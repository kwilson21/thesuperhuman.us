import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export default {
  title: 'Software agreement review, signatures and retained copies',
  async run({ capture, sql, ownerFetch, templates }) {
    // Legal sources remain private. Unit coverage may inject its small fixture.
    templates ??= JSON.parse(readFileSync(process.env.AGREEMENT_TEMPLATE_FILE ?? '.private/signing/templates.json', 'utf8'));
    const template = kind => templates[kind];
    const id = 'screenshot-signing',
      token = 'g'.repeat(43),
      at = new Date().toISOString(),
      // This fixture represents a completed send, outside the live send guard.
      sentAt = new Date(Date.now() - 60_000).toISOString(),
      session = 'v'.repeat(43),
      cookie = { name: 'agreement_session', value: session };
    const terms = {
      outcome: 'Fictional client tracker',
      summary: 'One shared view.',
      milestones: [
        {
          name: 'Tracker',
          deliverables: ['A shared view'],
          acceptance: ['Add a client and see their status.'],
          feeCents: 240000,
        },
      ],
      clientInputs: 'A synthetic sample.',
      exclusions: 'Production rollout.',
      timing: 'Agreed dates.',
      paymentMode: 'standard',
    };
    const details = {
      planned_start: '2026-10-01',
      planned_end: '2026-10-20',
      environment: 'Browser prototype',
      operating_responsibilities: 'Client operates the delivered prototype.',
      update_rhythm: 'Weekly',
      milestones: [
        { start: '2026-10-01', target: '2026-10-20', handoff: 'Source and license notices' },
      ],
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
    const client = {
      business_engagement: true,
      legal_name: 'Example Client LLC',
      entity_type: 'LLC',
      jurisdiction: 'Wyoming',
      business_address: '100 Example Business Street',
      notice_email: 'notices@example.com',
      signer_name: 'Example Signer',
      signer_title: 'Representative',
      reviewer_name: 'Example Reviewer',
      reviewer_email: 'reviewer@example.com',
      approver_name: 'Example Approver',
      approver_email: 'approver@example.com',
      portfolio: 'deny',
      naming: false,
      initials: 'ES',
    };
    sql(`UPDATE software_signing_settings SET software_signing_enabled=1;
   INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES(${quote(id)},'software','Example Client','signer@example.com','Fictional tracker','reviewed',${quote(at)},${quote(at)});
   INSERT INTO software_contractor_config VALUES(1,${quote(JSON.stringify(contractor))},${quote(at)},'owner@example.com');
   ${['msa', 'sow'].map((kind) => `INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES('screenshot-${kind}',${quote(kind)},1,${quote(template(kind))},${quote(hash(template(kind)))},${quote(at)},'owner@example.com');`).join('\n')}
   INSERT INTO software_offers(id,request_id,version,status,terms_json,agreement_details_json,msa_template_id,sow_template_id,contractor_snapshot_json,recipient_email_snapshot,created_at,updated_at,sent_at) VALUES('screenshot-signing-offer',${quote(id)},1,'sent',${quote(JSON.stringify(terms))},${quote(JSON.stringify(details))},'screenshot-msa','screenshot-sow',${quote(JSON.stringify({ ...contractor, config_version: 1 }))},'signer@example.com',${quote(at)},${quote(at)},${quote(sentAt)});
   INSERT INTO software_offer_links VALUES(${quote(id)},${quote(hash(token))},${quote(sentAt)},NULL);
   INSERT INTO software_agreement_challenges(id,purpose,offer_id,link_hash,recipient_email,code_hash,issued_at,expires_at) VALUES('screenshot-challenge','agreement','screenshot-signing-offer',${quote(hash(token))},'signer@example.com','synthetic-code-hash',${quote(at)},'2099-01-01');
   INSERT INTO software_agreement_sessions VALUES(${quote(hash(session))},'agreement','screenshot-signing-offer',${quote(hash(token))},'signer@example.com','screenshot-challenge',${quote(at)},'2099-01-01',NULL,'screenshot-csrf');`);
    const steps = [];
    async function shot(name, title, path, options = {}) {
      for (const viewport of ['desktop', 'phone'])
        steps.push({
          title: `${title}, ${viewport}`,
          images: [
            {
              file: await capture({
                file: `software-signing-${name}-${viewport}.png`,
                path,
                viewport,
                ...options,
                prepare: async page => {
                  if (options.prepare) await options.prepare(page);
                  const viewport = page.viewportSize();
                  try {
                    for (const width of [320, 390, 768, 1280]) {
                      await page.setViewportSize({ width, height: viewport.height });
                      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
                      if (overflow) throw new Error(`Agreement page overflows at ${width}px: ${path}`);
                    }
                  } finally {
                    await page.setViewportSize(viewport);
                  }
                },
              }),
              caption: title,
            },
          ],
        });
    }
    await shot('templates', 'Private template editor and sample fields', '/owner/agreements', {
      owner: true,
      prepare: async (page) => {
        await page
          .locator('[data-template-editor]')
          .first()
          .locator('[name=action][value=preview]')
          .click();
        await page
          .locator('[data-template-preview]')
          .first()
          .filter({ hasText: 'Sample' })
          .waitFor();
      },
    });
    await shot(
      'details',
      'Owner agreement details and start requirements',
      `/owner/requests/${id}`,
      { owner: true },
    );
    sql(`INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES('screenshot-incomplete-draft',${quote(id)},2,'draft',${quote(JSON.stringify(terms))},${quote(at)},${quote(at)});`);
    await shot('missing-send-field','Missing agreement details prevent sending',`/owner/requests/${id}`,{
      owner:true,
      expectedResponses: [{ path: `/api/owner/requests/${id}/software`, status: 400 }],
      prepare:async page=>{
        page.once('dialog',dialog=>dialog.accept());
        const editor = page.locator('[data-software-editor]');
        const response = page.waitForResponse(res => new URL(res.url()).pathname === `/api/owner/requests/${id}/software` && res.request().method() === 'POST');
        await editor.locator('[data-send-offer]').click();
        if ((await response).status() !== 400) throw new Error('Incomplete agreement details must reject sending with HTTP 400.');
        await editor.locator('[data-software-status]').filter({hasText:'Complete and validate Agreement details before sending.'}).waitFor();
      },
    });
    sql("DELETE FROM software_offers WHERE id='screenshot-incomplete-draft'");
    await shot('offer', 'Offer review and signing link', `/offer/${token}`);
    await shot('code', 'Recipient email verification', `/offer/${token}/sign`);
    for (const [name,expires] of [['invalid-code','2099-01-01'],['expired-code','2000-01-01']]) {
      const challenge='00000000-0000-4000-8000-000000000019';
      sql(`INSERT OR REPLACE INTO software_agreement_challenges(id,purpose,offer_id,link_hash,recipient_email,code_hash,issued_at,expires_at) VALUES(${quote(challenge)},'agreement','screenshot-signing-offer',${quote(hash(token))},'signer@example.com','invalid-hash',${quote(at)},${quote(expires)});`);
      await shot(name,'Invalid or expired code requires fresh verification',`/offer/${token}/sign?challenge=${challenge}`,{
        expectedResponses: [{ path: `/api/offer/${token}/session`, status: 401 }],
        prepare:async page=>{
          await page.locator('[name=code]').fill('00000000');
          await page.locator('[data-agreement-session] button').click();
          await page.locator('[role=status]').filter({hasText:'That code is invalid or expired. Request a new one if needed.'}).waitFor();
        },
      });
    }
    await shot('party', 'Verified legal party and required choices', `/offer/${token}/sign`, {
      cookie,
    });
    await shot('required-choice','Missing party fields and choices prevent review',`/offer/${token}/sign`,{
      cookie,
      expectedResponses: [{ path: `/api/offer/${token}/review`, status: 409 }],
      prepare:async page=>{
        await page.locator('[data-agreement-flow="review"]').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
        await page.locator('[role=status]').filter({hasText:'"portfolio"'}).filter({hasText:'"business_engagement"'}).waitFor();
      },
    });
    const reviewed = await ownerFetch(
      `/api/offer/${token}/review`,
      { csrf_nonce: 'screenshot-csrf', values: client },
      'POST',
      { cookie: `agreement_session=${session}` },
    );
    const sow = reviewed.documents?.find((d) => d.kind === 'sow'),
      msa = reviewed.documents?.find((d) => d.kind === 'msa');
    if (!sow || !msa) throw new Error('Agreement review did not return both exact snapshots.');
    await shot('preview', 'Complete exact agreement preview', `/offer/${token}/sign?review=1`, {
      cookie,
    });
    await shot('sow', 'SOW preview continuation', `/offer/${token}/sign?review=1`, {
      cookie,
      selector: '[data-agreement-document="sow"]',
    });
    await shot('signature', 'Consent and signature footer', `/offer/${token}/sign?review=1`, {
      cookie,
      selector: '[data-agreement-flow="sign"]',
    });
    await ownerFetch(
        `/api/offer/${token}/sign`,
        {
          csrf_nonce: 'screenshot-csrf',
          documents: reviewed.documents.map((d) => ({ id: d.id, hash: d.hash })),
          consent: true,
          authority: true,
          intent: true,
        },
        'POST',
        { cookie: `agreement_session=${session}` },
      );
    await shot(
      'waiting',
      'Client signature saved, awaiting countersignature',
      `/offer/${token}/sign`,
      { cookie },
    );
    await shot('counter', 'Owner countersign review', `/owner/requests/${id}`, { owner: true });
    await ownerFetch(`/api/owner/requests/${id}/agreement`, {
      action: 'countersign',
      documents: reviewed.documents.map((d) => ({ id: d.id, hash: d.hash })),
      typed_name: 'Example Owner',
      consent: true,
      authority: true,
      intent: true,
    });
    await shot(
      'executed',
      'Both signatures saved and copy preparation status',
      `/offer/${token}/sign`,
      { cookie },
    );
    sql(
      `UPDATE software_agreement_artifacts SET status='failed',error_code='storage' WHERE agreement_id=${quote(sow.id)};UPDATE software_agreement_deliveries SET status='failed' WHERE agreement_id=${quote(sow.id)};`,
    );
    await shot(
      'copy-error',
      'Executed agreement with copy preparation and email failures',
      `/owner/requests/${id}`,
      { owner: true },
    );
    await ownerFetch(`/api/owner/requests/${id}/agreement`, {
      action: 'retry-artifact',
      agreement_id: sow.id,
    });
    const artifact = JSON.parse(
      sql(`SELECT status FROM software_agreement_artifacts WHERE agreement_id=${quote(sow.id)}`),
    )[0]?.results?.[0];
    if (artifact?.status !== 'ready')
      throw new Error(
        'Signed PDF preparation must succeed before screenshot start/reuse fixtures.',
      );
    sql(`UPDATE software_agreement_deliveries SET status='sent',sent_at=${quote(at)} WHERE agreement_id=${quote(sow.id)};
   INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,stripe_invoice_id,hosted_invoice_url,status,created_by,created_at,updated_at) VALUES('screenshot-signing-deposit',${quote(id)},'screenshot-signing-offer',0,'deposit',120000,7,'in_fictional_signing','https://example.com/invoice/signing','paid','owner@example.com',${quote(at)},${quote(at)});`);
    await shot(
      'start-ready',
      'Website signatures automatically complete at project start',
      `/owner/requests/${id}`,
      { owner: true },
    );
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    await ownerFetch(`/api/owner/requests/${id}/project`, {
      action: 'start',
      expectedRequestUpdatedAt: at,
      offer_id: 'screenshot-signing-offer',
      offer_version: 1,
      signature_source: 'website',
      signatures: true,
      payment: true,
      inputs_ready: true,
      deposit_invoice_id: 'screenshot-signing-deposit',
      earlier_start_on: today,
      earlier_start_agreement: 'Fictional client agreed to this date in writing.',
      next_update_on: '',
    });
    const studio = '00000000-0000-4000-8000-000000000008'.repeat(2);
    sql(
      `INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES(${quote(hash(studio))},'signer@example.com',${quote(at)},'2099-01-01',${quote(at)});`,
    );
    await shot('project-copy', 'Project page signed agreement download', `/studio/software/${id}`, {
      cookie: { name: 'studio_session', value: studio },
    });
    const reuseId = 'screenshot-signing-reuse',
      reuseToken = 'h'.repeat(43),
      reuseSession = 'w'.repeat(43),
      reuseCookie = { name: 'agreement_session', value: reuseSession };
    sql(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES(${quote(reuseId)},'software','Example Client','signer@example.com','Second fictional milestone','reviewed',${quote(at)},${quote(at)});
   INSERT INTO software_offers(id,request_id,version,status,terms_json,agreement_details_json,msa_template_id,sow_template_id,contractor_snapshot_json,recipient_email_snapshot,reused_msa_id,created_at,updated_at,sent_at) SELECT 'screenshot-reuse-offer',${quote(reuseId)},1,'sent',terms_json,agreement_details_json,msa_template_id,sow_template_id,contractor_snapshot_json,recipient_email_snapshot,${quote(msa.id)},${quote(at)},${quote(at)},${quote(at)} FROM software_offers WHERE id='screenshot-signing-offer';
   INSERT INTO software_offer_links VALUES(${quote(reuseId)},${quote(hash(reuseToken))},${quote(at)},NULL);
   INSERT INTO software_agreement_challenges(id,purpose,offer_id,link_hash,recipient_email,code_hash,issued_at,expires_at) VALUES('screenshot-reuse-challenge','agreement','screenshot-reuse-offer',${quote(hash(reuseToken))},'signer@example.com','synthetic-code-hash',${quote(at)},'2099-01-01');
   INSERT INTO software_agreement_sessions VALUES(${quote(hash(reuseSession))},'agreement','screenshot-reuse-offer',${quote(hash(reuseToken))},'signer@example.com','screenshot-reuse-challenge',${quote(at)},'2099-01-01',NULL,'screenshot-reuse-csrf');`);
    await shot(
      'reuse-confirmation',
      'Owner confirmation of the existing same-party MSA',
      `/owner/requests/${reuseId}`,
      { owner: true },
    );
    await ownerFetch(
      `/api/offer/${reuseToken}/review`,
      { csrf_nonce: 'screenshot-reuse-csrf', values: client },
      'POST',
      { cookie: `agreement_session=${reuseSession}` },
    );
    await shot(
      'reuse',
      'Original executed MSA alongside the new SOW',
      `/offer/${reuseToken}/sign?review=1`,
      { cookie: reuseCookie },
    );
    sql(
      `UPDATE software_offers SET status='superseded' WHERE id='screenshot-reuse-offer';UPDATE software_offer_links SET revoked_at=${quote(at)} WHERE request_id=${quote(reuseId)};`,
    );
    await shot('superseded', 'Superseded signing session rejected', `/offer/${reuseToken}/sign`, {
      cookie: reuseCookie,
      status: 404,
    });
    await shot('archive-signin', 'Agreement archive sign-in', '/agreements');
    const archive = 'z'.repeat(43);
    sql(`UPDATE software_projects SET revoked_at=${quote(at)} WHERE request_id=${quote(id)};UPDATE owner_requests SET email='',status='withdrawn' WHERE id=${quote(id)};
   INSERT INTO software_agreement_challenges(id,purpose,recipient_email,code_hash,issued_at,expires_at) VALUES('screenshot-archive-challenge','archive','signer@example.com','synthetic-code-hash',${quote(at)},'2099-01-01');
   INSERT INTO software_agreement_sessions VALUES(${quote(hash(archive))},'archive',NULL,NULL,'signer@example.com','screenshot-archive-challenge',${quote(at)},'2099-01-01',NULL,'screenshot-archive-csrf');`);
    await shot(
      'archive-retained',
      'Retained agreement archive after project closure and contact redaction',
      '/agreements',
      { cookie: { name: 'agreement_archive', value: archive } },
    );
    sql('UPDATE software_signing_settings SET software_signing_enabled=0');
    return steps;
  },
};
