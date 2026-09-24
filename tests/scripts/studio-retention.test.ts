import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { applyStudioRetention, previewStudioRetention, remoteObjectDeleteArgs, studioStorageIdentity } from '../../scripts/studio-retention.mjs';

const storage = { accountId: null, databaseId: 'local-music', bucket: 'local-audio', jurisdiction: null };

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const now = new Date('2028-01-15T12:00:00Z');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at,resolved_at) VALUES
    ('withdrawn','service','Client One','one@example.com','Withdrawn song','withdrawn','2027-10-01','2027-11-01',NULL),
    ('delivered','service','Client Two','two@example.com','Delivered song','reviewed','2026-10-01','2027-01-01',NULL),
    ('active','service','Client Three','three@example.com','Active song','reviewed','2027-10-01','2028-01-01',NULL);
    UPDATE audio_projects SET stage='final_files_ready' WHERE request_id='delivered';
    UPDATE audio_projects SET stage='in_progress',current_due_at='2028-02-01' WHERE request_id='active';
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,booking_status,balance_status,created_at,updated_at)
    VALUES ('delivered','Mix',10000,5000,5000,'2026-10-01','paid','paid','2026-10-01','2026-10-01'),
      ('active','Mix',10000,5000,5000,'2027-10-01','paid','not_created','2027-10-01','2027-10-01');
    INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,status,uploaded_at,published_at,expires_at)
    VALUES ('file-withdrawn','withdrawn','review','studio/projects/withdrawn/file-withdrawn.mp3','Withdrawn song','audio/mpeg',100,'uploaded','2027-10-01',NULL,NULL),
      ('file-delivered','delivered','final','studio/projects/delivered/file-delivered.mp3','Final song','audio/mpeg',100,'published','2026-12-01','2026-12-01','2027-12-01'),
      ('file-active','active','review','studio/projects/active/file-active.mp3','Active song','audio/mpeg',100,'published','2028-01-01','2028-01-01',NULL);
    INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
      VALUES ('withdrawn','client','old-session','Private note','2027-10-02'),
        ('delivered','owner','owner@example.com','Listen here','2026-12-01'),
        ('active','client','active-session','Still working','2028-01-01');
    INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
      VALUES ('delivered','progress','Private update','owner@example.com','2026-12-01');
    INSERT INTO audio_client_codes(email,code_hash,created_at,expires_at)
      VALUES ('old@example.com','hash-old','2027-10-01','2027-10-01'),
        ('recent@example.com','hash-recent','2028-01-01','2028-01-01');
    INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at)
      VALUES ('old-session','old@example.com','2027-10-01','2027-10-15','2027-10-01'),
        ('recent-session','recent@example.com','2028-01-01','2028-01-30','2028-01-01');
    INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
      VALUES ('withdrawn','code-issued','2025-01-01'),('active','code-issued','2028-01-01');`);
  const database = {
    query: async (query: string) => sql.prepare(query).all().map((row: Record<string, unknown>) => ({ ...row })),
    batch: async (statements: string[]) => {
      sql.exec('BEGIN');
      try { const result = statements.map(statement => sql.prepare(statement).all()); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { sql, database };
}

it('previews without private values and removes only eligible closed project content', async () => {
  const { sql, database } = fixture();
  const review = await previewStudioRetention(database, 'Local test data', storage, now);
  expect(review.counts).toMatchObject({ projects: 2, objects: 2, codes: 1, sessions: 1, accessAudit: 1 });
  expect(JSON.stringify(review)).not.toMatch(/one@example|Private note|studio\/projects\/withdrawn/);
  const deleted: string[] = [];
  await applyStudioRetention(database, review, 'Local test data', storage, async (key: string) => { deleted.push(key); }, now);
  expect(deleted).toEqual([
    'studio/projects/delivered/file-delivered.mp3', 'studio/projects/withdrawn/file-withdrawn.mp3',
  ]);
  expect(sql.prepare('SELECT request_id FROM audio_project_files ORDER BY request_id').all())
    .toEqual([{ request_id: 'active' }]);
  expect(sql.prepare('SELECT request_id FROM audio_project_messages ORDER BY request_id').all())
    .toEqual([{ request_id: 'active' }]);
  expect(sql.prepare("SELECT request_id,content_deleted_at IS NOT NULL AS removed,revoked_at IS NOT NULL AS closed FROM audio_projects ORDER BY request_id").all())
    .toEqual([{ request_id: 'active', removed: 0, closed: 0 }, { request_id: 'delivered', removed: 1, closed: 1 }, { request_id: 'withdrawn', removed: 1, closed: 1 }]);
  expect(sql.prepare('SELECT email FROM audio_client_codes').all()).toEqual([{ email: 'recent@example.com' }]);
  expect(sql.prepare('SELECT token_hash FROM audio_client_sessions').all()).toEqual([{ token_hash: 'recent-session' }]);
  sql.close();
});

it('closes eligible access before object deletion and keeps records for a safe retry after storage failure', async () => {
  const { sql, database } = fixture();
  const review = await previewStudioRetention(database, 'Local test data', storage, now);
  const fail = vi.fn(async () => { throw new Error('R2 unavailable'); });
  await expect(applyStudioRetention(database, review, 'Local test data', storage, fail, now)).rejects.toThrow('R2 unavailable');
  expect(sql.prepare("SELECT revoked_at IS NOT NULL AS closed,content_deleted_at FROM audio_projects WHERE request_id='delivered'").get())
    .toEqual({ closed: 1, content_deleted_at: null });
  expect(sql.prepare("SELECT count(*) AS total FROM audio_project_files WHERE request_id='delivered'").get()).toEqual({ total: 1 });
  const retry = await previewStudioRetention(database, 'Local test data', storage, new Date(now.getTime() + 1000));
  await applyStudioRetention(database, retry, 'Local test data', storage, async () => {}, new Date(now.getTime() + 1000));
  expect(sql.prepare("SELECT content_deleted_at IS NOT NULL AS removed FROM audio_projects WHERE request_id='delivered'").get())
    .toEqual({ removed: 1 });
  sql.close();
});

it('retains a withdrawn delivered project until its final expires, then cleans it', async () => {
  const { sql, database } = fixture();
  sql.prepare("UPDATE owner_requests SET status='withdrawn' WHERE id='delivered'").run();
  const review = await previewStudioRetention(database, 'Local test data', storage, now);
  expect(review.counts.projects).toBe(2);
  await applyStudioRetention(database, review, 'Local test data', storage, async () => {}, now);
  expect(sql.prepare("SELECT content_deleted_at IS NOT NULL AS removed FROM audio_projects WHERE request_id='delivered'").get())
    .toEqual({ removed: 1 });
  sql.close();
});

it.each(['accepted', 'in_progress'])('cleans a withdrawn project after work reached %s', async stage => {
  const { sql, database } = fixture();
  sql.prepare("UPDATE audio_projects SET stage=? WHERE request_id='withdrawn'").run(stage);
  const review = await previewStudioRetention(database, 'Local test data', storage, now);
  expect(review.counts.projects).toBe(2);
  await applyStudioRetention(database, review, 'Local test data', storage, async () => {}, now);
  expect(sql.prepare("SELECT content_deleted_at IS NOT NULL AS removed FROM audio_projects WHERE request_id='withdrawn'").get())
    .toEqual({ removed: 1 });
  sql.close();
});

it('waits 30 days after a new unpublished draft before cleaning delivered content', async () => {
  const { sql, database } = fixture();
  sql.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,uploaded_at)
    VALUES ('recent-draft','delivered','final','studio/projects/delivered/recent-draft.mp3','New final draft','audio/mpeg',100,'2028-01-10')`).run();
  const early = await previewStudioRetention(database, 'Local test data', storage, now);
  expect(early.counts.projects).toBe(1);
  sql.prepare("UPDATE audio_project_files SET uploaded_at='2027-12-01' WHERE id='recent-draft'").run();
  const later = await previewStudioRetention(database, 'Local test data', storage, now);
  expect(later.counts.projects).toBe(2);
  sql.close();
});

it('cleans a revoked final after its access expiry and 30 days without project activity', async () => {
  const { sql, database } = fixture();
  sql.prepare("UPDATE audio_project_files SET status='revoked',revoked_at='2028-01-10' WHERE id='file-delivered'").run();
  sql.prepare("UPDATE audio_projects SET stage='in_progress',updated_at='2028-01-10' WHERE request_id='delivered'").run();
  expect((await previewStudioRetention(database, 'Local test data', storage, now)).counts.projects).toBe(1);
  sql.prepare("UPDATE audio_projects SET updated_at='2027-12-01' WHERE request_id='delivered'").run();
  expect((await previewStudioRetention(database, 'Local test data', storage, now)).counts.projects).toBe(2);
  sql.close();
});

it('refuses changed data, wrong environment, and already applied reviews before object deletion', async () => {
  const { sql, database } = fixture();
  const review = await previewStudioRetention(database, 'Local test data', storage, now);
  const deleteObject = vi.fn(async () => {});
  await expect(applyStudioRetention(database, review, 'Production', storage, deleteObject, now)).rejects.toThrow('environment');
  sql.prepare("UPDATE audio_project_files SET display_name='Changed' WHERE id='file-delivered'").run();
  // The source hash guards access-critical columns; a new file must also be detected.
  sql.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,uploaded_at)
    VALUES ('new-file','delivered','review','studio/projects/delivered/new-file.mp3','New','audio/mpeg',1,'2028-01-15')`).run();
  await expect(applyStudioRetention(database, review, 'Local test data', storage, deleteObject, now)).rejects.toThrow('source changed');
  expect(deleteObject).not.toHaveBeenCalled();
  sql.close();
});

it('does not discard a message added after the owner reviewed the cleanup', async () => {
  const { sql, database } = fixture();
  const review = await previewStudioRetention(database, 'Local test data', storage, now);
  sql.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
    VALUES ('delivered','client','new-session','A late private note','2028-01-15')`).run();
  const deleteObject = vi.fn(async () => {});
  await expect(applyStudioRetention(database, review, 'Local test data', storage, deleteObject, now)).rejects.toThrow('source changed');
  expect(deleteObject).not.toHaveBeenCalled();
  expect(sql.prepare("SELECT revoked_at FROM audio_projects WHERE request_id='delivered'").get())
    .toEqual({ revoked_at: null });
  sql.close();
});

it('refuses a review made for another database or bucket before changing anything', async () => {
  const { sql, database } = fixture();
  const review = await previewStudioRetention(database, 'Local test data', storage, now);
  const deleteObject = vi.fn(async () => {});
  const before = sql.prepare('SELECT request_id,revoked_at FROM audio_projects ORDER BY request_id').all();
  for (const other of [{ ...storage, bucket: 'superhuman-audio' }, { ...storage, databaseId: 'staging-music' }, { ...storage, jurisdiction: 'eu' }]) {
    await expect(applyStudioRetention(database, review, 'Local test data', other, deleteObject, now)).rejects.toThrow('another database or bucket');
  }
  expect(deleteObject).not.toHaveBeenCalled();
  expect(sql.prepare('SELECT request_id,revoked_at FROM audio_projects ORDER BY request_id').all()).toEqual(before);
  sql.close();
});

it('reads the storage identity from the selected config and deletes from that bucket', () => {
  const staging = studioStorageIdentity({
    d1_databases: [{ binding: 'MUSIC_DB', database_id: 'staging-db' }],
    r2_buckets: [{ binding: 'AUDIO', bucket_name: 'staging-audio', jurisdiction: 'eu' }],
  });
  expect(staging).toEqual({ accountId: null, databaseId: 'staging-db', bucket: 'staging-audio', jurisdiction: 'eu' });
  const args = remoteObjectDeleteArgs('studio/projects/song-1/file-1.wav', staging, 'staging.json');
  expect(args).toContain('staging-audio/studio/projects/song-1/file-1.wav');
  expect(args.join(' ')).not.toContain('superhuman-audio');
  expect(args.slice(args.indexOf('--jurisdiction'), args.indexOf('--jurisdiction') + 2)).toEqual(['--jurisdiction', 'eu']);
  expect(() => studioStorageIdentity({ d1_databases: [], r2_buckets: [] })).toThrow('MUSIC_DB and AUDIO');
});

it('cleans a resolved project the client stopped, but keeps a paid booking still owed a balance', async () => {
  const { sql, database } = fixture();
  // The active project is now resolved long ago, with a paid booking and no balance invoice.
  sql.exec(`UPDATE owner_requests SET status='resolved',resolved_at='2027-11-01',updated_at='2027-11-01' WHERE id='active';
    UPDATE audio_projects SET stage='review_ready',revoked_at='2027-11-01' WHERE request_id='active';
    UPDATE audio_project_files SET published_at='2027-10-15',uploaded_at='2027-10-15' WHERE id='file-active';
    UPDATE audio_project_messages SET created_at='2027-10-20' WHERE request_id='active';`);
  expect((await previewStudioRetention(database, 'Local test data', storage, now)).counts.projects).toBe(2);
  // The client stopped after the last round, so no balance is due and the project can be cleaned.
  sql.exec(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at,review_decision)
    VALUES ('active','client','active-session','I’m stopping the project here.','2027-10-25','stopped')`);
  expect((await previewStudioRetention(database, 'Local test data', storage, now)).counts.projects).toBe(3);
});
