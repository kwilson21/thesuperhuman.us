import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  validateTemplate,
  renderAgreement,
  sampleAgreementValues,
  templateFields,
  publishTemplate,
} from '~/lib/agreement-templates';
import {
  validateAgreementDetails,
  clientAgreementSchema,
  contractorSchema,
} from '~/lib/agreement-fields';
import {
  reviewAgreements,
  signAgreements,
  countersignAgreements,
  offerAgreements,
  executedOfferAgreement,
} from '~/lib/software-agreements';
import {
  agreementSession,
  completeAgreementLink,
  issueAgreementLink,
} from '~/lib/agreement-access';
import {
  prepareAgreementArtifact,
  deliverAgreementCopies,
  hashBytes,
} from '~/lib/agreement-artifacts';
import { agreementDownload } from '~/lib/agreement-download';
import { hashOfferToken, type SoftwareOffer } from '~/lib/software-offers';
import { projectToday } from '~/lib/audio-project-updates';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database, env: Env;
const token = 'x'.repeat(43),
  secret = 'test-agreement-code-key-at-least-32-characters',
  terms = {
    outcome: 'Synthetic tool',
    summary: 'A synthetic example.',
    milestones: [
      { name: 'One', deliverables: ['A view'], acceptance: ['Open the view'], feeCents: 101 },
    ],
    paymentMode: 'standard',
    clientInputs: '',
    exclusions: '',
    timing: '',
  };
const details = {
  planned_start: '2026-10-01',
  planned_end: '2026-10-20',
  environment: 'Browser',
  operating_responsibilities: 'Client operates',
  update_rhythm: 'Weekly',
  milestones: [{ start: '2026-10-01', target: '2026-10-20', handoff: 'Source and notices' }],
};
const client = {
  legal_name: 'Sample LLC',
  entity_type: 'LLC',
  jurisdiction: 'Wyoming',
  business_address: '100 Example Street',
  notice_email: 'notices@example.com',
  signer_name: 'Example Signer',
  signer_title: 'Representative',
  reviewer_name: 'Reviewer',
  reviewer_email: 'reviewer@example.com',
  approver_name: 'Approver',
  approver_email: 'approver@example.com',
  portfolio: 'deny',
  naming: false,
};
const contractor = {
  legal_name: 'Example Contractor LLC',
  entity_jurisdiction: 'Wyoming LLC',
  signer_name: 'Example Owner',
  signer_title: 'Representative',
  notice_email: 'owner@example.com',
  business_address: '200 Example Business Street',
  registered_agent_confirmed: true,
};
const synthetic = (kind: 'msa' | 'sow') =>
  templateFields[kind]
    .filter((f) => !f.startsWith('milestone.'))
    .map((f) => `${f}: {{${f}}}`)
    .join('\n') +
  (kind === 'sow'
    ? '\n{{#milestones}}\n' +
      templateFields.sow
        .filter((f) => f.startsWith('milestone.'))
        .map((f) => `${f}: {{${f}}}`)
        .join('\n') +
      '\n{{/milestones}}'
    : '');
const bucketData = new Map<string, Uint8Array>();
const bucketUploaded = new Map<string, Date>();
function adapter(database: InstanceType<typeof DatabaseSync>) {
  const statement = (query: string, args: unknown[] = []) => ({
    query,
    args,
    bind: (...values: unknown[]) => statement(query, values),
    first: async () => database.prepare(query).get(...args) ?? null,
    all: async () => ({ results: database.prepare(query).all(...args) }),
    run: async () => ({ meta: database.prepare(query).run(...args) }),
  });
  return {
    prepare: (query: string) => statement(query),
    batch: async (items: ReturnType<typeof statement>[]) => {
      database.exec('BEGIN');
      try {
        const result = items.map((i) => ({
          results: /^SELECT|RETURNING/.test(i.query)
            ? database.prepare(i.query).all(...i.args)
            : (database.prepare(i.query).run(...i.args), []),
        }));
        database.exec('COMMIT');
        return result;
      } catch (e) {
        database.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}
beforeEach(async () => {
  sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync('db/music.sql', 'utf8'));
  db = adapter(sql);
  bucketData.clear();
  bucketUploaded.clear();
  sql.exec(
    "UPDATE software_signing_settings SET software_signing_enabled=1; INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES('r','software','Example','client@example.com','Tool','reviewed','now','now');",
  );
  const msa = await publishTemplate(db, 'msa', synthetic('msa'), 0, 'owner@example.com'),
    sow = await publishTemplate(db, 'sow', synthetic('sow'), 0, 'owner@example.com');
  sql
    .prepare(
      "INSERT INTO software_offers(id,request_id,version,status,terms_json,agreement_details_json,msa_template_id,sow_template_id,contractor_snapshot_json,recipient_email_snapshot,created_at,updated_at) VALUES('o','r',1,'sent',?,?,?,?,?,'client@example.com','now','now')",
    )
    .run(
      JSON.stringify(terms),
      JSON.stringify(details),
      msa.id,
      sow.id,
      JSON.stringify(contractor),
    );
  sql
    .prepare("INSERT INTO software_offer_links VALUES('r',?,'now',NULL)")
    .run(await hashOfferToken(token));
  sql
    .prepare(
      "INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES('challenge','agreement','o',?,'client@example.com','hash','2020-01-01','2099-01-01')",
    )
    .run(await hashOfferToken(token));
  sql
    .prepare(
      "INSERT INTO software_agreement_sessions VALUES(?,'agreement','o',?,'client@example.com','challenge','2026-09-30T12:00:00Z','2099-01-01',NULL,'csrf')",
    )
    .run(await hashOfferToken(token), await hashOfferToken(token));
  const bucket = {
    put: vi.fn(async (k: string, v: string | Uint8Array, options?: {onlyIf?: {etagMatches?: string; etagDoesNotMatch?: string}}) => {
      const current=bucketData.get(k);
      const etag=current ? await hashBytes(current) : null;
      if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches!==etag) return null;
      if (options?.onlyIf?.etagDoesNotMatch==='*' && current) return null;
      bucketUploaded.set(k, new Date());
      return bucketData.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : v);
    }),
    list: vi.fn(async ({ prefix, cursor, limit = 1000 }: { prefix: string; cursor?: string; limit?: number }) => {
      const keys = [...bucketData.keys()].filter(k => k.startsWith(prefix)).sort();
      if (cursor && !cursor.startsWith('after:')) throw new Error('Invalid cursor');
      const remaining = keys.filter(key => !cursor || key > cursor.slice(6));
      const page = remaining.slice(0, limit);
      return {
        objects: page.map(key => ({ key, uploaded: bucketUploaded.get(key) ?? new Date(0) })),
        truncated: remaining.length > limit,
        cursor: remaining.length > limit ? `after:${page.at(-1)}` : undefined,
      };
    }),
    delete: vi.fn(async (k: string) => {
      bucketUploaded.delete(k);
      return bucketData.delete(k);
    }),
    get: vi.fn(async (k: string) => {
      const b = bucketData.get(k);
      return b
        ? {
            size: b.length,
            etag: await hashBytes(b),
            body: b,
            arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          }
        : null;
    }),
  };
  env = {
    MUSIC_DB: db,
    AUDIO: bucket,
    RESEND_API_KEY: 'fake',
    CONTACT_FROM_EMAIL: 'sender@example.com',
    AUDIO_CLIENT_CODE_KEY: secret,
    TURNSTILE_SECRET_KEY: 'fake',
    SITE_ORIGIN: 'https://example.com',
  } as unknown as Env;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"success":true}', { status: 200 })),
  );
});
afterEach(() => {
  sql.close();
  vi.unstubAllGlobals();
});
const request = () =>
  new Request(`https://example.com/offer/${token}/sign`, {
    headers: {
      cookie: `agreement_session=${token}`,
      'cf-connecting-ip': '192.0.2.1',
      'user-agent': 'Synthetic browser',
    },
  });
const offer = () => db.prepare("SELECT * FROM software_offers WHERE id='o'").first<SoftwareOffer>();
async function review() {
  return reviewAgreements(
    db,
    (await offer())!,
    (await agreementSession(db, request(), 'agreement', 'o'))!,
    client,
  );
}
async function signed() {
  const result = await review(),
    session = (await agreementSession(db, request(), 'agreement', 'o'))!;
  await signAgreements(db, (await offer())!, session, result.documents, request());
  return result;
}
it('removes an unused former client identity when replacing an unsigned review', async () => {
  await review();
  const former = sql.prepare('SELECT id FROM software_agreement_clients').get().id as string;
  await reviewAgreements(db, (await offer())!, (await agreementSession(db, request(), 'agreement', 'o'))!, {
    ...client,
    legal_name: 'Updated Sample LLC',
  });
  expect(sql.prepare('SELECT id FROM software_agreement_clients WHERE id=?').get(former)).toBeUndefined();
  const current = sql.prepare('SELECT client_id FROM software_agreements WHERE offer_id=?').get('o').client_id;
  expect(sql.prepare('SELECT legal_name FROM software_agreement_clients WHERE id=?').get(current)).toEqual({ legal_name: 'Updated Sample LLC' });
});
it('removes a just-uploaded PDF when its database row cannot be saved', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = await pdf.save();
  const batch = vi.spyOn(db, 'batch').mockRejectedValue(new Error('database unavailable'));
  try {
    const { PUT } = await import('~/pages/api/owner/requests/[id]/agreement-attachments');
    const response = await PUT({
      params: { id: 'r' },
      url: new URL('https://example.com/api/owner/requests/r/agreement-attachments?filename=Sample.pdf&version=v1&date=2026-10-01'),
      request: new Request('https://example.com/api/owner/requests/r/agreement-attachments', {
        method: 'PUT', headers: { origin: 'https://example.com', 'content-type': 'application/pdf' }, body: bytes as BodyInit,
      }),
      locals: { owner: { email: 'owner@example.com' }, runtime: { env } },
    } as never);
    expect(response.status).toBe(503);
    expect(env.AUDIO!.put).toHaveBeenCalledOnce();
    expect(env.AUDIO!.delete).toHaveBeenCalledOnce();
    expect(bucketData.size).toBe(0);
  } finally { batch.mockRestore(); }
});
it.each(['msa', 'sow'] as const)(
  'rejects incomplete %s templates, HTML, blanks, unknown fields and nesting',
  (kind) => {
    for (const text of [
      synthetic(kind).replace(/{{[^}]+}}/, ''),
      synthetic(kind) + '<b>HTML</b>',
      synthetic(kind) + ' [BLANK]',
      synthetic(kind) + '{{unknown.field}}',
      synthetic(kind) + '{{#milestones}}{{#milestones}}{{/milestones}}{{/milestones}}',
    ])
      expect(() => validateTemplate(kind, text)).toThrow();
    expect(validateTemplate(kind, synthetic(kind))).toBe(synthetic(kind));
  },
);
it('fills optional SOW fields in template samples', () => {
  const text = `${synthetic('sow')}\nSummary: {{sow.summary}}\nTiming: {{sow.timing}}`;
  const rendered = renderAgreement('sow', text, sampleAgreementValues('sow', text));
  expect(rendered).toContain('Summary: Sample summary');
  expect(rendered).toContain('Timing: Sample timing');
});
it('enforces dates, milestone counts, invoice duration and owner default semantics', () => {
  expect(validateAgreementDetails(details, terms as never).review_business_days).toBe(5);
  for (const value of [
    { ...details, planned_end: '2027-01-01' },
    { ...details, milestones: [] },
    { ...details, review_business_days: 31 },
    { ...details, data_retention: 'Keep longer', project_retention_days: 500 },
  ])
    expect(() => validateAgreementDetails(value, terms as never)).toThrow();
  expect(() =>
    validateAgreementDetails(details, { ...terms, paymentMode: 'invoice' } as never),
  ).toThrow();
  expect(() => clientAgreementSchema.parse({ ...client, naming: true })).toThrow();
  expect(() =>
    contractorSchema.parse({ ...contractor, registered_agent_confirmed: false }),
  ).toThrow();
});
it('pins immutable templates with publication CAS', async () => {
  await expect(publishTemplate(db, 'msa', synthetic('msa'), 0, 'owner')).rejects.toThrow();
  const original = (await offer())!.msa_template_id;
  await publishTemplate(db, 'msa', synthetic('msa'), 1, 'owner');
  expect((await offer())!.msa_template_id).toBe(original);
  expect(() =>
    sql
      .prepare('UPDATE software_agreement_templates SET text=? WHERE id=?')
      .run('changed', original),
  ).toThrow();
});
it('creates complete canonical previews and exact cents without unresolved fields', async () => {
  const result = await review();
  expect(result.documents).toHaveLength(2);
  for (const d of result.documents) {
    expect(d.text).not.toMatch(/{{|}}|\[[^\]]+\]|_{3,}/);
    expect(await hashOfferToken(d.text)).toBe(d.hash);
  }
  expect(result.documents[1].text).toContain('$0.51');
  expect(result.documents[1].text).toContain('$0.50');
});
it('rejects stale hashes and stores one atomic client action with email, IP and browser', async () => {
  const result = await review(),
    session = (await agreementSession(db, request()))!;
  await expect(
    signAgreements(
      db,
      (await offer())!,
      session,
      result.documents.map((d) => ({ ...d, hash: '0'.repeat(64) })),
      request(),
    ),
  ).rejects.toThrow();
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(0);
  const receipt = await signAgreements(db, (await offer())!, session, result.documents, request());
  expect(await signAgreements(db, (await offer())!, session, result.documents, request())).toBe(
    receipt,
  );
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(2);
  expect(
    sql
      .prepare(
        'SELECT verified_email,ip_address,user_agent FROM software_agreement_signatures LIMIT 1',
      )
      .get(),
  ).toEqual({
    verified_email: 'client@example.com',
    ip_address: '192.0.2.1',
    user_agent: 'Synthetic browser',
  });
  expect(await executedOfferAgreement(db, 'o')).toBeNull();
  await expect(review()).rejects.toThrow();
  expect(() =>
    sql.prepare("UPDATE software_agreements SET canonical_text='Changed' WHERE offer_id='o'").run(),
  ).toThrow();
});
it('does not sign a regenerated preview from another session', async () => {
  const result = await review(),
    session = (await agreementSession(db, request()))!;
  await expect(
    signAgreements(
      db,
      (await offer())!,
      { ...session, token_hash: 'wrong' },
      result.documents,
      request(),
    ),
  ).rejects.toThrow();
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(0);
});
it('countersigns identical hashes atomically and blocks start until artifact and two copies', async () => {
  const result = await signed();
  const id = await countersignAgreements(
    db,
    (await offer())!,
    result.documents,
    'Example Owner',
    'owner@example.com',
    request(),
  );
  expect(
    sql.prepare("SELECT count(*) n FROM software_agreements WHERE status='executed'").get().n,
  ).toBe(2);
  expect(sql.prepare('SELECT DISTINCT party,ip_address,user_agent FROM software_agreement_signatures ORDER BY party').all()).toEqual([
    { party: 'client', ip_address: '192.0.2.1', user_agent: 'Synthetic browser' },
    { party: 'contractor', ip_address: '192.0.2.1', user_agent: 'Synthetic browser' },
  ]);
  expect(await executedOfferAgreement(db, 'o')).toBeNull();
  const render = vi.fn(async () => new TextEncoder().encode('%PDF-synthetic'));
  await prepareAgreementArtifact(env, id, render);
  expect(render).toHaveBeenCalledOnce();
  await prepareAgreementArtifact(env, id, render);
  expect(render).toHaveBeenCalledOnce();
  await deliverAgreementCopies(env, id);
  expect(await executedOfferAgreement(db, 'o')).toMatchObject({ id });
  expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).attachments).toHaveLength(1);
  for (const [index, party] of ['client', 'contractor'].entries()) {
    const signature = sql.prepare('SELECT receipt_id FROM software_agreement_signatures WHERE agreement_id=? AND party=?').get(id, party);
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[index][1]?.body));
    expect(payload.text).toContain(`Receipt: ${signature.receipt_id}`);
    expect(payload.text).not.toContain(`Receipt: ${id}\n`);
  }
  const ownerCopy = await agreementDownload(env, request(), id, true);
  expect(ownerCopy.status).toBe(200);
  expect((await agreementDownload(env, new Request('https://example.com'), id)).status).toBe(401);
});
it('retains signatures after artifact failure and copy provider uncertainty', async () => {
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Example Owner',
      'owner',
      request(),
    );
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await prepareAgreementArtifact(env, id, async () => {
    throw new Error('render failed');
  });
  expect(log).toHaveBeenLastCalledWith('Agreement artifact preparation failed:', 'Error', 'render failed');
  await prepareAgreementArtifact(env, id, async () => {
    throw new SyntaxError('Invalid JSON containing private signer text');
  });
  expect(log).toHaveBeenLastCalledWith('Agreement artifact preparation failed:', 'SyntaxError', 'Invalid JSON.');
  log.mockRestore();
  expect(
    sql.prepare('SELECT status FROM software_agreement_artifacts WHERE agreement_id=?').get(id)
      .status,
  ).toBe('failed');
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(4);
  await prepareAgreementArtifact(env, id, async () => new TextEncoder().encode('%PDF-synthetic'));
  vi.mocked(fetch).mockRejectedValue(new Error('timeout'));
  await deliverAgreementCopies(env, id);
  expect(
    sql
      .prepare('SELECT status FROM software_agreement_deliveries')
      .all()
      .map((r: { status: string }) => r.status),
  ).toEqual(['sending', 'sending']);
  expect(await executedOfferAgreement(db, 'o')).toBeNull();
});
it('invalidates scoped signing access on revoked links without granting studio access', async () => {
  expect(await agreementSession(db, request())).not.toBeNull();
  sql.exec("UPDATE software_offer_links SET revoked_at='now'");
  expect(await agreementSession(db, request())).toBeNull();
  expect(
    await agreementSession(
      db,
      new Request('https://example.com', { headers: { cookie: `studio_session=${token}` } }),
    ),
  ).toBeNull();
});
it('issues a hashed pinned-recipient link, consumes once, expires and limits resend', async () => {
  const req = new Request('https://example.com', { headers: { 'cf-connecting-ip': '192.0.2.2' } });
  expect((await issueAgreementLink(env, req, { turnstileToken: 'test' }, token)).status).toBe(200);
  const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  expect(payload.to).toEqual(['client@example.com']);
  expect(payload.subject).toBe('Open your agreement');
  const link = new URL(payload.text.match(/https:\/\/\S+/)[0]);
  const key = link.searchParams.get('key')!;
  const stored = sql.prepare('SELECT * FROM software_agreement_links WHERE token_hash=?').get(await hashOfferToken(key));
  expect(stored).toBeTruthy();
  expect(JSON.stringify(stored)).not.toContain(key);
  expect(Date.parse(stored.expires_at)-Date.parse(stored.issued_at)).toBe(3600000);
  const landing = await completeAgreementLink(env, req, key, token);
  expect(landing.status).toBe(200);
  expect(sql.prepare('SELECT used_at FROM software_agreement_links WHERE id=?').get(stored.id).used_at).toBeNull();
  const opened = await completeAgreementLink(env, new Request(req.url, {method:"POST"}), key, token);
  expect(opened.status).toBe(303);
  expect(opened.headers.get('location')).toBe(`/offer/${token}/sign`);
  expect(opened.headers.get('set-cookie')).toContain('Max-Age=7200');
  expect((await completeAgreementLink(env, req, key, token)).status).toBe(401);
  expect((await issueAgreementLink(env, req, { turnstileToken: 'test' }, token)).status).toBe(429);
});
it('rejects expired links without creating a session', async () => {
  await issueAgreementLink(env, request(), {turnstileToken:'test'}, token);
  const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  const key = new URL(payload.text.match(/https:\/\/\S+/)[0]).searchParams.get('key')!;
  sql.prepare("UPDATE software_agreement_links SET expires_at='2000-01-01'").run();
  expect((await completeAgreementLink(env,new Request(request(),{method:"POST"}),key,token)).status).toBe(401);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_sessions').get().n).toBe(1);
});
it('keeps archive access independent of closed projects and the signing switch', async () => {
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Owner',
      'owner',
      request(),
    );
  await prepareAgreementArtifact(env, id, async () => new TextEncoder().encode('%PDF-synthetic'));
  sql.exec(
    "UPDATE software_signing_settings SET software_signing_enabled=0; UPDATE owner_requests SET email='',name='',details_json='{}',private_note='',city_region='',status='withdrawn';",
  );
  sql
    .prepare(
      "INSERT INTO software_agreement_sessions VALUES(?,'archive',NULL,NULL,'client@example.com','challenge','now','2099-01-01',NULL,'archive-csrf')",
    )
    .run(await hashOfferToken('a'.repeat(43)));
  const response = await agreementDownload(
    env,
    new Request('https://example.com', {
      headers: { cookie: `agreement_archive=${'a'.repeat(43)}` },
    }),
    id,
  );
  expect(response.status).toBe(200);
});
it('refuses to serve a retained signed PDF whose bytes no longer match its digest', async () => {
  const result = await signed();
  const id = await countersignAgreements(db, (await offer())!, result.documents, 'Owner', 'owner@example.com', request());
  await prepareAgreementArtifact(env, id, async () => new TextEncoder().encode('%PDF-original'));
  const artifact = sql.prepare('SELECT pdf_key FROM software_agreement_artifacts WHERE agreement_id=?').get(id) as { pdf_key: string };
  bucketData.set(artifact.pdf_key, new TextEncoder().encode('%PDF-changed'));
  const response = await agreementDownload(env, request(), id, true);
  expect(response.status).toBe(503);
  expect(await response.text()).toMatch(/integrity check/i);
});
it('runs private source templates through one, two and three milestones in both payment modes when supplied', async () => {
  const path = process.env.AGREEMENT_PRIVATE_TEMPLATES;
  if (!path) return;
  const templates = JSON.parse(readFileSync(path, 'utf8')) as { msa: string; sow: string };
  const { agreementValues } = await import('~/lib/agreement-fields');
  for (const count of [1, 2, 3])
    for (const mode of ['standard', 'invoice']) {
      const purchase = {
        ...terms,
        paymentMode: mode,
        milestones: Array.from({ length: count }, (_, i) => ({
          ...terms.milestones[0],
          name: `Milestone ${i + 1}`,
        })),
      };
      const filled = validateAgreementDetails(
        {
          ...details,
          invoice_first_duration: mode === 'invoice' ? 1 : null,
          milestones: Array.from({ length: count }, (_, i) => ({
            ...details.milestones[0],
            start: `2026-10-${String(1 + i * 5).padStart(2, '0')}`,
            target: `2026-10-${String(5 + i * 5).padStart(2, '0')}`,
          })),
        },
        purchase as never,
      );
      const values = agreementValues(
        purchase as never,
        filled,
        clientAgreementSchema.parse(client),
        contractorSchema.parse(contractor),
        {
          effective_on: '2026-09-30',
          msa_version: '2026-09-30 / template 1',
          sow_number: 'SOW-example',
          offer_version: 1,
          template_version: 1,
        },
      );
      for (const kind of ['msa', 'sow'] as const)
        expect(renderAgreement(kind, templates[kind], values)).not.toMatch(
          /{{|}}|\[[^\]]+\]|_{3,}/,
        );
    }
});
it('recovers only an owner-confirmed stale artifact attempt', async () => {
  const { recoverAgreementRendering } = await import('~/lib/agreement-artifacts');
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Owner',
      'owner',
      request(),
    );
  const attempt = crypto.randomUUID();
  sql
    .prepare(
      "UPDATE software_agreement_artifacts SET status='rendering',attempt_id=?,attempted_at='2020-01-01' WHERE agreement_id=?",
    )
    .run(attempt, id);
  expect(await recoverAgreementRendering(db, id, attempt, false)).toBe(false);
  expect(await recoverAgreementRendering(db, id, 'wrong', true)).toBe(false);
  expect(await recoverAgreementRendering(db, id, attempt, true)).toBe(true);
  await prepareAgreementArtifact(env, id, async () => new TextEncoder().encode('%PDF-recovered'));
  expect(
    sql.prepare('SELECT status FROM software_agreement_artifacts WHERE agreement_id=?').get(id)
      .status,
  ).toBe('ready');
});
it('normalizes native Turnstile form submissions and enforces Origin', async () => {
  const { agreementRequest } = await import('~/lib/agreement-request');
  const body = await agreementRequest(
    new Request('https://example.com/api/agreements/link', {
      method: 'POST',
      headers: {
        origin: 'https://example.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'cf-turnstile-response=completed&turnstileToken=',
    }),
  );
  expect(body).toMatchObject({ turnstileToken: 'completed' });
  expect(
    (
      (await agreementRequest(
        new Request('https://example.com/api/agreements/link', {
          method: 'POST',
          headers: {
            origin: 'https://other.example',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'cf-turnstile-response=completed',
        }),
      )) as Response
    ).status,
  ).toBe(403);
});
it('excludes open, held and in-use MSAs from the separate retention preview', async () => {
  const { previewAgreementRetention } = await import('~/lib/agreement-retention');
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Owner',
      'owner',
      request(),
    );
  expect((await previewAgreementRetention(db, env.AUDIO, 'test-storage')).agreements).toEqual([]);
  sql
    .prepare(
      "UPDATE software_agreements SET ended_at='2000-01-01',retain_until='2010-01-01',legal_hold=1 WHERE id=?",
    )
    .run(id);
  expect((await previewAgreementRetention(db, env.AUDIO, 'test-storage')).agreements).toEqual([]);
  sql.prepare('UPDATE software_agreements SET legal_hold=0 WHERE id=?').run(id);
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements.map((a) => a.id)).toEqual([id]);
});
it('binds exact archive retention to storage and protects held records from stale review', async () => {
  const { previewAgreementRetention, applyAgreementRetention } =
    await import('~/lib/agreement-retention');
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Owner',
      'owner',
      request(),
    );
  sql
    .prepare(
      "UPDATE software_agreements SET ended_at='2000-01-01',retain_until='2010-01-01' WHERE id=?",
    )
    .run(id);
  await prepareAgreementArtifact(env, id, async () => new TextEncoder().encode('%PDF-retired'));
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  await expect(applyAgreementRetention(db, env.AUDIO, 'different', manifest)).rejects.toThrow();
  sql.prepare('UPDATE software_agreements SET legal_hold=1 WHERE id=?').run(id);
  await expect(applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest)).rejects.toThrow();
  expect(sql.prepare('SELECT id FROM software_agreements WHERE id=?').get(id)).toBeTruthy();
});
it('deletes only the reviewed retired packet, closes archive access and keeps a safe receipt', async () => {
  const { previewAgreementRetention, applyAgreementRetention } =
    await import('~/lib/agreement-retention');
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Owner',
      'owner',
      request(),
    );
  sql
    .prepare(
      "UPDATE software_agreements SET ended_at='2000-01-01',retain_until='2010-01-01' WHERE id=?",
    )
    .run(id);
  await prepareAgreementArtifact(env, id, async () => new TextEncoder().encode('%PDF-retired'));
  bucketData.set('software/unrelated/visual.png', new Uint8Array([1]));
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest);
  expect(sql.prepare('SELECT id FROM software_agreements WHERE id=?').get(id)).toBeUndefined();
  expect(bucketData.has('software/unrelated/visual.png')).toBe(true);
  expect(
    sql.prepare('SELECT agreement_id FROM software_agreement_retention_receipts').get(),
  ).toEqual({ agreement_id: id });
});
it('expires an ended SOW once its project content has been deleted', async () => {
  const { previewAgreementRetention, applyAgreementRetention } =
    await import('~/lib/agreement-retention');
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Owner',
      'owner',
      request(),
    );
  sql
    .prepare(
      "UPDATE software_agreements SET ended_at='2000-01-01',retain_until='2010-01-01' WHERE id=?",
    )
    .run(id);
  sql
    .prepare(
      "INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,content_deleted_at,agreement_id) VALUES('r','o','{}','standard','now','now','now','owner','now','now','now',?)",
    )
    .run(id);
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements.map((a) => a.id)).toContain(id);
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest);
  expect(
    sql.prepare("SELECT agreement_id FROM software_projects WHERE request_id='r'").get(),
  ).toEqual({ agreement_id: null });
});
it('records business authority in the single explicit consent statement', () => {
  expect(clientAgreementSchema.safeParse(client).success).toBe(true);
  const source=readFileSync('src/pages/offer/[token]/sign.astro','utf8');
  expect(source.match(/type="checkbox"/g)).toHaveLength(1);
  expect(source).not.toContain('name="initials"');
});
it('removes expired access data while retaining signature verification evidence', async () => {
  const { cleanupAgreementAccess } = await import('~/lib/agreement-access');
  await signed();
  sql.exec(
    "UPDATE software_agreement_sessions SET expires_at='2020-01-01';UPDATE software_agreement_links SET expires_at='2020-01-01';",
  );
  await cleanupAgreementAccess(db);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_sessions').get().n).toBe(0);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_links').get().n).toBe(0);
  expect(
    sql
      .prepare('SELECT verified_email,verified_at FROM software_agreement_signatures LIMIT 1')
      .get(),
  ).toEqual({ verified_email: 'client@example.com', verified_at: '2026-09-30T12:00:00Z' });
});
it('does not reconcile a pre-existing packet whose stored digest is missing or corrupt', async () => {
  const result = await signed(),
    id = await countersignAgreements(
      db,
      (await offer())!,
      result.documents,
      'Owner',
      'owner',
      request(),
    );
  await prepareAgreementArtifact(env, id, async () => new TextEncoder().encode('%PDF-synthetic'));
  sql
    .prepare("UPDATE software_agreement_artifacts SET status='failed' WHERE agreement_id=?")
    .run(id);
  await prepareAgreementArtifact(env, id, async () => {
    throw new Error('must not render over existing object');
  });
  expect(
    sql.prepare('SELECT status FROM software_agreement_artifacts WHERE agreement_id=?').get(id)
      .status,
  ).toBe('failed');
});
it('validates font coverage before preserving a review snapshot', async () => {
  const coverage = JSON.parse(
    readFileSync('src/assets/agreement-fonts/Inter-coverage.json', 'utf8'),
  );
  expect(await hashBytes(readFileSync('src/assets/agreement-fonts/Inter-400.ttf'))).toBe(
    coverage.sha256,
  );
  const session = (await agreementSession(db, request()))!;
  await expect(
    reviewAgreements(db, (await offer())!, session, { ...client, signer_name: 'Unsupported 🧪' }),
  ).rejects.toThrow('Unsupported character');
  expect(sql.prepare('SELECT count(*) n FROM software_agreements').get().n).toBe(0);
});
it('never interprets substituted milestone text as another template field', async () => {
  sql.prepare("UPDATE software_offers SET terms_json=? WHERE id='o'").run(
    JSON.stringify({
      ...terms,
      milestones: [{ ...terms.milestones[0], name: '{{client.legal_name}}' }],
    }),
  );
  await expect(review()).rejects.toThrow('unresolved blanks');
  expect(sql.prepare('SELECT count(*) n FROM software_agreements').get().n).toBe(0);
});
it('uses Unicode casefold for legal-party lookup while preserving original names', async () => {
  const { legalNameKey } = await import('~/lib/software-agreements');
  expect(legalNameKey(' Straße LLC ')).toBe(legalNameKey('STRASSE LLC'));
  expect(legalNameKey('ΟΣ')).toBe(legalNameKey('ος'));
  expect(legalNameKey('Café')).toBe(legalNameKey('Cafe\u0301'));
});
it('records changed notice details separately from the immutable party snapshot', async () => {
  await review();
  const session = (await agreementSession(db, request()))!;
  const updated = await reviewAgreements(db, (await offer())!, session, {
    ...client,
    business_address: '300 Other Example Street',
    notice_email: 'updated@example.com',
  });
  await signAgreements(db, (await offer())!, session, updated.documents, request());
  expect(
    sql.prepare('SELECT business_address,notice_email FROM software_agreement_clients').get(),
  ).toEqual({ business_address: client.business_address, notice_email: client.notice_email });
  expect(
    sql
      .prepare('SELECT business_address,notice_email,recorded_at FROM software_agreement_notices')
      .get(),
  ).toMatchObject({
    business_address: '300 Other Example Street',
    notice_email: 'updated@example.com',
    recorded_at: expect.stringContaining('T'),
  });
});
it('queues signature receipts atomically and keeps uncertain notifications visible without repeating them', async () => {
  const { deliverAgreementNotifications } = await import('~/lib/agreement-artifacts');
  await signed();
  const id = (await offerAgreements(db, 'o')).find((d) => d.kind === 'sow')!.id;
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_notifications').get().n).toBe(2);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('unknown provider outcome');
    }),
  );
  await deliverAgreementNotifications(env, id);
  expect(
    sql
      .prepare("SELECT count(*) n FROM software_agreement_notifications WHERE status='sending'")
      .get().n,
  ).toBe(2);
  const count = vi.mocked(fetch).mock.calls.length;
  await deliverAgreementNotifications(env, id);
  expect(vi.mocked(fetch).mock.calls.length).toBe(count);
});
it('rejects unsupported countersigner names before execution and losslessly renders browser evidence', async () => {
  const result = await signed();
  await expect(
    countersignAgreements(db, (await offer())!, result.documents, 'Owner 🧪', 'owner', request()),
  ).rejects.toThrow('Unsupported character');
  expect(
    sql
      .prepare("SELECT count(*) n FROM software_agreement_signatures WHERE party='contractor'")
      .get().n,
  ).toBe(0);
  const { agreementCertificateText } = await import('~/lib/agreement-templates');
  const raw = JSON.stringify({ user_agent: 'Browser 🧪 漢', typed_name: 'José' }),
    display = agreementCertificateText(raw);
  expect(JSON.parse(display)).toEqual(JSON.parse(raw));
  expect(display).toContain('José');
  expect(display).toContain('\\ud83e\\uddea');
});
it('retires unsigned snapshots on link changes without blocking the next MSA review', async () => {
  const { abandonUnsignedAgreementReviews } = await import('~/lib/software-agreements');
  const old = await review();
  await db.batch([abandonUnsignedAgreementReviews(db, 'r', '2000-01-01T00:00:00Z')]);
  const fresh = await review();
  expect(
    fresh.documents.every((d) => !old.documents.some((previous) => previous.id === d.id)),
  ).toBe(true);
  const { previewAgreementRetention, applyAgreementRetention } =
    await import('~/lib/agreement-retention');
  let manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements.map((a) => a.id)).toEqual([
    old.documents.find((d) => d.kind === 'sow')!.id,
  ]);
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest);
  manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements.map((a) => a.id)).toEqual([
    old.documents.find((d) => d.kind === 'msa')!.id,
  ]);
});
it.each(['client-signed', 'pdf-failed', 'copies-pending'])(
  'prevents external start from bypassing website state %s',
  async (state) => {
    const result = await signed();
    if (state !== 'client-signed') {
      const id = await countersignAgreements(
        db,
        (await offer())!,
        result.documents,
        'Owner',
        'owner',
        request(),
      );
      if (state === 'pdf-failed')
        sql
          .prepare("UPDATE software_agreement_artifacts SET status='failed' WHERE agreement_id=?")
          .run(id);
      else
        await prepareAgreementArtifact(env, id, async () =>
          new TextEncoder().encode('%PDF-pending-copies'),
        );
    }
    const { POST } = await import('~/pages/api/owner/requests/[id]/project');
    for (const signature_source of ['external', 'website']) {
      const body = {
        action: 'start',
        signature_source,
        offer_id: 'o',
        offer_version: 1,
        expectedRequestUpdatedAt: 'now',
        signatures: true,
        payment: true,
        inputs_ready: true,
        external_signed_on: '2026-09-30',
        external_parties: 'Sample LLC / Example Contractor LLC',
        external_kept_copy: true,
        external_copy_reference: 'Synthetic kept copy',
        next_update_on: '',
      };
      const response = await POST({
        params: { id: 'r' },
        request: new Request('https://example.com/api/owner/requests/r/project', {
          method: 'POST',
          headers: { origin: 'https://example.com', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        locals: {
          owner: { email: 'owner@example.com' },
          runtime: { env: { ...env, AUDIO_CLIENT_PORTAL_ENABLED: 'true' } },
        },
      } as never);
      expect(response.status).toBe(409);
    }
    expect(sql.prepare('SELECT count(*) n FROM software_projects').get().n).toBe(0);
  },
);
it('attributes owner verification to the Access account rather than the configured notice mailbox', async () => {
  const result = await signed();
  await countersignAgreements(
    db,
    (await offer())!,
    result.documents,
    'Owner',
    'access-owner@example.com',
    request(),
  );
  expect(
    sql
      .prepare(
        "SELECT verified_email FROM software_agreement_signatures WHERE party='contractor' LIMIT 1",
      )
      .get(),
  ).toEqual({ verified_email: 'access-owner@example.com' });
  expect(
    sql
      .prepare("SELECT email FROM software_agreement_deliveries WHERE recipient_role='contractor'")
      .get(),
  ).toEqual({ email: contractor.notice_email });
});
it('abandons the complete pending signing action atomically and retains the signatures', async () => {
  const result = await signed(),
    { POST } = await import('~/pages/api/owner/requests/[id]/agreement');
  const call = (documents: { id: string; hash: string }[]) =>
    POST({
      params: { id: 'r' },
      request: new Request('https://example.com/api/owner/requests/r/agreement', {
        method: 'POST',
        headers: {
          origin: 'https://example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'abandon',
          documents,
          reason: 'Fictional owner cancellation',
          confirmed: true,
        }),
      }),
      locals: { owner: { email: 'owner@example.com' }, runtime: { env } },
    } as never);
  expect((await call([result.documents[0]])).status).toBe(409);
  expect(
    sql.prepare("SELECT count(*) n FROM software_agreements WHERE status='client_signed'").get()
      .n,
  ).toBe(2);
  expect((await call(result.documents)).status).toBe(200);
  expect((await offer())!.status).toBe('superseded');
  expect(await agreementSession(db, request())).toBeNull();
  expect(
    sql.prepare("SELECT count(*) n FROM software_agreements WHERE status='abandoned'").get().n,
  ).toBe(2);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(2);
  expect(
    sql
      .prepare("SELECT DISTINCT reason FROM software_agreement_events WHERE action='abandoned'")
      .get().reason,
  ).toBe('owner-abandoned');
  expect(
    sql
      .prepare("SELECT count(*) n FROM software_agreement_events WHERE action='abandoned'")
      .get().n,
  ).toBe(2);
});
it.each(['executed', 'abandoned'])(
  'keeps %s evidence under a dated ten-year policy without backdating',
  async (state) => {
    const result = await signed();
    let id = result.documents.find((d) => d.kind === 'sow')!.id;
    if (state === 'executed')
      id = await countersignAgreements(
        db,
        (await offer())!,
        result.documents,
        'Owner',
        'owner@example.com',
        request(),
      );
    else
      sql.exec(
        "UPDATE software_agreements SET status='abandoned',abandoned_at='now' WHERE status='client_signed'",
      );
    const { POST } = await import('~/pages/api/owner/requests/[id]/agreement');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const end = (ended_on: string) =>
      POST({
        params: { id: 'r' },
        request: new Request('https://example.com/api/owner/requests/r/agreement', {
          method: 'POST',
          headers: {
            origin: 'https://example.com',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'end',
            agreement_id: id,
            ended_on,
            confirmed: true,
          }),
        }),
        locals: { owner: { email: 'owner@example.com' }, runtime: { env } },
      } as never);
    expect((await end('2000-01-01')).status).toBe(409);
    expect((await end('2099-01-01')).status).toBe(409);
    expect(
      sql.prepare('SELECT ended_at FROM software_agreements WHERE id=?').get(id).ended_at,
    ).toBeNull();
    expect((await end(today)).status).toBe(200);
    const row = sql
      .prepare('SELECT ended_at,retain_until FROM software_agreements WHERE id=?')
      .get(id);
    expect(row.ended_at).toBe(today);
    expect(row.retain_until).toMatch(new RegExp(`^${Number(today.slice(0, 4)) + 10}-`));
    expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(
      state === 'executed' ? 4 : 2,
    );
  },
);
it('fences archive cleanup against active work and rejects artifact claims after closure', async () => {
  const { previewAgreementRetention } = await import('~/lib/agreement-retention');
  const result = await signed();
  const id = await countersignAgreements(db,(await offer())!,result.documents,'Owner','owner',request());
  sql.prepare("UPDATE software_agreements SET ended_at='2000-01-01',retain_until='2010-01-01' WHERE id=?").run(id);
  sql.prepare("UPDATE software_agreement_artifacts SET status='rendering' WHERE agreement_id=?").run(id);
  expect((await previewAgreementRetention(db,env.AUDIO,'test')).agreements).toEqual([]);
  sql.prepare("UPDATE software_agreement_artifacts SET status='failed' WHERE agreement_id=?").run(id);
  sql.prepare("UPDATE software_agreement_deliveries SET status='sending' WHERE agreement_id=?").run(id);
  expect((await previewAgreementRetention(db,env.AUDIO,'test')).agreements).toEqual([]);
  sql.prepare("UPDATE software_agreement_deliveries SET status='pending' WHERE agreement_id=?").run(id);
  expect((await previewAgreementRetention(db,env.AUDIO,'test')).agreements.map(a=>a.id)).toContain(id);
  sql.prepare("UPDATE software_agreements SET archive_closed_at='now' WHERE id=?").run(id);
  const render = vi.fn(async()=>new Uint8Array([1]));
  await prepareAgreementArtifact(env,id,render);
  expect(render).not.toHaveBeenCalled();
  await deliverAgreementCopies(env,id);
  expect(sql.prepare('SELECT status FROM software_agreement_deliveries WHERE agreement_id=?').all(id).every((d:{status:string})=>d.status==='pending')).toBe(true);
  expect(()=>sql.prepare('UPDATE software_agreements SET legal_hold=1 WHERE id=?').run(id)).toThrow('Archive cleanup is reserved');
});
it('keeps a signed abandoned agreement and its offer out of request retention', async () => {
  const { previewOwnerRetention } = await import('../../scripts/owner-retention.mjs');
  await signed();
  sql.exec("UPDATE software_agreements SET status='abandoned',abandoned_at='2020-01-01'; UPDATE owner_requests SET status='resolved',resolved_at='2020-01-01',updated_at='2020-01-01'");
  const preview = await previewOwnerRetention({query:async(statement:string)=>sql.prepare(statement).all()},'test');
  expect(preview.requestContacts).toBe(0);
  expect(sql.prepare('SELECT COUNT(*) AS n FROM software_agreements').get().n).toBe(2);
});
it.each(['resolved','withdrawn'])('rejects signing and new sessions for a %s request', async status => {
  const reviewed = await review();
  const session = (await agreementSession(db,request(),'agreement','o'))!;
  sql.prepare('UPDATE owner_requests SET status=?').run(status);
  expect(await agreementSession(db,request(),'agreement','o')).toBeNull();
  await expect(signAgreements(db,(await offer())!,session,reviewed.documents,request())).rejects.toThrow();
});
it('consumes a link atomically under parallel verification', async () => {
  await issueAgreementLink(env,request(),{turnstileToken:'test'},token);
  const payload=JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  const key=new URL(payload.text.match(/https:\/\/\S+/)[0]).searchParams.get('key')!;
  const results=await Promise.all([completeAgreementLink(env,new Request(request(),{method:"POST"}),key,token),completeAgreementLink(env,new Request(request(),{method:"POST"}),key,token)]);
  expect(results.map(r=>r.status).sort()).toEqual([303,401]);
});
it('rejects expired sessions, wrong recipients, studio cookies and archive purpose for signing', async () => {
  const original = (await agreementSession(db,request(),'agreement','o'))!;
  sql.prepare("UPDATE software_agreement_sessions SET expires_at='2000-01-01'").run();
  expect(await agreementSession(db,request(),'agreement','o')).toBeNull();
  sql.prepare("UPDATE software_agreement_sessions SET expires_at='2099-01-01',recipient_email='other@example.test'").run();
  expect(await agreementSession(db,request(),'agreement','o')).toBeNull();
  sql.prepare("UPDATE software_agreement_sessions SET recipient_email=?,purpose='archive'").run(original.recipient_email);
  expect(await agreementSession(db,request(),'agreement','o')).toBeNull();
  expect(await agreementSession(db,new Request('https://example.com',{headers:{cookie:`studio_session=${token}`}}),'agreement','o')).toBeNull();
});

it('prepares a real signed PDF through the API renderer module without font asset access', async () => {
  const result = await signed();
  const id = await countersignAgreements(db, (await offer())!, result.documents,
    'Example Owner', 'owner@example.test', request());
  const { renderAgreementPacket } = await import('~/lib/agreement-pdf');
  env.ASSETS = { fetch: async () => { throw new Error('Font asset access is unavailable.'); } } as unknown as Fetcher;
  await prepareAgreementArtifact(env, id, renderAgreementPacket);
  expect(sql.prepare('SELECT status,renderer_version FROM software_agreement_artifacts WHERE agreement_id=?').get(id))
    .toMatchObject({ status: 'ready', renderer_version: 'website-pdf-v2' });
});

it('keeps project attachments only on the SOW snapshot used for PDF generation', async () => {
  const attachment = { filename: 'Sample.pdf', version: '1', date: '2026-10-01', key: 'agreements/attachments/00000000-0000-4000-8000-000000000001.pdf', sha256: 'a'.repeat(64), bytes: 10 };
  sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'").run(JSON.stringify({ ...details, attachments: [attachment] }));
  await review();
  const agreements = await offerAgreements(db, 'o');
  expect(JSON.parse(agreements.find(a => a.kind === 'msa')!.attachment_manifest_json)).toEqual([]);
  expect(JSON.parse(agreements.find(a => a.kind === 'sow')!.attachment_manifest_json)).toEqual([attachment]);
});

it('reuses an MSA across two offers without importing the first SOW attachments', async () => {
  const attachment = (name: string) => ({ filename: `${name}.pdf`, version: '1', date: '2026-10-01', key: `agreements/attachments/${crypto.randomUUID()}.pdf`, sha256: 'a'.repeat(64), bytes: 10 });
  const first = attachment('first'), second = attachment('second');
  sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'").run(JSON.stringify({ ...details, attachments: [first] }));
  const result = await signed();
  await countersignAgreements(db, (await offer())!, result.documents, 'Owner', 'owner@example.com', request());
  const msa = (await offerAgreements(db, 'o')).find(a => a.kind === 'msa')!;
  await prepareAgreementArtifact(env, msa.id, async () => new TextEncoder().encode('%PDF-synthetic'));
  sql.prepare("UPDATE software_offers SET status='superseded' WHERE id='o'").run();
  const columns = sql.prepare('PRAGMA table_info(software_offers)').all().map((row: { name: string }) => row.name);
  const replacements: Record<string, string> = { id: "'o2'", version: '2', status: "'sent'", reused_msa_id: '?', agreement_details_json: '?' };
  sql.prepare(`INSERT INTO software_offers(${columns.join(',')}) SELECT ${columns.map((name: string) => replacements[name] ?? name).join(',')} FROM software_offers WHERE id='o'`)
    .run(...columns.filter((name: string) => replacements[name] === '?').map((name: string) => name === 'reused_msa_id' ? msa.id : JSON.stringify({ ...details, attachments: [second] })));
  sql.exec("UPDATE software_agreement_sessions SET offer_id='o2'; UPDATE software_agreement_links SET offer_id='o2'");
  const reviewed = await reviewAgreements(db, (await db.prepare("SELECT * FROM software_offers WHERE id='o2'").first<SoftwareOffer>())!, (await agreementSession(db, request(), 'agreement', 'o2'))!, client);
  expect(reviewed.reused_msa?.id).toBe(msa.id);
  expect(reviewed.documents.map(document => document.kind)).toEqual(['sow']);
  expect(JSON.parse(msa.attachment_manifest_json)).toEqual([]);
  expect(JSON.parse((await offerAgreements(db, 'o')).find(a => a.kind === 'sow')!.attachment_manifest_json)).toEqual([first]);
  expect(JSON.parse((await offerAgreements(db, 'o2'))[0].attachment_manifest_json)).toEqual([second]);
  const nextOffer=(await db.prepare("SELECT * FROM software_offers WHERE id='o2'").first<SoftwareOffer>())!;
  await signAgreements(db,nextOffer,(await agreementSession(db,request(),'agreement','o2'))!,reviewed.documents.map(d=>({id:d.id,hash:d.hash})),request());
  await countersignAgreements(db,nextOffer,reviewed.documents.map(d=>({id:d.id,hash:d.hash})),'Owner','owner@example.com',request());
  const rows=sql.prepare('SELECT * FROM software_agreement_signatures WHERE agreement_id=?').all(reviewed.documents[0].id);
  expect(rows).toHaveLength(2);
  for(const row of rows) {
    expect(row.intent_text).toBe(row.party==='client'?'Signing applies your name above as your electronic signature on the statement of work linked above.':'Countersigning applies your name above as your electronic signature on the statement of work you reviewed.');
    expect(row.consent_version).toBe('website-signing-v3');
  }

});

it.each([false, true])('cleans the last shared attachment reference while preserving a held reference (%s)', async held => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  const bytes = new Uint8Array([1, 2, 3]), key = 'agreements/attachments/shared.pdf', sha256 = await hashBytes(bytes);
  bucketData.set(key, bytes);
  sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)').run('attachment', 'r', 'Sample.pdf', '1', '2026-10-01', key, sha256, bytes.length, 'now', 'owner');
  // Model historical snapshots that shared the same attachment, independent of MSA linkage.
  sql.prepare("UPDATE software_agreements SET status='abandoned',msa_id=NULL,ended_at='2000-01-01',retain_until='2000-04-01',attachment_manifest_json=?").run(JSON.stringify([{ key, sha256 }]));
  const ids = sql.prepare('SELECT id FROM software_agreements ORDER BY id').all().map((row: { id: string }) => row.id);
  if (held) sql.prepare('UPDATE software_agreements SET legal_hold=1 WHERE id=?').run(ids[1]);
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements.flatMap(item => item.objects).filter(object => object.key === key)).toHaveLength(held ? 0 : 1);
  if (!held) expect(manifest.agreements.at(-1)!.objects).toContainEqual({ key, sha256 });
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest);
  expect(bucketData.has(key)).toBe(held);
  expect(Boolean(sql.prepare('SELECT id FROM software_agreement_attachments WHERE object_key=?').get(key))).toBe(held);
  expect(sql.prepare('SELECT count(*) n FROM software_agreements').get().n).toBe(held ? 1 : 0);
});

it.each(['agreement', 'archive'] as const)('invalid Turnstile requests preserve the recipient allowance for %s', async purpose => {
  vi.mocked(fetch).mockResolvedValue(new Response('{"success":false}', { status: 200 }));
  for (let i = 0; i < 3; i++) {
    const response = await issueAgreementLink(env, request(), { turnstileToken: 'invalid', email: 'client@example.com' }, purpose === 'agreement' ? token : undefined);
    expect(response.status).toBe(403);
  }
  expect(sql.prepare('SELECT uses FROM audio_client_allowances').all()).toEqual([]);
  vi.mocked(fetch).mockImplementation(async () => new Response('{"success":true}', { status: 200 }));
  const response = await issueAgreementLink(env, request(), { turnstileToken: 'valid', email: 'client@example.com' }, purpose === 'agreement' ? token : undefined);
  expect(response.status).toBe(200);
  expect(sql.prepare('SELECT uses FROM audio_client_allowances ORDER BY uses').all()).toEqual(Array.from({length:purpose==='archive'?3:2},()=>({uses:1})));
});

it.each([true, false])('external start atomically retires unsigned reviews and signing access when request is current (%s)', async current => {
  const snapshots = await review();
  sql.prepare("UPDATE software_offers SET agreement_details_json=NULL WHERE id='o'").run();
  const { POST } = await import('~/pages/api/owner/requests/[id]/project');
  const response = await POST({
    params: { id: 'r' },
    request: new Request('https://example.com/api/owner/requests/r/project', {
      method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', signature_source: 'external', offer_id: 'o', offer_version: 1, expectedRequestUpdatedAt: current ? 'now' : 'stale', signatures: true, payment: true, inputs_ready: true, external_signed_on: '2026-09-30', external_parties: 'Sample LLC / Example Contractor LLC', external_kept_copy: true, external_copy_reference: 'Synthetic copy', next_update_on: '' }),
    }),
    locals: { owner: { email: 'owner@example.com' }, runtime: { env: { ...env, AUDIO_CLIENT_PORTAL_ENABLED: 'true' } } },
  } as never);
  expect(response.status).toBe(current ? 200 : 409);
  const rows = sql.prepare('SELECT status,abandoned_at,retain_until FROM software_agreements').all();
  expect(rows).toHaveLength(snapshots.documents.length);
  for (const row of rows) {
    expect(row.status).toBe(current ? 'abandoned' : 'review');
    expect(Boolean(row.abandoned_at)).toBe(current);
    expect(Boolean(row.retain_until)).toBe(current);
  }
  expect(Boolean(sql.prepare('SELECT revoked_at FROM software_agreement_sessions').get().revoked_at)).toBe(current);
  expect(Boolean(sql.prepare('SELECT used_at FROM software_agreement_links').get().used_at)).toBe(current);
  expect(Boolean(sql.prepare('SELECT revoked_at FROM software_offer_links').get().revoked_at)).toBe(current);
  expect(sql.prepare('SELECT count(*) n FROM software_projects').get().n).toBe(current ? 1 : 0);
});

it('rejects an outside-site signature dated after today without starting the project', async () => {
  await review();
  sql.prepare("UPDATE software_offers SET agreement_details_json=NULL WHERE id='o'").run();
  const tomorrow = new Date(`${projectToday()}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const { POST } = await import('~/pages/api/owner/requests/[id]/project');
  const response = await POST({
    params: { id: 'r' },
    request: new Request('https://example.com/api/owner/requests/r/project', {
      method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', signature_source: 'external', offer_id: 'o', offer_version: 1, expectedRequestUpdatedAt: 'now', signatures: true, payment: true, inputs_ready: true, external_signed_on: tomorrow.toISOString().slice(0, 10), external_parties: 'Sample LLC / Example Contractor LLC', external_kept_copy: true, external_copy_reference: 'Synthetic copy', next_update_on: '' }),
    }),
    locals: { owner: { email: 'owner@example.com' }, runtime: { env: { ...env, AUDIO_CLIENT_PORTAL_ENABLED: 'true' } } },
  } as never);
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: string }).error).toMatch(/cannot be in the future/i);
  expect(sql.prepare('SELECT count(*) AS n FROM software_projects').get()).toEqual({ n: 0 });
  expect(sql.prepare("SELECT count(*) AS n FROM software_agreements WHERE status<>'review'").get()).toEqual({ n: 0 });
});

it('preserves omitted draft agreement details and reuse, and permits explicit clearing', async () => {
  await review();
  const msaId = (await offerAgreements(db, 'o')).find(a => a.kind === 'msa')!.id;
  sql.prepare("UPDATE software_offers SET status='draft',reused_msa_id=? WHERE id='o'").run(msaId);
  sql.exec('UPDATE software_signing_settings SET software_signing_enabled=0');
  const { POST } = await import('~/pages/api/owner/requests/[id]/software');
  const save = async (extra: Record<string, unknown>, expectedUpdatedAt: string) => POST({
    params: { id: 'r' },
    request: new Request('https://example.com/api/owner/requests/r/software', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draft', terms: { ...terms, summary: 'Updated offer summary' }, expectedUpdatedAt, ...extra }) }),
    locals: { owner: { email: 'owner@example.com' }, runtime: { env } },
  } as never);
  expect((await save({}, 'now')).status).toBe(200);
  const preserved = (await offer())!;
  expect(JSON.parse(preserved.agreement_details_json!)).toEqual(details);
  expect(preserved.reused_msa_id).toBe(msaId);
  expect(JSON.parse(preserved.terms_json).summary).toBe('Updated offer summary');
  expect((await save({ agreementDetails: null, confirmMsaReuse: false }, preserved.updated_at)).status).toBe(200);
  expect((await offer())!.agreement_details_json).toBeNull();
  expect((await offer())!.reused_msa_id).toBeNull();
});

it.each(['draft', 'sent'])('retains attachments pinned to a %s offer after old review snapshots expire', async status => {
  const { abandonUnsignedAgreementReviews } = await import('~/lib/software-agreements');
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  const bytes = new Uint8Array([1, 2, 3]), key = 'agreements/attachments/00000000-0000-4000-8000-000000000002.pdf', sha256 = await hashBytes(bytes);
  bucketData.set(key, bytes);
  const attachment = { filename: 'Sample.pdf', version: '1', date: '2026-10-01', key, sha256, bytes: bytes.length };
  sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'").run(JSON.stringify({ ...details, attachments: [attachment] }));
  await review();
  await db.batch([abandonUnsignedAgreementReviews(db, 'r', '2000-01-01T00:00:00Z')]);
  sql.prepare("UPDATE software_offers SET status=? WHERE id='o'").run(status);
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements).toHaveLength(1);
  expect(manifest.agreements[0].objects).toEqual([]);
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest);
  expect(bucketData.has(key)).toBe(true);
});

it('refuses a stale attachment delete when a new live offer reference appears during apply', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  const bytes = new Uint8Array([1, 2, 3]), key = 'agreements/attachments/00000000-0000-4000-8000-000000000003.pdf', sha256 = await hashBytes(bytes);
  bucketData.set(key, bytes);
  sql.prepare("UPDATE software_agreements SET status='abandoned',ended_at='2000-01-01',retain_until='2000-04-01',attachment_manifest_json=? WHERE kind='sow'").run(JSON.stringify([{ key, sha256 }]));
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements[0].objects).toContainEqual({ key, sha256 });
  const batch = db.batch.bind(db);
  vi.spyOn(db, 'batch').mockImplementationOnce(async statements => {
    // The offer pins a new attachment after fresh preview, before reserving archive closure.
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'").run(JSON.stringify({ ...details, attachments: [{ filename: 'Sample.pdf', version: '1', date: '2026-10-01', key, sha256, bytes: bytes.length }] }));
    return batch(statements);
  });
  await expect(applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest)).rejects.toThrow();
  expect(bucketData.has(key)).toBe(true);
  expect(sql.prepare("SELECT archive_closed_at FROM software_agreements WHERE kind='sow'").get().archive_closed_at).toBeNull();
});

it.each(['draft-first', 'retention-first'])('serializes attachment acquisition with retention reservation (%s)', async order => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  const { POST } = await import('~/pages/api/owner/requests/[id]/software');
  await review();
  const bytes = new Uint8Array([1, 2, 3]), key = 'agreements/attachments/00000000-0000-4000-8000-000000000004.pdf', sha256 = await hashBytes(bytes);
  const attachment = { filename: 'Sample.pdf', version: '1', date: '2026-10-01', key, sha256, bytes: bytes.length };
  bucketData.set(key, bytes);
  sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)').run('attachment', 'r', attachment.filename, attachment.version, attachment.date, key, sha256, bytes.length, 'now', 'owner');
  sql.prepare("UPDATE software_agreements SET status='abandoned',ended_at='2000-01-01',retain_until='2000-04-01',attachment_manifest_json=? WHERE kind='sow'").run(JSON.stringify([attachment]));
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  const save = () => POST({ params: { id: 'r' }, request: new Request('https://example.com/api/owner/requests/r/software', {
    method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'draft', terms, expectedUpdatedAt: null, agreementDetails: { ...details, attachments: [attachment] } }),
  }), locals: { owner: { email: 'owner@example.com' }, runtime: { env } } } as never);
  if (order === 'draft-first') {
    expect((await save()).status).toBe(200);
    await expect(applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest)).rejects.toThrow('Archive changed');
    expect(bucketData.has(key)).toBe(true);
  } else {
    const batch = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async statements => {
      const result = await batch(statements);
      expect((await save()).status).toBe(409);
      expect(sql.prepare("SELECT id FROM software_offers WHERE status='draft'").get()).toBeUndefined();
      return result;
    });
    await applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest);
    expect(bucketData.has(key)).toBe(false);
    expect(sql.prepare('SELECT id FROM software_agreement_attachments').get()).toBeUndefined();
  }
});

it('ignores malformed partial attachment entries in an unrelated draft during retention', async () => {
  const { previewAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  sql.prepare("UPDATE software_agreements SET status='abandoned',ended_at='2000-01-01',retain_until='2000-04-01',attachment_manifest_json=? WHERE kind='sow'").run(JSON.stringify([{ key: 'agreements/attachments/synthetic.pdf', sha256: 'a'.repeat(64) }]));
  sql.prepare("UPDATE software_offers SET status='draft',agreement_details_json=? WHERE id='o'").run(JSON.stringify({ attachments: ['incomplete draft'] }));
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.agreements).toHaveLength(1);
  expect(manifest.agreements[0].objects).toHaveLength(1);
});

it('previews and removes only 30-day-old unattached uploads while preserving referenced and recent files', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  const now = new Date('2026-10-01T12:00:00Z');
  const addAttachment = async (id: string, key: string, createdAt: string) => {
    const bytes = new Uint8Array([1, 2, id.charCodeAt(0)]), sha256 = await hashBytes(bytes);
    bucketData.set(key, bytes);
    sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, 'r', `${id}.pdf`, '1', '2026-09-01', key, sha256, bytes.length, createdAt, 'owner');
    return { bytes, sha256 };
  };
  await addAttachment('orphan', 'agreements/attachments/orphan.pdf', '2026-08-01T00:00:00Z');
  await addAttachment('recent', 'agreements/attachments/recent.pdf', '2026-09-15T00:00:00Z');
  const offered = await addAttachment('offered', 'agreements/attachments/offered.pdf', '2026-08-01T00:00:00Z');
  const manifested = await addAttachment('manifested', 'agreements/attachments/manifested.pdf', '2026-08-01T00:00:00Z');
  const offeredUnindexed = 'agreements/attachments/offered-without-metadata.pdf';
  const manifestedUnindexed = 'agreements/attachments/manifested-without-metadata.pdf';
  bucketData.set(offeredUnindexed, new Uint8Array([3, 4, 5]));
  bucketData.set(manifestedUnindexed, new Uint8Array([6, 7, 8]));
  bucketUploaded.set(offeredUnindexed, new Date('2026-08-01T00:00:00Z'));
  bucketUploaded.set(manifestedUnindexed, new Date('2026-08-01T00:00:00Z'));
  sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'")
    .run(JSON.stringify({ ...details, attachments: [
      { key: 'agreements/attachments/offered.pdf', sha256: offered.sha256, bytes: offered.bytes.length, filename: 'offered.pdf', version: '1', date: '2026-09-01' },
      { key: offeredUnindexed, sha256: 'c'.repeat(64), bytes: 3, filename: 'offered-without-metadata.pdf', version: '1', date: '2026-09-01' },
    ] }));
  sql.prepare("UPDATE software_agreements SET attachment_manifest_json=? WHERE kind='sow'")
    .run(JSON.stringify([
      { key: 'agreements/attachments/manifested.pdf', sha256: manifested.sha256 },
      { key: manifestedUnindexed, sha256: 'd'.repeat(64) },
    ]));
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  expect(manifest.unattached_attachments.map(item => item.id)).toEqual(['orphan']);
  expect(manifest.orphan_attachments).toEqual([]);
  expect(JSON.stringify(manifest)).not.toContain('Example');
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest, now);
  expect(bucketData.has('agreements/attachments/orphan.pdf')).toBe(false);
  expect(sql.prepare("SELECT id FROM software_agreement_attachments WHERE id='orphan'").get()).toBeUndefined();
  for (const id of ['recent', 'offered', 'manifested'])
    expect(sql.prepare('SELECT id FROM software_agreement_attachments WHERE id=?').get(id)).toBeTruthy();
  for (const key of ['recent', 'offered', 'manifested'])
    expect(bucketData.has(`agreements/attachments/${key}.pdf`)).toBe(true);
  expect(bucketData.has(offeredUnindexed)).toBe(true);
  expect(bucketData.has(manifestedUnindexed)).toBe(true);
});

it('reserves an orphan attachment before storage deletion so a concurrent offer cannot lose it', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  const now = new Date('2026-10-01T12:00:00Z'), key = 'agreements/attachments/race.pdf';
  const bytes = new Uint8Array([4, 5, 6]), sha256 = await hashBytes(bytes);
  bucketData.set(key, bytes);
  sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('race-attachment', 'r', 'race.pdf', '1', '2026-09-01', key, sha256, bytes.length, '2026-08-01T00:00:00Z', 'owner');
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now), batch = db.batch.bind(db);
  vi.spyOn(db, 'batch').mockImplementationOnce(async statements => {
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'")
      .run(JSON.stringify({ ...details, attachments: [{ key, sha256, bytes: bytes.length, filename: 'race.pdf', version: '1', date: '2026-09-01' }] }));
    return batch(statements);
  });
  await expect(applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest, now)).rejects.toThrow();
  expect(bucketData.has(key)).toBe(true);
  expect(sql.prepare("SELECT id FROM software_agreement_attachments WHERE id='race-attachment'").get()).toBeTruthy();
});

it('recovers an old private object after interruption between metadata removal and R2 deletion', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  const now = new Date('2026-10-01T12:00:00Z'), key = 'agreements/attachments/interrupted.pdf';
  const bytes = new Uint8Array([8, 6, 7]), sha256 = await hashBytes(bytes);
  bucketData.set(key, bytes);
  bucketUploaded.set(key, new Date('2026-08-01T00:00:00Z'));
  sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('interrupted-attachment', 'r', 'interrupted.pdf', '1', '2026-09-01', key, sha256, bytes.length, '2026-08-01T00:00:00Z', 'owner');
  const reviewed = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now), batch = db.batch.bind(db);
  vi.spyOn(db, 'batch').mockImplementationOnce(async statements => {
    await batch(statements);
    throw new Error('Simulated interruption after metadata committed.');
  });
  await expect(applyAgreementRetention(db, env.AUDIO, 'test-storage', reviewed, now)).rejects.toThrow('Simulated interruption');
  expect(sql.prepare("SELECT id FROM software_agreement_attachments WHERE id='interrupted-attachment'").get()).toBeUndefined();
  expect(bucketData.has(key)).toBe(true);

  const recovered = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  expect(recovered.orphan_attachments).toEqual([{ key, sha256, uploaded_at: '2026-08-01T00:00:00.000Z' }]);
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', recovered, now);
  expect(bucketData.has(key)).toBe(false);
});

it('restores retry metadata when private storage refuses orphan deletion', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  const now = new Date('2026-10-01T12:00:00Z'), key = 'agreements/attachments/retry.pdf';
  const bytes = new Uint8Array([7, 8, 9]), sha256 = await hashBytes(bytes);
  bucketData.set(key, bytes);
  sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('retry-attachment', 'r', 'retry.pdf', '1', '2026-09-01', key, sha256, bytes.length, '2026-08-01T00:00:00Z', 'owner');
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  vi.spyOn(env.AUDIO, 'delete').mockRejectedValueOnce(new Error('Storage is temporarily unavailable.'));
  await expect(applyAgreementRetention(db, env.AUDIO, 'test-storage', manifest, now)).rejects.toThrow('Storage is temporarily unavailable.');
  expect(bucketData.has(key)).toBe(true);
  expect(sql.prepare("SELECT id,object_key,sha256 FROM software_agreement_attachments WHERE id='retry-attachment'").get()).toEqual({id:'retry-attachment',object_key:key,sha256});
  const retry = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', retry, now);
  expect(bucketData.has(key)).toBe(false);
  expect(sql.prepare("SELECT id FROM software_agreement_attachments WHERE id='retry-attachment'").get()).toBeUndefined();
});

it('resumes the server draft under a fresh two-hour email session without sharing it with another email', async () => {
  const { saveAgreementDraft, loadAgreementDraft, prefillAgreementDraft, resolveClientDetails } = await import('~/lib/agreement-draft');
  const { getOwnerRequest } = await import('~/lib/owner-requests');
  sql.prepare("UPDATE owner_requests SET name='Alex Example',details_json=? WHERE id='r'").run(JSON.stringify({company:'Example Client LLC'}));
  const prefilled=prefillAgreementDraft((await getOwnerRequest(db,'r'))!);
  expect(prefilled.legal_name).toBe('Example Client LLC');expect(prefilled.signer_name).toBe('Alex Example');
  expect(prefilled.signer_title).toBe('');expect(prefilled.portfolio_choice).toBe('');
  const session=(await agreementSession(db,request(),'agreement','o'))!;
  const input={...prefilled,entity_type:'LLC',state:'Wyoming',business_address:'100 Example Street',signer_title:'Owner',portfolio_choice:'anonymous' as const};
  await saveAgreementDraft(db,(await offer())!,session,input);
  sql.prepare("UPDATE software_agreement_sessions SET expires_at='2000-01-01'").run();
  await issueAgreementLink(env,request(),{turnstileToken:'test'},token);
  const payload=JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  const key=new URL(payload.text.match(/https:\/\/\S+/)[0]).searchParams.get('key')!;
  const opened=await completeAgreementLink(env,new Request(request(),{method:"POST"}),key,token);
  const newSession=await agreementSession(db,new Request(request().url,{headers:{cookie:opened.headers.get('set-cookie')!}}),'agreement','o');
  expect(newSession).not.toBeNull();
  expect(Date.parse(newSession!.expires_at)-Date.parse(newSession!.verified_at)).toBe(7200000);
  expect(await loadAgreementDraft(db,'o','client@example.com')).toEqual(input);
  expect(await loadAgreementDraft(db,'o','other@example.com')).toBeNull();
  const resolved=resolveClientDetails(input,session.recipient_email);
  expect(resolved.ok).toBe(true);
  if(resolved.ok){expect(resolved.client.reviewer_name).toBe('Alex Example');expect(resolved.client.reviewer_email).toBe(session.recipient_email);expect(resolved.client.approver_email).toBe(session.recipient_email);expect(resolved.client.notice_email).toBe(session.recipient_email);}
});
it.each([['private','deny',false],['anonymous','allow',false],['named','allow',true]] as const)('maps %s into the exact SOW fields',async(choice,portfolio,naming)=>{
  const {resolveClientDetails}=await import('~/lib/agreement-draft');
  const {jurisdiction,...rest}=client;
  const {portfolio:unused,naming:unusedNaming,...fields}=rest;
  const result=resolveClientDetails({...fields,state:jurisdiction,portfolio_choice:choice},'client@example.com');
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.client.portfolio).toBe(portfolio);expect(result.client.naming).toBe(naming);
  const reviewed=await reviewAgreements(db,(await offer())!,(await agreementSession(db,request()))!,result.client);
  const sow=reviewed.documents.find(d=>d.kind==='sow')!;
  expect(sow.text).toContain(`sow.portfolio: ${portfolio==='deny'?'Do not allow':'Allow'}`);
  expect(sow.text).toContain(`sow.naming: ${naming?'Yes':'No'}`);
  expect(sow.text).not.toContain('initials');
});
it('retains both verbatim statements and verification method in signatures and certificates',async()=>{
  const {consentText,intentText}=await import('~/lib/agreement-fields');
  const result=await signed();
  const id=await countersignAgreements(db,(await offer())!,result.documents,'Example Owner','owner@example.com',request());
  for(const party of ['client','contractor']) {
    const row=sql.prepare('SELECT * FROM software_agreement_signatures WHERE party=? LIMIT 1').get(party);
    expect(row.consent_text).toBe(consentText(client.legal_name,party==='contractor'));
    expect(row.intent_text).toBe(intentText(party==='contractor'));
    expect(row.consent_version).toBe('website-signing-v3');
    expect(row.verification_method).toBe(party==='client'?'verified by one-time email link':'verified by owner authentication');
  }
  await prepareAgreementArtifact(env,id,async(_env,_docs,certificates)=>{
    const json=JSON.stringify(certificates);
    expect(json).toContain(consentText(client.legal_name));expect(json).toContain(intentText());
    expect(json).toContain(intentText(true));expect(json).toContain('verified by one-time email link');
    expect(json).toContain('v2026-09-30');return new TextEncoder().encode('%PDF-synthetic');
  });
});
it('rejects signing stale reviewed documents after autosaved details change',async()=>{
  const {resolveClientDetails,saveAgreementDraft}=await import('~/lib/agreement-draft');
  const {jurisdiction,portfolio,naming,...rest}=client;
  const input={...rest,state:jurisdiction,portfolio_choice:'private' as const};
  const session=(await agreementSession(db,request()))!;
  await saveAgreementDraft(db,(await offer())!,session,input);
  const resolved=resolveClientDetails(input,session.recipient_email);if(!resolved.ok)throw new Error('Invalid fixture');
  const result=await reviewAgreements(db,(await offer())!,session,resolved.client);
  await saveAgreementDraft(db,(await offer())!,session,{...input,signer_title:'Updated title'});
  await expect(signAgreements(db,(await offer())!,session,result.documents,request())).rejects.toThrow('details changed');
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(0);
});
it('returns field-linked validation messages without raw schema output',async()=>{
  const {POST}=await import('~/pages/api/offer/[token]/review');
  const response=await POST({params:{token},locals:{runtime:{env}},request:new Request(request().url,{method:'POST',headers:{cookie:`agreement_session=${token}`,origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({csrf_nonce:'csrf',values:{}})})} as never);
  expect(response.status).toBe(400);const body=await response.json() as {error:string;errors:Record<string,string>};
  expect(body.errors.signer_title).toBe('Add your title');expect(body.errors.portfolio_choice).toBe('Choose a portfolio option');expect(body.error).not.toContain('invalid_type');
});

it('retires the redundant draft after saving immutable signatures',async()=>{
 const {saveAgreementDraft,resolveClientDetails}=await import('~/lib/agreement-draft');
 const {jurisdiction,portfolio,naming,...rest}=client;
 const input={...rest,state:jurisdiction,portfolio_choice:'private' as const},session=(await agreementSession(db,request()))!;
 await saveAgreementDraft(db,(await offer())!,session,input);
 const resolved=resolveClientDetails(input,session.recipient_email);if(!resolved.ok)throw new Error('Invalid fixture');
 const result=await reviewAgreements(db,(await offer())!,session,resolved.client);
 await signAgreements(db,(await offer())!,session,result.documents,request());
 expect(sql.prepare('SELECT count(*) n FROM software_agreement_drafts').get().n).toBe(0);
 expect(sql.prepare('SELECT count(*) n FROM software_agreement_signatures').get().n).toBe(2);
});
it('prevents external start if website signing commits after the initial read',async()=>{
 const reviewed=await review(),session=(await agreementSession(db,request()))!;
 sql.prepare("UPDATE software_offers SET agreement_details_json=NULL WHERE id='o'").run();
 const originalBatch=db.batch.bind(db);
 vi.spyOn(db,'batch').mockImplementationOnce(async statements=>{
   await signAgreements({...db,batch:originalBatch} as D1Database,(await offer())!,session,reviewed.documents,request());
   return originalBatch(statements);
 });
 const {POST}=await import('~/pages/api/owner/requests/[id]/project');
 const response=await POST({params:{id:'r'},request:new Request('https://example.com/api/owner/requests/r/project',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({action:'start',signature_source:'external',offer_id:'o',offer_version:1,expectedRequestUpdatedAt:'now',signatures:true,payment:true,inputs_ready:true,external_signed_on:'2026-09-30',external_parties:'Sample LLC / Example Contractor LLC',external_kept_copy:true,external_copy_reference:'Synthetic copy',next_update_on:''})}),locals:{owner:{email:'owner@example.com'},runtime:{env:{...env,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}}} as never);
 expect(response.status).toBe(409);expect(sql.prepare('SELECT count(*) n FROM software_projects').get().n).toBe(0);
 expect(sql.prepare("SELECT count(*) n FROM software_agreements WHERE status='client_signed'").get().n).toBe(2);
});

it.each(['legal_name', 'entity_type', 'state', 'country', 'business_address', 'signer_name', 'signer_title', 'reviewer_name', 'reviewer_email', 'approver_name', 'approver_email', 'notice_email'])('maps control characters in %s to a field error in browser and API validation', async field => {
  const { resolveClientDetails } = await import('~/lib/agreement-draft');
  const { jurisdiction, portfolio, naming, ...rest } = client;
  const values = { ...rest, state: jurisdiction, portfolio_choice: 'private', [field]: 'Example\u0001 LLC' };
  const resolved = resolveClientDetails(values, 'client@example.com');
  expect(resolved).toEqual({ ok: false, errors: { [field]: 'Remove unusual characters from this field.' } });
  for (const route of ['review', 'draft']) {
    const { POST } = route === 'review' ? await import('~/pages/api/offer/[token]/review') : await import('~/pages/api/offer/[token]/draft');
    const response = await POST({ params: { token }, locals: { runtime: { env } }, request: new Request(request().url, { method: 'POST', headers: { cookie: `agreement_session=${token}`, origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify({ csrf_nonce: 'csrf', values }) }) } as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Check the highlighted details.', errors: { [field]: 'Remove unusual characters from this field.' } });
  }
});
it('maps unfamiliar draft validation issues to a generic message on the field', async () => {
  const { resolveClientDetails } = await import('~/lib/agreement-draft');
  expect(resolveClientDetails({ signer_title: 123 }, 'client@example.com')).toEqual({ ok: false, errors: { signer_title: 'Check this field.' } });
  expect(resolveClientDetails({ legal_name: 'x'.repeat(201) }, 'client@example.com')).toEqual({ ok: false, errors: { legal_name: 'Check this field.' } });
});

it('renders cumulative checkpoint payments and invoice-identical odd-cent installments', async () => {
  const { agreementValues, agreementDetailsSchema } = await import('~/lib/agreement-fields');
  const { softwareInvoiceTerms } = await import('~/lib/software-invoices');
  const purchased = {...terms, paymentMode:'standard' as const, milestones:[terms.milestones[0],{...terms.milestones[0],feeCents:303,checkpoint:{label:'Preview',cancellationPercent:75}}]};
  const values = agreementValues(purchased,agreementDetailsSchema.parse({...details,milestones:[details.milestones[0],{...details.milestones[0],start:'2026-10-20',checkpoint_criteria:'View',checkpoint_evidence:'Preview'}]}),clientAgreementSchema.parse(client),contractorSchema.parse(contractor),{effective_on:'2026-10-01',msa_version:'2026-10-01 / template 1',sow_number:'SOW-test',offer_version:1,template_version:1});
  expect(values.milestones[1].checkpoint_cumulative_amount).toBe('$3.28 (includes prior payments)');
  expect(values.milestones[1].checkpoint).toContain('cumulative cancellation amount $3.28');
  expect(values.system.amount1).toBe('$0.50 deposit / $0.51 balance');
  expect(values.milestones[0].deposit).toBe('$0.50');
  expect(values.milestones[0].balance).toBe('$0.51');
  expect(softwareInvoiceTerms(purchased,0,'deposit').amountCents).toBe(50);
  const rendered=renderAgreement('sow',synthetic('sow'),values);
  expect(rendered).toContain('milestone.checkpoint_cumulative_amount: $3.28 (includes prior payments)');
  expect(rendered).toContain('milestone.deposit: $0.50');
  expect(rendered).toContain('milestone.balance: $0.51');
});
it.each(['data_retention','handoff_access'])('requires a complete day count in custom %s prose', field => {
  const input = {...details,project_retention_days:30,handoff_access_days:30,data_retention:'Keep for 30 days.',handoff_access:'Keep for 30 days.',[field]:'Keep access for 130 days.'};
  expect(()=>validateAgreementDetails(input,terms as any)).toThrow('State the agreed');
  expect(()=>validateAgreementDetails({...input,[field]:'Keep access for 30 days.'},terms as any)).not.toThrow();
});

it('masks link receipts and refunds definite token-scoped email rejection without cooldown', async () => {
  sql.exec('DELETE FROM software_agreement_sessions');
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>url.includes('turnstile') ? Response.json({success:true}) : Response.json({message:'Rejected'},{status:422})));
  for(let i=0;i<4;i++) {
    const response=await issueAgreementLink(env,request(),{turnstileToken:'test'},token);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:"That email didn't go through. Please try again."});
    expect(sql.prepare('SELECT COALESCE(sum(uses),0) n FROM audio_client_allowances').get().n).toBe(0);
    expect(sql.prepare("SELECT count(*) n FROM software_agreement_links WHERE id<>'challenge'").get().n).toBe(0);
  }
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({success:true})));
  const response=await issueAgreementLink(env,request(),{turnstileToken:'test'},token);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({message:'I sent a link to c•••@example.com. Tap it on any device to open your agreement.'});
});
it('keeps definite archive send rejection generic', async () => {
  await signed();
  sql.exec("UPDATE software_agreements SET status='executed'");
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>url.includes('turnstile') ? Response.json({success:true}) : Response.json({message:'Rejected'},{status:422})));
  const response=await issueAgreementLink(env,request(),{turnstileToken:'test',email:'client@example.com'});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({message:'If an agreement is available, a link is on its way.'});
});
it('verifies the attachment bytes against the offer hash before client download', async () => {
  const {GET}=await import('~/pages/api/agreements/attachments/[id]');
  const id=crypto.randomUUID(),key=`agreements/attachments/${id}.pdf`,bytes=new TextEncoder().encode('%PDF-original'),sha=await hashBytes(bytes);
  sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'r','File.pdf','1','2026-10-01',key,sha,bytes.length,'now','owner');
  sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'").run(JSON.stringify({...details,attachments:[{key,sha256:sha}]}));
  bucketData.set(key,bytes);
  const call=()=>GET({locals:{runtime:{env}},request:request(),params:{id}} as never);
  expect(new Uint8Array(await (await call()).arrayBuffer())).toEqual(bytes);
  bucketData.set(key,new TextEncoder().encode('%PDF-altered'));
  const refused=await call();expect(refused.status).toBe(503);
  expect(await refused.text()).toBe("This file couldn't be verified, so I've held it back. Please let me know before you sign.");
});

it.each(['resolve','withdraw'])('retires unsigned signing atomically when request is closed (%s)',async action=>{
  const {changeOwnerRequest}=await import('~/lib/owner-requests');
  sql.exec("UPDATE software_offer_links SET created_at='2000-01-01'");
  const current=await offer();await reviewAgreements(db,current!, (await agreementSession(db,request()))!,client);
  sql.prepare("INSERT INTO software_agreement_drafts VALUES('o','client@example.com',?,'now')").run(JSON.stringify({legal_name:'Private'}));
  await changeOwnerRequest(db,{id:'r',action:action as 'resolve'|'withdraw',actor:'owner@example.com'});
  expect(sql.prepare("SELECT count(*) n FROM software_agreements WHERE status='review'").get().n).toBe(0);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_drafts').get().n).toBe(0);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_sessions WHERE revoked_at IS NULL').get().n).toBe(0);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_links WHERE used_at IS NULL').get().n).toBe(0);
});
it.each(['revoke','replace'])('deletes signing drafts when an offer stops being signable (%s)',async action=>{
  const {POST}=await import('~/pages/api/owner/requests/[id]/software');
  sql.exec("UPDATE software_offer_links SET created_at='2000-01-01'");
  sql.prepare("INSERT INTO software_agreement_drafts VALUES('o','client@example.com',?,'now')").run(JSON.stringify({legal_name:'Private'}));
  if(action==='replace'){
    sql.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES('draft','r',2,'draft',?,'now','now')").run(JSON.stringify(terms));
    sql.exec('UPDATE software_signing_settings SET software_signing_enabled=0');
  }
  const body=action==='revoke'?{action:'revoke',expectedLinkCreatedAt:'2000-01-01'}:{action:'send',version:2,expectedUpdatedAt:'now'};
  const response=await POST({params:{id:'r'},request:new Request('https://example.com/api/owner/requests/r/software',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify(body)}),locals:{owner:{email:'owner@example.com'},runtime:{env}}} as never);
  expect(response.status).toBe(200);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_drafts').get().n).toBe(0);
});
it.each(['creating','open','payment_failed','uncollectible','paid'])('blocks pending signing abandonment with an unrefunded %s deposit',async status=>{
  const result=await signed();const {POST}=await import('~/pages/api/owner/requests/[id]/agreement');
  sql.prepare("INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('deposit','r','o',0,'deposit',50,7,?,'owner','now','now')").run(status);
  const call=()=>POST({params:{id:'r'},request:new Request('https://example.com/api/owner/requests/r/agreement',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({action:'abandon',documents:result.documents,reason:'Cancelled',confirmed:true})}),locals:{owner:{email:'owner@example.com'},runtime:{env}}} as never);
  const response=await call();expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'Void or refund the deposit invoice first.'});
  expect((await offer())!.status).toBe('sent');expect((await offerAgreements(db,'o')).every(a=>a.status==='client_signed')).toBe(true);
  sql.exec(status==='paid' ? "UPDATE software_invoices SET refunded_at='now'" : "UPDATE software_invoices SET status='void'");expect((await call()).status).toBe(200);
});
it.each(['draft','sent'])('refuses MSA termination while a live %s offer reuses it',async status=>{
  const result=await signed();await countersignAgreements(db,(await offer())!,result.documents,'Example Owner','owner@example.com',request());
  const msa=(await offerAgreements(db,'o')).find(a=>a.kind==='msa')!;
  sql.exec("INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES('r2','software','client@example.com','Tool','reviewed','now','now')");
  sql.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,reused_msa_id,created_at,updated_at) VALUES('reuse','r2',1,?,'{}',?,'now','now')").run(status,msa.id);
  const {POST}=await import('~/pages/api/owner/requests/[id]/agreement');
  const call=()=>POST({params:{id:'r'},request:new Request('https://example.com/api/owner/requests/r/agreement',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({action:'end',agreement_id:msa.id,ended_on:projectToday(),confirmed:true})}),locals:{owner:{email:'owner@example.com'},runtime:{env}}} as never);
  const response=await call();expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'An open offer uses this agreement. Withdraw that offer first.'});
  expect(sql.prepare('SELECT terminated_at FROM software_agreements WHERE id=?').get(msa.id).terminated_at).toBeNull();
  sql.exec("UPDATE software_offers SET status='withdrawn' WHERE id='reuse'");expect((await call()).status).toBe(200);
});
it('bounds the attachment scan even when the archive has nothing eligible',async()=>{
  const {previewAgreementRetention}=await import('~/lib/agreement-retention');
  const list=vi.fn(async()=>{if(list.mock.calls.length>1)throw new Error('Unbounded scan');return {objects:[],truncated:true,cursor:'next'};});env.AUDIO.list=list as any;
  await previewAgreementRetention(db,env.AUDIO,'local');expect(list).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledWith(expect.objectContaining({prefix:'agreements/attachments/',limit:100}));
});

it.each([false,true])('removes draft attachments and preserves objects referenced by sent offers (%s)',async sentReference=>{
  const {POST}=await import('~/pages/api/owner/requests/[id]/software');
  const id=crypto.randomUUID(),key=`agreements/attachments/${id}.pdf`,bytes=new TextEncoder().encode('%PDF-attachment'),sha=await hashBytes(bytes);
  const attachment={key,sha256:sha,filename:'File.pdf',version:'1',date:'2026-10-01',bytes:bytes.length};
  bucketData.set(key,bytes);
  sql.prepare('INSERT INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'r','File.pdf','1','2026-10-01',key,sha,bytes.length,'now','owner');
  if(sentReference)sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='o'").run(JSON.stringify({...details,attachments:[attachment]}));
  sql.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,agreement_details_json,created_at,updated_at) VALUES('draft','r',2,'draft',?,?,'now','now')").run(JSON.stringify(terms),JSON.stringify({...details,attachments:[attachment]}));
  const response=await POST({params:{id:'r'},request:new Request('https://example.com/api/owner/requests/r/software',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({action:'draft',terms,agreementDetails:{...details,attachments:[]},removedAttachmentKeys:[key],expectedUpdatedAt:'now'})}),locals:{owner:{email:'owner@example.com'},runtime:{env}}} as never);
  expect(response.status).toBe(200);
  expect(JSON.parse(sql.prepare("SELECT agreement_details_json FROM software_offers WHERE id='draft'").get().agreement_details_json).attachments).toEqual([]);
  expect(bucketData.has(key)).toBe(sentReference);
});

it('saves a valid empty manifest after more than five cumulative attachment removals',async()=>{
  const {POST}=await import('~/pages/api/owner/requests/[id]/software');
  const response=await POST({params:{id:'r'},request:new Request('https://example.com/api/owner/requests/r/software',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({action:'draft',terms,agreementDetails:{...details,attachments:[]},removedAttachmentKeys:Array.from({length:6},()=>`agreements/attachments/${crypto.randomUUID()}.pdf`),expectedUpdatedAt:null})}),locals:{owner:{email:'owner@example.com'},runtime:{env}}} as never);
  expect(response.status).toBe(200);
});

it('rechecks a newly live deposit inside the abandonment transaction',async()=>{
  const result=await signed(),{POST}=await import('~/pages/api/owner/requests/[id]/agreement');
  const batch=db.batch.bind(db);
  db.batch=async statements=>{
    sql.exec("INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES('racing-deposit','r','o',0,'deposit',50,7,'open','owner','now','now')");
    return batch(statements);
  };
  const response=await POST({params:{id:'r'},request:new Request('https://example.com/api/owner/requests/r/agreement',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({action:'abandon',documents:result.documents,reason:'Cancelled',confirmed:true})}),locals:{owner:{email:'owner@example.com'},runtime:{env}}} as never);
  expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'Void or refund the deposit invoice first.'});
  expect((await offer())!.status).toBe('sent');expect((await offerAgreements(db,'o')).every(a=>a.status==='client_signed')).toBe(true);
});

it.each(['agreement','archive'])('GET leaves %s links reusable until POST, which rechecks expiry',async purpose=>{
  const key='z'.repeat(43),hash=await hashOfferToken(key),offerToken=purpose==='agreement'?token:undefined;
  sql.prepare('INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run('landing',purpose,purpose==='agreement'?'o':null,purpose==='agreement'?await hashOfferToken(token):null,'client@example.com',hash,'now','2099-01-01');
  const sessions=sql.prepare('SELECT count(*) n FROM software_agreement_sessions').get().n;
  for(let i=0;i<2;i++)expect((await completeAgreementLink(env,new Request('https://example.com'),key,offerToken)).status).toBe(200);
  expect(sql.prepare("SELECT used_at FROM software_agreement_links WHERE id='landing'").get().used_at).toBeNull();
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_sessions').get().n).toBe(sessions);
  sql.prepare("UPDATE software_agreement_links SET expires_at='2000-01-01' WHERE id='landing'").run();
  expect((await completeAgreementLink(env,new Request('https://example.com',{method:'POST'}),key,offerToken)).status).toBe(401);
  sql.prepare("UPDATE software_agreement_links SET expires_at='2099-01-01' WHERE id='landing'").run();
  const response=await completeAgreementLink(env,new Request('https://example.com',{method:'POST'}),key,offerToken);
  expect(response.status).toBe(303);expect(response.headers.get('location')).toBe(purpose==='agreement'?`/offer/${token}/sign`:'/agreements');
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_sessions').get().n).toBe(sessions+1);
  for(const method of ['GET','POST'])expect((await completeAgreementLink(env,new Request('https://example.com',{method}),key,offerToken)).status).toBe(401);
});


it('covers later orphan pages, wraps, and applies the reviewed page after another preview', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  const now = new Date('2026-10-01T12:00:00Z');
  for (let i = 0; i < 101; i++) {
    const key = `agreements/attachments/kept-${String(i).padStart(3, '0')}.pdf`;
    bucketData.set(key, new Uint8Array([1]));
    bucketUploaded.set(key, now);
  }
  const key = 'agreements/attachments/z-orphan.pdf';
  bucketData.set(key, new Uint8Array([2]));
  const first = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  expect(first.orphan_scan_cursor).toBeNull();
  expect(first.orphan_attachments).toEqual([]);
  const second = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  expect(second.orphan_attachments.map(item => item.key)).toEqual([key]);
  expect((await previewAgreementRetention(db, env.AUDIO, 'test-storage', now)).orphan_attachments).toEqual(second.orphan_attachments);
  await applyAgreementRetention(db, env.AUDIO, 'test-storage', second, now);
  const wrapped = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  expect(wrapped.orphan_scan_cursor).toBeNull();
  expect(wrapped.orphan_attachments).toEqual([]);
  expect(bucketData.has(key)).toBe(false);
  const next = await previewAgreementRetention(db, env.AUDIO, 'test-storage', now);
  expect(next.orphan_scan_cursor).toBe(second.orphan_scan_cursor);
});

it.each(['not json', JSON.stringify({ version: 1, cursor: 42 }), JSON.stringify({ version: 1, cursor: 'damaged' })])('restarts a corrupted orphan cursor (%s)', async marker => {
  const { previewAgreementRetention } = await import('~/lib/agreement-retention');
  bucketData.set('agreements/retention/attachment-cursor.json', new TextEncoder().encode(marker));
  const key = 'agreements/attachments/orphan.pdf';
  bucketData.set(key, new Uint8Array([2]));
  const manifest = await previewAgreementRetention(db, env.AUDIO, 'test-storage');
  expect(manifest.orphan_scan_cursor).toBeNull();
  expect(manifest.orphan_attachments.map(item => item.key)).toEqual([key]);
});

it('retries the same orphan page after storage refuses deletion', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  for (let i=0;i<101;i++) bucketData.set(`agreements/attachments/${String(i).padStart(3,'0')}.pdf`,new Uint8Array([1]));
  const first=await previewAgreementRetention(db,env.AUDIO,'test-storage');
  expect((await previewAgreementRetention(db,env.AUDIO,'test-storage')).orphan_attachments).toEqual(first.orphan_attachments);
  vi.mocked(env.AUDIO.delete).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(applyAgreementRetention(db,env.AUDIO,'test-storage',first)).rejects.toThrow('Storage unavailable');
  expect((await previewAgreementRetention(db,env.AUDIO,'test-storage')).orphan_attachments).toEqual(first.orphan_attachments);
  await applyAgreementRetention(db,env.AUDIO,'test-storage',first);
  expect((await previewAgreementRetention(db,env.AUDIO,'test-storage')).orphan_attachments).toHaveLength(1);
});

it('clears offer snapshots only when its last retained agreement is deleted', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await signed();
  const snapshot=()=>sql.prepare("SELECT recipient_email_snapshot,agreement_details_json FROM software_offers WHERE id='o'").get();
  const original=snapshot();
  sql.exec("UPDATE software_agreements SET status='abandoned',ended_at='2000-01-01',retain_until='2010-01-01' WHERE kind='sow'");
  await applyAgreementRetention(db,env.AUDIO,'test-storage',await previewAgreementRetention(db,env.AUDIO,'test-storage'));
  expect(snapshot()).toEqual(original);
  sql.exec("UPDATE software_agreements SET status='abandoned',ended_at='2000-01-01',retain_until='2010-01-01',terminated_at='2000-01-01'");
  await applyAgreementRetention(db,env.AUDIO,'test-storage',await previewAgreementRetention(db,env.AUDIO,'test-storage'));
  expect(snapshot()).toEqual({recipient_email_snapshot:null,agreement_details_json:null});
});

it('applies the same archive cooldown to known and unknown emails without storing unknown addresses',async()=>{
  await signed();sql.exec("UPDATE software_agreements SET status='executed'");
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({success:true})));
  const results=[];
  for(const email of ['client@example.com','unknown@example.com']) {
    const first=await issueAgreementLink(env,request(),{turnstileToken:'test',email});
    const second=await issueAgreementLink(env,request(),{turnstileToken:'test',email});
    results.push([first.status,await first.json(),second.status,await second.json()]);
  }
  expect(results[0]).toEqual(results[1]);expect(results[1][2]).toBe(429);
  expect(JSON.stringify(sql.prepare('SELECT * FROM audio_client_allowances').all())).not.toContain('unknown@example.com');
  expect(JSON.stringify((fetch as any).mock.calls)).not.toContain('unknown@example.com');
});

it('retains review agreements and pinned terms while any project references the offer', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await signed();
  sql.exec("UPDATE software_agreements SET status='abandoned',ended_at='2000-01-01',retain_until='2010-01-01',terminated_at='2000-01-01'; INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r','o','{}','standard','now','now','now','owner','now','now')");
  const original=sql.prepare("SELECT * FROM software_offers WHERE id='o'").get();
  const manifest=await previewAgreementRetention(db,env.AUDIO,'test-storage');
  expect(manifest.agreements).toEqual([]);
  await applyAgreementRetention(db,env.AUDIO,'test-storage',manifest);
  expect(sql.prepare("SELECT * FROM software_offers WHERE id='o'").get()).toEqual(original);
});
it('leaves a newer saved attachment cursor alone when applying an old preview', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  const old=await previewAgreementRetention(db,env.AUDIO,'test-storage');
  const marker='agreements/retention/attachment-cursor.json';
  const newer=JSON.stringify({version:1,cursor:'after:newer'});
  bucketData.set(marker,new TextEncoder().encode(newer));
  await applyAgreementRetention(db,env.AUDIO,'test-storage',old);
  expect(new TextDecoder().decode(bucketData.get(marker))).toBe(newer);
});
it('emails the client signature receipt rather than the agreement ID', async () => {
  const { deliverAgreementNotifications } = await import('~/lib/agreement-artifacts');
  await signed();
  const signature=sql.prepare("SELECT agreement_id,receipt_id FROM software_agreement_signatures WHERE party='client' AND agreement_id IN (SELECT id FROM software_agreements WHERE kind='sow')").get();
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'message'})));
  await deliverAgreementNotifications(env,signature.agreement_id);
  const payload=vi.mocked(fetch).mock.calls.map(([,init])=>JSON.parse(String(init?.body))).find(p=>p.subject==='Your signature is saved');
  expect(payload.text).toContain(`Receipt: ${signature.receipt_id}`);
  expect(payload.text).not.toContain(`Receipt: ${signature.agreement_id}`);
});

it.each([false,true])('conditionally advances the attachment cursor if storage changes during apply (existing marker: %s)', async exists => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  const marker='agreements/retention/attachment-cursor.json';
  const old=await previewAgreementRetention(db,env.AUDIO,'test-storage');
  if (!exists) bucketData.delete(marker);
  const newer=JSON.stringify({version:1,cursor:'after:newer'});
  const put=vi.mocked(env.AUDIO.put).getMockImplementation()!;
  vi.mocked(env.AUDIO.put).mockImplementationOnce(async (...args:any[])=>{
    bucketData.set(marker,new TextEncoder().encode(newer));
    return (put as any)(...args);
  });
  await applyAgreementRetention(db,env.AUDIO,'test-storage',old);
  expect(new TextDecoder().decode(bucketData.get(marker))).toBe(newer);
});

it('expires a reused MSA once its project content is deleted', async () => {
  const { previewAgreementRetention, applyAgreementRetention } = await import('~/lib/agreement-retention');
  await review();
  sql.exec("UPDATE software_offers SET status='superseded' WHERE id='o'; UPDATE software_agreements SET msa_id=NULL,legal_hold=1 WHERE kind='sow'; UPDATE software_agreements SET status='abandoned',ended_at='2000-01-01',retain_until='2010-01-01',terminated_at='2000-01-01'; INSERT INTO software_offers(id,request_id,version,status,terms_json,reused_msa_id,created_at,updated_at) SELECT 'reused','r',2,'sent','{}',id,'now','now' FROM software_agreements WHERE kind='msa'; INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,content_deleted_at) VALUES('r','reused','{}','standard','now','now','now','owner','now','now','now')");
  const original=sql.prepare("SELECT reused_msa_id FROM software_offers WHERE id='reused'").get();
  const manifest=await previewAgreementRetention(db,env.AUDIO,'test-storage');
  expect(manifest.agreements.map(a=>a.id)).toContain(original.reused_msa_id);
  await applyAgreementRetention(db,env.AUDIO,'test-storage',manifest);
  expect(sql.prepare("SELECT reused_msa_id FROM software_offers WHERE id='reused'").get()).toEqual({reused_msa_id:null});
});

it.each(['agreement','archive'])('rejects noncanonical %s link requests without using allowances or links',async purpose=>{
  const foreign=new Request('https://foreign.example/api/agreements/link',{method:'POST'});
  const before=sql.prepare('SELECT count(*) n FROM audio_client_allowances').get().n;
  expect((await issueAgreementLink(env,foreign,{email:'client@example.com',turnstileToken:'valid'},purpose==='agreement'?token:undefined)).status).toBe(404);
  expect((await completeAgreementLink(env,foreign,token,purpose==='agreement'?token:undefined)).status).toBe(404);
  expect(sql.prepare('SELECT count(*) n FROM audio_client_allowances').get().n).toBe(before);
  expect(sql.prepare("SELECT used_at FROM software_agreement_links WHERE id='challenge'").get().used_at).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('emails archive access with signed-document copy and the canonical link',async()=>{
  const result=await signed();await countersignAgreements(db,(await offer())!,result.documents,'Owner','owner',request());
  await issueAgreementLink(env,request(),{email:'client@example.com',turnstileToken:'valid'});
  const payload=JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]?.body));
  expect(payload.subject).toBe('Your signed documents');
  expect(payload.text).toContain('Tap below to open your signed agreement documents.');
  expect(payload.html).toContain('Open your documents</a>');
  expect(payload.html).toContain('https://example.com/agreements/verify?key=');
});
