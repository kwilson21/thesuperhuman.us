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
});

it('places compact playback beside the waveform and seeks from both the track and the waveform', () => {
  expect(component).toContain('data-compact-waveform');
  expect(component).toContain('data-waveform-before=');
  expect(component).toContain('data-waveform-after=');
  expect(component).toContain('data-compact-wave-line');
  expect(component).toContain('class="compact-waveform-seek"');
  expect(component).toContain('compact-waveform-play" data-comparison-play');
  expect(component).toContain('<div class="compact-waveform-stage">\n      <button class="round-play compact-waveform-play"');
  expect(component).toContain('<div class="compact-waveform-column">');
  expect(component).toContain('::-webkit-slider-runnable-track');
  expect(component).not.toContain('compact-waveform-playhead');
  expect(component).toContain('.comparison-player--compact:not([data-initialized="true"]) .compact-waveform-stage,.comparison-player--compact:not([data-initialized="true"]) .compact-choice-row{display:none}');
  expect(component).toContain('.comparison-player--compact[data-initialized="true"]:not([data-audio-fallback="true"]) .comparison-lanes{display:none}');
  expect(component).toContain('.comparison-player--compact[data-initialized="true"]:not([data-audio-fallback="true"]) .compact-waveform-stage{display:grid}');
  expect(script.indexOf('media.forEach(audio => { audio.pause(); audio.controls = false; audio.hidden = true; });')).toBeLessThan(script.indexOf("root.dataset.initialized = 'true';"));
  expect(component).toContain('.comparison-player--compact .comparison-switch span{display:inline}');
  expect(script).toContain("'.comparison-waveform-stage, .compact-waveform-frame'");
  expect(script).toContain('waveformSeekSeconds(');
  expect(component).toContain('.comparison-player[data-initialized="true"]:not([data-audio-fallback="true"]) .comparison-waveform-stage,.comparison-player[data-initialized="true"]:not([data-audio-fallback="true"]) .compact-waveform-frame{cursor:pointer;touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-select:none}');
});

it('fills the played part of every A/B waveform in the accent over neutral unplayed bars', () => {
  expect(component).toContain('.comparison-player{border:1px solid var(--rule);border-radius:4px;padding:1rem;--wave-unplayed:#BDB6AA}');
  expect(component).toContain('.comparison-waveform{height:44px;color:var(--wave-unplayed)}');
  expect(component).toContain('.comparison-waveform-played{position:absolute;top:0;left:0;width:100%;height:100%;color:var(--accent);pointer-events:none;clip-path:inset(0 calc(100% - var(--position,0%)) 0 0)}');
  expect(component).toContain('.comparison-player--compact .compact-waveform{display:block;width:100%;height:38px;color:var(--wave-unplayed)}');
  expect(component).toContain('.comparison-player--compact .compact-waveform-played{position:absolute;top:0;left:0;color:var(--accent);pointer-events:none;clip-path:inset(0 calc(100% - var(--position,0%)) 0 0)}');
  expect(component).toContain('.comparison-player--compact .compact-waveform-frame{position:relative}');
  expect(component).toContain('<div class="compact-waveform-frame">');
  expect(component).toContain('class="comparison-waveform-played"');
  expect(component).toContain('class="compact-waveform compact-waveform-played"');
  expect(component).toContain('.comparison-player--compact .compact-waveform :global(line){transition:y1 180ms ease,y2 180ms ease}');
  expect(component).toContain('@media(prefers-reduced-motion:reduce){.comparison-player--compact .compact-waveform :global(line){transition:none}}');
  expect(script).toContain("root.querySelectorAll<SVGSVGElement>('.compact-waveform').forEach(svg => {");
  expect(script).toContain("svg.querySelectorAll<SVGLineElement>('[data-compact-wave-line]')");
});

it('drags across both waveforms with pointer events so mouse, pen and touch each scrub in their own way', () => {
  expect(script).toContain('setPointerCapture(event.pointerId)');
  expect(script).toContain("addEventListener('pointerdown'");
  expect(script).toContain("addEventListener('pointermove'");
  expect(script).toContain("addEventListener('pointerup'");
  expect(script).toContain('isWaveformScrub(event.pointerType');
  expect(script).toContain('event.isPrimary');
});

it('tells visitors they can click, tap or drag the full waveform to seek', () => {
  expect(component).toContain('Switch versions. Keep your place. Click, tap or drag either waveform to seek.');
});

it('keeps the compact played fill above the unplayed bars by source order', () => {
  expect(component.indexOf('.comparison-player--compact .compact-waveform{')).toBeLessThan(component.indexOf('.comparison-player--compact .compact-waveform-played{'));
});

it('seeks once per gesture, keeps playback through a drag past the end, and leaves fallback players alone', () => {
  expect(script).toContain("root.dataset.audioFallback === 'true'");
  expect(script).toContain('scrubbing: isWaveformScrub(event.pointerType, 0, 0)');
  expect(script).toContain('if (!gesture || gesture.scrubbing || !stage.hasPointerCapture(event.pointerId)) return;');
  expect(script).toContain('resume: Boolean(transport?.playing)');
  expect(script).toContain('position < transport.duration');
  expect(script).toContain('transport.play()');
  expect(script).toContain('if (!gesture.scrubbing) {');
  expect(script).toContain('gesture.scrubbing = true');
});

it('skips pen pressure moves that leave the pointer in place so a resting pen does not restart playback', () => {
  expect(script).toContain('if (event.clientX === gesture.lastX) return;');
  expect(script).toContain('gesture.lastX = event.clientX;');
});
