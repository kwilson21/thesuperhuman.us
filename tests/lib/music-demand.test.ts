import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { interestSchema, eventSchema, PlaybackSequenceError, saveInterest, saveEvent } from '~/lib/music-demand';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const input = { releaseId: 'old-news-single', email: ' Fan@Example.com ', interest: 'both', merchandise: ['shirts', 'digital-art'], suggestion: 'Blue design', cityRegion: ' Nashville, Tennessee ', consent: true, turnstileToken: 'token' };
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values),
    run: async () => sql.prepare(query).run(...args),
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    first: async () => sql.prepare(query).get(...args) ?? null,
  });
  const db = { prepare: (query: string) => statement(query), batch: async (statements: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try { const results = statements.map(item => ({ results: [], meta: sql.prepare(item.query).run(...item.args) })); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, db: db as unknown as D1Database };
}
describe('private music demand', () => {
  it('normalizes email and requires valid choices and consent', () => {
    expect(interestSchema.parse({ ...input, releaseUpdates: true })).toMatchObject({ email: 'fan@example.com', cityRegion: 'Nashville, Tennessee' });
    expect(interestSchema.parse({ ...input, releaseUpdates: true })).not.toHaveProperty('releaseUpdates');
    expect(interestSchema.safeParse({ ...input, consent: false }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, merchandise: ['vinyl'] }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, suggestion: 'x'.repeat(501) }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, interest: 'song' }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, cityRegion: 'x'.repeat(121) }).success).toBe(false);
  });
  it('updates aggregate interest while keeping each request independent', async () => {
    const { sql, db } = fixture();
    await saveInterest(db, interestSchema.parse(input));
    await saveInterest(db, interestSchema.parse({ ...input, merchandise: ['hoodies'] }));
    const rows = sql.prepare('SELECT email, merchandise FROM music_interest').all();
    expect(rows).toHaveLength(1); expect(rows[0].merchandise).toBe('["hoodies"]');
    expect(sql.prepare('SELECT kind,status FROM owner_requests ORDER BY kind').all())
      .toEqual([
        { kind: 'merchandise', status: 'new' }, { kind: 'merchandise', status: 'new' },
        { kind: 'purchase', status: 'new' }, { kind: 'purchase', status: 'new' },
      ]);
    expect(sql.prepare('SELECT count(*) AS total FROM owner_request_audit').get()).toEqual({ total: 4 });
  });
  it('deduplicates retries and accepts ordered progress across audio and video', async () => {
    const { sql, db } = fixture();
    const baseEvent = { releaseId: 'old-news-single', recordingId: 'old-news-recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', mediaDurationSeconds: 200 };
    const start = eventSchema.parse({ ...baseEvent, eventId: '538b2261-f59b-4489-96bd-1945e307d312', sequence: 1, medium: 'audio', event: 'start', accumulatedSeconds: 0 });
    await saveEvent(db, start, { trafficClass: 'human' }, new Date('2026-09-19T12:00:00Z'));
    await saveEvent(db, start, { trafficClass: 'human' }, new Date('2026-09-19T12:00:00Z'));
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: 'f072c4b5-c77a-41ca-ac07-40e850586067', sequence: 2, medium: 'video', event: 'progress', accumulatedSeconds: 10 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:10Z'));
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '2b0888f7-bf7f-41db-99af-6dc11b3b2b46', sequence: 3, medium: 'video', event: 'progress', accumulatedSeconds: 20 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:20Z'));
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '6fcda671-3155-4ee1-9b6d-401a3ae52d31', sequence: 4, medium: 'video', event: 'listen30', accumulatedSeconds: 30 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:30Z'));
    expect(sql.prepare('SELECT count(*) AS n FROM music_playback_events').get().n).toBe(4);
    expect(sql.prepare('SELECT medium,event FROM music_playback_events ORDER BY sequence').all())
      .toEqual([{ medium: 'audio', event: 'start' }, { medium: 'video', event: 'progress' }, { medium: 'video', event: 'progress' }, { medium: 'video', event: 'listen30' }]);
  });
  it('rejects out-of-order and unearned listening milestones', async () => {
    const { db } = fixture();
    const event = eventSchema.parse({ releaseId: 'old-news-single', recordingId: 'old-news-recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', eventId: '6fcda671-3155-4ee1-9b6d-401a3ae52d31', sequence: 2, medium: 'audio', event: 'listen30', accumulatedSeconds: 10, mediaDurationSeconds: 200 });
    await expect(saveEvent(db, event, { trafficClass: 'human' })).rejects.toBeInstanceOf(PlaybackSequenceError);
  });
  it('rejects browser timing that advances faster than server time', async () => {
    const { db } = fixture();
    const baseEvent = { releaseId: 'old-news-single', recordingId: 'old-news-recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', mediaDurationSeconds: 200 };
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '538b2261-f59b-4489-96bd-1945e307d312', sequence: 1, medium: 'audio', event: 'start', accumulatedSeconds: 0 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:00Z'));
    await expect(saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '6fcda671-3155-4ee1-9b6d-401a3ae52d31', sequence: 2, medium: 'audio', event: 'listen30', accumulatedSeconds: 30 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:01Z')))
      .rejects.toBeInstanceOf(PlaybackSequenceError);
  });
  it('accepts ordered events that catch up after a delivery delay', async () => {
    const { db } = fixture();
    const baseEvent = { releaseId: 'old-news-single', recordingId: 'old-news-recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', mediaDurationSeconds: 200 };
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '538b2261-f59b-4489-96bd-1945e307d312', sequence: 1, medium: 'audio', event: 'start', accumulatedSeconds: 0 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:00Z'));
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: 'f072c4b5-c77a-41ca-ac07-40e850586067', sequence: 2, medium: 'audio', event: 'progress', accumulatedSeconds: 10 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:30Z'));
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '2b0888f7-bf7f-41db-99af-6dc11b3b2b46', sequence: 3, medium: 'audio', event: 'progress', accumulatedSeconds: 20 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:30Z'));
    await expect(saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '6fcda671-3155-4ee1-9b6d-401a3ae52d31', sequence: 4, medium: 'audio', event: 'listen30', accumulatedSeconds: 30 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:30Z')))
      .resolves.toEqual({ status: 'stored' });
  });
  it('does not turn an idle gap into earned listening', async () => {
    const { db } = fixture();
    const baseEvent = { releaseId: 'old-news-single', recordingId: 'old-news-recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', mediaDurationSeconds: 200 };
    await saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '538b2261-f59b-4489-96bd-1945e307d312', sequence: 1, medium: 'audio', event: 'start', accumulatedSeconds: 0 }), { trafficClass: 'human' }, new Date('2026-09-19T12:00:00Z'));
    await expect(saveEvent(db, eventSchema.parse({ ...baseEvent, eventId: '6fcda671-3155-4ee1-9b6d-401a3ae52d31', sequence: 2, medium: 'audio', event: 'listen30', accumulatedSeconds: 30 }), { trafficClass: 'human' }, new Date('2026-09-19T12:01:00Z')))
      .rejects.toBeInstanceOf(PlaybackSequenceError);
  });
});
