import { hashValue } from './audio-client-access';

export type ProjectMessage = {
  id: number;
  actor: 'owner' | 'client';
  body: string;
  created_at: string;
  read_at: string | null;
  /** Set when a client message answers a published review. */
  review_decision: ReviewDecision | null;
};
export type ReviewDecision = 'approved' | 'changes' | 'stopped';
/** Revision rounds included with every project, bundle and custom quotes too, as the services page states. */
export const REVISION_ROUNDS = 2;

const messageColumns = 'id,actor,body,created_at,read_at,review_decision';
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
        WHERE m.request_id=? AND m.actor='client' AND m.created_at>?)<?
    RETURNING ${messageColumns}`)
    .bind(tokenHash, body, now.toISOString(), requestId, tokenHash, now.toISOString(),
      requestId, windowStart, CLIENT_MESSAGE_LIMIT).first<ProjectMessage>();
}

/**
 * The client's answer to the latest published review: approve it, request changes with notes
 * while revision rounds remain, or stop once they are used. Allowed only while that review
 * awaits an answer (stage review_ready, no decision since it was published), under the same
 * session and rate limit as any client message. The answer names the review the client heard,
 * so a page left open across a newer review cannot answer it. Stopping closes this project's
 * access in the same write; the client's other projects and session are untouched.
 */
export async function postClientReviewDecision(db: D1Database, requestId: string, token: string, reviewId: string, decision: ReviewDecision, body: string, now = new Date()): Promise<ProjectMessage | null> {
  const tokenHash = await hashValue(token);
  const at = now.toISOString();
  const windowStart = new Date(now.getTime() - CLIENT_MESSAGE_WINDOW_MS).toISOString();
  const insert = db.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at,review_decision)
    SELECT p.request_id,'client',?,?,?,? FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    JOIN audio_client_sessions s ON s.email=r.email
    WHERE p.request_id=? AND p.stage='review_ready' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND (SELECT count(*) FROM audio_project_messages m
        WHERE m.request_id=? AND m.actor='client' AND m.created_at>?)<?
      AND ${reviewAwaitingAnswer('p.request_id')}
      AND (? = 'approved' OR (${roundsUsed('p.request_id')} < ${REVISION_ROUNDS}) = (? = 'changes'))
      AND ?=(SELECT f.id FROM audio_project_files f WHERE f.request_id=p.request_id AND f.version='review'
        AND f.status='published' ORDER BY f.published_at DESC LIMIT 1)
    RETURNING ${messageColumns}`)
    .bind(tokenHash, body, at, decision, requestId, tokenHash, at,
      requestId, windowStart, CLIENT_MESSAGE_LIMIT, decision, decision, reviewId);
  if (decision !== 'stopped') return insert.first<ProjectMessage>();
  const stopped = `EXISTS(SELECT 1 FROM audio_project_messages WHERE request_id=? AND review_decision='stopped' AND created_at=?)`;
  const [saved] = await db.batch([
    insert,
    db.prepare(`UPDATE audio_projects SET revoked_at=?,updated_at=? WHERE request_id=? AND revoked_at IS NULL AND ${stopped}`)
      .bind(at, at, requestId, requestId, at),
    db.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'revoked','client-stopped',? FROM audio_projects WHERE request_id=? AND revoked_at=? AND ${stopped}`)
      .bind(at, requestId, at, requestId, at),
  ]);
  return (saved.results[0] as ProjectMessage | undefined) ?? null;
}

/** SQL: revision rounds begun on this project. */
function roundsUsed(requestId: string) {
  return `(SELECT count(*) FROM audio_project_updates u WHERE u.request_id=${requestId} AND u.milestone='revision_started')`;
}

/** Revision rounds the client has left to request. */
export async function revisionRoundsLeft(db: D1Database, requestId: string): Promise<number> {
  const row = await db.prepare(`SELECT ${roundsUsed('?')} AS used`).bind(requestId).first<{ used: number }>();
  return Math.max(0, REVISION_ROUNDS - Number(row?.used ?? 0));
}

/** SQL: the project has a published review and no client decision since the latest one. */
function reviewAwaitingAnswer(requestId: string) {
  const published = `(SELECT MAX(f.published_at) FROM audio_project_files f
    WHERE f.request_id=${requestId} AND f.version='review' AND f.status='published')`;
  return `${published} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM audio_project_messages d
    WHERE d.request_id=${requestId} AND d.review_decision IS NOT NULL AND d.created_at>=${published})`;
}

/** The client's decision on the latest published review, or null while it awaits one. */
export async function latestReviewDecision(db: D1Database, requestId: string): Promise<ReviewDecision | null> {
  const row = await db.prepare(`SELECT m.review_decision FROM audio_project_messages m
    WHERE m.request_id=? AND m.review_decision IS NOT NULL AND m.created_at>=(SELECT MAX(f.published_at)
      FROM audio_project_files f WHERE f.request_id=m.request_id AND f.version='review' AND f.status='published')
    ORDER BY m.id DESC LIMIT 1`).bind(requestId).first<{ review_decision: ReviewDecision }>();
  return row?.review_decision ?? null;
}

export async function clientMessageRateLimited(db: D1Database, requestId: string, now = new Date()): Promise<boolean> {
  const windowStart = new Date(now.getTime() - CLIENT_MESSAGE_WINDOW_MS).toISOString();
  const row = await db.prepare(`SELECT count(*) AS total FROM audio_project_messages
    WHERE request_id=? AND actor='client' AND created_at>?`).bind(requestId, windowStart).first<{ total: number }>();
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
