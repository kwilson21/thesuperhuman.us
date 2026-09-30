import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  validateTemplate,
  renderAgreement,
  templateFields,
  publishTemplate,
} from '~/lib/agreement-templates';
import {
  validateAgreementDetails,
  agreementDetailsSchema,
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
  completeAgreementCode,
  issueAgreementCode,
} from '~/lib/agreement-access';
import {
  prepareAgreementArtifact,
  deliverAgreementCopies,
  hashBytes,
} from '~/lib/agreement-artifacts';
import { agreementDownload } from '~/lib/agreement-download';
import { hashOfferToken, type SoftwareOffer } from '~/lib/software-offers';
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
  business_engagement: true,
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
  initials: 'ES',
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
      "INSERT INTO software_agreement_challenges(id,purpose,offer_id,link_hash,recipient_email,code_hash,issued_at,expires_at) VALUES('challenge','agreement','o',?,'client@example.com','hash','2020-01-01','2099-01-01')",
    )
    .run(await hashOfferToken(token));
  sql
    .prepare(
      "INSERT INTO software_agreement_sessions VALUES(?,'agreement','o',?,'client@example.com','challenge','2026-09-30T12:00:00Z','2099-01-01',NULL,'csrf')",
    )
    .run(await hashOfferToken(token), await hashOfferToken(token));
  const bucket = {
    put: vi.fn(async (k: string, v: string | Uint8Array) =>
      bucketData.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : v),
    ),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: [...bucketData.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    })),
    delete: vi.fn(async (k: string) => bucketData.delete(k)),
    get: vi.fn(async (k: string) => {
      const b = bucketData.get(k);
      return b
        ? {
            size: b.length,
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
  await prepareAgreementArtifact(env, id, async () => {
    throw new Error('render failed');
  });
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
it('issues a pinned-recipient code, rejects wrong codes, consumes once and limits resend', async () => {
  const req = new Request('https://example.com', { headers: { 'cf-connecting-ip': '192.0.2.2' } });
  const response = await issueAgreementCode(env, req, { turnstileToken: 'test' }, token);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { challenge_id: string };
  const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  expect(payload.to).toEqual(['client@example.com']);
  const code = payload.text.match(/\d{8}/)[0];
  expect(
    (
      await completeAgreementCode(
        env,
        req,
        { challenge_id: body.challenge_id, code: '00000000' },
        token,
      )
    ).status,
  ).toBe(401);
  expect(
    (await completeAgreementCode(env, req, { challenge_id: body.challenge_id, code }, token))
      .status,
  ).toBe(200);
  expect(
    (await completeAgreementCode(env, req, { challenge_id: body.challenge_id, code }, token))
      .status,
  ).toBe(401);
  expect((await issueAgreementCode(env, req, { turnstileToken: 'test' }, token)).status).toBe(429);
});
it('charges five failed attempts and refuses later correct code', async () => {
  const req = new Request('https://example.com'),
    issued = await issueAgreementCode(env, req, { turnstileToken: 'test' }, token),
    body = (await issued.json()) as { challenge_id: string };
  const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)),
    code = payload.text.match(/\d{8}/)[0];
  for (let i = 0; i < 5; i++)
    expect(
      (
        await completeAgreementCode(
          env,
          req,
          { challenge_id: body.challenge_id, code: 'wrong' },
          token,
        )
      ).status,
    ).toBe(401);
  expect(
    (await completeAgreementCode(env, req, { challenge_id: body.challenge_id, code }, token))
      .status,
  ).toBe(401);
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
    new Request('https://example.com/api/agreements/code', {
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
        new Request('https://example.com/api/agreements/code', {
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
it('allows expired SOW cleanup after project content cleanup and clears only its tombstone reference', async () => {
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
it('requires an explicit business engagement before review', () => {
  expect(() => clientAgreementSchema.parse({ ...client, business_engagement: false })).toThrow();
  const { business_engagement, ...without } = client;
  expect(() => clientAgreementSchema.parse(without)).toThrow();
});
it('removes expired access data while retaining signature verification evidence', async () => {
  const { cleanupAgreementAccess } = await import('~/lib/agreement-access');
  await signed();
  sql.exec(
    "UPDATE software_agreement_sessions SET expires_at='2020-01-01';UPDATE software_agreement_challenges SET expires_at='2020-01-01';",
  );
  await cleanupAgreementAccess(db);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_sessions').get().n).toBe(0);
  expect(sql.prepare('SELECT count(*) n FROM software_agreement_challenges').get().n).toBe(0);
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
