import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

it('prepares an album using a previously imported recording and rejects duplicate routes before writing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'music-catalog-'));
  const script = resolve('scripts/prepare-music.mjs');
  try {
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toFile(join(dir, 'cover.png'));
    writeFileSync(join(dir, 'master.mp3'), 'ID3 test fixture');
    const recording = { id: 'song-recording', title: 'Same Name', artist: 'Artist', duration: 160, visibility: 'draft', credits: [], sources: { master: 'master.mp3' } };
    const release = { id: 'song-single', slug: 'same-name', title: 'Same Name', artist: 'Artist', type: 'single', status: 'preview', visibility: 'draft', tracks: ['song-recording'] };
    const run = (input: unknown) => { writeFileSync(join(dir, 'package.json'), JSON.stringify(input)); return execFileSync(process.execPath, [script, join(dir, 'package.json')], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }); };
    run({ artworkFile: 'cover.png', recordings: [recording], release });
    const original = readFileSync(join(dir, 'src/content/recordings/song-recording.json'), 'utf8');
    run({ artworkFile: 'cover.png', recordings: [], release: { ...release, id: 'song-album', slug: 'same-name-album', type: 'album' } });
    expect(readFileSync(join(dir, 'src/content/recordings/song-recording.json'), 'utf8')).toBe(original);
    expect(existsSync(join(dir, 'src/content/releases/song-album.json'))).toBe(true);
    expect(() => run({ artworkFile: 'cover.png', recordings: [], release: { ...release, id: 'collision' } })).toThrow();
    expect(existsSync(join(dir, 'src/content/releases/collision.json'))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
