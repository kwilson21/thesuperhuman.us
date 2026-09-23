import { sendStudioSignInNotice } from './audio-resend';

export type ProjectInvitation = {
  invitation_status: 'pending' | 'sending' | 'sent' | 'failed';
  invitation_attempted_at: string | null;
  invitation_sent_at: string | null;
};

export async function deliverProjectInvitation(db: D1Database, requestId: string, env: Env): Promise<void> {
  const at = new Date().toISOString();
  const claimed = await db.prepare(`UPDATE audio_projects SET invitation_status='sending',invitation_attempted_at=?
    WHERE request_id=? AND invitation_status='pending' AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND kind='service' AND status<>'withdrawn' AND email<>'')
    RETURNING request_id`).bind(at, requestId, requestId).first<{ request_id: string }>();
  if (!claimed) return;
  let recipient: { email: string } | null;
  try {
    recipient = await db.prepare(`SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE r.id=? AND r.kind='service' AND r.status<>'withdrawn' AND r.email<>'' AND p.revoked_at IS NULL`)
      .bind(requestId).first<{ email: string }>();
  } catch {
    await db.prepare(`UPDATE audio_projects SET invitation_status='failed'
      WHERE request_id=? AND invitation_status='sending' AND revoked_at IS NULL`).bind(requestId).run();
    return;
  }
  const sent = recipient && env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL
    ? await sendStudioSignInNotice(env.RESEND_API_KEY, env.CONTACT_FROM_EMAIL, recipient.email, 'Your private studio project') : { ok: false };
  if (sent.uncertain) return;
  await db.prepare(`UPDATE audio_projects SET invitation_status=?,invitation_sent_at=?
    WHERE request_id=? AND invitation_status='sending' AND revoked_at IS NULL`)
    .bind(sent.ok ? 'sent' : 'failed', sent.ok ? new Date().toISOString() : null, requestId).run();
}

export async function queueProjectInvitation(db: D1Database, requestId: string,
  confirmedNotSent = false, now = new Date()): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - 60_000).toISOString();
  const row = await db.prepare(`UPDATE audio_projects SET invitation_status='pending',invitation_attempted_at=NULL
    WHERE request_id=? AND (invitation_status IN ('pending','failed') OR
      (invitation_status='sending' AND ?=1 AND invitation_attempted_at<=?)) AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND kind='service' AND status<>'withdrawn' AND email<>'')
    RETURNING request_id`).bind(requestId, confirmedNotSent ? 1 : 0, staleBefore, requestId).first<{ request_id: string }>();
  return Boolean(row);
}
