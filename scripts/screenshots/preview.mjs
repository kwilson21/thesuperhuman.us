#!/usr/bin/env node
// Local-only bindings for screenshots. No production identifiers or credentials.
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ACCESS_AUDIENCE, ACCESS_ISSUER, OWNER_EMAIL } from './config.mjs';

export const previewConfig = resolve('.screenshots/wrangler.json');

await rm('.wrangler/state', { recursive: true, force: true });
await mkdir('.screenshots', { recursive: true });
await writeFile(previewConfig, JSON.stringify({
  name: 'screenshots-preview', compatibility_date: '2026-05-14', compatibility_flags: ['nodejs_compat'],
  vars: {
    PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    OWNER_ACCESS_TEAM_DOMAIN: ACCESS_ISSUER, OWNER_ACCESS_AUD: ACCESS_AUDIENCE, OWNER_EMAIL,
    STRIPE_PAYMENTS_ENABLED: 'false', AUDIO_CLIENT_PORTAL_ENABLED: 'true',
    AUDIO_CLIENT_CODE_KEY: 'screenshots-only-code-key-0123456789abcdef',
  },
  d1_databases: [{ binding: 'MUSIC_DB', database_name: 'screenshots', database_id: '00000000-0000-0000-0000-00000000005c', migrations_dir: resolve('migrations/music') }],
  kv_namespaces: [{ binding: 'RATE_LIMIT', id: 'screenshots-rate-limit' }, { binding: 'SESSION', id: 'screenshots-session' }],
  r2_buckets: [{ binding: 'AUDIO', bucket_name: 'superhuman-audio' }],
}, null, 2));
const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'MUSIC_DB',
  '--local', '--config', previewConfig, '--persist-to', resolve('.wrangler/state')], { encoding: 'utf8', env: { ...process.env, CI: '1' } });
if (result.status !== 0) throw new Error(`Could not apply local migrations:\n${result.stderr || result.stdout}`);
console.log(`Preview ready. Start with MUSIC_PREVIEW_CONFIG=${previewConfig} npx astro dev --port 4321`);
