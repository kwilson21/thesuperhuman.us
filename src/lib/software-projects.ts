import { z } from 'astro/zod';
import { offerTermsSchema } from './software-offers';
import { validProjectDate } from './audio-project-updates';
import { sendAudioMessage } from './audio-resend';
import { softwareInvitationEmail, softwareUpdateEmail } from './client-emails';

export const projectStates = { preparing: 'Preparing', building: 'Building', waiting_for_input: 'Waiting for your input', ready_for_review: 'Ready for review', complete: 'Complete' } as const;
export const projectSteps = ['direction', 'build', 'review', 'handoff'] as const;
export const evidenceTypes = { concept: 'Concept', prototype: 'Prototype', working_preview: 'Working preview', demonstration: 'Demonstration', investigation: 'Investigation' } as const;
const text = (max: number) => z.string().trim().max(max, `Use up to ${max} characters.`).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value), 'Remove control characters.');
export const projectDate = z.string().refine(value => !value || validProjectDate(value), 'Choose a valid date.');
export const updateInput = z.object({
  kind: z.literal('progress'), milestone_index: z.number().int().min(0).max(2),
  title: text(120), artifact_version: text(60), evidence_type: z.enum(['concept','prototype','working_preview','demonstration','investigation']),
  visual_alt: text(300), preview_url: text(2000).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }, 'Use an HTTPS link the client is allowed to open.'),
  what_changed: text(1000), checks_limitations: text(1000), next_step: text(300), client_request: text(300),
  next_update_on: projectDate, email_client: z.boolean(),
});
export type SoftwareUpdateInput = z.infer<typeof updateInput>;
export type SoftwareProject = {
  request_id: string; offer_id: string; terms_json: string; payment_mode: 'standard' | 'invoice';
  state: keyof typeof projectStates; waiting_for: string; milestone_index: number; step: typeof projectSteps[number];
  started_at: string; next_update_on: string | null; invitation_status: string; invitation_attempted_at: string | null;
  revoked_at: string | null; completed_at: string | null; content_deleted_at: string | null; updated_at: string;
};
export type SoftwareUpdate = Omit<SoftwareUpdateInput, 'email_client'> & {
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
export type ClientSoftwareUpdate = Pick<SoftwareUpdate, 'id' | 'title' | 'artifact_version' | 'evidence_type' | 'visual_alt' | 'preview_url' | 'what_changed' | 'checks_limitations' | 'next_step' | 'client_request' | 'next_update_on' | 'shared_at'> & { has_visual: number };
export async function sharedSoftwareUpdates(db: D1Database, id: string) {
  return (await db.prepare(`SELECT id,title,artifact_version,evidence_type,visual_alt,preview_url,what_changed,checks_limitations,
    next_step,client_request,next_update_on,shared_at,visual_key IS NOT NULL AS has_visual
    FROM software_project_updates WHERE request_id=? AND status='shared' ORDER BY shared_at DESC,id DESC`).bind(id).all<ClientSoftwareUpdate>()).results;
}
export const softwareAudit = (db: D1Database, id: string, action: string, actor: string, at: string) =>
  db.prepare('INSERT INTO software_project_audit(request_id,action,actor,occurred_at) VALUES (?,?,?,?)').bind(id, action, actor, at);
/** Same atomic assertion as software offers: a stale write rolls back its whole batch. */
export const softwareGuard = (db: D1Database, query: string, values: (string | number | null)[]) =>
  db.prepare(`SELECT CASE WHEN EXISTS(${query}) THEN 1 ELSE json_extract('Project changed. Reload and try again.','$') END`).bind(...values);
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
    if (recipient && env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL) sent = await sendAudioMessage({ apiKey: env.RESEND_API_KEY,
      payload: { from: env.CONTACT_FROM_EMAIL, to: [recipient.email], subject: updateId ? 'Your project has an update' : 'Your project has started',
        ...(updateId ? softwareUpdateEmail(env.SITE_ORIGIN) : softwareInvitationEmail(env.SITE_ORIGIN)) } });
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
