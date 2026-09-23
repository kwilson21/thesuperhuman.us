import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { listProjectUpdates } from '~/lib/audio-project-updates';
import { privateProjectObjectKey } from '~/lib/audio-project-files';
import { publishProjectFile } from '~/lib/audio-project-publishing';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const schema = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
const now = new Date('2026-09-22T12:00:00Z');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(schema);
  const statement = (query: string, args: unknown[] = []) => ({
    query, args, bind: (...values: unknown[]) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    run: async () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }),
    all: async () => ({ results: sql.prepare(query).all(...args) }),
  });
  const db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try {
      const results = items.map(item => ({ results: /\bRETURNING\b/i.test(item.query)
        ? sql.prepare(item.query).all(...item.args) : (sql.prepare(item.query).run(...item.args), []) }));
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  sql.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','reviewed',?,?)`).run(now.toISOString(), now.toISOString());
  sql.prepare(`INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
    offer_accepted_at,booking_status,balance_status,created_at,updated_at)
    VALUES ('song-1','Mix',10000,5000,5000,?,'open','open',?,?)`).run(now.toISOString(), now.toISOString(), now.toISOString());
  sql.prepare("UPDATE audio_projects SET stage='in_progress' WHERE request_id='song-1'").run();
  const addFile = (id: string, version: 'review' | 'final', size = 5) => sql.prepare(`INSERT INTO audio_project_files
    (id,request_id,version,object_key,display_name,media_type,byte_size,uploaded_at)
    VALUES (?,'song-1',?,?,?,'audio/mpeg',?,?)`).run(id, version,
      privateProjectObjectKey('song-1', id, 'audio/mpeg'), `${id}.mp3`, size, now.toISOString());
  const bucket = { head: async () => ({ size: 5 }) } as unknown as R2Bucket;
  return { sql, db, addFile, bucket };
}

it('publishes a review atomically, supersedes the old review, and records the client notice', async () => {
  const { sql, db, addFile, bucket } = fixture();
  addFile('review-1', 'review'); addFile('review-2', 'review');
  expect(await publishProjectFile(db, bucket, 'song-1', 'review-1', 'owner@example.com', 'Please listen and send one set of notes.', false, now)).toBeNull();
  sql.prepare("UPDATE audio_payments SET booking_status='paid' WHERE request_id='song-1'").run();
  const first = await publishProjectFile(db, bucket, 'song-1', 'review-1', 'owner@example.com', 'Please listen and send one set of notes.', false, now);
  expect(first).toBeGreaterThan(0);
  expect(sql.prepare("SELECT stage FROM audio_projects WHERE request_id='song-1'").get()).toEqual({ stage: 'review_ready' });
  expect(sql.prepare("SELECT status,downloadable FROM audio_project_files WHERE id='review-1'").get()).toEqual({ status: 'published', downloadable: 0 });
  expect(await publishProjectFile(db, bucket, 'song-1', 'review-1', 'owner@example.com', 'Again', true, now)).toBeNull();
  expect(await publishProjectFile(db, bucket, 'song-1', 'review-2', 'owner@example.com', 'Updated review is ready.', true,
    new Date(now.getTime() + 1000))).toBeGreaterThan(0);
  expect(sql.prepare("SELECT status FROM audio_project_files WHERE id='review-1'").get()).toEqual({ status: 'revoked' });
  expect(sql.prepare("SELECT status,downloadable FROM audio_project_files WHERE id='review-2'").get()).toEqual({ status: 'published', downloadable: 1 });
  expect((await listProjectUpdates(db, 'song-1')).map(item => [item.file_id, item.file_version, item.notification_status]))
    .toEqual([['review-1', 'review', 'pending'], ['review-2', 'review', 'pending']]);
  sql.close();
});

it('keeps final delivery hidden until the balance is paid and gives it a one-year expiry', async () => {
  const { sql, db, addFile, bucket } = fixture();
  addFile('review-1', 'review'); addFile('final-1', 'final');
  sql.prepare("UPDATE audio_payments SET booking_status='paid' WHERE request_id='song-1'").run();
  await publishProjectFile(db, bucket, 'song-1', 'review-1', 'owner@example.com', 'Review ready.', false, now);
  expect(await publishProjectFile(db, bucket, 'song-1', 'final-1', 'owner@example.com', 'Your final file is ready.', false, now)).toBeNull();
  expect(sql.prepare("SELECT status FROM audio_project_files WHERE id='final-1'").get()).toEqual({ status: 'uploaded' });
  sql.prepare("UPDATE audio_payments SET balance_status='paid' WHERE request_id='song-1'").run();
  expect(await publishProjectFile(db, bucket, 'song-1', 'final-1', 'owner@example.com', 'Your final file is ready.', false, now)).toBeGreaterThan(0);
  expect(sql.prepare("SELECT stage FROM audio_projects WHERE request_id='song-1'").get()).toEqual({ stage: 'final_files_ready' });
  expect(sql.prepare("SELECT status FROM audio_project_files WHERE id='review-1'").get()).toEqual({ status: 'revoked' });
  expect(sql.prepare("SELECT status,downloadable,expires_at FROM audio_project_files WHERE id='final-1'").get())
    .toEqual({ status: 'published', downloadable: 1, expires_at: '2027-09-22T12:00:00.000Z' });
  addFile('final-2', 'final');
  expect(await publishProjectFile(db, bucket, 'song-1', 'final-2', 'owner@example.com', 'The WAV version is ready too.', false,
    new Date(now.getTime() + 1000))).toBeGreaterThan(0);
  expect(sql.prepare("SELECT status FROM audio_project_files WHERE id='final-1'").get()).toEqual({ status: 'published' });
  sql.close();
});
