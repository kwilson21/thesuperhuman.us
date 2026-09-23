import { hashValue } from './audio-client-access';

export type ProjectMessage = {
  id: number;
  actor: 'owner' | 'client';
  body: string;
  created_at: string;
  read_at: string | null;
};

const messageColumns = 'id,actor,body,created_at,read_at';

export function validateProjectMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (!body || body.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) return null;
  for (const match of body.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/gi)) {
    if (!match[0].toLowerCase().startsWith('https://')) return null;
    try {
      const url = new URL(match[0].replace(/[.,!?;:)\]]+$/, ''));
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    } catch { return null; }
  }
  return body;
}

export async function listProjectMessages(db: D1Database, requestId: string): Promise<ProjectMessage[]> {
  const result = await db.prepare(`SELECT ${messageColumns} FROM audio_project_messages WHERE request_id=? ORDER BY id`)
    .bind(requestId).all<ProjectMessage>();
  return result.results;
}

export async function postOwnerProjectMessage(db: D1Database, requestId: string, ownerEmail: string, body: string, now = new Date()): Promise<ProjectMessage | null> {
  return db.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'owner',?,?,? FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    WHERE p.request_id=? AND p.stage<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
    RETURNING ${messageColumns}`)
    .bind(ownerEmail, body, now.toISOString(), requestId).first<ProjectMessage>();
}

export async function postClientProjectMessage(db: D1Database, requestId: string, token: string, body: string, now = new Date()): Promise<ProjectMessage | null> {
  const tokenHash = await hashValue(token);
  return db.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'client','client',?,? FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    JOIN audio_client_sessions s ON s.email=r.email
    WHERE p.request_id=? AND p.stage<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
    RETURNING ${messageColumns}`)
    .bind(body, now.toISOString(), requestId, tokenHash, now.toISOString()).first<ProjectMessage>();
}

export async function markProjectMessagesRead(db: D1Database, requestId: string, reader: 'owner' | 'client', token: string | null = null, now = new Date()): Promise<void> {
  const sender = reader === 'owner' ? 'client' : 'owner';
  if (reader === 'owner') {
    await db.prepare(`UPDATE audio_project_messages SET read_at=? WHERE request_id=? AND actor=? AND read_at IS NULL`)
      .bind(now.toISOString(), requestId, sender).run();
    return;
  }
  if (!token) return;
  const tokenHash = await hashValue(token);
  await db.prepare(`UPDATE audio_project_messages SET read_at=?
    WHERE request_id=? AND actor=? AND read_at IS NULL AND EXISTS(
      SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      JOIN audio_client_sessions s ON s.email=r.email
      WHERE p.request_id=audio_project_messages.request_id AND p.revoked_at IS NULL
        AND r.status<>'withdrawn' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?)`)
    .bind(now.toISOString(), requestId, sender, tokenHash, now.toISOString()).run();
}
