import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { revokeProjectAccess, revokeProjectFile } from '~/lib/audio-project-revocation';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const schema = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
const now = new Date('2026-09-22T12:00:00Z');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON'); sql.exec(schema);
  const statement = (query: string, args: unknown[] = []) => ({
    query, args, bind: (...values: unknown[]) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    run: async () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }),
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
  sql.prepare("UPDATE audio_projects SET stage='review_ready' WHERE request_id='song-1'").run();
  sql.prepare(`INSERT INTO audio_project_files
    (id,request_id,version,object_key,display_name,media_type,byte_size,status,uploaded_at,published_at)
    VALUES ('review-1','song-1','review','studio/projects/song-1/review-1.mp3','Review','audio/mpeg',5,'published',?,?)`)
    .run(now.toISOString(), now.toISOString());
  sql.prepare(`INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
    VALUES ('session-hash','artist@example.com',?,?,?)`).run(now.toISOString(), '2026-10-01T12:00:00Z', now.toISOString());
  sql.prepare(`INSERT INTO audio_client_codes(email,code_hash,created_at,expires_at)
    VALUES ('artist@example.com','code-hash',?,?)`).run(now.toISOString(), '2026-10-01T12:00:00Z');
  return { sql, db };
}

it('removes a published review immediately and records a client update once', async () => {
  const { sql, db } = fixture();
  expect(await revokeProjectFile(db, 'song-1', 'review-1', 'owner@example.com', '', now)).toBeNull();
  const result = await revokeProjectFile(db, 'song-1', 'review-1', 'owner@example.com', 'I need to replace this review.', now);
  expect(result?.updateId).toBeGreaterThan(0);
  expect(sql.prepare("SELECT status,revoked_by FROM audio_project_files WHERE id='review-1'").get())
    .toEqual({ status: 'revoked', revoked_by: 'owner@example.com' });
  expect(sql.prepare("SELECT stage FROM audio_projects WHERE request_id='song-1'").get()).toEqual({ stage: 'in_progress' });
  expect(sql.prepare('SELECT body,notification_status FROM audio_project_updates WHERE id=?').get(result?.updateId))
    .toEqual({ body: 'I need to replace this review.', notification_status: 'pending' });
  expect(await revokeProjectFile(db, 'song-1', 'review-1', 'owner@example.com', 'Again', now)).toBeNull();
  sql.close();
});

it('closes project access, invalidates sessions and codes, and writes one audit event', async () => {
  const { sql, db } = fixture();
  expect(await revokeProjectAccess(db, 'song-1', 'owner@example.com', now)).toBe(true);
  expect(sql.prepare("SELECT revoked_at FROM audio_projects WHERE request_id='song-1'").get())
    .toEqual({ revoked_at: now.toISOString() });
  expect(sql.prepare("SELECT revoked_at FROM audio_client_sessions WHERE token_hash='session-hash'").get())
    .toEqual({ revoked_at: now.toISOString() });
  expect(sql.prepare('SELECT email FROM audio_client_codes').all()).toEqual([]);
  expect(sql.prepare("SELECT action FROM audio_project_audit WHERE request_id='song-1' ORDER BY id").all())
    .toEqual([{ action: 'created' }, { action: 'revoked' }]);
  expect(await revokeProjectAccess(db, 'song-1', 'owner@example.com', now)).toBe(false);
  expect(sql.prepare("SELECT COUNT(*) AS count FROM audio_project_audit WHERE action='revoked'").get()).toEqual({ count: 1 });
  sql.close();
});

it('closes a declined provisional project when its request is resolved', () => {
  const { sql } = fixture();
  // Simulate a database that applied 0013 before the close-on-decline trigger existed.
  sql.exec('DROP TRIGGER audio_project_close_declined_request');
  sql.exec(readFileSync(new URL('../../migrations/music/0015_audio_project_close_declined.sql', import.meta.url), 'utf8'));
  sql.prepare("UPDATE audio_projects SET stage='files_under_review' WHERE request_id='song-1'").run();
  sql.prepare("UPDATE owner_requests SET status='resolved',updated_at=? WHERE id='song-1'").run(now.toISOString());
  expect(sql.prepare("SELECT revoked_at FROM audio_projects WHERE request_id='song-1'").get())
    .toEqual({ revoked_at: now.toISOString() });
  expect(sql.prepare("SELECT action,actor FROM audio_project_audit WHERE request_id='song-1' ORDER BY id").all())
    .toEqual([{ action: 'created', actor: 'system' }, { action: 'revoked', actor: 'request-resolution' }]);
  sql.close();
});

it('leaves delivered work available when its request is resolved', () => {
  const { sql } = fixture();
  sql.prepare("UPDATE owner_requests SET status='resolved',updated_at=? WHERE id='song-1'").run(now.toISOString());
  expect(sql.prepare("SELECT revoked_at FROM audio_projects WHERE request_id='song-1'").get())
    .toEqual({ revoked_at: null });
  sql.close();
});
