#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const [manifest, ...flags] = process.argv.slice(2);
if (!manifest) throw new Error('Usage: node scripts/upload-music.mjs <upload.json> [--remote]');
const assets = JSON.parse(await readFile(manifest,'utf8'));
for (const { key, file } of assets) {
  if (!/^music\/[a-z0-9-]+\/[a-z0-9-]+\.(mp3|mp4)$/.test(key)) throw new Error('Invalid object key');
  if (!flags.includes('--remote')) { console.log(`Prepared upload: ${key}`); continue; }
  const result = spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','put',`superhuman-audio/${key}`,'--file',file,'--content-type',key.endsWith('.mp4')?'video/mp4':'audio/mpeg','--remote'],{stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!flags.includes('--remote')) console.log('Dry run only. Use --remote after publication review.');
