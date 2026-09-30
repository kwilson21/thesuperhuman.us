import { z } from 'astro/zod';
import { offerTermsSchema } from './software-offers';
import { validProjectDate } from './audio-project-updates';
import { sendAudioMessage } from './audio-resend';
import { softwareInvitationEmail, softwareUpdateEmail, softwareReviewEmail, softwareHandoffEmail } from './client-emails';

export const projectStates = { preparing: 'Preparing', building: 'Building', waiting_for_input: 'Waiting for your input', ready_for_review: 'Ready for review', complete: 'Complete' } as const;
export const projectSteps = ['direction', 'build', 'review', 'handoff'] as const;
export const evidenceTypes = { concept: 'Concept', prototype: 'Prototype', working_preview: 'Working preview', demonstration: 'Demonstration', investigation: 'Investigation', handoff: 'Handoff' } as const;
export const updateKinds = { progress: 'Progress', direction_review: 'Direction review', delivery_review: 'Delivery review', handoff: 'Handoff' } as const;
const text = (max: number) => z.string().trim().max(max, `Use up to ${max} characters.`).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value), 'Remove control characters.');
export const projectDate = z.string().refine(value => !value || validProjectDate(value), 'Choose a valid date.');
export const updateInput = z.object({
  kind: z.enum(['progress','direction_review','delivery_review','handoff']), milestone_index: z.number().int().min(0).max(2),
  title: text(120), artifact_version: text(60), evidence_type: z.enum(['concept','prototype','working_preview','demonstration','investigation','handoff']),
  visual_alt: text(300), preview_url: text(2000).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }, 'Use an HTTPS link the client is allowed to open.'),
  what_changed: text(1000), checks_limitations: text(1000), next_step: text(300), client_request: text(300),
  next_update_on: projectDate, email_client: z.boolean(),
  criteria: z.array(text(300)).max(20).default([]),
  links: z.array(z.object({ label: text(80).refine(value=>Boolean(value), 'Name the link.'), url: text(2000).refine(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }, 'Use an HTTPS link.') })).max(10).default([]),
  review_window_days: z.number().int().min(5).max(30).default(5),
  paid_confirmed: z.boolean().default(false),
});
export type SoftwareUpdateInput = z.infer<typeof updateInput>;
export type SoftwareProject = {
  request_id: string; offer_id: string; terms_json: string; payment_mode: 'standard' | 'invoice';
  state: keyof typeof projectStates; waiting_for: string; milestone_index: number; step: typeof projectSteps[number];
  started_at: string; next_update_on: string | null; invitation_status: string; invitation_attempted_at: string | null;
  revoked_at: string | null; completed_at: string | null; content_deleted_at: string | null; updated_at: string;
};
export type SoftwareUpdate = Omit<SoftwareUpdateInput, 'email_client' | 'criteria' | 'links' | 'paid_confirmed'> & {
  criteria_json: string; links_json: string;
  id: string; request_id: string; status: 'draft' | 'shared' | 'superseded'; visual_key: string | null;
  visual_media_type: string | null; shared_at: string | null; updated_at: string; notification_status: string;
  notification_attempted_at: string | null; email_client: number;
};
export const projectTerms = (project: { terms_json: string }) => offerTermsSchema.parse(JSON.parse(project.terms_json));
export function softwareStateSentence(project: { state: string; waiting_for: string }) {
  return ({ preparing: 'Getting set up.', building: 'In progress.', waiting_for_input: `Waiting on you: ${project.waiting_for}`, ready_for_review: 'Ready for your review.', complete: 'Complete.' }[project.state] ?? 'Getting set up.');
}
export const softwareDate = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
export async function getSoftwareProject(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM software_projects WHERE request_id=?').bind(id).first<SoftwareProject>();
}
export async function listSoftwareUpdates(db: D1Database, id: string) {
  return (await db.prepare('SELECT * FROM software_project_updates WHERE request_id=? ORDER BY created_at DESC,id DESC').bind(id).all<SoftwareUpdate>()).results;
}
// Client queries never select drafts, storage keys, notification internals or owner identities.
export type SoftwareDecision = 'direction_confirmed' | 'milestone_accepted' | 'changes_requested';
export type ClientSoftwareUpdate = Pick<SoftwareUpdate, 'id' | 'title' | 'artifact_version' | 'evidence_type' | 'visual_alt' | 'preview_url' | 'what_changed' | 'checks_limitations' | 'next_step' | 'client_request' | 'next_update_on' | 'shared_at'> & {
  has_visual: number; kind?: SoftwareUpdate['kind']; milestone_index?: number; status?: SoftwareUpdate['status'];
  criteria_json?: string; links_json?: string; review_window_days?: number; decision?: SoftwareDecision | null; decided_at?: string | null; decision_body?: string | null;
};
export async function sharedSoftwareUpdates(db: D1Database, id: string) {
  return (await db.prepare(`SELECT u.id,u.title,u.artifact_version,u.evidence_type,u.visual_alt,u.preview_url,u.what_changed,u.checks_limitations,
    u.next_step,u.client_request,u.next_update_on,u.shared_at,u.visual_key IS NOT NULL AS has_visual,
    u.kind,u.milestone_index,u.status,u.criteria_json,u.links_json,u.review_window_days,
    m.decision,m.created_at AS decided_at,m.body AS decision_body
    FROM software_project_updates u LEFT JOIN software_project_messages m ON m.update_id=u.id AND m.decision IS NOT NULL
    WHERE u.request_id=? AND u.status IN ('shared','superseded') ORDER BY u.shared_at DESC,u.id DESC`).bind(id).all<ClientSoftwareUpdate>()).results;
}
export const softwareAudit = (db: D1Database, id: string, action: string, actor: string, at: string, note = '') =>
  db.prepare('INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note) VALUES (?,?,?,?,?)').bind(id, action, actor, at, note);
export function recordMilestonePayment(db: D1Database, id: string, milestone: number, actor: string, at: string) {
  return [db.prepare(`INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note)
    SELECT ?,'milestone-paid',?,?,? WHERE NOT EXISTS(SELECT 1 FROM software_milestone_payments WHERE request_id=? AND milestone_index=?)`)
    .bind(id,actor,at,`Paid in full · milestone ${milestone+1}`,id,milestone),
    db.prepare('INSERT OR IGNORE INTO software_milestone_payments VALUES (?,?,?,?)').bind(id,milestone,at,actor)];
}
export async function milestonePayments(db: D1Database, id: string) {
  return (await db.prepare('SELECT milestone_index,paid_recorded_at FROM software_milestone_payments WHERE request_id=? ORDER BY milestone_index').bind(id)
    .all<{milestone_index: number; paid_recorded_at: string}>()).results;
}
export function correctionPeriodEnd(acceptedAt: string, paidAt?: string) {
  const start = paidAt && paidAt < acceptedAt ? paidAt : acceptedAt;
  const instant = new Date(start.length===10 ? `${start}T12:00:00Z` : start);
  const date = new Date(instant.toLocaleDateString('en-CA', {timeZone:'America/New_York'}) + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+30);
  return date.toISOString().slice(0,10);
}
export const acceptedDeliveryGuard = (db: D1Database, id: string, milestone: number) => softwareGuard(db,
  `SELECT 1 FROM software_project_updates u JOIN software_project_messages m ON m.update_id=u.id
   WHERE u.request_id=? AND u.milestone_index=? AND u.kind='delivery_review' AND u.status='shared' AND m.decision='milestone_accepted'
   AND u.id=(SELECT latest.id FROM software_project_updates latest WHERE latest.request_id=u.request_id AND latest.milestone_index=u.milestone_index
     AND latest.kind='delivery_review' AND latest.status='shared' ORDER BY latest.shared_at DESC,latest.id DESC LIMIT 1)`, [id,milestone]);
/** Same atomic assertion as software offers: a stale write rolls back its whole batch. */
export const softwareGuard = (db: D1Database, query: string, values: (string | number | null)[]) =>
  db.prepare(`SELECT CASE WHEN EXISTS(${query}) THEN 1 ELSE json_extract('Project changed. Reload and try again.','$') END`).bind(...values);
export const priorMilestonePaymentGuard = (db: D1Database, id: string, milestone: number) => softwareGuard(db,
  'SELECT 1 WHERE (SELECT count(*) FROM software_milestone_payments WHERE request_id=? AND milestone_index<?)=?', [id,milestone,milestone]);
export const openSoftwareGuard = (db: D1Database, id: string) => softwareGuard(db, `SELECT 1 FROM software_projects p JOIN owner_requests r ON r.id=p.request_id
  WHERE p.request_id=? AND p.revoked_at IS NULL AND p.content_deleted_at IS NULL AND r.status<>'withdrawn' AND r.email<>''`, [id]);

/** Claim once. An uncertain provider result remains sending until the owner checks it. */
export async function deliverSoftwareNotice(db: D1Database, id: string, env: Env, updateId?: string) {
  const table = updateId ? 'software_project_updates' : 'software_projects';
  const prefix = updateId ? 'notification' : 'invitation';
  const where = updateId ? "id=? AND request_id=? AND status='shared'" : 'request_id=?';
  const values = updateId ? [updateId, id] : [id];
  const at = new Date().toISOString();
  const claimed = await db.prepare(`UPDATE ${table} SET ${prefix}_status='sending',${prefix}_attempted_at=?
    WHERE ${where} AND ${prefix}_status='pending' AND EXISTS(SELECT 1 FROM software_projects p JOIN owner_requests r ON r.id=p.request_id
    WHERE p.request_id=? AND p.revoked_at IS NULL AND r.status<>'withdrawn' AND r.email<>'') RETURNING request_id`).bind(at, ...values, id).first();
  if (!claimed) return;
  let sent: { ok: boolean; uncertain?: boolean } = { ok: false };
  try {
    const recipient = await db.prepare(`SELECT r.email FROM owner_requests r JOIN software_projects p ON p.request_id=r.id
      WHERE r.id=? AND r.status<>'withdrawn' AND p.revoked_at IS NULL`).bind(id).first<{ email: string }>();
    const update = updateId ? await db.prepare('SELECT kind FROM software_project_updates WHERE id=? AND request_id=?').bind(updateId,id).first<{kind:string}>() : null;
    const handoff = update?.kind === 'handoff', review = update?.kind.endsWith('_review');
    if (recipient && env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL) sent = await sendAudioMessage({ apiKey: env.RESEND_API_KEY,
      payload: { from: env.CONTACT_FROM_EMAIL, to: [recipient.email], subject: !updateId ? 'Your project has started' : handoff ? 'Your project handoff is ready' : review ? 'Your project is ready for review' : 'Your project has an update',
        ...(handoff ? softwareHandoffEmail(env.SITE_ORIGIN) : review ? softwareReviewEmail(env.SITE_ORIGIN) : updateId ? softwareUpdateEmail(env.SITE_ORIGIN) : softwareInvitationEmail(env.SITE_ORIGIN)) } });
  } catch { /* A lookup failure sends nothing. */ }
  if (sent.uncertain) return;
  await db.prepare(`UPDATE ${table} SET ${prefix}_status=?,${prefix}_sent_at=? WHERE ${where} AND ${prefix}_status='sending' AND ${prefix}_attempted_at=?`)
    .bind(sent.ok ? 'sent' : 'failed', sent.ok ? new Date().toISOString() : null, ...values, at).run();
}
export async function queueSoftwareNotice(db: D1Database, id: string, confirmedNotSent: boolean, updateId?: string) {
  const table = updateId ? 'software_project_updates' : 'software_projects', prefix = updateId ? 'notification' : 'invitation';
  return Boolean(await db.prepare(`UPDATE ${table} SET ${prefix}_status='pending',${prefix}_attempted_at=NULL
    WHERE ${updateId ? "id=? AND request_id=? AND status='shared' AND email_client=1" : 'request_id=?'}
    AND (${prefix}_status IN ('pending','failed') OR (${prefix}_status='sending' AND ?=1 AND ${prefix}_attempted_at<=?))
    AND EXISTS(SELECT 1 FROM software_projects p JOIN owner_requests r ON r.id=p.request_id WHERE p.request_id=? AND p.revoked_at IS NULL AND r.status<>'withdrawn')
    RETURNING request_id`).bind(...(updateId ? [updateId, id] : [id]), confirmedNotSent ? 1 : 0, new Date(Date.now() - 60_000).toISOString(), id).first());
}

/** Used by explicit access closure and request withdrawal, in the caller's transaction. */
export function softwareAccessRevocation(db: D1Database, id: string, actor: string, at: string) {
  const closedEmail = `SELECT r.email FROM owner_requests r JOIN software_projects p ON p.request_id=r.id WHERE p.request_id=? AND p.revoked_at=?`;
  return [
    db.prepare(`INSERT INTO software_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'access-revoked',?,? FROM software_projects WHERE request_id=? AND revoked_at IS NULL`).bind(actor, at, id),
    db.prepare('UPDATE software_projects SET revoked_at=?,updated_at=? WHERE request_id=? AND revoked_at IS NULL').bind(at, at, id),
    db.prepare(`UPDATE audio_client_sessions SET revoked_at=? WHERE email=(${closedEmail}) AND revoked_at IS NULL`).bind(at, id, at),
    db.prepare(`DELETE FROM audio_client_codes WHERE email=(${closedEmail})`).bind(id, at),
  ];
}
