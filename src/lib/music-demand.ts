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
  releaseId: musicId, recordingId: musicId, sessionId: z.string().uuid(), playthroughId: z.string().uuid(),
  eventId: z.string().uuid(), sequence: z.number().int().min(1).max(10_000),
  medium: z.enum(['audio', 'video']), event: z.enum(['start', 'progress', 'listen30', 'complete', 'replay']),
  accumulatedSeconds: z.number().int().min(0).max(86_400),
  mediaDurationSeconds: z.number().int().min(0).max(86_400),
  campaignId: musicId.optional(), channel: musicId.optional(), creative: musicId.optional(),
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
      db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
        SELECT id,'reopened','system','Repeat submission',? FROM owner_requests
        WHERE id=? AND status IN ('reviewed','resolved','withdrawn')`)
        .bind(now, requestIds[index]),
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
      withdrawn_at=NULL,updated_at=excluded.updated_at`).bind(input.email, sourceId, now, now),
      db.prepare(`INSERT INTO owner_audience_audit(email,action,actor,occurred_at) VALUES (?,'subscribed','requester',?)`)
        .bind(input.email, now));
  }
  await db.batch(statements);
}
export class PlaybackSequenceError extends Error {}

type PlaybackMetadata = {
  trafficClass: 'human' | 'automated';
  campaignId?: string;
  channel?: string;
  creative?: string;
  country?: string;
  region?: string;
  city?: string;
};

export async function saveEvent(db: D1Database, input: z.infer<typeof eventSchema>, metadata: PlaybackMetadata, now = new Date()) {
  const duplicate = await db.prepare(`SELECT session_id,playthrough_id,sequence FROM music_playback_events WHERE id=?`)
    .bind(input.eventId).first<{ session_id: string; playthrough_id: string; sequence: number }>();
  if (duplicate) {
    if (duplicate.session_id === input.sessionId && duplicate.playthrough_id === input.playthroughId && duplicate.sequence === input.sequence) return { status: 'duplicate' as const };
    throw new PlaybackSequenceError('Playback event identity was reused.');
  }
  const last = await db.prepare(`SELECT sequence,accumulated_seconds,event,occurred_at,
      (SELECT occurred_at FROM music_playback_events first_event
        WHERE first_event.session_id=? AND first_event.playthrough_id=? AND first_event.sequence=1) AS started_at
    FROM music_playback_events
    WHERE session_id=? AND playthrough_id=? ORDER BY sequence DESC LIMIT 1`)
    .bind(input.sessionId, input.playthroughId, input.sessionId, input.playthroughId)
    .first<{ sequence: number; accumulated_seconds: number; event: string; occurred_at: string; started_at: string }>();
  const first = input.event === 'start' || input.event === 'replay';
  if (first ? Boolean(last) || input.sequence !== 1 || input.accumulatedSeconds !== 0
    : !last || input.sequence !== last.sequence + 1 || input.accumulatedSeconds < last.accumulated_seconds) {
    throw new PlaybackSequenceError('Playback event sequence is invalid.');
  }
  if (input.event === 'listen30' && input.accumulatedSeconds < 30) throw new PlaybackSequenceError('Reported listen is not earned.');
  if (input.event === 'complete' && (input.mediaDurationSeconds <= 0 || input.accumulatedSeconds * 10 < input.mediaDurationSeconds * 9)) {
    throw new PlaybackSequenceError('Reported completion is not earned.');
  }
  if (last) {
    const elapsed = Math.max(0, (now.getTime() - new Date(last.started_at).getTime()) / 1000);
    if (!Number.isFinite(elapsed) || input.accumulatedSeconds > elapsed + 2) throw new PlaybackSequenceError('Reported playback advanced faster than server time.');
  }
  const occurredAt = now.toISOString();
  await db.prepare(`INSERT INTO music_playback_events
    (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,
      media_duration_seconds,campaign_id,channel,creative,traffic_class,country,region,city,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(input.eventId, input.releaseId, input.recordingId, input.sessionId, input.playthroughId,
      input.sequence, input.medium, input.event, input.accumulatedSeconds, input.mediaDurationSeconds,
      metadata.campaignId ?? null, metadata.channel ?? null, metadata.creative ?? null, metadata.trafficClass,
      metadata.country ?? '', metadata.region ?? '', metadata.city ?? '', occurredAt).run();
  return { status: 'stored' as const };
}
