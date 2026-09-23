import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { abortProjectUpload, beginProjectUpload, expectedPartLength, finishProjectUpload,
  getProjectUpload, ownerProjectCanUpload, uploadPartSize } from '~/lib/audio-project-uploads';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const schema = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
const now = new Date('2026-09-22T12:00:00Z');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(schema);
  const statement = (query: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    run: async () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }),
  });
  const db = { prepare: (query: string) => statement(query) } as unknown as D1Database;
  sql.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','reviewed',?,?)`).run(now.toISOString(), now.toISOString());
  sql.prepare(`INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
    offer_accepted_at,booking_status,created_at,updated_at)
    VALUES ('song-1','Mix',10000,5000,5000,?,'open',?,?)`).run(now.toISOString(), now.toISOString(), now.toISOString());
  sql.prepare("UPDATE audio_projects SET stage='in_progress' WHERE request_id='song-1'").run();
  const objects = new Map<string, { size: number }>();
  const uploads = new Map<string, string>();
  const deleted: string[] = [];
  const bucket = {
    createMultipartUpload: async (key: string) => {
      const uploadId = `r2-${uploads.size + 1}`;
      uploads.set(uploadId, key);
      return { uploadId, abort: async () => { uploads.delete(uploadId); } };
    },
    resumeMultipartUpload: (key: string, uploadId: string) => {
      if (uploads.get(uploadId) !== key) throw new Error('Invalid R2 upload');
      return {
        uploadPart: async (partNumber: number) => ({ partNumber, etag: 'a'.repeat(32) }),
        complete: async () => { const object = { size: uploadPartSize + 3 }; objects.set(key, object); return object; },
        abort: async () => { uploads.delete(uploadId); },
      };
    },
    head: async (key: string) => objects.get(key) ?? null,
    delete: async (key: string) => { deleted.push(key); objects.delete(key); },
  } as unknown as R2Bucket;
  return { sql, db, bucket, objects, deleted };
}

it('keeps an owner upload private until publication and supports a large multipart file', async () => {
  const { sql, db, bucket } = fixture();
  const input = { version: 'review' as const, displayName: 'Review.wav', mediaType: 'audio/wav' as const, byteSize: uploadPartSize + 3 };
  expect(await ownerProjectCanUpload(db, 'song-1')).toBe(false);
  expect(await beginProjectUpload(db, bucket, 'song-1', input, now)).toBeNull();
  sql.prepare("UPDATE audio_payments SET booking_status='paid' WHERE request_id='song-1'").run();
  const upload = (await beginProjectUpload(db, bucket, 'song-1', input, now))!;
  expect(upload.object_key).toMatch(/^studio\/projects\/song-1\/.+\.wav$/);
  expect(expectedPartLength(input.byteSize, 1)).toBe(uploadPartSize);
  expect(expectedPartLength(input.byteSize, 2)).toBe(3);
  expect(expectedPartLength(input.byteSize, 3)).toBeNull();
  const parts = [1, 2].map(partNumber => ({ partNumber, etag: 'a'.repeat(32) }));
  expect(await finishProjectUpload(db, bucket, upload, parts.slice(0, 1), now)).toBe('blocked');
  expect(await finishProjectUpload(db, bucket, upload, parts, now)).toBe('saved');
  expect(sql.prepare('SELECT status,published_at FROM audio_project_files WHERE id=?').get(upload.id))
    .toEqual({ status: 'uploaded', published_at: null });
  expect(await getProjectUpload(db, 'song-1', upload.id)).toBeNull();
  sql.close();
});

it('recovers a completed R2 object after a metadata write failure and can discard it safely', async () => {
  const { sql, db, bucket, objects, deleted } = fixture();
  sql.prepare("UPDATE audio_payments SET booking_status='paid' WHERE request_id='song-1'").run();
  const upload = (await beginProjectUpload(db, bucket, 'song-1', {
    version: 'final', displayName: 'Final.mp3', mediaType: 'audio/mpeg', byteSize: 5,
  }, now))!;
  objects.set(upload.object_key, { size: 4 });
  expect(await finishProjectUpload(db, bucket, upload, null, now)).toBe('size-mismatch');
  expect(await getProjectUpload(db, 'song-1', upload.id)).not.toBeNull();
  objects.set(upload.object_key, { size: 5 });
  expect(await finishProjectUpload(db, bucket, upload, null, now)).toBe('saved');
  expect(sql.prepare('SELECT status FROM audio_project_files WHERE id=?').get(upload.id)).toEqual({ status: 'uploaded' });
  const second = (await beginProjectUpload(db, bucket, 'song-1', {
    version: 'review', displayName: 'Discard.mp3', mediaType: 'audio/mpeg', byteSize: 5,
  }, now))!;
  objects.set(second.object_key, { size: 5 });
  await abortProjectUpload(db, bucket, second);
  expect(deleted).toContain(second.object_key);
  expect(await getProjectUpload(db, 'song-1', second.id)).toBeNull();
  sql.close();
});
