import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const component = readFileSync(new URL('../../src/components/audio/ComparisonPlayer.astro', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../src/scripts/comparison-player.ts', import.meta.url), 'utf8');

it('keeps each comparison playhead within its waveform and reveals both markers', () => {
  expect(component).toContain('<div class="comparison-waveform-stage">');
  expect(component).toContain('<span class="comparison-playhead" aria-hidden="true" hidden></span>');
  expect(component).toContain('.comparison-waveform-stage{position:relative;margin-top:.4rem}');
  expect(script).toContain("root.querySelectorAll<HTMLElement>('.comparison-playhead').forEach(playhead => playhead.hidden = false);");
});

it('keeps the compact A/B selector from stretching across the mobile controls grid', () => {
  expect(component).toContain('.comparison-switch{display:flex;justify-self:start;width:max-content;');
});

it('supports a compact homepage variant while keeping the same synchronized, accessible player controls', () => {
  const home = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');

  expect(component).toContain("compact?: boolean");
  expect(component).toContain("comparison-player--compact");
  expect(component).toContain("aria-label={labels[0]}");
  expect(component).toContain("aria-label={labels[1]}");
  expect(home).toContain("example.id === 'old-news-mastering'");
  expect(home).toContain("<ComparisonPlayer example={oldNewsExample} recording={oldNewsRecording} compact />");
  expect(home).toContain("setupComparisonPlayers();");
  expect(home).not.toContain("Start your song");
  expect(home).toContain("<WorkWithMe />");
});

it('places compact playback beside the waveform and seeking on a separate track', () => {
  expect(component).toContain('data-compact-waveform');
  expect(component).toContain('data-waveform-before=');
  expect(component).toContain('data-waveform-after=');
  expect(component).toContain('data-compact-wave-line');
  expect(component).toContain('class="compact-waveform-seek"');
  expect(component).toContain('compact-waveform-play" data-comparison-play');
  expect(component).toContain('<div class="compact-waveform-stage">\n      <button class="round-play compact-waveform-play"');
  expect(component).toContain('<div class="compact-waveform-column">');
  expect(component).toContain('::-webkit-slider-runnable-track');
  expect(component).not.toContain('compact-waveform-progress');
  expect(component).not.toContain('compact-waveform-playhead');
  expect(component).toContain('.comparison-player--compact:not([data-initialized="true"]) .compact-waveform-stage,.comparison-player--compact:not([data-initialized="true"]) .compact-choice-row{display:none}');
  expect(component).toContain('.comparison-player--compact[data-initialized="true"]:not([data-audio-fallback="true"]) .comparison-lanes{display:none}');
  expect(component).toContain('.comparison-player--compact[data-initialized="true"]:not([data-audio-fallback="true"]) .compact-waveform-stage{display:grid}');
  expect(script.indexOf('media.forEach(audio => { audio.pause(); audio.controls = false; audio.hidden = true; });')).toBeLessThan(script.indexOf("root.dataset.initialized = 'true';"));
  expect(component).toContain('.comparison-player--compact .comparison-switch span{display:inline}');
});
