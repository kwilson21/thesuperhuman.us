#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateCatalog, recordingSchema, releaseSchema, exampleSchema } from '../src/lib/music-catalog.ts';

const [input, ...flags] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/prepare-music.mjs <package.json> [--replace] (Node 24+)');
const config = JSON.parse(await readFile(input, 'utf8'));
const base = dirname(resolve(input));
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const prepared = [];
const copies = [];
for (const item of (config.recordings ?? [])) {
  const { sources, lyricsFile, ...recording } = item;
  recording.versions = {};
  for (const [version, source] of Object.entries(sources)) {
    if (!['master', 'mix', 'unmixed', 'video'].includes(version)) throw new Error('Unknown media version');
    const path = resolve(base, source);
    const bytes = await readFile(path);
    const extension = version === 'video' ? 'mp4' : 'mp3';
    if (!path.toLowerCase().endsWith(`.${extension}`)) throw new Error(`Expected ${extension}: ${path}`);
    const key = `music/${recording.id}/${version}-${hash(bytes)}.${extension}`;
    recording.versions[version] = { key, type: version === 'video' ? 'video/mp4' : 'audio/mpeg' };
    copies.push({ source: path, key });
  }
  if (lyricsFile) recording.lyrics = await readFile(resolve(base, lyricsFile), 'utf8');
  prepared.push(recording);
}
const cover = await sharp(resolve(base, config.artworkFile)).resize({ width: 1254, withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
const artwork = `/music/${config.release.id}-${hash(cover)}.webp`;
const addition = { recordings: prepared.map(row => recordingSchema.parse(row)), releases: [releaseSchema.parse({ ...config.release, artwork })], examples: (config.examples ?? []).map(row => exampleSchema.parse(row)) };
// Resolve shared references against existing content, including earlier singles used by albums.
const folders = { recordings: 'recordings', releases: 'releases', examples: 'audio-examples' };
const merged = {};
for (const [kind, folder] of Object.entries(folders)) {
  const dir = join('src/content', folder); await mkdir(dir, { recursive: true });
  const existing = await Promise.all((await readdir(dir)).filter(f => f.endsWith('.json')).map(async f => JSON.parse(await readFile(join(dir, f), 'utf8'))));
  for (const row of addition[kind]) if (existing.some(e => e.id === row.id) && !flags.includes('--replace')) throw new Error(`Existing ${row.id}; use --replace for an intentional update`);
  merged[kind] = [...existing.filter(e => !addition[kind].some(row => row.id === e.id)), ...addition[kind]];
}
validateCatalog(merged);
// Validate everything before writing any public content or staged media.
for (const { source, key } of copies) {
  const target = join('.private/music-assets', key); await mkdir(dirname(target), { recursive: true }); await copyFile(source, target);
}
await mkdir('public/music', { recursive: true }); await writeFile(`public${artwork}`, cover);
for (const [kind, folder] of Object.entries(folders)) for (const row of addition[kind]) await writeFile(join('src/content', folder, `${row.id}.json`), JSON.stringify(row, null, 2) + '\n');
await mkdir('.private/music-assets', { recursive: true });
await writeFile(`.private/music-assets/${config.release.id}-upload.json`, JSON.stringify(copies.map(({ key }) => ({ key, file: join('.private/music-assets', key) })), null, 2));
console.log(`Prepared ${config.release.slug}. Original files unchanged. No uploads performed.`);
