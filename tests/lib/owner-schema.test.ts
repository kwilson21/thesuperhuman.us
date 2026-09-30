import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

function apply(path: string) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return db;
}

function tableNames(db: InstanceType<typeof DatabaseSync>) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map((row: { name: string }) => row.name);
}

describe('owner insights schema', () => {
  it('rebuilds populated requests without breaking children or audio triggers', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    const migrations = readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations.filter(name => name < '0019'))
      db.exec(readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url), 'utf8'));
    db.exec(`INSERT INTO owner_campaigns(id,subject_type,subject_id,name,primary_goal,starts_at,status,created_at,updated_at)
      VALUES ('campaign','release','release','Name','Goal','2026-01-01','active','now','now');
      INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,created_at,updated_at)
      VALUES ('audio','service','vocal-mix','Artist','artist@example.com','Song','{"note":"keep"}','new','now','now');
      INSERT INTO owner_requests(id,kind,campaign_id,name,email,summary,status,created_at,updated_at)
      VALUES ('purchase','purchase','campaign','Fan','fan@example.com','Purchase','new','now','now');
      INSERT INTO owner_request_audit(request_id,action,actor,occurred_at) VALUES ('purchase','created','system','now');
      INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,offer_accepted_at,created_at,updated_at)
      VALUES ('audio','Mix',10000,5000,5000,'now','now','now');
      INSERT INTO stripe_invoice_attempts(invoice_id,request_id,installment,created_at) VALUES ('invoice','audio','booking','now');`);
    db.exec('BEGIN');
    db.exec(readFileSync(new URL('../../migrations/music/0019_software_requests.sql', import.meta.url), 'utf8'));
    db.exec('COMMIT');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(tableNames(db)).not.toContain('owner_requests_0019_stash');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='owner_requests'").all().map((row: { name: string }) => row.name)).toEqual(expect.arrayContaining(['owner_requests_status_date', 'owner_requests_submission_id']));
    expect(db.prepare("SELECT campaign_id,email FROM owner_requests WHERE id='purchase'").get()).toEqual({ campaign_id: 'campaign', email: 'fan@example.com' });
    expect(db.prepare("SELECT details_json FROM owner_requests WHERE id='audio'").get()).toEqual({ details_json: '{"note":"keep"}' });
    expect(db.prepare("SELECT request_id FROM audio_payments WHERE request_id='audio'").get()).toEqual({ request_id: 'audio' });
    expect(db.prepare("SELECT request_id FROM stripe_invoice_attempts WHERE invoice_id='invoice'").get()).toEqual({ request_id: 'audio' });
    db.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at,submission_id)
      VALUES ('software','software','client@example.com','Tool','new','now','now','submission');
      INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
      VALUES ('audio-two','service','artist@example.com','Song','new','now','now');`);
    expect(db.prepare("SELECT request_id FROM audio_projects WHERE request_id='software'").get()).toBeUndefined();
    expect(db.prepare("SELECT request_id FROM audio_projects WHERE request_id='audio-two'").get()).toEqual({ request_id: 'audio-two' });
    expect(() => db.exec("INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at,submission_id) VALUES ('duplicate','software','x','x','new','now','now','submission')")).toThrow();
    expect(() => db.exec("INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES ('unknown','wrong','x','x','new','now','now')")).toThrow();
    db.exec("UPDATE owner_requests SET name='',email='',city_region='',details_json='{}',private_note='',updated_at='later' WHERE id='purchase'");
    expect(db.prepare("SELECT action FROM owner_request_audit WHERE request_id='purchase' ORDER BY id DESC LIMIT 1").get()).toEqual({ action: 'personal-data-deleted' });
    db.exec("UPDATE owner_requests SET status='resolved',updated_at='later' WHERE id='audio'");
    expect(db.prepare("SELECT revoked_at FROM audio_projects WHERE request_id='audio'").get()).toEqual({ revoked_at: 'later' });
    expect(db.prepare("SELECT action FROM audio_project_audit WHERE request_id='audio' ORDER BY id DESC LIMIT 1").get()).toEqual({ action: 'revoked' });
    db.close();
  });
  it('rebuilds offer audit without losing rows, ids or the personal-delete trigger', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(name => name.endsWith('.sql') && name < '0020').sort())
      db.exec(readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url), 'utf8'));
    for (const [index, kind] of ['purchase','merchandise','service','software'].entries()) {
      db.prepare("INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES (?,?,'a@example.com','Keep','new','now','now')").run(String(index), kind);
      db.prepare("INSERT INTO owner_request_audit(id,request_id,action,actor,note,occurred_at) VALUES (?,?,'created','system','keep','now')").run(index * 5 + 2, String(index));
    }
    const requests = db.prepare('SELECT * FROM owner_requests ORDER BY id').all();
    const audit = db.prepare('SELECT * FROM owner_request_audit ORDER BY id').all();
    db.exec('BEGIN');
    db.exec(readFileSync(new URL('../../migrations/music/0020_software_offers.sql', import.meta.url), 'utf8'));
    db.exec('COMMIT');
    expect(db.prepare('SELECT * FROM owner_requests ORDER BY id').all()).toEqual(requests);
    expect(db.prepare('SELECT * FROM owner_request_audit ORDER BY id').all()).toEqual(audit);
    db.exec("UPDATE owner_requests SET email='',updated_at='later' WHERE id='0'");
    expect(db.prepare('SELECT id,action FROM owner_request_audit ORDER BY id DESC LIMIT 1').get()).toEqual({ id: 18, action: 'personal-data-deleted' });
    expect(() => db.exec("INSERT INTO owner_request_audit(request_id,action,actor,occurred_at) VALUES ('3','unknown','owner','now')")).toThrow();
    expect(() => db.exec("INSERT INTO software_fit_reviews VALUES ('3','unknown','','now','owner')")).toThrow();
    db.exec("INSERT INTO software_fit_reviews VALUES ('3','potential-fit','','now','owner')");
    const offer = db.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES (?,'3',?,?,'{}','now','now')");
    offer.run('draft',1,'draft'); offer.run('sent',2,'sent');
    expect(() => offer.run('draft-two',3,'draft')).toThrow();
    expect(() => offer.run('sent-two',3,'sent')).toThrow();
    expect(() => offer.run('unknown',3,'unknown')).toThrow();
    expect(() => offer.run('zero',0,'superseded')).toThrow();
    db.exec("INSERT INTO software_offer_links VALUES ('3','hash','now',NULL)");
    expect(() => db.exec("INSERT INTO software_offer_links VALUES ('2','hash','now',NULL)")).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
  it('adds declined-studio closure to a database that already applied 0013 and 0014', () => {
    const db = new DatabaseSync(':memory:');
    const migrations = readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations.filter(name => name < '0015'))
      db.exec(readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url), 'utf8'));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='audio_project_close_declined_request'").get()).toBeUndefined();
    db.exec(readFileSync(new URL('../../migrations/music/0015_audio_project_close_declined.sql', import.meta.url), 'utf8'));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='audio_project_close_declined_request'").get())
      .toEqual({ name: 'audio_project_close_declined_request' });
    db.close();
  });

  it('pins the Wrangler release that preserves numbered D1 migration order', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies?.wrangler).toBe('4.90.0');
  });

  it('keeps publication and music migrations in database-specific directories', () => {
    const config = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    expect(config).toMatch(/"binding": "MUSIC_DB"[\s\S]*?"migrations_dir": "migrations\/music"/);
    expect(config).toMatch(/"binding": "PUBLICATION_DB"[\s\S]*?"migrations_dir": "migrations\/publication"/);
    expect(readFileSync(new URL('../../migrations/publication/0001_publication_journal.sql', import.meta.url), 'utf8')).toContain('publication_events');
  });

  it('provides an idempotent music baseline plus separate owner domains', () => {
    const baseline = readFileSync(new URL('../../migrations/music/0001_music_schema.sql', import.meta.url), 'utf8');
    const retention = readFileSync(new URL('../../migrations/music/0002_owner_retention.sql', import.meta.url), 'utf8');
    const payments = readFileSync(new URL('../../migrations/music/0003_audio_payments.sql', import.meta.url), 'utf8');
    const reconciliation = readFileSync(new URL('../../migrations/music/0004_stripe_reconciliation.sql', import.meta.url), 'utf8');
    const projects = readFileSync(new URL('../../migrations/music/0005_audio_projects.sql', import.meta.url), 'utf8');
    const clientAccess = readFileSync(new URL('../../migrations/music/0006_audio_client_access.sql', import.meta.url), 'utf8');
    const messages = readFileSync(new URL('../../migrations/music/0007_audio_project_messages.sql', import.meta.url), 'utf8');
    const updates = readFileSync(new URL('../../migrations/music/0008_audio_project_updates.sql', import.meta.url), 'utf8');
    const invitations = readFileSync(new URL('../../migrations/music/0009_audio_project_invitations.sql', import.meta.url), 'utf8');
    const files = readFileSync(new URL('../../migrations/music/0010_audio_project_files.sql', import.meta.url), 'utf8');
    const uploads = readFileSync(new URL('../../migrations/music/0011_audio_project_uploads.sql', import.meta.url), 'utf8');
    const publication = readFileSync(new URL('../../migrations/music/0012_audio_project_publication.sql', import.meta.url), 'utf8');
    const revocation = readFileSync(new URL('../../migrations/music/0013_audio_project_revocation.sql', import.meta.url), 'utf8');
    const studioRetention = readFileSync(new URL('../../migrations/music/0014_audio_project_retention.sql', import.meta.url), 'utf8');
    const declined = readFileSync(new URL('../../migrations/music/0015_audio_project_close_declined.sql', import.meta.url), 'utf8');
    const peaks = readFileSync(new URL('../../migrations/music/0016_audio_project_file_peaks.sql', import.meta.url), 'utf8');
    const milestones = readFileSync(new URL('../../migrations/music/0017_audio_project_update_milestones.sql', import.meta.url), 'utf8');
    const decisions = readFileSync(new URL('../../migrations/music/0018_audio_project_review_decisions.sql', import.meta.url), 'utf8');
    const offers = readFileSync(new URL('../../migrations/music/0020_software_offers.sql', import.meta.url), 'utf8');
    const software = readFileSync(new URL('../../migrations/music/0019_software_requests.sql', import.meta.url), 'utf8');
    expect(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8')).toBe(`${baseline.trim()}\n${retention.trim()}\n${payments.trim()}\n${reconciliation.trim()}\n${projects.trim()}\n${clientAccess.trim()}\n${messages.trim()}\n${updates.trim()}\n${invitations.trim()}\n${files.trim()}\n${uploads.trim()}\n${publication.trim()}\n${revocation.trim()}\n${studioRetention.trim()}\n${declined.trim()}\n${peaks.trim()}\n${milestones.trim()}\n${decisions.trim()}\n${software.trim()}\n${offers.trim()}\n`);
    const db = apply('../../db/music.sql');
    const expected = [
      'music_event_daily', 'music_events', 'music_interest', 'music_playback_daily',
      'music_playback_events', 'music_playback_geography_daily', 'owner_campaign_tags',
      'owner_retention_runs', 'owner_campaigns', 'owner_request_audit', 'owner_requests',
      'audio_payments', 'stripe_webhook_events', 'stripe_invoice_attempts', 'stripe_unmatched_events',
      'audio_projects', 'audio_project_audit',
      'audio_client_codes', 'audio_client_sessions', 'audio_client_access_audit', 'audio_project_messages', 'audio_project_updates',
      'audio_project_files', 'audio_project_file_access', 'audio_project_uploads',
    ];
    expect(tableNames(db)).toEqual(expect.arrayContaining(expected));
    expect(() => db.exec(`${baseline}\n${retention}\n${payments}`)).not.toThrow();
    expect(() => db.prepare(`INSERT INTO owner_requests
      (id,kind,email,summary,status,created_at,updated_at)
      VALUES ('1','unknown','fan@example.com','Bad kind','new','now','now')`).run()).toThrow();
    db.prepare(`INSERT INTO owner_requests
      (id,kind,email,summary,status,created_at,updated_at)
      VALUES ('payment-request','service','artist@example.com','Mix','reviewed','now','now')`).run();
    expect(() => db.prepare(`INSERT INTO owner_request_audit
      (request_id,action,actor,note,occurred_at)
      VALUES ('payment-request','payment-approved','owner@example.com','USD 200.00','now')`).run()).not.toThrow();
  });
});
