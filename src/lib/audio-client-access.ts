import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
const codeLifetimeMs = 10 * 60 * 1000;
const sessionLifetimeMs = 14 * 24 * 60 * 60 * 1000;

export function normalizeClientEmail(input: unknown): string | null {
  const parsed = emailSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function clientPortalEnabled(env: Env | undefined): boolean {
  return env?.AUDIO_CLIENT_PORTAL_ENABLED === 'true';
}

export async function hashValue(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function keyedHash(secret: string, message: string): Promise<string> {
  if (secret.length < 32) throw new Error('Studio code key is not configured.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const codeHash = (email: string, code: string, secret: string) => keyedHash(secret, `${email}:${code}`);

function newCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 100_000_000).padStart(8, '0');
}

const activeProjects = `SELECT p.request_id FROM audio_projects p
  JOIN owner_requests r ON r.id=p.request_id
  WHERE r.email=? AND r.status<>'withdrawn' AND p.revoked_at IS NULL`;

export async function issueClientCode(db: D1Database, email: string, secret: string, now = new Date()): Promise<string | null> {
  const code = newCode();
  const digest = await codeHash(email, code, secret);
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + codeLifetimeMs).toISOString();
  const [stored] = await db.batch([
    db.prepare(`INSERT INTO audio_client_codes(email,code_hash,attempts,created_at,expires_at,used_at,session_token_hash)
      SELECT ?,?,0,?,?,NULL,NULL WHERE EXISTS (${activeProjects})
      ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,attempts=0,
      created_at=excluded.created_at,expires_at=excluded.expires_at,used_at=NULL,session_token_hash=NULL
      WHERE audio_client_codes.created_at<=? OR audio_client_codes.used_at IS NOT NULL OR audio_client_codes.expires_at<=?
      RETURNING email`)
      .bind(email, digest, issuedAt, expiresAt, email, new Date(now.getTime() - 30_000).toISOString(), issuedAt),
    db.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
      SELECT p.request_id,'code-issued',? FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      WHERE r.email=? AND p.revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM audio_client_codes WHERE email=? AND code_hash=? AND created_at=?)`)
      .bind(issuedAt, email, email, digest, issuedAt),
  ]);
  return stored.results.length ? code : null;
}

export async function discardUndeliveredCode(db: D1Database, email: string, code: string, secret: string, now = new Date()): Promise<void> {
  const digest = await codeHash(email, code, secret);
  await db.batch([
    db.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
      SELECT p.request_id,'code-delivery-failed',? FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      WHERE r.email=? AND p.revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM audio_client_codes WHERE email=? AND code_hash=? AND used_at IS NULL)`)
      .bind(now.toISOString(), email, email, digest),
    db.prepare('DELETE FROM audio_client_codes WHERE email=? AND code_hash=? AND used_at IS NULL').bind(email, digest),
  ]);
}

export async function listStudioSignInFailures(db: D1Database): Promise<{ requestId: string; clientName: string | null }[]> {
  const rows = await db.prepare(`SELECT a.request_id AS requestId,r.name AS clientName,MAX(a.id) AS last_failure
    FROM audio_client_access_audit a
    JOIN audio_projects p ON p.request_id=a.request_id
    JOIN owner_requests r ON r.id=a.request_id
    WHERE a.action='code-delivery-failed' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND NOT EXISTS(SELECT 1 FROM audio_client_access_audit later
        WHERE later.request_id=a.request_id AND later.id>a.id AND later.action='signed-in')
    GROUP BY a.request_id ORDER BY last_failure DESC LIMIT 5`).all<{ requestId: string; clientName: string | null; last_failure: number }>();
  return rows.results.map(row => ({ requestId: row.requestId, clientName: row.clientName }));
}

export async function completeClientCode(db: D1Database, email: string, code: string, secret: string, now = new Date()): Promise<string | null> {
  if (!/^\d{8}$/.test(code)) return null;
  const digest = await codeHash(email, code, secret);
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const tokenHash = await hashValue(token);
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + sessionLifetimeMs).toISOString();
  // One transaction: charge the attempt first, then accept the code only if that charge landed.
  // Concurrent guesses each spend one of the code's five attempts before any comparison.
  const [, used] = await db.batch([
    db.prepare(`UPDATE audio_client_codes SET attempts=attempts+1
      WHERE email=? AND used_at IS NULL AND expires_at>? AND attempts<5`).bind(email, at),
    db.prepare(`UPDATE audio_client_codes SET used_at=?,session_token_hash=?
      WHERE email=? AND code_hash=? AND used_at IS NULL AND expires_at>? AND changes()=1
      RETURNING email`).bind(at, tokenHash, email, digest, at),
    db.prepare(`INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
      SELECT ?,email,?,?,? FROM audio_client_codes WHERE email=? AND session_token_hash=?`)
      .bind(tokenHash, at, expiresAt, at, email, tokenHash),
    db.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
      SELECT p.request_id,'signed-in',? FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      WHERE r.email=? AND p.revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM audio_client_sessions WHERE token_hash=?)`).bind(at, email, tokenHash),
  ]);
  return used.results.length ? token : null;
}

const allowanceWindowMs = 5 * 60 * 1000;

/**
 * An atomic sign-in allowance: at most `limit` uses per five minutes for one scope and subject
 * (an email address or IP). Subjects are stored only as keyed hashes, and stale windows are
 * pruned in the same transaction.
 */
export async function takeStudioAllowance(db: D1Database, scope: string, subject: string, limit: number,
  secret: string, now = new Date()): Promise<boolean> {
  const key = await keyedHash(secret, `${scope}:${subject}`);
  const [, counted] = await db.batch([
    db.prepare('DELETE FROM audio_client_allowances WHERE window_start<=?').bind(new Date(now.getTime() - allowanceWindowMs).toISOString()),
    db.prepare(`INSERT INTO audio_client_allowances(key,window_start,uses) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET uses=uses+1 RETURNING uses`).bind(key, now.toISOString()),
  ]);
  return Number((counted.results[0] as { uses: number } | undefined)?.uses ?? Infinity) <= limit;
}

export async function clientProjectForSession(db: D1Database, token: string, projectId: string, now = new Date()) {
  if (!/^[0-9a-f-]{72}$/i.test(token)) return null;
  const tokenHash = await hashValue(token);
  return db.prepare(`SELECT p.request_id,p.stage,p.original_due_at,p.current_due_at,p.completed_at,
    r.summary,r.service_id,pay.booking_status,pay.balance_status
    FROM audio_client_sessions s
    JOIN owner_requests r ON r.email=s.email
    JOIN audio_projects p ON p.request_id=r.id
    LEFT JOIN audio_payments pay ON pay.request_id=r.id
    WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL
      AND p.request_id=? AND p.revoked_at IS NULL AND r.email<>'' AND r.status<>'withdrawn'`)
    .bind(tokenHash, now.toISOString(), projectId)
    .first<{ request_id: string; stage: string; original_due_at: string | null; current_due_at: string | null;
      completed_at: string | null; summary: string; service_id: string | null;
      booking_status: string | null; balance_status: string | null }>();
}

export async function clientProjectsForSession(db: D1Database, token: string, now = new Date()) {
  if (!/^[0-9a-f-]{72}$/i.test(token)) return null;
  const tokenHash = await hashValue(token);
  const session = await db.prepare(`SELECT email FROM audio_client_sessions
    WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL`)
    .bind(tokenHash, now.toISOString()).first<{ email: string }>();
  if (!session) return null;
  const projects = await db.prepare(`SELECT p.request_id,p.stage,r.summary FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    WHERE r.email=? AND r.status<>'withdrawn' AND p.revoked_at IS NULL
    ORDER BY p.created_at DESC`).bind(session.email)
    .all<{ request_id: string; stage: string; summary: string }>();
  return projects.results;
}

export function studioSessionCookie(token: string, secure: boolean): string {
  return `studio_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeMs / 1000}${secure ? '; Secure' : ''}`;
}

export async function revokeClientSession(db: D1Database, token: string, now = new Date()): Promise<void> {
  if (!/^[0-9a-f-]{72}$/i.test(token)) return;
  const tokenHash = await hashValue(token);
  await db.prepare('UPDATE audio_client_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
    .bind(now.toISOString(), tokenHash).run();
}

export function clearStudioSessionCookie(secure: boolean): string {
  return `studio_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function studioSessionFromRequest(request: Request): string | null {
  const match = request.headers.get('cookie')?.match(/(?:^|;\s*)studio_session=([0-9a-f-]{72})(?:;|$)/i);
  return match?.[1] ?? null;
}
