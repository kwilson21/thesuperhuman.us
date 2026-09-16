#!/usr/bin/env node
// Requires ffmpeg on PATH. Analyze staged exports; never modify audio sources.
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const [id] = process.argv.slice(2);
if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error('Usage: node scripts/music-waveforms.mjs <example-id>');
const path = `src/content/audio-examples/${id}.json`;
const example = JSON.parse(await readFile(path, 'utf8'));
const track = JSON.parse(await readFile(`src/content/recordings/${example.recordingId}.json`, 'utf8'));
const waveforms = {};
const loudness = {};
for (const side of ['before', 'after']) {
  const file = resolve('.private/music-assets', track.versions[example[side]].key);
  const window = ['-ss', String(example.alignment?.[side] ?? 0), '-i', file, '-t', String(track.duration)];
  // Trim before analysis filters: an output -t alone can let loudnorm analyze
  // buffered samples beyond the playback endpoint.
  const trim = `atrim=duration=${track.duration}`;
  const result = spawnSync('ffmpeg', ['-v', 'error', ...window, '-af', trim, '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || 'ffmpeg could not decode the export');
  const count = result.stdout.length / 4;
  const bins = Array.from({ length: 160 }, (_, index) => {
    let peak = 0;
    for (let i = Math.floor(index * count / 160); i < Math.floor((index + 1) * count / 160); i++) peak = Math.max(peak, Math.abs(result.stdout.readFloatLE(i * 4)));
    return peak;
  });
  const measured = spawnSync('ffmpeg', ['-hide_banner', ...window, '-af', `${trim},loudnorm=print_format=json`, '-f', 'null', '-'], { maxBuffer: 4 * 1024 * 1024 });
  const match = measured.stderr?.toString().match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (measured.status !== 0 || !match) throw new Error('Could not measure integrated loudness');
  loudness[side] = Number(JSON.parse(match[0]).input_i);
  if (!Number.isFinite(loudness[side])) throw new Error('No measurable signal');
  // Same full-scale reference for both exports; no independent normalization.
  waveforms[side] = bins.map(n => Math.round(Math.min(1, n) * 1000) / 1000);
}
await writeFile(path, JSON.stringify({ ...example, waveforms, loudness }, null, 2) + '\n');
console.log(`Saved source-derived waveforms for ${id}.`);
