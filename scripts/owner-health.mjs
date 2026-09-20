#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMusicDatabase } from './music-analytics.mjs';
import { renderMusicReport } from './music-report-view.mjs';

const requiredConfiguration = ['MUSIC_DB', 'AUDIO', 'OWNER_ACCESS_TEAM_DOMAIN', 'OWNER_ACCESS_AUD', 'OWNER_EMAIL'];
const requiredSchema = ['owner_campaigns', 'owner_requests', 'owner_request_audit', 'music_playback_events', 'music_playback_daily', 'music_playback_geography_daily', 'owner_retention_runs', 'audio_payments', 'stripe_webhook_events', 'stripe_invoice_attempts', 'stripe_unmatched_events'];
const attention = (id, summary, next) => ({ id, status: 'attention', summary, next });
const pass = (id, summary) => ({ id, status: 'pass', summary, next: '' });

export function wranglerSecretListArguments() {
  return ['node_modules/wrangler/bin/wrangler.js', 'secret', 'list', '--format', 'json'];
}

export async function ownerHealth({ now = new Date(), configuredNames, query, media, head }) {
  const checks = [];
  const missingConfiguration = requiredConfiguration.filter(name => !configuredNames.has(name));
  checks.push(missingConfiguration.length
    ? attention('configuration', `Missing ${missingConfiguration.length} required configuration name${missingConfiguration.length === 1 ? '' : 's'}.`, 'Configure the named owner access or storage setting, then run health again.')
    : pass('configuration', 'Required owner access and storage configuration names are present.'));

  let availableSchema = new Set();
  try {
    availableSchema = new Set((await query(`SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name`)).map(row => row.name));
  } catch {
    checks.push(attention('schema', 'The music database schema could not be read.', 'Confirm the MUSIC_DB binding and migration state.'));
  }
  if (availableSchema.size) {
    const missing = requiredSchema.filter(name => !availableSchema.has(name));
    checks.push(missing.length
      ? attention('schema', `${missing.length} required owner data object${missing.length === 1 ? ' is' : 's are'} missing.`, 'Reconcile the database migration ledger before applying any migration.')
      : pass('schema', 'Required owner data objects are present.'));
  }

  let mediaFailures = 0;
  for (const asset of media) {
    try {
      const result = await head(asset.url);
      if (!result.ok || !result.contentType.startsWith(asset.type)) mediaFailures += 1;
    } catch { mediaFailures += 1; }
  }
  checks.push(mediaFailures
    ? attention('release-media', `${mediaFailures} of ${media.length} public Old News media checks failed.`, 'Keep the release hidden and verify its private bucket objects and streaming routes.')
    : pass('release-media', `All ${media.length} public Old News media checks passed.`));

  try {
    const rows = await query("SELECT COUNT(*) AS total FROM owner_requests WHERE status='new'");
    if (rows.length !== 1 || !Number.isFinite(Number(rows[0].total))) throw new Error('invalid summary');
    checks.push(pass('request-storage', 'The bounded owner request summary query passed.'));
  } catch {
    checks.push(attention('request-storage', 'The owner request summary could not be read.', 'Check MUSIC_DB availability and the owner_requests schema.'));
  }

  try {
    const rows = await query('SELECT COUNT(*) AS total FROM stripe_unmatched_events');
    const total = Number(rows[0]?.total);
    if (!Number.isFinite(total)) throw new Error('invalid summary');
    checks.push(total > 0
      ? attention('stripe-unmatched', `${total} Stripe invoice event${total === 1 ? '' : 's'} need reconciliation.`, 'Compare the request and invoice in Stripe before creating or releasing files.')
      : pass('stripe-unmatched', 'No unmatched Stripe invoice events are waiting.'));
  } catch {
    checks.push(attention('stripe-unmatched', 'Unmatched Stripe invoice events could not be read.', 'Confirm the payment migration and database availability.'));
  }

  try {
    const rows = await query('SELECT completed_at FROM owner_retention_runs ORDER BY completed_at DESC LIMIT 1');
    const completed = rows[0]?.completed_at ? Date.parse(String(rows[0].completed_at)) : Number.NaN;
    const ageDays = (now.getTime() - completed) / 86400000;
    checks.push(Number.isFinite(completed) && ageDays >= 0 && ageDays <= 100
      ? pass('retention', `Retention completed ${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? '' : 's'} ago.`)
      : attention('retention', 'No successful retention run was recorded in the last 100 days.', 'Preview retention, preserve important aggregate observations, then apply the exact reviewed manifest.'));
  } catch {
    checks.push(attention('retention', 'Retention history could not be read.', 'Confirm the retention migration and run the preview again.'));
  }

  return { status: checks.every(check => check.status === 'pass') ? 'healthy' : 'attention', checkedAt: now.toISOString(), checks };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--remote')) throw new Error('Usage: node scripts/owner-health.mjs [--remote]');
  const remote = args.includes('--remote');
  const recording = JSON.parse(await readFile(new URL('../src/content/recordings/old-news-recording.json', import.meta.url), 'utf8'));
  const baseUrl = process.env.OWNER_HEALTH_BASE_URL || 'https://thesuperhuman.us';
  const configuredNames = new Set(['MUSIC_DB', 'AUDIO', ...requiredConfiguration.filter(name => process.env[name])]);
  if (remote) {
    const secretList = spawnSync(process.execPath, wranglerSecretListArguments(), {
      encoding: 'utf8',
      env: { ...process.env, WRANGLER_LOG_PATH: resolve('.private/wrangler-owner-health.log') },
    });
    if (secretList.status === 0) {
      for (const secret of JSON.parse(secretList.stdout)) if (typeof secret.name === 'string') configuredNames.add(secret.name);
    }
  }
  const media = Object.entries(recording.versions).map(([version, asset]) => ({
    label: `Old News ${version}`,
    url: `${baseUrl}/music/file/${recording.id}/${version}`,
    type: asset.type.split('/')[0],
  }));
  const database = await openMusicDatabase(remote);
  try {
    const report = await ownerHealth({
      configuredNames,
      query: sql => database.query(sql),
      media,
      head: async url => {
        const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(10_000) });
        await response.body?.cancel();
        return { ok: response.ok, status: response.status, contentType: response.headers.get('content-type') ?? '' };
      },
    });
    await mkdir('.private', { recursive: true });
    await writeFile('.private/owner-health.json', JSON.stringify(report, null, 2), { mode: 0o600 });
    await writeFile('.private/owner-health.html', renderMusicReport('Owner center health', `${remote ? 'Production' : 'Local test data'} · ${report.checkedAt}`, report.status === 'healthy' ? 'All owner center health checks passed.' : 'One or more checks need attention before deployment.', { Checks: report.checks }), { mode: 0o600 });
    for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.summary}${check.next ? ` Next: ${check.next}` : ''}`);
    if (report.status !== 'healthy') process.exitCode = 1;
  } finally { await database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error('Owner health could not complete. Check local authentication and bindings.');
  process.exitCode = 1;
});
