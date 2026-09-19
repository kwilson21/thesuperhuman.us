import { z } from 'astro/zod';
import { musicId } from './music-catalog';
export const MERCHANDISE = { shirts: 'Shirts', hoodies: 'Hoodies', stickers: 'Stickers', 'digital-art': 'Digital art' } as const;
export const interestSchema = z.object({
  releaseId: musicId, email: z.string().trim().toLowerCase().email().max(120),
  interest: z.enum(['song', 'merchandise', 'both']),
  merchandise: z.array(z.enum(['shirts', 'hoodies', 'stickers', 'digital-art'])).max(4).default([]),
  suggestion: z.string().trim().max(500).default(''),
  cityRegion: z.string().trim().max(120).default(''),
  releaseUpdates: z.boolean().default(false),
  consent: z.literal(true),
  turnstileToken: z.string().min(1).max(2048),
}).refine(v => v.interest !== 'song' || (!v.merchandise.length && !v.suggestion), { path: ['merchandise'], message: 'Choose merchandise interest to include merchandise suggestions.' });
export const eventSchema = z.object({
  releaseId: musicId, recordingId: musicId, sessionId: z.string().uuid(),
  medium: z.enum(['audio', 'video']), event: z.enum(['start', 'listen30']),
});
type InterestInput = z.infer<typeof interestSchema>;

async function demandRequestId(input: InterestInput, kind: 'purchase' | 'merchandise' | 'release-update') {
  const source = `${input.releaseId}\0${input.email}\0${kind}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return `music-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

export async function saveInterest(db: D1Database, input: InterestInput) {
  const now = new Date().toISOString();
  const kinds: ('purchase' | 'merchandise' | 'release-update')[] = [];
  if (input.interest === 'song' || input.interest === 'both') kinds.push('purchase');
  if (input.interest === 'merchandise' || input.interest === 'both') kinds.push('merchandise');
  if (input.releaseUpdates) kinds.push('release-update');
  const requestIds = await Promise.all(kinds.map(kind => demandRequestId(input, kind)));
  const statements = [db.prepare(`INSERT INTO music_interest (release_id,email,interest,merchandise,suggestion,consent_version,updated_at)
    VALUES (?,?,?,?,?,'availability-v1',?) ON CONFLICT(release_id,email) DO UPDATE SET
    interest=excluded.interest,merchandise=excluded.merchandise,suggestion=excluded.suggestion,
    consent_version=excluded.consent_version,updated_at=excluded.updated_at`)
    .bind(input.releaseId, input.email, input.interest, JSON.stringify([...new Set(input.merchandise)]), input.suggestion, now)];
  kinds.forEach((kind, index) => {
    const summary = kind === 'purchase' ? `Purchase interest · ${input.releaseId}`
      : kind === 'merchandise' ? `Merchandise interest · ${input.releaseId}`
      : `Release updates · ${input.releaseId}`;
    const details = kind === 'merchandise'
      ? JSON.stringify({ merchandise: [...new Set(input.merchandise)], suggestion: input.suggestion })
      : '{}';
    statements.push(
      db.prepare(`INSERT INTO owner_requests
        (id,kind,release_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at)
        VALUES (?,?,?,'',?,?,?,?, 'new','',?,?) ON CONFLICT(id) DO UPDATE SET
        city_region=excluded.city_region,summary=excluded.summary,details_json=excluded.details_json,
        status='new',resolved_at=NULL,contact_delete_after=NULL,updated_at=excluded.updated_at`)
        .bind(requestIds[index], kind, input.releaseId, input.email, input.cityRegion, summary, details, now, now),
      db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
        SELECT ?,'created','system','',? WHERE NOT EXISTS
          (SELECT 1 FROM owner_request_audit WHERE request_id=?)`)
        .bind(requestIds[index], now, requestIds[index]),
    );
  });
  if (input.releaseUpdates) {
    const sourceId = requestIds[kinds.indexOf('release-update')];
    statements.push(db.prepare(`INSERT INTO owner_audience_permissions
      (email,status,consent_version,source_request_id,granted_at,withdrawn_at,updated_at)
      VALUES (?,'subscribed','release-updates-v1',?,?,NULL,?) ON CONFLICT(email) DO UPDATE SET
      status='subscribed',consent_version=excluded.consent_version,source_request_id=excluded.source_request_id,
      withdrawn_at=NULL,updated_at=excluded.updated_at`).bind(input.email, sourceId, now, now));
  }
  await db.batch(statements);
}
export async function saveEvent(db: D1Database, input: z.infer<typeof eventSchema>) {
  await db.prepare('INSERT OR IGNORE INTO music_events (release_id,recording_id,session_id,medium,event,occurred_at) VALUES (?,?,?,?,?,?)')
    .bind(input.releaseId, input.recordingId, input.sessionId, input.medium, input.event, new Date().toISOString()).run();
}
