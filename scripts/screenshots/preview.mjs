#!/usr/bin/env node
// Writes the local preview config from wrangler.jsonc (see previewWrangler in config.mjs) and
// applies every D1 migration to local storage. No production identifiers or credentials.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseJsonc, previewWrangler } from './config.mjs';

export const previewConfig = resolve('.screenshots/wrangler.json');

const preview = previewWrangler(parseJsonc(await readFile('wrangler.jsonc', 'utf8')));
// The preview config lives in .screenshots/, and wrangler resolves paths against the config file.
for (const database of preview.d1_databases) if (database.migrations_dir) database.migrations_dir = resolve(database.migrations_dir);

await rm('.wrangler/state', { recursive: true, force: true });
await mkdir('.screenshots', { recursive: true });
await writeFile(previewConfig, JSON.stringify(preview, null, 2));
for (const database of preview.d1_databases.filter(item => item.migrations_dir)) {
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', database.binding,
    '--local', '--config', previewConfig, '--persist-to', resolve('.wrangler/state')], { encoding: 'utf8', env: { ...process.env, CI: '1' } });
  if (result.status !== 0) throw new Error(`Could not apply local migrations for ${database.binding}:\n${result.stderr || result.stdout}`);
}
console.log(`Preview ready. Start with MUSIC_PREVIEW_CONFIG=${previewConfig} npx astro dev --port 4321`);
