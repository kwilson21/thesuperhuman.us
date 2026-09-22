import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const migration = readFileSync(new URL('../../migrations/music/0005_audio_projects.sql', import.meta.url), 'utf8');
const baseline = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');

function request(db: InstanceType<typeof DatabaseSync>, id: string, kind: 'service' | 'purchase', status = 'new', email = 'artist@example.com') {
  db.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'2026-09-22T12:00:00.000Z','2026-09-22T12:00:00.000Z')`)
    .run(id, kind, email, 'A song', status);
}

describe('audio project migration', () => {
  it('backfills open service requests and creates future projects atomically', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(`CREATE TABLE owner_requests (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, email TEXT NOT NULL,
      summary TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    request(db, 'existing-service', 'service');
    request(db, 'withdrawn-service', 'service', 'withdrawn');
    request(db, 'purchase', 'purchase');

    db.exec(migration);
    expect(db.prepare('SELECT request_id,stage FROM audio_projects').all()).toEqual([
      { request_id: 'existing-service', stage: 'files_under_review' },
    ]);
    expect(db.prepare('SELECT action,actor FROM audio_project_audit').all()).toEqual([
      { action: 'created', actor: 'migration' },
    ]);

    request(db, 'new-service', 'service');
    request(db, 'new-purchase', 'purchase');
    expect(db.prepare('SELECT request_id,stage FROM audio_projects ORDER BY request_id').all()).toEqual([
      { request_id: 'existing-service', stage: 'files_under_review' },
      { request_id: 'new-service', stage: 'files_under_review' },
    ]);
    expect(db.prepare("SELECT action,actor FROM audio_project_audit WHERE request_id='new-service'").get())
      .toEqual({ action: 'created', actor: 'system' });
    db.close();
  });

  it('creates a project for a new service request in the full baseline', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(baseline);
    request(db, 'new-service', 'service');
    expect(db.prepare("SELECT stage FROM audio_projects WHERE request_id='new-service'").get())
      .toEqual({ stage: 'files_under_review' });
    db.close();
  });
});
