import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
import { readFileSync } from 'node:fs';
import { preview, apply, cutoffFor } from '../../scripts/music-retention.mjs';
import { lifetimePlayback, dailyPlayback } from '../../scripts/music-analytics.mjs';
const now = new Date('2026-09-16T12:00:00.000Z');
const schema = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
function setup() {
  const db = new DatabaseSync(':memory:');
  for (const sql of schema.replace(/^--.*$/gm, '').split(/;\s*(?=CREATE\b|$)/i).filter(sql => sql.trim())) db.exec(sql);
  const insert = db.prepare('INSERT INTO music_events VALUES (?,?,?,?,?,?)');
  insert.run('release','song','old-a','audio','start','2026-05-01T00:00:00.000Z');
  insert.run('release','song','old-a','audio','listen30','2026-05-01T00:00:30.000Z');
  insert.run('release','song','old-b','video','start','2026-05-02T00:00:00.000Z');
  insert.run('release','other','old-c','audio','start','2026-05-01T00:00:00.000Z');
  insert.run('release','song','boundary','audio','start',cutoffFor(now));
  insert.run('release','song','recent','audio','start','2026-09-15T00:00:00.000Z');
  return { db, query: async (sql: string) => db.prepare(sql).all().map((row: Record<string, unknown>) => ({ ...row })) };
}
test('preview is read-only; cleanup preserves daily and lifetime totals and cannot double count', async () => {
  const database = setup();
  const before = await database.query(lifetimePlayback);
  const daily = await database.query(dailyPlayback);
  const review = await preview(database, 'Local test data', now);
  assert.equal(review.rows, 4);
  assert.equal((await database.query('SELECT count(*) n FROM music_events'))[0].n, 6);
  assert.equal(JSON.stringify(review).includes('old-a'), false);
  assert.equal(await apply(database, review, 'Local test data', now), 4);
  assert.deepEqual(await database.query(lifetimePlayback), before);
  assert.deepEqual(await database.query(dailyPlayback), daily);
  assert.equal((await database.query('SELECT count(*) n FROM music_events'))[0].n, 2);
  await assert.rejects(apply(database, review, 'Local test data', now), /changed|already applied/);
  const empty = await preview(database, 'Local test data', now);
  assert.equal(await apply(database, empty, 'Local test data', now), 0);
  assert.deepEqual(await database.query(lifetimePlayback), before);
});
test('changed source, edited summary, wrong environment and unsafe cutoff are rejected', async () => {
  const database = setup();
  const review = await preview(database, 'Local test data', now);
  await assert.rejects(apply(database, review, 'Production', now), /environment/);
  await assert.rejects(apply(database, {...review,cutoff:now.toISOString()}, 'Local test data', now), /Invalid review/);
  await assert.rejects(apply(database, {...review,dailySummary:[]}, 'Local test data', now), /summary/);
  database.db.exec("UPDATE music_events SET session_id='changed' WHERE session_id='old-a'");
  await assert.rejects(apply(database, review, 'Local test data', now), /changed/);
});
test('concurrent change after verification blocks the atomic delete', async () => {
  const database = setup();
  const review = await preview(database, 'Local test data', now);
  const guarded = { query: async (sql: string) => {
    if (sql.startsWith('DELETE')) database.db.exec("UPDATE music_events SET session_id='raced' WHERE session_id='old-a'");
    return database.query(sql);
  }};
  await assert.rejects(apply(guarded, review, 'Local test data', now), /source changed/);
  assert.equal((await database.query('SELECT count(*) n FROM music_events'))[0].n, 6);
  assert.equal((await database.query('SELECT count(*) n FROM music_event_daily'))[0].n, 0);
});
test('archive failure rolls back all raw deletes and archive writes', async () => {
  const database = setup();
  const review = await preview(database, 'Local test data', now);
  database.db.exec("CREATE TRIGGER fail_archive BEFORE INSERT ON music_event_daily WHEN NEW.medium='video' BEGIN SELECT RAISE(ABORT,'simulated archive failure'); END");
  await assert.rejects(apply(database, review, 'Local test data', now), /simulated archive failure/);
  assert.equal((await database.query('SELECT count(*) n FROM music_events'))[0].n, 6);
  assert.equal((await database.query('SELECT count(*) n FROM music_event_daily'))[0].n, 0);
});
test('missing or altered archive trigger prevents cleanup', async () => {
  const database = setup();
  const review = await preview(database, 'Local test data', now);
  database.db.exec('DROP TRIGGER music_events_archive_before_delete');
  await assert.rejects(apply(database, review, 'Local test data', now), /trigger/);
});

test('large reviews use bounded chunks; failure leaves the rest for a fresh review', async () => {
  const database = setup();
  const insert = database.db.prepare('INSERT INTO music_events VALUES (?,?,?,?,?,?)');
  for (let i=0; i<220; i++) insert.run('batch','song',`session-${i}`,'audio','start','2026-01-01T00:00:00.000Z');
  const before = await database.query(lifetimePlayback);
  const review = await preview(database, 'Local test data', now);
  let deletes = 0;
  const interrupted = { query: async (sql: string) => {
    if (sql.startsWith('DELETE') && ++deletes === 2) throw new Error('simulated interruption');
    return database.query(sql);
  }};
  await assert.rejects(apply(interrupted, review, 'Local test data', now), /earlier chunks may be archived/);
  assert.equal((await database.query('SELECT sum(count) n FROM music_event_daily'))[0].n, 100);
  assert.deepEqual(await database.query(lifetimePlayback), before);
  await assert.rejects(apply(database, review, 'Local test data', now), /changed/);
  const remaining = await preview(database, 'Local test data', now);
  assert.equal(remaining.rows, 124);
  assert.equal(await apply(database, remaining, 'Local test data', now), 124);
  assert.deepEqual(await database.query(lifetimePlayback), before);
});
