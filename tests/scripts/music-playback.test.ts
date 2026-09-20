import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPlaybackTracker } from '~/scripts/music-playback';

it('counts actual playback across media while seeking adds no listening time', async () => {
  let clock = 0;
  const events: Record<string, unknown>[] = [];
  const tracker = createPlaybackTracker({
    releaseId: 'old-news-single', recordingId: 'old-news-recording',
    sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450',
    now: () => clock, submit: async event => { events.push(event); },
  });
  tracker.reset(0);
  clock = 12_000; tracker.sample(12, true, 1, 100, 'audio');
  tracker.reset(80);
  clock = 13_000; tracker.sample(81, true, 1, 100, 'video');
  clock = 30_000; tracker.sample(98, true, 1, 100, 'video');
  await tracker.flush();
  expect(events.map(event => event.event)).toEqual(['start', 'progress', 'progress', 'progress', 'listen30']);
  expect(events.filter(event => event.event === 'progress').map(event => event.accumulatedSeconds)).toEqual([10, 20, 30]);
  expect(events.at(-1)).toMatchObject({ accumulatedSeconds: 30, medium: 'video' });
  expect(events.every((event, index) => event.sequence === index + 1)).toBe(true);
});

it('reports completion after genuine playback and starts a replay as a new playthrough', async () => {
  let clock = 0;
  const events: Record<string, unknown>[] = [];
  const tracker = createPlaybackTracker({
    releaseId: 'old-news-single', recordingId: 'old-news-recording',
    sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450',
    now: () => clock, submit: async event => { events.push(event); },
  });
  tracker.reset(0);
  clock = 91_000; tracker.sample(91, true, 1, 100, 'audio');
  await tracker.flush();
  const firstPlaythrough = events[0].playthroughId;
  expect(events.some(event => event.event === 'complete')).toBe(true);
  tracker.restart(0);
  clock = 92_000; tracker.sample(1, true, 1, 100, 'audio');
  await tracker.flush();
  expect(events.at(-1)).toMatchObject({ event: 'replay', sequence: 1, accumulatedSeconds: 0 });
  expect(events.at(-1)?.playthroughId).not.toBe(firstPlaythrough);
});

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
