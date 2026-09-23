import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
    expect(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8')).toBe(`${baseline.trim()}\n${retention.trim()}\n${payments.trim()}\n${reconciliation.trim()}\n${projects.trim()}\n${clientAccess.trim()}\n${messages.trim()}\n${updates.trim()}\n${invitations.trim()}\n${files.trim()}\n${uploads.trim()}\n${publication.trim()}\n${revocation.trim()}\n${studioRetention.trim()}\n${declined.trim()}\n`);
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
