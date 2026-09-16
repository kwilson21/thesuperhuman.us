import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

it('retries loading the YouTube API after a temporary script failure', async () => {
  // Exercise the real loader without loading a third-party script in the test runner.
  const source = readFileSync('src/scripts/music-playback.ts', 'utf8');
  const compiled = ts.transpileModule(`${source}\nexports.loadYoutube = youtubeAPI;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scripts: Array<{ onerror?: (error: Error) => void; remove(): void }> = [];
  const window: { YT?: { Player: () => void }; onYouTubeIframeAPIReady?: () => void; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = {
    setTimeout, clearTimeout,
  };
  const exports = {} as { loadYoutube: () => Promise<unknown> };
  runInNewContext(compiled, {
    exports, window, setTimeout, clearTimeout,
    require: () => ({ setupAudioControls() {} }),
    document: {
      createElement: () => ({ remove() {} }),
      head: { appendChild: (script: typeof scripts[number]) => scripts.push(script) },
    },
  });

  const first = exports.loadYoutube();
  const rejection = expect(first).rejects.toThrow();
  scripts[0].onerror!(new Error('Temporary network failure'));
  await rejection;

  const retry = exports.loadYoutube();
  // Consume a stale rejection too, so regression failures have no unhandled promise.
  void retry.catch(() => {});
  expect(scripts).toHaveLength(2);
  const api = { Player() {} };
  window.YT = api;
  window.onYouTubeIframeAPIReady!();
  await expect(retry).resolves.toBe(api);
});
