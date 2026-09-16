#!/usr/bin/env node
// Isolated local bindings. No production resource identifiers or credentials.
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';
const configPath = resolve('.private/wrangler-music-preview.json');
await mkdir('.private/music-assets', { recursive: true });
await writeFile(configPath, JSON.stringify({
  name: 'music-local-preview', compatibility_date: '2026-05-14', compatibility_flags: ['nodejs_compat'],
  vars: { PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' },
  d1_databases: [{ binding: 'MUSIC_DB', database_name: 'music-local-preview', database_id: '00000000-0000-0000-0000-000000000001' }],
  kv_namespaces: [{ binding: 'RATE_LIMIT', id: 'local-rate-limit' }, { binding: 'SESSION', id: 'local-session' }],
  r2_buckets: [{ binding: 'AUDIO', bucket_name: 'superhuman-audio' }],
}, null, 2));
const proxy = await getPlatformProxy({ configPath, persist: { path: '.wrangler/state/v3' } });
try {
  const sql = await readFile('db/music.sql', 'utf8');
  for (const statement of sql.replace(/^--.*$/gm, '').split(';').filter(s => s.trim())) await proxy.env.MUSIC_DB.prepare(statement).run();
  const files = (await readdir('.private/music-assets')).filter(f => f.endsWith('-upload.json'));
  for (const file of files) {
    const media = JSON.parse(await readFile(`.private/music-assets/${file}`, 'utf8'));
    for (const { key, file: path } of media) {
      if (!(await proxy.env.AUDIO.head(key))) {
        await proxy.env.AUDIO.put(key, new Uint8Array(await readFile(path)).buffer, { httpMetadata: { contentType: key.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg' } });
        console.log(`Staged locally: ${key}`);
      }
    }
  }
} finally { await proxy.dispose(); }
console.log('Local preview ready. Start with MUSIC_PREVIEW_CONFIG=.private/wrangler-music-preview.json npm run dev');
