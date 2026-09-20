import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { dispose, run } = vi.hoisted(() => ({ dispose: vi.fn(), run: vi.fn() }));
vi.mock('wrangler', () => ({ getPlatformProxy: async () => ({
  env: { MUSIC_DB: { prepare: () => ({ run }) }, AUDIO: {} }, dispose,
}) }));
it('sets up an empty checkout without any imported music assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-preview-'));
  const cwd = process.cwd();
  try {
    await mkdir(join(root, 'db'));
    await writeFile(join(root, 'db/music.sql'), 'CREATE TABLE demo (id TEXT);');
    process.chdir(root);
    await import('../../scripts/music-preview.mjs');
    expect((await stat(join(root, '.private/music-assets'))).isDirectory()).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  } finally { process.chdir(cwd); await rm(root, { recursive: true, force: true }); }
});
