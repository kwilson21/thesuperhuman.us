import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { listStudioProjectAttention, loadCampaignDesk, loadStudioLedger } from '~/lib/owner-reporting';

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

it('shows unread client messages, failed notices, and approaching delivery dates in owner attention', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('due','service','due@example.com','Due song','reviewed','2026-09-01','2026-09-01'),
      ('quiet','service','quiet@example.com','Quiet song','reviewed','2026-09-01','2026-09-01'),
      ('review','service','review@example.com','Review song','reviewed','2026-09-01','2026-09-01'),
      ('closed','service','closed@example.com','Closed song','withdrawn','2026-09-01','2026-09-01'),
      ('late','service','late@example.com','Late song','reviewed','2026-09-01','2026-09-01');
    UPDATE audio_projects SET stage='revision_in_progress',current_due_at='2026-09-21' WHERE request_id='late';
    UPDATE audio_projects SET stage='in_progress',current_due_at='2026-09-24' WHERE request_id='due';
    UPDATE audio_projects SET stage='in_progress',current_due_at='2026-10-01' WHERE request_id='quiet';
    UPDATE audio_projects SET stage='review_ready',current_due_at='2026-09-24' WHERE request_id='review';
    UPDATE audio_projects SET stage='in_progress',current_due_at='2026-09-24' WHERE request_id='closed';
    INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
      VALUES ('due','client','session','Please check my files','2026-09-23');
    INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,notification_status)
      VALUES ('due','progress','I have an update','owner','2026-09-23','failed');
    INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,notification_status,notification_attempted_at)
      VALUES ('quiet','progress','Timed out a day ago','owner','2026-09-22T12:00:00Z','sending','2026-09-22T12:00:00Z'),
        ('review','progress','Still sending','owner','2026-09-23T11:59:50Z','sending','2026-09-23T11:59:50Z');`);
  const statement = (query: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(query, values),
    all: async () => ({ results: sql.prepare(query).all(...args) }),
  });
  const db = { prepare: (query: string) => statement(query) } as unknown as D1Database;
  expect(await listStudioProjectAttention(db, new Date('2026-09-23T12:00:00Z'))).toEqual([
    { requestId: 'due', summary: 'Due song', unreadMessages: 1, failedNotices: 1, uncheckedNotices: 0, dueSoon: true, stage: 'in_progress', bookingPaid: false, dueInDays: 1 },
    { requestId: 'late', summary: 'Late song', unreadMessages: 0, failedNotices: 0, uncheckedNotices: 0, dueSoon: true, stage: 'revision_in_progress', bookingPaid: false, dueInDays: -2 },
    // A notice still marked sending a day later needs a delivery check; one sent seconds ago does not.
    { requestId: 'quiet', summary: 'Quiet song', unreadMessages: 0, failedNotices: 0, uncheckedNotices: 1, dueSoon: false, stage: 'in_progress', bookingPaid: false, dueInDays: null },
  ]);
  sql.close();
});
