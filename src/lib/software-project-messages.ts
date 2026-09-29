import { hashValue } from './audio-client-access';
import type { ProjectMessage } from './audio-project-messages';
export type SoftwareProjectMessage = Omit<ProjectMessage, 'review_decision'> & { review_decision: null };
const messageColumns = 'id,actor,body,created_at,read_at,NULL AS review_decision';
const CLIENT_MESSAGE_WINDOW_MS = 300_000, CLIENT_MESSAGE_LIMIT = 12;
export async function listSoftwareProjectMessages(db: D1Database, requestId: string): Promise<SoftwareProjectMessage[]> {
  const result = await db.prepare(`SELECT ${messageColumns} FROM software_project_messages WHERE request_id=? ORDER BY id`)
    .bind(requestId).all<SoftwareProjectMessage>();
  return result.results;
}

export async function postOwnerSoftwareProjectMessage(db: D1Database, requestId: string, ownerEmail: string, body: string, now = new Date()): Promise<SoftwareProjectMessage | null> {
  return db.prepare(`INSERT INTO software_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'owner',?,?,? FROM software_projects p
    JOIN owner_requests r ON r.id=p.request_id
    WHERE p.request_id=? AND p.state<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
    RETURNING ${messageColumns}`)
    .bind(ownerEmail, body, now.toISOString(), requestId).first<SoftwareProjectMessage>();
}

export async function postClientSoftwareProjectMessage(db: D1Database, requestId: string, token: string, body: string, now = new Date()): Promise<SoftwareProjectMessage | null> {
  const tokenHash = await hashValue(token);
  const windowStart = new Date(now.getTime() - CLIENT_MESSAGE_WINDOW_MS).toISOString();
  // The count and write belong to one SQL statement so concurrent sends cannot
  // all pass a separate KV read before any of them saves a message.
  return db.prepare(`INSERT INTO software_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'client',?,?,? FROM software_projects p
    JOIN owner_requests r ON r.id=p.request_id
    JOIN audio_client_sessions s ON s.email=r.email
    WHERE p.request_id=? AND p.state<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND (SELECT count(*) FROM software_project_messages m
        WHERE m.request_id=? AND m.actor='client' AND m.created_at>?)<?
    RETURNING ${messageColumns}`)
    .bind(tokenHash, body, now.toISOString(), requestId, tokenHash, now.toISOString(),
      requestId, windowStart, CLIENT_MESSAGE_LIMIT).first<SoftwareProjectMessage>();
}

export async function markProjectMessagesRead(db: D1Database, requestId: string, reader: 'owner' | 'client', messageId: number, token: string | null = null, now = new Date()): Promise<void> {
  if (!Number.isInteger(messageId) || messageId < 1) return;
  const sender = reader === 'owner' ? 'client' : 'owner';
  if (reader === 'owner') {
    await db.prepare(`UPDATE software_project_messages SET read_at=? WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL`)
      .bind(now.toISOString(), messageId, requestId, sender).run();
    return;
  }
  if (!token) return;
  const tokenHash = await hashValue(token);
  await db.prepare(`UPDATE software_project_messages SET read_at=?
    WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL AND EXISTS(
      SELECT 1 FROM software_projects p JOIN owner_requests r ON r.id=p.request_id
      JOIN audio_client_sessions s ON s.email=r.email
      WHERE p.request_id=software_project_messages.request_id AND p.revoked_at IS NULL
        AND r.status<>'withdrawn' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?)`)
    .bind(now.toISOString(), messageId, requestId, sender, tokenHash, now.toISOString()).run();
}
