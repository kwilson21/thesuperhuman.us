import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import * as ownerHealthModule from '../../scripts/owner-health.mjs';

const { ownerHealth } = ownerHealthModule;

const requiredSchema = [
  'owner_campaigns', 'owner_requests', 'owner_request_audit',
  'music_playback_events', 'music_playback_daily', 'music_playback_geography_daily', 'owner_retention_runs',
  'audio_payments', 'stripe_webhook_events', 'stripe_invoice_attempts', 'stripe_unmatched_events',
  'audio_projects', 'audio_client_codes', 'audio_client_sessions', 'audio_client_access_audit',
  'audio_project_messages', 'audio_project_updates', 'audio_project_files', 'audio_project_uploads',
  'owner_requests_audit_personal_delete', 'audio_project_after_service_request', 'audio_project_close_declined_request',
  'owner_requests_submission_id', 'software_fit_reviews', 'software_offers', 'software_offer_links', 'software_offers_one_draft', 'software_offers_one_sent',
  'software_projects', 'software_project_updates', 'software_project_updates_one_draft', 'software_project_updates_shared', 'software_project_messages', 'software_project_messages_request', 'software_project_messages_one_decision', 'software_project_audit', 'software_project_audit_request', 'software_milestone_payments', 'software_invoices', 'software_invoices_one_active', 'software_invoices_request', 'software_stripe_unmatched_events', 'software_milestone_deposits',
];

function healthyFixture() {
  return {
    now: new Date('2026-09-19T12:00:00Z'),
    configuredNames: new Set(['MUSIC_DB', 'AUDIO', 'OWNER_ACCESS_TEAM_DOMAIN', 'OWNER_ACCESS_AUD', 'OWNER_EMAIL']),
    query: async (sql: string) => {
      if (sql.includes('sqlite_master')) return requiredSchema.map(name => ({ name }));
      if (sql.includes('owner_retention_runs')) return [{ completed_at: '2026-09-18T12:00:00Z' }];
      if (sql.includes('stripe_unmatched_events')) return [{ total: 0 }];
      if (sql.includes('audio_client_codes')) return [{ total: 0 }];
      return [{ total: 2 }];
    },
    media: [
      { label: 'Old News master', url: 'https://example.test/music/file/old-news-recording/master', type: 'audio' },
      { label: 'Old News video', url: 'https://example.test/music/file/old-news-recording/video', type: 'video' },
    ],
    head: async (url: string) => ({ ok: true, status: 206, contentType: url.endsWith('/video') ? 'video/mp4' : 'audio/mpeg' }),
  };
}

it('uses the supported Wrangler JSON format option when listing secrets', () => {
  expect(ownerHealthModule.wranglerSecretListArguments()).toEqual([
    'node_modules/wrangler/bin/wrangler.js', 'secret', 'list', '--format', 'json',
  ]);
});

it('passes only when configuration, schema, media, reporting and retention are healthy', async () => {
  const report = await ownerHealth(healthyFixture());
  expect(report.status).toBe('healthy');
  expect(report.checks.every(check => check.status === 'pass')).toBe(true);
});

it('reports actionable safe failures without private data', async () => {
  const fixture = healthyFixture();
  fixture.configuredNames.delete('OWNER_EMAIL');
  fixture.query = async (sql: string) => {
    if (sql.includes('sqlite_master')) return requiredSchema.filter(name => name !== 'owner_requests').map(name => ({ name }));
    if (sql.includes('owner_retention_runs')) return [];
    throw new Error('fan@example.com database failure');
  };
  fixture.head = async () => ({ ok: false, status: 404, contentType: '' });
  const report = await ownerHealth(fixture);
  expect(report.status).toBe('attention');
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'request-storage', status: 'attention', next: expect.any(String) }));
  expect(JSON.stringify(report)).not.toContain('fan@example.com');
  expect(JSON.stringify(report)).not.toContain('OWNER_EMAIL=');
});

it('requires the payment projection and Stripe event ledger', async () => {
  const fixture = healthyFixture();
  fixture.query = async (sql: string) => {
    if (sql.includes('sqlite_master')) return requiredSchema.filter(name => name !== 'audio_payments').map(name => ({ name }));
    if (sql.includes('owner_retention_runs')) return [{ completed_at: '2026-09-18T12:00:00Z' }];
    return [{ total: 0 }];
  };
  const report = await ownerHealth(fixture);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'attention' }));
});

it('reports attention when the request audit trigger is missing', async () => {
  const fixture = healthyFixture();
  const baseQuery = fixture.query;
  fixture.query = async (sql: string) => sql.includes('sqlite_master')
    ? requiredSchema.filter(name => name !== 'owner_requests_audit_personal_delete').map(name => ({ name }))
    : baseQuery(sql);
  const report = await ownerHealth(fixture);
  expect(report.status).toBe('attention');
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'attention' }));
});

it('detects schemas through 0021 and passes only after 0022', async () => {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const migrations = readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations.filter(name => name < '0019')) db.exec(readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url), 'utf8'));
  const fixture = healthyFixture();
  const baseQuery = fixture.query;
  fixture.query = sql => sql.includes('sqlite_master') ? Promise.resolve(db.prepare(sql).all() as { name: string }[]) : baseQuery(sql);
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'attention' }));
  db.exec('BEGIN');
  db.exec(readFileSync(new URL('../../migrations/music/0019_software_requests.sql', import.meta.url), 'utf8'));
  db.exec('COMMIT');
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'attention' }));
  db.exec(readFileSync(new URL('../../migrations/music/0020_software_offers.sql', import.meta.url), 'utf8'));
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'attention' }));
  db.exec(readFileSync(new URL('../../migrations/music/0021_software_projects.sql', import.meta.url), 'utf8'));
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'attention' }));
  db.exec(readFileSync(new URL('../../migrations/music/0022_software_invoices.sql', import.meta.url), 'utf8'));
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({ id: 'schema', status: 'pass' }));
  db.close();
});

it('requires attention when a Stripe invoice event needs reconciliation', async () => {
  const fixture = healthyFixture();
  const baseQuery = fixture.query;
  fixture.query = async (sql: string) => sql.includes('stripe_unmatched_events') ? [{ total: 1 }] : baseQuery(sql);
  const report = await ownerHealth(fixture);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'stripe-unmatched', status: 'attention' }));
});

it('flags overdue studio cleanup without revealing client details', async () => {
  const fixture = healthyFixture();
  const baseQuery = fixture.query;
  fixture.query = async (sql: string) => sql.includes('audio_client_codes') ? [{ total: 3 }] : baseQuery(sql);
  const report = await ownerHealth(fixture);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'studio-retention', status: 'attention' }));
  expect(JSON.stringify(report)).not.toContain('example.com');
});

it('counts eligible software projects alongside audio retention items', async () => {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  const fixture = healthyFixture();
  const baseQuery = fixture.query;
  fixture.query = sql => sql.includes('audio_client_codes') ? Promise.resolve(db.prepare(sql).all()) : baseQuery(sql);
  for (const [id, completed, revoked, deleted] of [
    ['completed', '2025-09-01', null, null], ['revoked', null, '2025-09-01', null],
    ['recent', '2026-09-01', null, null], ['active', null, null, null], ['deleted', '2025-09-01', null, '2026-09-01'],
  ]) {
    db.prepare("INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES (?,'software','client@example.test','Tool','reviewed','now','now')").run(id);
    db.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,sent_at,sent_by) VALUES (?, ?, 1, 'sent', '{}', 'now', 'now', 'now', 'owner')").run(id, id);
    db.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,completed_at,revoked_at,content_deleted_at,created_at,updated_at) VALUES (?,?,'{}','standard','now','now','now','owner',?,?,?,'now','now')").run(id,id,completed,revoked,deleted);
  }
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({ id: 'studio-retention', status: 'attention', summary: '2 studio retention items need review.' }));
  db.exec("UPDATE software_projects SET content_deleted_at='now'");
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({ id: 'studio-retention', status: 'pass' }));
  db.close();
});

it('sums unresolved audio and software Stripe dead letters',async()=>{
  const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../db/music.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO stripe_unmatched_events(event_id,event_type,invoice_id,request_id,installment,status,occurred_at,received_at,reason) VALUES ('audio','invoice.paid','in_audio','audio','booking','paid','now','now','request-not-found');
    INSERT INTO software_stripe_unmatched_events VALUES ('software','invoice.paid','in_software','software','paid','now','now',NULL),('resolved','invoice.paid','in_old','old','paid','now','now','now');`);
  const fixture=healthyFixture(), base=fixture.query;
  fixture.query=sql=>sql.includes('stripe_unmatched_events') ? Promise.resolve(db.prepare(sql).all()) : base(sql);
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({id:'stripe-unmatched',status:'attention',summary:'2 Stripe invoice events need reconciliation.'}));
  db.exec('DELETE FROM stripe_unmatched_events');
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({id:'stripe-unmatched',status:'attention',summary:'1 Stripe invoice event need reconciliation.'}));db.close();
});
it.each(['creating','open','payment_failed','uncollectible'])('health reports %s software invoices blocking overdue retention',async status=>{
  const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../db/music.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES ('software','software','example@example.com','Tool','reviewed','now','now');
    INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES ('offer','software',1,'sent','{}','now','now');
    INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,completed_at,created_at,updated_at) VALUES ('software','offer','{}','standard','now','now','now','owner','2025-01-01','now','now');`);
  db.prepare(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES ('invoice','software','offer',0,'deposit',100,7,?,'owner','now','now')`).run(status);
  const fixture=healthyFixture(),base=fixture.query;
  fixture.query=sql=>sql.includes('audio_client_codes') ? Promise.resolve(db.prepare(sql).all()) : base(sql);
  expect((await ownerHealth(fixture)).checks).toContainEqual(expect.objectContaining({id:'studio-retention',status:'attention',summary:'1 software project awaiting invoice reconciliation before retention.'}));db.close();
});
