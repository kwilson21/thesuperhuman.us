import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { applyOwnerRetention, previewOwnerRetention } from '../../scripts/owner-retention.mjs';
import { lifetimeOwnerPlayback } from '../../scripts/music-analytics.mjs';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const now = new Date('2026-09-19T12:00:00Z');

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO owner_requests(id,kind,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at,resolved_at) VALUES
    ('old-request','purchase','Fan','fan@example.com','Nashville','Purchase','{"format":"digital"}','resolved','reply sent','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z'),
    ('recent-request','service','Artist','artist@example.com','','Mastering','{}','resolved','','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-02T00:00:00Z');
    INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at) VALUES ('old-request','created','system','','2026-01-01T00:00:00Z');`);
  const event = db.prepare(`INSERT INTO music_playback_events(id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,campaign_id,channel,creative,traffic_class,country,region,city,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let index=0; index<3; index++) event.run(`event-${index}`,'old-news-single','old-news-recording',`session-${index}`,`play-${index}`,1,'audio',index ? 'listen30' : 'start',index ? 30 : 0,180,'campaign','instagram','story','human','US','Tennessee','Nashville','2026-01-01T00:00:00Z');
  event.run('automated','old-news-single','old-news-recording','bot-session','bot-play',1,'audio','listen30',30,180,'campaign','crawler','preview','automated','US','Virginia','Ashburn','2026-01-01T00:00:00Z');
  event.run('recent','old-news-single','old-news-recording','recent-session','recent-play',1,'audio','start',0,180,null,null,null,'human','US','','','2026-09-18T00:00:00Z');
  const database = { db, query: async (sql: string) => db.prepare(sql).all().map((row: Record<string, unknown>) => ({ ...row })) };
  return database;
}

it('preview is read-only and apply preserves aggregates while deleting eligible personal detail', async () => {
  const database = fixture();
  const before = await database.query(lifetimeOwnerPlayback);
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1); expect(review.rawPlayback).toBe(4);
  expect(JSON.stringify(review)).not.toContain('fan@example.com');
  expect((await database.query('SELECT count(*) AS total FROM music_playback_events'))[0].total).toBe(5);
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect(await database.query(lifetimeOwnerPlayback)).toEqual(before);
  expect((await database.query('SELECT sum(count) AS total FROM music_playback_daily'))[0].total).toBe(3);
  expect((await database.query("SELECT name,email,city_region,details_json,private_note,status FROM owner_requests WHERE id='old-request'"))[0])
    .toEqual({ name: '', email: '', city_region: '', details_json: '{}', private_note: '', status: 'resolved' });
  expect((await database.query("SELECT action,actor FROM owner_request_audit WHERE request_id='old-request' ORDER BY id DESC LIMIT 1"))[0])
    .toEqual({ action: 'personal-data-deleted', actor: 'retention' });
  expect((await database.query('SELECT environment,playback_rows,request_contacts FROM owner_retention_runs'))[0])
    .toEqual({ environment: 'Local test data', playback_rows: 4, request_contacts: 1 });
});

it('rejects changed sources, wrong environments and a second application', async () => {
  const database = fixture(); const review = await previewOwnerRetention(database, 'Local test data', now);
  await expect(applyOwnerRetention(database, review, 'Production', now)).rejects.toThrow('environment');
  database.db.exec("UPDATE owner_requests SET updated_at='changed' WHERE id='old-request'");
  await expect(applyOwnerRetention(database, review, 'Local test data', now)).rejects.toThrow('changed');
  const fresh = await previewOwnerRetention(database, 'Local test data', now); await applyOwnerRetention(database, fresh, 'Local test data', now);
  await expect(applyOwnerRetention(database, fresh, 'Local test data', now)).rejects.toThrow(/changed|applied/);
});
