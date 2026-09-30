import { createHash } from 'node:crypto';
// Sent rows and links are seeded because sending depends on an external email service.
export default {
  title: 'Software offer review and private client views',
  async run({ capture, sql, ownerFetch }) {
    const id = 'screenshot-offer';
    const terms = { outcome: 'One place for client onboarding.', summary: 'A focused first milestone to see each client’s status, next action, and owner.',
      milestones: [{ name: 'Client onboarding tracker', deliverables: ['A shared client-status view', 'Next actions with a named owner', 'CSV import and handoff notes'], acceptance: ['Using the agreed sample, add a client, update their status, and identify their next action.'], feeCents: 240000, checkpoint: { label: 'Direction approved', cancellationPercent: 75 } }],
      clientInputs: 'A redacted sample spreadsheet and one person to review the work.', exclusions: 'CRM integrations, automated emails, and ongoing support.', timing: 'We’ll agree the schedule before signing. Your start date is confirmed after the agreement and initial payment.', paymentMode: 'standard', projectRange: { lowCents: 240000, highCents: 500000 } };
    const quote = value => `'${String(value).replaceAll("'", "''")}'`;
    sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at)
      VALUES (${quote(id)},'software','workflow','Alex Example','alex@example.com','Client onboarding tool','{"path":"workflow","company":"Example Studio","today":"We track client onboarding in spreadsheets and chase updates by email.","audience":"The client team","firstResult":"One place to see what each client needs next.","timing":"flexible","budgetStatus":"exploring","approver":"self"}','new','Check how many people need access.','2026-09-29T12:00:00Z','2026-09-29T12:00:00Z')`);
    await ownerFetch(`/api/owner/requests/${id}/software`, { action:'fit', label:'needs-clarification', note:'Clarify who will use the first version.' });
    await ownerFetch(`/api/owner/requests/${id}/software`, { action:'draft', terms, expectedUpdatedAt:null });
    const steps = [];
    for (const viewport of ['desktop','phone']) {
      steps.push({ title:`Owner draft and fit review, ${viewport}`, images:[{ file:await capture({ file:`software-offer-owner-${viewport}.png`, path:`/owner/requests/${id}`, owner:true, viewport }), caption:'Fictional saved draft; client answers remain read only' }] });
      steps.push({ title:`Exact draft preview, ${viewport}`, images:[{ file:await capture({ file:`software-offer-preview-${viewport}.png`, path:`/owner/requests/${id}/offer`, owner:true, viewport }), caption:'Owner-only preview of fictional terms' }] });
    }
    for (const [index, mode] of ['standard','invoice'].entries()) {
      const token = (mode === 'standard' ? 's' : 'i').repeat(43), hash = createHash('sha256').update(token).digest('hex');
      if (index === 0) sql(`DELETE FROM software_offers WHERE request_id=${quote(id)} AND status='draft'`);
      sql(`UPDATE software_offers SET status='superseded' WHERE request_id=${quote(id)} AND status='sent';
        INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,sent_at,sent_by)
        VALUES (${quote(`screenshot-offer-${mode}`)},${quote(id)},${index + 1},'sent',${quote(JSON.stringify({ ...terms, paymentMode:mode }))},'2026-09-29T12:00:00Z','2026-09-29T12:00:00Z','2026-09-29T12:00:00Z','owner@example.com');
        INSERT INTO software_offer_links(request_id,token_hash,created_at) VALUES (${quote(id)},${quote(hash)},'2026-09-29T12:00:00Z')
        ON CONFLICT(request_id) DO UPDATE SET token_hash=excluded.token_hash,revoked_at=NULL;`);
      for (const viewport of ['desktop','phone']) steps.push({ title:`Owner sent v${index + 1}, ${viewport}`, images:[{ file:await capture({ file:`software-offer-owner-sent-${mode}-${viewport}.png`, path:`/owner/requests/${id}`, owner:true, viewport }), caption:'Seeded fictional sent state, versions and link controls; no email call' }] });
      for (const viewport of ['desktop','phone']) steps.push({ title:`Client ${mode} terms, ${viewport}`, images:[{ file:await capture({ file:`software-offer-${mode}-${viewport}.png`, path:`/offer/${token}`, viewport }), caption:'Seeded fictional sent offer; no external email call' }] });
    }
    // Seed the same post-decline state as the guarded API batch; never send a real email.
    sql(`UPDATE owner_requests SET status='resolved',resolved_at='2026-09-29T13:00:00Z' WHERE id=${quote(id)}; UPDATE software_offers SET status='withdrawn' WHERE request_id=${quote(id)} AND status IN ('sent','draft'); UPDATE software_offer_links SET revoked_at='2026-09-29T13:00:00Z' WHERE request_id=${quote(id)};`);
    for (const viewport of ['desktop','phone']) steps.push({ title:`Resolved owner request, ${viewport}`, images:[{ file:await capture({ file:`software-offer-owner-resolved-${viewport}.png`, path:`/owner/requests/${id}`, owner:true, viewport }), caption:'Resolved request keeps versions and hides offer editing' }] });
    for (const viewport of ['desktop','phone']) steps.push({ title:`Declined client offer unavailable, ${viewport}`, images:[{ file:await capture({ file:`software-offer-declined-${viewport}.png`, path:`/offer/${'i'.repeat(43)}`, status:404, viewport }), caption:'Seeded decline withdraws the offer and revokes its actual fictional link' }] });
    sql(`UPDATE owner_requests SET status='withdrawn' WHERE id=${quote(id)}`);
    for (const viewport of ['desktop','phone']) steps.push({ title:`Withdrawn owner request, ${viewport}`, images:[{ file:await capture({ file:`software-offer-owner-withdrawn-${viewport}.png`, path:`/owner/requests/${id}`, owner:true, viewport }), caption:'Withdrawn request keeps saved fit history and versions with no editing controls' }] });
    for (const viewport of ['desktop','phone']) steps.push({ title:`Unavailable offer, ${viewport}`, images:[{ file:await capture({ file:`software-offer-unavailable-${viewport}.png`, path:'/offer/unavailable', status:404, viewport }), caption:'Identical response for unknown or revoked links' }] });
    return steps;
  },
};
