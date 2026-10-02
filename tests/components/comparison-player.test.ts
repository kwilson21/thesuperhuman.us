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
  expect(home).toContain("Start your song");
});
