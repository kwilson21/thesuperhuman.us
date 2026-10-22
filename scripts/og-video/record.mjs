#!/usr/bin/env node
// Brings docs/asset-reviews/link-previews.md up to date with src/data/og-media.json: rewrites the
// JSON file list (path, SHA-256, size) that npm run assets:check reads, and optionally adds a note
// to the record's header list.
//
//   node scripts/og-video/record.mjs
//   node scripts/og-video/record.mjs --note "CI render in PR #212 ..."
//   node scripts/og-video/record.mjs --root pr      update another checkout (the publish workflow)
//
// Node built-ins only. Every poster and video is 1200 × 630; render.mjs enforces it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEIGHT, WIDTH } from './fingerprint.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function withFiles(record, manifest, read) {
  const entries = Object.values(manifest);
  const paths = [...entries.map(entry => `public${entry.image}`).sort(), ...entries.map(entry => `public${entry.video.replace('/og/', '/og/raw/')}`).sort()];
  const rows = paths.map(path => {
    const bytes = read(path);
    return `    {"path": "${path}", "sha256": "${createHash('sha256').update(bytes).digest('hex')}", "width": ${WIDTH}, "height": ${HEIGHT}, "bytes": ${bytes.length}}`;
  });
  const start = record.indexOf('```json\n');
  const end = record.indexOf('\n```', start);
  const list = record.indexOf('"files": [', start);
  if (start < 0 || end < 0 || list < 0 || list > end) throw new Error('The record has no JSON file list.');
  return `${record.slice(0, list)}"files": [\n${rows.join(',\n')}\n  ]\n}${record.slice(end)}`;
}

// The header is the bullet list before the first scene section.
export function withNote(record, note) {
  if (/[\r\n]/.test(note) || !note.trim()) throw new Error('A note is one non-empty line.');
  const at = record.indexOf('\n\n## ');
  if (at < 0) throw new Error('The record has no scene sections.');
  return `${record.slice(0, at)}\n- ${note.trim()}${record.slice(at)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] ?? '' : undefined; };
  const ROOT = option('--root') ?? HERE;
  const RECORD = join(ROOT, 'docs/asset-reviews/link-previews.md');
  const note = option('--note');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'src/data/og-media.json'), 'utf8'));
  let record = withFiles(readFileSync(RECORD, 'utf8'), manifest, path => readFileSync(join(ROOT, path)));
  if (note !== undefined) record = withNote(record, note);
  writeFileSync(RECORD, record);
}
