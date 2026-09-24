import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { applyOwnerRetention, previewOwnerRetention } from '../../scripts/owner-retention.mjs';
import { applyStudioRetention, previewStudioRetention } from '../../scripts/studio-retention.mjs';
import { lifetimeOwnerPlayback } from '../../scripts/music-analytics.mjs';

const storage = { accountId: null, databaseId: 'local-music', bucket: 'local-audio', jurisdiction: null };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const now = new Date('2026-09-19T12:00:00Z');

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO owner_requests(id,kind,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at,resolved_at) VALUES
    ('old-request','purchase','Fan','fan@example.com','Nashville','Purchase','{"format":"digital"}','resolved','reply sent','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z'),
    ('recent-request','service','Artist','artist@example.com','','Mastering','{}','resolved','','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-02T00:00:00Z');
    INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at) VALUES ('old-request','created','system','','2026-01-01T00:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,stripe_customer_id,booking_invoice_id,booking_invoice_url,booking_status,balance_invoice_id,balance_invoice_url,balance_status,created_at,updated_at)
    VALUES ('old-request','Mastering',7500,3750,3750,'2026-01-01T00:00:00Z','cus_private','in_old','https://invoice.stripe.com/private','paid','in_balance','https://invoice.stripe.com/balance','paid','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    INSERT INTO stripe_invoice_attempts(invoice_id,request_id,installment,created_at)
    VALUES ('in_old','old-request','booking','2026-01-01T00:00:00Z');`);
  const event = db.prepare(`INSERT INTO music_playback_events(id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,campaign_id,channel,creative,traffic_class,country,region,city,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let index=0; index<3; index++) event.run(`event-${index}`,'old-news-single','old-news-recording',`session-${index}`,`play-${index}`,1,'audio',index ? 'listen30' : 'start',index ? 30 : 0,180,'campaign','instagram','story','human','US','Tennessee','Nashville','2026-01-01T00:00:00Z');
  event.run('automated','old-news-single','old-news-recording','bot-session','bot-play',1,'audio','listen30',30,180,'campaign','crawler','preview','automated','US','Virginia','Ashburn','2026-01-01T00:00:00Z');
  event.run('complete-only','old-news-single','old-news-recording','session-1','complete-play',1,'audio','complete',180,180,'campaign','instagram','story','human','US','Tennessee','Nashville','2026-01-01T00:00:00Z');
  event.run('recent','old-news-single','old-news-recording','recent-session','recent-play',1,'audio','start',0,180,null,null,null,'human','US','','','2026-09-18T00:00:00Z');
  const database = { db, query: async (sql: string) => db.prepare(sql).all().map((row: Record<string, unknown>) => ({ ...row })),
    batch: async (statements: string[]) => { db.exec('BEGIN'); try { const results = statements.map(sql => db.prepare(sql).all()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; } } };
  return database;
}

it('preview is read-only and apply preserves aggregates while deleting eligible personal detail', async () => {
  const database = fixture();
  const totals = `SELECT event,SUM(count) AS count FROM (${lifetimeOwnerPlayback}) GROUP BY event ORDER BY event`;
  const before = await database.query(totals);
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1); expect(review.rawPlayback).toBe(5); expect(review.remainingPlayback).toBe(0);
  expect(JSON.stringify(review)).not.toContain('fan@example.com');
  expect((await database.query('SELECT count(*) AS total FROM music_playback_events'))[0].total).toBe(6);
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect(await database.query(totals)).toEqual(before);
  expect((await database.query('SELECT sum(count) AS total FROM music_playback_daily'))[0].total).toBe(4);
  expect(await database.query('SELECT city,count FROM music_playback_geography_daily')).toEqual([{ city: '', count: 2 }]);
  expect(await database.query('SELECT DISTINCT city FROM music_playback_daily')).toEqual([{ city: '' }]);
  expect((await database.query("SELECT name,email,city_region,details_json,private_note,status FROM owner_requests WHERE id='old-request'"))[0])
    .toEqual({ name: '', email: '', city_region: '', details_json: '{}', private_note: '', status: 'resolved' });
  expect((await database.query("SELECT action,actor FROM owner_request_audit WHERE request_id='old-request' ORDER BY id DESC LIMIT 1"))[0])
    .toEqual({ action: 'personal-data-deleted', actor: 'retention' });
  expect((await database.query("SELECT stripe_customer_id,booking_invoice_id,booking_invoice_url,external_refs_deleted_at FROM audio_payments WHERE request_id='old-request'"))[0])
    .toEqual({ stripe_customer_id: null, booking_invoice_id: null, booking_invoice_url: null, external_refs_deleted_at: now.toISOString() });
  expect((await database.query("SELECT COUNT(*) AS total FROM stripe_invoice_attempts WHERE request_id='old-request'"))[0])
    .toEqual({ total: 0 });
  expect((await database.query('SELECT environment,playback_rows,request_contacts FROM owner_retention_runs'))[0])
    .toEqual({ environment: 'Local test data', playback_rows: 5, request_contacts: 1 });
});

it('rolls back every retention mutation when an atomic batch statement fails', async () => {
  const database = fixture(); const review = await previewOwnerRetention(database, 'Local test data', now);
  const interrupted = { ...database, batch: async (statements: string[]) => {
    database.db.exec('BEGIN');
    try { database.db.prepare(statements[0]).all(); database.db.prepare(statements[1]).all(); throw new Error('simulated failure'); }
    catch (error) { database.db.exec('ROLLBACK'); throw error; }
  } };
  await expect(applyOwnerRetention(interrupted, review, 'Local test data', now)).rejects.toThrow('simulated failure');
  expect((await database.query('SELECT count(*) AS total FROM music_playback_events'))[0].total).toBe(6);
  expect((await database.query("SELECT email FROM owner_requests WHERE id='old-request'"))[0].email).toBe('fan@example.com');
  expect((await database.query('SELECT count(*) AS total FROM owner_retention_runs'))[0].total).toBe(0);
});

it('rejects changed sources, wrong environments and a second application', async () => {
  const database = fixture(); const review = await previewOwnerRetention(database, 'Local test data', now);
  await expect(applyOwnerRetention(database, review, 'Production', now)).rejects.toThrow('environment');
  database.db.exec("UPDATE owner_requests SET updated_at='changed' WHERE id='old-request'");
  await expect(applyOwnerRetention(database, review, 'Local test data', now)).rejects.toThrow('changed');
  const fresh = await previewOwnerRetention(database, 'Local test data', now); await applyOwnerRetention(database, fresh, 'Local test data', now);
  await expect(applyOwnerRetention(database, fresh, 'Local test data', now)).rejects.toThrow(/changed|applied/);
});

it('refuses payment cleanup when the reconciliation migration is incomplete', async () => {
  const database = fixture();
  const review = await previewOwnerRetention(database, 'Local test data', now);
  database.db.exec('DROP TABLE stripe_unmatched_events');
  await expect(applyOwnerRetention(database, review, 'Local test data', now)).rejects.toThrow('migration 0004');
});

it('keeps an unfinished service request intact until both invoices are terminal', async () => {
  const database = fixture();
  database.db.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at,resolved_at)
    VALUES ('active-service','service','Active Artist','active@example.com','Mix','resolved','2025-01-01T00:00:00Z','2025-01-02T00:00:00Z','2025-01-02T00:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,stripe_customer_id,booking_invoice_id,booking_invoice_url,booking_status,created_at,updated_at)
    VALUES ('active-service','Mix',10000,5000,5000,'2026-01-01T00:00:00Z','cus_active','in_active','https://invoice.stripe.com/active','open','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');`);
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1);
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect((await database.query("SELECT name,email FROM owner_requests WHERE id='active-service'"))[0])
    .toEqual({ name: 'Active Artist', email: 'active@example.com' });
  expect((await database.query("SELECT stripe_customer_id,booking_invoice_id FROM audio_payments WHERE request_id='active-service'"))[0])
    .toEqual({ stripe_customer_id: 'cus_active', booking_invoice_id: 'in_active' });
});

it('keeps an uncollectible service invoice available for Stripe reconciliation', async () => {
  const database = fixture();
  database.db.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at,resolved_at)
    VALUES ('uncollectible-service','service','Artist','artist@example.com','Mix','resolved','2025-01-01T00:00:00Z','2025-01-02T00:00:00Z','2025-01-02T00:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,stripe_customer_id,booking_status,balance_invoice_id,balance_invoice_url,balance_status,created_at,updated_at)
    VALUES ('uncollectible-service','Mix',10000,5000,5000,'2025-01-01T00:00:00Z','cus_uncollectible','paid','in_uncollectible','https://invoice.stripe.com/uncollectible','uncollectible','2025-01-01T00:00:00Z','2025-01-01T00:00:00Z');`);
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1);
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect((await database.query("SELECT name,email FROM owner_requests WHERE id='uncollectible-service'"))[0])
    .toEqual({ name: 'Artist', email: 'artist@example.com' });
  expect((await database.query("SELECT stripe_customer_id,balance_invoice_id,balance_invoice_url FROM audio_payments WHERE request_id='uncollectible-service'"))[0])
    .toEqual({ stripe_customer_id: 'cus_uncollectible', balance_invoice_id: 'in_uncollectible', balance_invoice_url: 'https://invoice.stripe.com/uncollectible' });
});

it('keeps withdrawn service contact until studio content has completed its 30-day cleanup', async () => {
  const database = fixture();
  database.db.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at)
    VALUES ('withdrawn-service','service','Artist','artist@example.com','Mix','withdrawn','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,created_at,updated_at)
    VALUES ('withdrawn-service','Mix',10000,5000,5000,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');`);
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1);
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect((await database.query("SELECT name,email FROM owner_requests WHERE id='withdrawn-service'"))[0])
    .toEqual({ name: 'Artist', email: 'artist@example.com' });
  expect((await database.query("SELECT external_refs_deleted_at FROM audio_payments WHERE request_id='withdrawn-service'"))[0])
    .toEqual({ external_refs_deleted_at: null });
});

it('clears request contact and summary after studio cleanup has removed withdrawn project content', async () => {
  const database = fixture();
  const later = new Date('2026-10-10T12:00:00Z');
  database.db.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at)
    VALUES ('studio-withdrawn','service','Artist','artist@example.com','Private song details','withdrawn','2026-09-01','2026-09-02');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,created_at,updated_at)
    VALUES ('studio-withdrawn','Mix',10000,5000,5000,'2026-09-01','2026-09-01','2026-09-01');`);
  const studioReview = await previewStudioRetention(database, 'Local test data', storage, later);
  await applyStudioRetention(database, studioReview, 'Local test data', storage, async () => {}, later);
  const ownerReview = await previewOwnerRetention(database, 'Local test data', later);
  await applyOwnerRetention(database, ownerReview, 'Local test data', later);
  expect((await database.query("SELECT name,email,summary FROM owner_requests WHERE id='studio-withdrawn'"))[0])
    .toEqual({ name: '', email: '', summary: '' });
});

it('keeps a withdrawn service request while an invoice creation is reserved', async () => {
  const database = fixture();
  database.db.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at)
    VALUES ('reserved-service','service','Artist','artist@example.com','Mix','withdrawn','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,booking_creation_started_at,created_at,updated_at)
    VALUES ('reserved-service','Mix',10000,5000,5000,'2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z');`);
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1);
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect((await database.query("SELECT name,email FROM owner_requests WHERE id='reserved-service'"))[0])
    .toEqual({ name: 'Artist', email: 'artist@example.com' });
});

it('keeps a withdrawn service request while its paid booking still permits a balance invoice', async () => {
  const database = fixture();
  database.db.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at)
    VALUES ('balance-due-service','service','Artist','artist@example.com','Mix','withdrawn','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,stripe_customer_id,booking_invoice_id,booking_invoice_url,booking_status,created_at,updated_at)
    VALUES ('balance-due-service','Mix',10000,5000,5000,'2026-09-01T00:00:00Z','cus_balance_due','in_booking','https://invoice.stripe.com/booking','paid','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');`);
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1);
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect((await database.query("SELECT name,email FROM owner_requests WHERE id='balance-due-service'"))[0])
    .toEqual({ name: 'Artist', email: 'artist@example.com' });
  expect((await database.query("SELECT stripe_customer_id,booking_invoice_id FROM audio_payments WHERE request_id='balance-due-service'"))[0])
    .toEqual({ stripe_customer_id: 'cus_balance_due', booking_invoice_id: 'in_booking' });
});
