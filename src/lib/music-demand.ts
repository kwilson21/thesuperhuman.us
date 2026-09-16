import { z } from 'astro/zod';
import { musicId } from './music-catalog';
export const MERCHANDISE = { shirts: 'Shirts', hoodies: 'Hoodies', stickers: 'Stickers', 'digital-art': 'Digital art' } as const;
export const interestSchema = z.object({
  releaseId: musicId, email: z.string().trim().toLowerCase().email().max(120),
  interest: z.enum(['song', 'merchandise', 'both']),
  merchandise: z.array(z.enum(['shirts', 'hoodies', 'stickers', 'digital-art'])).max(4).default([]),
  suggestion: z.string().trim().max(500).default(''), consent: z.literal(true),
  turnstileToken: z.string().min(1).max(2048),
}).refine(v => v.interest !== 'song' || (!v.merchandise.length && !v.suggestion), { path: ['merchandise'], message: 'Choose merchandise interest to include merchandise suggestions.' });
export const eventSchema = z.object({
  releaseId: musicId, recordingId: musicId, sessionId: z.string().uuid(),
  medium: z.enum(['audio', 'video']), event: z.enum(['start', 'listen30']),
});
export async function saveInterest(db: D1Database, input: z.infer<typeof interestSchema>) {
  await db.prepare(`INSERT INTO music_interest (release_id,email,interest,merchandise,suggestion,consent_version,updated_at)
    VALUES (?,?,?,?,?,'availability-v1',?) ON CONFLICT(release_id,email) DO UPDATE SET
    interest=excluded.interest,merchandise=excluded.merchandise,suggestion=excluded.suggestion,
    consent_version=excluded.consent_version,updated_at=excluded.updated_at`)
    .bind(input.releaseId, input.email, input.interest, JSON.stringify([...new Set(input.merchandise)]), input.suggestion, new Date().toISOString()).run();
}
export async function saveEvent(db: D1Database, input: z.infer<typeof eventSchema>) {
  await db.prepare('INSERT OR IGNORE INTO music_events (release_id,recording_id,session_id,medium,event,occurred_at) VALUES (?,?,?,?,?,?)')
    .bind(input.releaseId, input.recordingId, input.sessionId, input.medium, input.event, new Date().toISOString()).run();
}
