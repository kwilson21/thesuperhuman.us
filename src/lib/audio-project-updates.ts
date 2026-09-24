import { sendAudioMessage } from './audio-resend';

export type ProjectUpdate = {
  id: number;
  request_id: string;
  kind: 'accepted' | 'progress' | 'work_started' | 'date_changed';
  body: string;
  reason: 'protect_song' | 'client_clarification' | 'schedule_conflict' | null;
  previous_due_at: string | null;
  new_due_at: string | null;
  actor: string;
  created_at: string;
  notification_status: 'pending' | 'sending' | 'sent' | 'failed';
  notification_attempted_at: string | null;
};

export type ProjectUpdateCommand =
  | { action: 'accept'; dueDate: string; body: string }
  | { action: 'progress'; body: string }
  | { action: 'start_work'; body: string }
  | { action: 'revise_date'; dueDate: string; reason: 'protect_song' | 'client_clarification' | 'schedule_conflict'; body: string };

const columns = `id,request_id,kind,body,reason,previous_due_at,new_due_at,actor,created_at,notification_status,notification_attempted_at`;

export function validProjectDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function projectToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const number = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${number('year')}-${number('month')}-${number('day')}`;
}

export async function listProjectUpdates(db: D1Database, requestId: string): Promise<ProjectUpdate[]> {
  const result = await db.prepare(`SELECT ${columns} FROM audio_project_updates WHERE request_id=? ORDER BY id`)
    .bind(requestId).all<ProjectUpdate>();
  return result.results;
}

export async function getOwnerProjectState(db: D1Database, requestId: string) {
  return db.prepare(`SELECT p.stage,p.current_due_at,p.original_due_at,p.updated_at,p.revoked_at,
    r.status AS request_status,r.email,pay.booking_status
    FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
    LEFT JOIN audio_payments pay ON pay.request_id=p.request_id WHERE p.request_id=?`)
    .bind(requestId).first<{ stage: string; current_due_at: string | null; original_due_at: string | null;
      updated_at: string; revoked_at: string | null; request_status: string; email: string; booking_status: string | null }>();
}

export async function saveProjectUpdate(db: D1Database, requestId: string, actor: string, command: ProjectUpdateCommand, now = new Date()): Promise<ProjectUpdate | null> {
  const state = await getOwnerProjectState(db, requestId);
  if (!state || state.revoked_at || state.request_status === 'withdrawn' || state.stage === 'complete') return null;
  const at = now.toISOString();
  const body = command.body.trim();
  if (!body || body.length > 1000 || !actor.trim()) return null;
  if ('dueDate' in command && (!validProjectDate(command.dueDate) || command.dueDate < projectToday(now))) return null;

  if (command.action === 'progress') {
    if (state.stage === 'files_under_review') return null;
    return db.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
      SELECT p.request_id,'progress',?,?,? FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      WHERE p.request_id=? AND p.stage<>'complete' AND p.stage<>'files_under_review'
        AND p.revoked_at IS NULL AND r.status<>'withdrawn' RETURNING ${columns}`)
      .bind(body, actor, at, requestId).first<ProjectUpdate>();
  }

  if (command.action === 'accept') {
    if (state.stage !== 'files_under_review' || state.request_status !== 'reviewed') return null;
    const [changed, update] = await db.batch([
      db.prepare(`UPDATE audio_projects SET stage='accepted',original_due_at=?,current_due_at=?,updated_at=?
        WHERE request_id=? AND stage='files_under_review' AND updated_at=? AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status='reviewed') RETURNING request_id`)
        .bind(command.dueDate, command.dueDate, at, requestId, state.updated_at, requestId),
      db.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,new_due_at,actor,created_at)
        SELECT request_id,'accepted',?,?,?,? FROM audio_projects
        WHERE request_id=? AND stage='accepted' AND updated_at=? AND original_due_at=? AND changes()=1 RETURNING ${columns}`)
        .bind(body, command.dueDate, actor, at, requestId, at, command.dueDate),
      db.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
        SELECT request_id,'accepted',?,? FROM audio_projects
        WHERE request_id=? AND stage='accepted' AND updated_at=? AND original_due_at=? AND changes()=1`)
        .bind(actor, at, requestId, at, command.dueDate),
    ]);
    return changed.results.length ? update.results[0] as ProjectUpdate : null;
  }

  if (command.action === 'start_work') {
    if (state.stage !== 'accepted' || state.booking_status !== 'paid') return null;
    const [changed, update] = await db.batch([
      db.prepare(`UPDATE audio_projects SET stage='in_progress',updated_at=?
        WHERE request_id=? AND stage='accepted' AND updated_at=? AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status<>'withdrawn')
        AND EXISTS(SELECT 1 FROM audio_payments WHERE request_id=? AND booking_status='paid') RETURNING request_id`)
        .bind(at, requestId, state.updated_at, requestId, requestId),
      db.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
        SELECT request_id,'work_started',?,?,? FROM audio_projects
        WHERE request_id=? AND stage='in_progress' AND updated_at=? AND changes()=1 RETURNING ${columns}`)
        .bind(body, actor, at, requestId, at),
      db.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
        SELECT request_id,'stage-changed',?,? FROM audio_projects
        WHERE request_id=? AND stage='in_progress' AND updated_at=? AND changes()=1`)
        .bind(actor, at, requestId, at),
    ]);
    return changed.results.length ? update.results[0] as ProjectUpdate : null;
  }

  if (!state.current_due_at || command.dueDate <= state.current_due_at) return null;
  const [changed, update] = await db.batch([
    db.prepare(`UPDATE audio_projects SET current_due_at=?,updated_at=?
      WHERE request_id=? AND current_due_at=? AND updated_at=? AND stage<>'complete' AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status<>'withdrawn')
      RETURNING request_id`).bind(command.dueDate, at, requestId, state.current_due_at, state.updated_at, requestId),
    db.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,reason,previous_due_at,new_due_at,actor,created_at)
      SELECT request_id,'date_changed',?,?,?,?,?,? FROM audio_projects
      WHERE request_id=? AND current_due_at=? AND updated_at=? AND changes()=1 RETURNING ${columns}`)
      .bind(body, command.reason, state.current_due_at, command.dueDate, actor, at, requestId, command.dueDate, at),
    db.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'date-changed',?,? FROM audio_projects
      WHERE request_id=? AND current_due_at=? AND updated_at=? AND changes()=1`)
      .bind(actor, at, requestId, command.dueDate, at),
  ]);
  return changed.results.length ? update.results[0] as ProjectUpdate : null;
}

export async function deliverProjectUpdateNotice(db: D1Database, updateId: number, env: Env): Promise<void> {
  const at = new Date().toISOString();
  const claimed = await db.prepare(`UPDATE audio_project_updates SET notification_status='sending',notification_attempted_at=?
    WHERE id=? AND notification_status='pending' RETURNING request_id`).bind(at, updateId).first<{ request_id: string }>();
  if (!claimed) return;
  let recipient: { email: string } | null;
  try {
    recipient = await db.prepare(`SELECT email FROM owner_requests WHERE id=? AND status<>'withdrawn' AND email<>''`)
      .bind(claimed.request_id).first<{ email: string }>();
  } catch {
    await db.prepare(`UPDATE audio_project_updates SET notification_status='failed'
      WHERE id=? AND notification_status='sending'`).bind(updateId).run();
    return;
  }
  const sent = recipient && env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL
    ? await sendAudioMessage({ apiKey: env.RESEND_API_KEY, payload: {
      from: env.CONTACT_FROM_EMAIL, to: [recipient.email], subject: 'Your studio project has an update',
      text: 'There is an update to your audio project. Sign in to see it: https://thesuperhuman.us/studio/sign-in',
    } }) : { ok: false };
  if (sent.uncertain) return;
  await db.prepare(`UPDATE audio_project_updates SET notification_status=?,notification_sent_at=?
    WHERE id=? AND notification_status='sending'`).bind(sent.ok ? 'sent' : 'failed', sent.ok ? new Date().toISOString() : null, updateId).run();
}

export async function queueProjectNoticeForDelivery(db: D1Database, requestId: string, updateId: number,
  confirmedNotSent = false, now = new Date()): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - 60_000).toISOString();
  const result = await db.prepare(`UPDATE audio_project_updates SET notification_status='pending',notification_attempted_at=NULL
    WHERE id=? AND request_id=? AND (notification_status IN ('failed','pending') OR
      (notification_status='sending' AND ?=1 AND notification_attempted_at<=?))
      AND EXISTS(SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
        WHERE p.request_id=? AND p.revoked_at IS NULL AND r.status<>'withdrawn' AND r.email<>'')
    RETURNING id`).bind(updateId, requestId, confirmedNotSent ? 1 : 0, staleBefore, requestId).first<{ id: number }>();
  return Boolean(result);
}
