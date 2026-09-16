import { expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitMusicFiles, recoverMusicFiles } from '../../scripts/music-transaction.mjs';

it('rolls back replacements and new files when a later rename fails', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'music-transaction-'));
  try {
    await fs.writeFile(join(root, 'recording.json'), 'original');
    let writes = 0;
    await expect(commitMusicFiles([
      { target: 'recording.json', bytes: 'replacement' },
      { target: 'new.json', bytes: 'new' },
      { target: 'release.json', bytes: 'release' },
    ], root, { ...fs, rename: async (source, target) => {
      if (String(source).endsWith('.staged') && ++writes === 3) throw new Error('simulated disk failure');
      return fs.rename(source, target);
    } })).rejects.toThrow('simulated disk failure');
    expect(await fs.readFile(join(root, 'recording.json'), 'utf8')).toBe('original');
    await expect(fs.stat(join(root, 'new.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await recoverMusicFiles(root);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('recovers an interrupted commit before another preparation reads the catalog', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'music-interrupted-'));
  try {
    await fs.writeFile(join(root, 'recording.json'), 'original');
    const helper = resolve('scripts/music-transaction.mjs');
    const source = `import * as fs from 'node:fs/promises';
      import { commitMusicFiles } from ${JSON.stringify(helper)};
      let writes = 0;
      await commitMusicFiles([{target:'recording.json',bytes:'changed'}, {target:'new.json',bytes:'new'}], ${JSON.stringify(root)},
        {...fs, rename: async (source, target) => {
          if (String(source).endsWith('.staged') && ++writes === 2) process.exit(77);
          return fs.rename(source, target);
        }});`;
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', source], { stdio: 'pipe' })).toThrow();
    expect(await fs.readFile(join(root, 'recording.json'), 'utf8')).toBe('changed');
    await recoverMusicFiles(root);
    expect(await fs.readFile(join(root, 'recording.json'), 'utf8')).toBe('original');
    await expect(fs.stat(join(root, 'new.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await commitMusicFiles([{ target: 'recording.json', bytes: 'finished' }], root);
    expect(await fs.readFile(join(root, 'recording.json'), 'utf8')).toBe('finished');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('leaves the package untouched if staging fails and permits a later retry', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'music-staging-'));
  try {
    await fs.writeFile(join(root, 'recording.json'), 'original');
    await expect(commitMusicFiles([{ target: 'recording.json', bytes: 'changed' }], root, {
      ...fs, writeFile: async (path, ...args) => {
        if (String(path).endsWith('.staged')) throw new Error('staging disk full');
        return fs.writeFile(path, ...args);
      },
    })).rejects.toThrow('staging disk full');
    expect(await fs.readFile(join(root, 'recording.json'), 'utf8')).toBe('original');
    await commitMusicFiles([{ target: 'recording.json', bytes: 'finished' }], root);
    expect(await fs.readFile(join(root, 'recording.json'), 'utf8')).toBe('finished');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('refuses to recover a transaction owned by a running process', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'music-owner-'));
  try {
    const dir = join(root, '.private/music-prepare-transaction');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid }));
    await expect(recoverMusicFiles(root)).rejects.toThrow('still running');
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
