import { expect, it } from 'vitest';
import * as ownerHealthModule from '../../scripts/owner-health.mjs';

const { ownerHealth } = ownerHealthModule;

const requiredSchema = [
  'owner_campaigns', 'owner_requests', 'owner_request_audit',
  'music_playback_events', 'music_playback_daily', 'music_playback_geography_daily', 'owner_retention_runs',
  'audio_payments', 'stripe_webhook_events', 'stripe_invoice_attempts', 'stripe_unmatched_events',
];

function healthyFixture() {
  return {
    now: new Date('2026-09-19T12:00:00Z'),
    configuredNames: new Set(['MUSIC_DB', 'AUDIO', 'OWNER_ACCESS_TEAM_DOMAIN', 'OWNER_ACCESS_AUD', 'OWNER_EMAIL']),
    query: async (sql: string) => {
      if (sql.includes('sqlite_master')) return requiredSchema.map(name => ({ name }));
      if (sql.includes('owner_retention_runs')) return [{ completed_at: '2026-09-18T12:00:00Z' }];
      if (sql.includes('stripe_unmatched_events')) return [{ total: 0 }];
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

it('requires attention when a Stripe invoice event needs reconciliation', async () => {
  const fixture = healthyFixture();
  const baseQuery = fixture.query;
  fixture.query = async (sql: string) => sql.includes('stripe_unmatched_events') ? [{ total: 1 }] : baseQuery(sql);
  const report = await ownerHealth(fixture);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'stripe-unmatched', status: 'attention' }));
});
