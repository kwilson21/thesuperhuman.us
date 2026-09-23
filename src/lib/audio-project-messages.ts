import { hashValue } from './audio-client-access';

export type ProjectMessage = {
  id: number;
  actor: 'owner' | 'client';
  body: string;
  created_at: string;
  read_at: string | null;
};

const messageColumns = 'id,actor,body,created_at,read_at';
const CLIENT_MESSAGE_WINDOW_MS = 300_000;
const CLIENT_MESSAGE_LIMIT = 12;

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
  const windowStart = new Date(now.getTime() - CLIENT_MESSAGE_WINDOW_MS).toISOString();
  // The count and write belong to one SQL statement so concurrent sends cannot
  // all pass a separate KV read before any of them saves a message.
  return db.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'client',?,?,? FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    JOIN audio_client_sessions s ON s.email=r.email
    WHERE p.request_id=? AND p.stage<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND (SELECT count(*) FROM audio_project_messages m
        WHERE m.actor='client' AND m.actor_id=? AND m.created_at>?)<?
    RETURNING ${messageColumns}`)
    .bind(tokenHash, body, now.toISOString(), requestId, tokenHash, now.toISOString(),
      tokenHash, windowStart, CLIENT_MESSAGE_LIMIT).first<ProjectMessage>();
}

export async function clientMessageRateLimited(db: D1Database, token: string, now = new Date()): Promise<boolean> {
  const tokenHash = await hashValue(token);
  const windowStart = new Date(now.getTime() - CLIENT_MESSAGE_WINDOW_MS).toISOString();
  const row = await db.prepare(`SELECT count(*) AS total FROM audio_project_messages
    WHERE actor='client' AND actor_id=? AND created_at>?`).bind(tokenHash, windowStart).first<{ total: number }>();
  return (row?.total ?? 0) >= CLIENT_MESSAGE_LIMIT;
}

export async function markProjectMessagesRead(db: D1Database, requestId: string, reader: 'owner' | 'client', messageId: number, token: string | null = null, now = new Date()): Promise<void> {
  if (!Number.isInteger(messageId) || messageId < 1) return;
  const sender = reader === 'owner' ? 'client' : 'owner';
  if (reader === 'owner') {
    await db.prepare(`UPDATE audio_project_messages SET read_at=? WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL`)
      .bind(now.toISOString(), messageId, requestId, sender).run();
    return;
  }
  if (!token) return;
  const tokenHash = await hashValue(token);
  await db.prepare(`UPDATE audio_project_messages SET read_at=?
    WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL AND EXISTS(
      SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      JOIN audio_client_sessions s ON s.email=r.email
      WHERE p.request_id=audio_project_messages.request_id AND p.revoked_at IS NULL
        AND r.status<>'withdrawn' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?)`)
    .bind(now.toISOString(), messageId, requestId, sender, tokenHash, now.toISOString()).run();
}
