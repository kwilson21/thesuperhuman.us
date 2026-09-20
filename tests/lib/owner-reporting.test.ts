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
    `);
  const request = sql.prepare(`INSERT INTO owner_requests(id,kind,release_id,campaign_id,email,summary,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (let index = 0; index < 12; index++) request.run(`d${index}`, index % 2 ? 'merchandise' : 'purchase', 'old-news-single', 'old-news-launch', `d${index}@example.com`, 'Demand', 'resolved', `2026-09-18T${String(13 + Math.floor(index / 2)).padStart(2, '0')}:00:00Z`, `2026-09-18T${String(13 + Math.floor(index / 2)).padStart(2, '0')}:00:00Z`);
  const insert = sql.prepare(`INSERT INTO music_playback_events
    (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,campaign_id,channel,creative,traffic_class,country,region,city,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let index = 0; index < 7; index++) {
    const automated = index === 6;
    const session = index < 5 ? 'replaying-session' : `s${index}`;
    insert.run(`e${index}`,'old-news-single','old-news-recording',session,`p${index}`,1,'audio','start',0,100,'old-news-launch','instagram','story',automated ? 'automated' : 'human','US','Tennessee',index < 5 ? 'Nashville' : 'Memphis','2026-09-18T12:00:00Z');
    if (!automated) insert.run(`l${index}`,'old-news-single','old-news-recording',session,`p${index}`,2,'audio','listen30',30,100,'old-news-launch','instagram','story','human','US','Tennessee',index < 5 ? 'Nashville' : 'Memphis','2026-09-18T12:01:00Z');
  }
  insert.run('unrelated','other-release','other-recording','other-session','other-play',1,'audio','start',0,100,null,null,null,'human','US','','','2026-09-18T12:00:00Z');
  return db;
}

it('orders attention first, suppresses sparse cities and excludes automated traffic', async () => {
  const ledger = await loadStudioLedger(fixture(), new Date('2026-09-19T12:00:00Z'));
  expect(ledger.attention.newRequests).toBe(2);
  expect(ledger.geography.cities).toEqual([{ label: 'Other locations', reportedListens: 2 }]);
  expect(ledger.listening.reportedStarts).toBe(7);
  expect(ledger.activeCampaignListening.reportedStarts).toBe(6);
  expect(ledger.attentionRequests.map(request => request.id)).toEqual(['r2', 'r1']);
  expect(ledger.activeCampaign?.id).toBe('old-news-launch');
});

it('uses the same campaign evidence for the campaign desk', async () => {
  const desk = await loadCampaignDesk(fixture(), 'old-news-launch', new Date('2026-09-19T12:00:00Z'));
  expect(desk).toMatchObject({ id: 'old-news-launch', listening: { reportedStarts: 6, reported30SecondListens: 6 } });
  expect(desk?.demand).toEqual({ purchase: 7, merchandise: 7 });
  expect(desk?.requests).toHaveLength(10);
  expect(await loadCampaignDesk(fixture(), 'missing', new Date())).toBeNull();
});
