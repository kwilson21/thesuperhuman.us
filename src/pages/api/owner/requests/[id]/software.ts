import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { getOwnerRequest } from '~/lib/owner-requests';
import { listSoftwareOffers, validateOfferTerms, hashOfferToken, newOfferToken, offerSendingGuard, offerIsSending, offerSendingMessage } from '~/lib/software-offers';
import { sendAudioMessage } from '~/lib/audio-resend';
export const prerender = false;
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fit'), label: z.enum(['potential-fit','needs-clarification','stated-mismatch']), note: z.string().trim().max(500), expectedRequestUpdatedAt: z.string().optional() }),
  z.object({ action: z.literal('draft'), terms: z.unknown(), expectedUpdatedAt: z.string().nullable() }),
  z.object({ action: z.literal('send'), version: z.number().int().positive(), expectedUpdatedAt: z.string() }),
  z.object({ action: z.literal('revoke') }),
  z.object({ action: z.enum(['question','decline']), text: z.string().trim().min(1).max(2000) }),
]);
const headers = { 'cache-control': 'private, no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return json({ ok: false }, 403);
  const env = locals.runtime.env, db = env.MUSIC_DB;
  if (!db || !params.id) return json({ ok: false }, 503);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ ok: false, message: 'Check the required fields and their limits.' }, 400);
  const command = parsed.data;
  const record = await getOwnerRequest(db, params.id);
  if (!record || record.kind !== 'software') return json({ ok: false }, 404);
  if ((record.status === 'withdrawn' && command.action !== 'revoke') || !record.email) return json({ ok: false, message: 'This request is closed.' }, 409);
  if (record.status === 'resolved' && ['draft', 'send', 'fit', 'question'].includes(command.action)) return json({ ok: false, message: 'This request is resolved. Reopen it to make a new offer.' }, 409);
  const actor = locals.owner.email;
  let now = new Date().toISOString();
  const audit = (action: string, note = '') => db.prepare('INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at) VALUES (?,?,?,?,?)').bind(record.id, action, actor, note, now);
  const email = async (subject: string, text: string) => {
    if (!env.RESEND_API_KEY || !env.CONTACT_FROM_EMAIL || !env.OWNER_EMAIL) return { ok: false, copySent: false };
    const payload = { from: env.CONTACT_FROM_EMAIL, reply_to: env.OWNER_EMAIL, subject, text };
    const sent = await sendAudioMessage({ apiKey: env.RESEND_API_KEY, payload: { ...payload, to: [record.email] } });
    if (!sent.ok) return { ok: false, copySent: false, uncertain: sent.uncertain };
    const copy = await sendAudioMessage({ apiKey: env.RESEND_API_KEY, payload: { ...payload, to: [env.OWNER_EMAIL], subject: `Copy: ${subject}` } });
    return { ok: true, copySent: copy.ok };
  };
  // D1 batches are transactions. This assertion rolls back a stale command before any mutation.
  const guard = (query: string, values: (string | number)[]) => db.prepare(`SELECT CASE WHEN EXISTS(${query}) THEN 1 ELSE json_extract('Offer changed. Reload and try again.','$') END`).bind(...values);
  const requestGuard = () => guard('SELECT 1 FROM owner_requests WHERE id=? AND updated_at=? AND status=? AND email=?', [record.id, record.updatedAt, record.status, record.email]);
  try {
    if (command.action === 'fit') {
      if (command.expectedRequestUpdatedAt !== undefined && command.expectedRequestUpdatedAt !== record.updatedAt) return json({ ok: false, message: 'The request changed or could not be saved. Reload and try again.' }, 409);
      if (Date.parse(record.updatedAt) >= Date.parse(now)) now = new Date(Date.parse(record.updatedAt) + 1).toISOString();
      await db.batch([requestGuard(), db.prepare(`INSERT INTO software_fit_reviews(request_id,label,note,updated_at,updated_by) VALUES (?,?,?,?,?)
        ON CONFLICT(request_id) DO UPDATE SET label=excluded.label,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(record.id, command.label, command.note, now, actor), db.prepare('UPDATE owner_requests SET updated_at=? WHERE id=?').bind(now, record.id), audit('fit-reviewed')]);
      return json({ ok: true, updatedAt: now });
    }
    if (command.action === 'question' || command.action === 'decline') {
      if (command.action === 'decline' && record.status === 'resolved') return json({ ok: false, message: 'This request is already resolved.' }, 409);
      if (command.action === 'decline' && await offerIsSending(db, record.id)) return json({ ok: false, message: offerSendingMessage }, 409);
      if (command.action === 'decline') await db.batch([
        requestGuard(), offerSendingGuard(db, record.id),
        guard('SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM audio_projects WHERE request_id=?)', [record.id]),
        db.prepare("UPDATE software_offers SET status='withdrawn',updated_at=? WHERE request_id=? AND status IN ('sent','draft')").bind(now, record.id),
        db.prepare('UPDATE software_offer_links SET revoked_at=? WHERE request_id=? AND revoked_at IS NULL').bind(now, record.id),
      ]);
      const sent = await email(command.action === 'question' ? 'A question about your project brief' : 'About your project brief', `${command.text}\n\nKazon`);
      if (!sent.ok) return json({ ok: false, uncertain: sent.uncertain, message: command.action === 'decline' ? (sent.uncertain ? 'The email service didn’t confirm. The offer is withdrawn and its link is closed. Check Resend before retrying.' : 'The email didn’t send. The offer is withdrawn and its link is closed; nothing else changed. Try again.') : sent.uncertain ? 'The email service didn’t confirm. Check Resend before retrying. Nothing was recorded.' : 'The email didn’t send. Nothing changed. Try again.' }, 502);
      try { await db.batch([
        requestGuard(),
        ...(command.action === 'decline' ? [offerSendingGuard(db, record.id),
          guard('SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM audio_projects WHERE request_id=?)', [record.id]),
          db.prepare("UPDATE owner_requests SET status='resolved',resolved_at=?,updated_at=? WHERE id=?").bind(now, now, record.id)] : []),
        audit(command.action === 'question' ? 'question-sent' : 'declined'),
      ]); } catch { if (command.action === 'decline' && await offerIsSending(db, record.id)) return json({ ok: false, message: offerSendingMessage }, 409); return json({ ok: false, message: 'The client email was sent, but the request changed before it could be recorded. Reload before taking another action.' }, 409); }
      return json({ ok: true, copySent: sent.copySent });
    }
    if (command.action === 'revoke') {
      await db.batch([requestGuard(), offerSendingGuard(db, record.id), guard('SELECT 1 FROM software_offer_links WHERE request_id=? AND revoked_at IS NULL', [record.id]),
        db.prepare('UPDATE software_offer_links SET revoked_at=? WHERE request_id=?').bind(now, record.id), audit('offer-link-revoked')]);
      return json({ ok: true });
    }
    const offers = await listSoftwareOffers(db, record.id), draft = offers.find(offer => offer.status === 'draft');
    if (draft && Date.parse(draft.updated_at) >= Date.parse(now)) now = new Date(Date.parse(draft.updated_at) + 1).toISOString();
    if (command.action === 'draft') {
      const terms = validateOfferTerms(command.terms);
      if (!terms.ok) return json({ ok: false, errors: terms.errors }, 400);
      if ((draft?.updated_at ?? null) !== command.expectedUpdatedAt) return json({ ok: false, updatedAt: draft?.updated_at ?? null, message: 'The saved draft changed since this page loaded. Save again to keep what’s on screen, or reload to see the saved version.' }, 409);
      const version = draft?.version ?? ((offers[0]?.version ?? 0) + 1), id = draft?.id ?? crypto.randomUUID();
      await db.batch([
        requestGuard(),
        ...(draft ? [guard("SELECT 1 FROM software_offers WHERE id=? AND status='draft' AND updated_at=?", [draft.id, command.expectedUpdatedAt!])] : []),
        draft ? db.prepare("UPDATE software_offers SET terms_json=?,updated_at=? WHERE id=? AND status='draft'").bind(JSON.stringify(terms.value), now, id)
          : db.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES (?,?,?,'draft',?,?,?)").bind(id, record.id, version, JSON.stringify(terms.value), now, now),
        audit('offer-draft-saved'),
      ]);
      return json({ ok: true, version, updatedAt: now });
    }
    if (command.action !== 'send') return json({ ok: false }, 400);
    if (await offerIsSending(db, record.id)) return json({ ok: false, message: offerSendingMessage }, 409);
    // A revoked link can be reissued for the current sent version without changing its terms.
    const offer = draft ?? offers.find(value => value.status === 'sent');
    if (!offer || offer.version !== command.version || offer.updated_at !== command.expectedUpdatedAt) return json({ ok: false, message: 'Save a valid draft before sending.' }, 409);
    const terms = validateOfferTerms(JSON.parse(offer.terms_json));
    if (!terms.ok) return json({ ok: false, errors: terms.errors }, 400);
    const token = newOfferToken(), tokenHash = await hashOfferToken(token);
    let link: string;
    try { link = new URL(`/offer/${token}`, env.SITE_ORIGIN ?? 'https://thesuperhuman.us').href; }
    catch { return json({ ok: false, message: 'The offer link couldn’t be built. Check SITE_ORIGIN. Nothing was sent.' }, 500); }
    await db.batch([
      requestGuard(), offerSendingGuard(db, record.id),
      guard('SELECT 1 FROM software_offers WHERE id=? AND status=? AND updated_at=?', [offer.id, offer.status, offer.updated_at]),
      ...(offer.status === 'sent' ? [guard('SELECT 1 FROM software_offer_links WHERE request_id=? AND revoked_at IS NOT NULL', [record.id])] : []),
      ...(draft ? [db.prepare("UPDATE software_offers SET status='superseded' WHERE request_id=? AND status='sent'").bind(record.id),
        db.prepare("UPDATE software_offers SET status='sent',sent_at=?,sent_by=?,updated_at=? WHERE id=?").bind(now, actor, now, offer.id)] : []),
      db.prepare(`INSERT INTO software_offer_links(request_id,token_hash,created_at,revoked_at) VALUES (?,?,?,NULL)
        ON CONFLICT(request_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,revoked_at=NULL`).bind(record.id, tokenHash, now),
      audit('offer-sent', `Offer v${offer.version} sent`),
    ]);
    const sent = await email(`Your project offer: ${terms.value.outcome}`, `Hi ${record.name.trim().split(/\s+/)[0] || 'there'},\n\nHere’s the offer for ${terms.value.outcome}: ${link}\n\nThe link is private to you. You can forward it to whoever approves the budget. Reply to this email with any questions.\n\nKazon`);
    const live = await db.prepare(`SELECT 1 FROM software_offer_links WHERE request_id=? AND token_hash=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM software_offers WHERE id=? AND status='sent')
      AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status<>'withdrawn' AND email<>'')`).bind(record.id, tokenHash, offer.id, record.id).first();
    if (sent.ok && !live) return json({ ok: false, message: 'The email went out, but the link was closed while it was sending. Send the offer again for a working link.' }, 409);
    return json({ ok: true, version: offer.version, link, sentAt: draft ? now : offer.sent_at, updatedAt: draft ? now : offer.updated_at, emailSent: sent.ok, uncertain: sent.uncertain, copySent: sent.copySent });
  } catch {
    if (['send', 'revoke', 'decline'].includes(command.action) && await offerIsSending(db, record.id)) return json({ ok: false, message: offerSendingMessage }, 409);
    if (command.action === 'draft') {
      const draft = (await listSoftwareOffers(db, record.id)).find(offer => offer.status === 'draft');
      return json({ ok: false, updatedAt: draft?.updated_at ?? null, message: 'The saved draft changed since this page loaded. Save again to keep what’s on screen, or reload to see the saved version.' }, 409);
    }
    return json({ ok: false, message: 'The request changed or could not be saved. Reload and try again.' }, 409);
  }
};
