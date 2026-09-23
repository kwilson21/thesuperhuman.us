import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const migration = readFileSync(new URL('../../migrations/music/0017_audio_project_update_milestones.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');

it('backfills revision and completion notes from their same-instant audit rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(schema.replace(migration.trim(), ''));
  const at = (minute: number) => `2026-09-22T12:0${minute}:00.000Z`;
  db.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','Song','reviewed',?,?)`).run(at(0), at(0));
  const note = db.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at) VALUES ('song-1',?,?,'owner',?)`);
  const audit = db.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at) VALUES ('song-1',?,'owner',?)`);
  note.run('work_started', 'Starting.', at(1)); audit.run('stage-changed', at(1));
  note.run('progress', 'Chorus notes heard.', at(2)); audit.run('stage-changed', at(2));
  note.run('progress', 'A plain update.', at(3));
  note.run('progress', 'All done.', at(4)); audit.run('completed', at(4));
  db.exec(migration);
  expect(db.prepare('SELECT body,milestone FROM audio_project_updates ORDER BY id').all()).toEqual([
    { body: 'Starting.', milestone: null },
    { body: 'Chorus notes heard.', milestone: 'revision_started' },
    { body: 'A plain update.', milestone: null },
    { body: 'All done.', milestone: 'completed' },
  ]);
  db.close();
});
