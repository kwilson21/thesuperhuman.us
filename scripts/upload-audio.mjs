#!/usr/bin/env node
import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [, , filePath] = process.argv;
if (!filePath) {
  console.error('Usage: npm run audio:upload <path/to/track.mp3>');
  process.exit(1);
}
if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}
const file = basename(filePath);
if (!/^[a-z0-9-]+\.mp3$/.test(file)) {
  console.error(`File name must be lowercase-with-dashes and end in .mp3 (got "${file}").`);
  process.exit(1);
}
const key = `tracks/${file}`;

console.log(`Uploading ${filePath} -> R2 (superhuman-audio): ${key}`);
const r = spawnSync(
  'npx',
  ['wrangler', 'r2', 'object', 'put', `superhuman-audio/${key}`, '--file', filePath, '--content-type', 'audio/mpeg', '--remote'],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
