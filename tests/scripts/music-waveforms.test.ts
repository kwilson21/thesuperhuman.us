import { expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
it('measures each aligned playback window for both waveform and loudness', async () => {
  const argv = process.argv;
  process.argv = ['node', 'music-waveforms.mjs', 'demo'];
  vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ recordingId: 'song', before: 'mix', after: 'master', alignment: { before: 4, after: 2 } }))
    .mockResolvedValueOnce(JSON.stringify({ duration: 12, versions: { mix: { key: 'mix.mp3' }, master: { key: 'master.mp3' } } }));
  vi.mocked(spawnSync).mockImplementation((_command, args) => ({
    status: 0, stdout: Buffer.alloc(640), stderr: Buffer.from(args?.includes('null') ? '{"input_i":"-18"}' : ''),
  }) as ReturnType<typeof spawnSync>);
  try {
    await import('../../scripts/music-waveforms.mjs');
    const calls = vi.mocked(spawnSync).mock.calls;
    expect(calls).toHaveLength(4);
    for (const [index, offset] of [4, 2].entries()) {
      for (const call of calls.slice(index * 2, index * 2 + 2)) {
        const args = call[1] as string[];
        expect(args[args.indexOf('-ss') + 1]).toBe(String(offset));
        expect(args[args.indexOf('-t') + 1]).toBe('12');
        expect(args[args.indexOf('-af') + 1]).toContain('atrim=duration=12');
      }
    }
    const output = JSON.parse(String(vi.mocked(writeFile).mock.calls[0][1]));
    expect(output.loudness).toEqual({ before: -18, after: -18 });
  } finally { process.argv = argv; }
});
