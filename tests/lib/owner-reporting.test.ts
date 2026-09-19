import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadCampaignDesk, loadStudioLedger } from '~/lib/owner-reporting';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  const statement = (query: string, args: unknown[] = []) => ({
    query, args,
    bind: (...values: unknown[]) => statement(query, values),
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    first: async () => sql.prepare(query).get(...args) ?? null,
  });
  const db = { prepare: (query: string) => statement(query) } as unknown as D1Database;
  sql.exec(`INSERT INTO owner_campaigns VALUES
    ('old-news-launch','release','old-news-single','Old News learning campaign','meaningful listening','["purchase demand"]','2026-09-01T00:00:00Z',NULL,'Share the release thoughtfully.','','','active','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
    INSERT INTO owner_requests(id,kind,release_id,email,summary,status,created_at,updated_at) VALUES
    ('r1','purchase','old-news-single','one@example.com','Wants the song','new','2026-09-18T10:00:00Z','2026-09-18T10:00:00Z'),
    ('r2','merchandise','old-news-single','two@example.com','Wants a shirt','new','2026-09-18T11:00:00Z','2026-09-18T11:00:00Z'),
    ('r3','service',NULL,'three@example.com','Mastering request','reviewed','2026-09-18T12:00:00Z','2026-09-18T12:00:00Z');
    INSERT INTO owner_audience_permissions VALUES
    ('listener@example.com','subscribed','release-updates-v1','r1','2026-09-18T10:00:00Z',NULL,'2026-09-18T10:00:00Z');`);
  const insert = sql.prepare(`INSERT INTO music_playback_events
    (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,campaign_id,channel,creative,traffic_class,country,region,city,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let index = 0; index < 7; index++) {
    const automated = index === 6;
    insert.run(`e${index}`,'old-news-single','old-news-recording',`s${index}`,`p${index}`,1,'audio','start',0,100,'old-news-launch','instagram','story',automated ? 'automated' : 'human','US','Tennessee',index < 5 ? 'Nashville' : 'Memphis','2026-09-18T12:00:00Z');
    if (!automated) insert.run(`l${index}`,'old-news-single','old-news-recording',`s${index}`,`p${index}`,2,'audio','listen30',30,100,'old-news-launch','instagram','story','human','US','Tennessee',index < 5 ? 'Nashville' : 'Memphis','2026-09-18T12:01:00Z');
  }
  return db;
}

it('orders attention first, suppresses sparse cities and excludes automated traffic', async () => {
  const ledger = await loadStudioLedger(fixture(), new Date('2026-09-19T12:00:00Z'));
  expect(ledger.attention.newRequests).toBe(2);
  expect(ledger.geography.cities).toEqual([
    { label: 'Nashville, Tennessee', reportedListens: 5 },
    { label: 'Other locations', reportedListens: 1 },
  ]);
  expect(ledger.listening.reportedStarts).toBe(6);
  expect(ledger.activeCampaign?.id).toBe('old-news-launch');
});

it('uses the same campaign evidence for the campaign desk', async () => {
  const desk = await loadCampaignDesk(fixture(), 'old-news-launch', new Date('2026-09-19T12:00:00Z'));
  expect(desk).toMatchObject({ id: 'old-news-launch', listening: { reportedStarts: 6, reported30SecondListens: 6 } });
  expect(desk?.demand).toEqual({ purchase: 1, merchandise: 1, subscribers: 1 });
  expect(await loadCampaignDesk(fixture(), 'missing', new Date())).toBeNull();
});
