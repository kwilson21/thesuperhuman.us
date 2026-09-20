import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { dispose, spawnSync } = vi.hoisted(() => ({
  dispose: vi.fn(),
  spawnSync: vi.fn((..._args: unknown[]) => ({ status: 0, stdout: '', stderr: '' })),
}));
vi.mock('node:child_process', () => ({ spawnSync }));
vi.mock('wrangler', () => ({ getPlatformProxy: async () => ({
  env: { MUSIC_DB: { prepare: () => ({ first: async () => ({ name: 'owner_requests' }) }) }, AUDIO: {} }, dispose,
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
    expect(spawnSync).toHaveBeenCalledOnce();
    const args = spawnSync.mock.calls[0]?.[1] as string[];
    expect(args.slice(1, 6)).toEqual(['d1', 'migrations', 'apply', 'MUSIC_DB', '--local']);
    expect(args[args.indexOf('--persist-to') + 1]).toMatch(/\/\.wrangler\/state$/);
    expect(dispose).toHaveBeenCalledOnce();
  } finally { process.chdir(cwd); await rm(root, { recursive: true, force: true }); }
});
