import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { interestSchema, eventSchema, saveInterest, saveEvent } from '~/lib/music-demand';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const input = { releaseId: 'old-news-single', email: ' Fan@Example.com ', interest: 'both', merchandise: ['shirts', 'digital-art'], suggestion: 'Blue design', cityRegion: ' Nashville, Tennessee ', releaseUpdates: true, consent: true, turnstileToken: 'token' };
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values), run: async () => sql.prepare(query).run(...args) });
  const db = { prepare: (query: string) => statement(query), batch: async (statements: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try { const results = statements.map(item => ({ results: [], meta: sql.prepare(item.query).run(...item.args) })); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, db: db as unknown as D1Database };
}
describe('private music demand', () => {
  it('normalizes email and requires valid choices and consent', () => {
    expect(interestSchema.parse(input)).toMatchObject({ email: 'fan@example.com', cityRegion: 'Nashville, Tennessee', releaseUpdates: true });
    expect(interestSchema.safeParse({ ...input, consent: false }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, merchandise: ['vinyl'] }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, suggestion: 'x'.repeat(501) }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, interest: 'song' }).success).toBe(false);
    expect(interestSchema.safeParse({ ...input, cityRegion: 'x'.repeat(121) }).success).toBe(false);
    expect(interestSchema.parse({ ...input, releaseUpdates: undefined }).releaseUpdates).toBe(false);
  });
  it('updates a fans interest instead of counting repeat submissions twice', async () => {
    const { sql, db } = fixture();
    await saveInterest(db, interestSchema.parse(input));
    await saveInterest(db, interestSchema.parse({ ...input, merchandise: ['hoodies'] }));
    const rows = sql.prepare('SELECT email, merchandise FROM music_interest').all();
    expect(rows).toHaveLength(1); expect(rows[0].merchandise).toBe('["hoodies"]');
    expect(sql.prepare('SELECT kind,status FROM owner_requests ORDER BY kind').all())
      .toEqual([{ kind: 'merchandise', status: 'new' }, { kind: 'purchase', status: 'new' }, { kind: 'release-update', status: 'new' }]);
    expect(sql.prepare('SELECT email,status,consent_version FROM owner_audience_permissions').all())
      .toEqual([{ email: 'fan@example.com', status: 'subscribed', consent_version: 'release-updates-v1' }]);
  });
  it('deduplicates event retries and separates audio, video and milestones', async () => {
    const { sql, db } = fixture();
    const event = eventSchema.parse({ releaseId: 'old-news-single', recordingId: 'old-news-recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', medium: 'audio', event: 'start' });
    await saveEvent(db, event); await saveEvent(db, event);
    await saveEvent(db, { ...event, medium: 'video' });
    await saveEvent(db, { ...event, event: 'listen30' });
    expect(sql.prepare('SELECT count(*) AS n FROM music_events').get().n).toBe(3);
  });
});
