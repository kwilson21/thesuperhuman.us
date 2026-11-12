import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expectSource, sourceText } from '../helpers/source-text';

const component = readFileSync(new URL('../../src/components/audio/ComparisonPlayer.astro', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../src/scripts/comparison-player.ts', import.meta.url), 'utf8');

it('keeps each comparison playhead within its waveform and reveals both markers', () => {
  expectSource(component).toContain('<div class="comparison-waveform-stage">');
  expectSource(component).toContain('<span class="comparison-playhead" aria-hidden="true" hidden></span>');
  expectSource(component).toContain('.comparison-waveform-stage{position:relative;margin-top:.4rem}');
  expectSource(script).toContain("root.querySelectorAll<HTMLElement>('.comparison-playhead')");
  expectSource(script).toContain("playhead.hidden = false");
});

it('keeps the compact A/B selector from stretching across the mobile controls grid', () => {
  expectSource(component).toContain('.comparison-switch{display:flex;justify-self:start;width:max-content;');
});

it('supports a compact homepage variant while keeping the same synchronized, accessible player controls', () => {
  const home = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');

  expectSource(component).toContain("compact?: boolean");
  expectSource(component).toContain("comparison-player--compact");
  expectSource(component).toContain("aria-label={labels[0]}");
  expectSource(component).toContain("aria-label={labels[1]}");
  expectSource(home).toContain("example.id === 'old-news-mastering'");
  expectSource(home).toContain("<ComparisonPlayer example={oldNewsExample} recording={oldNewsRecording} compact />");
  expectSource(home).toContain("setupComparisonPlayers();");
  expectSource(home).not.toContain("Start your song");
});

it('places compact playback beside the waveform and seeks from both the track and the waveform', () => {
  expectSource(component).toContain('data-compact-waveform');
  expectSource(component).toContain('data-waveform-before=');
  expectSource(component).toContain('data-waveform-after=');
  expectSource(component).toContain('data-compact-wave-line');
  expectSource(component).toContain('class="compact-waveform-seek"');
  expectSource(component).toContain('compact-waveform-play" data-comparison-play');
  expectSource(component).toContain('<div class="compact-waveform-stage">\n      <button class="round-play compact-waveform-play"');
  expectSource(component).toContain('<div class="compact-waveform-column">');
  expectSource(component).toContain('::-webkit-slider-runnable-track');
  expectSource(component).not.toContain('compact-waveform-playhead');
  expectSource(component).toContain('.comparison-player--compact:not([data-initialized="true"]) .compact-waveform-stage,.comparison-player--compact:not([data-initialized="true"]) .compact-choice-row{display:none}');
  expectSource(component).toContain('.comparison-player--compact[data-initialized="true"]:not([data-audio-fallback="true"]) .comparison-lanes{display:none}');
  expectSource(component).toContain('.comparison-player--compact[data-initialized="true"]:not([data-audio-fallback="true"]) .compact-waveform-stage{display:grid}');
  expect(sourceText(script).indexOf(sourceText('media.forEach(audio => { audio.pause(); audio.controls = false; audio.hidden = true; });'))).toBeLessThan(sourceText(script).indexOf(sourceText("root.dataset.initialized = 'true';")));
  expectSource(component).toContain('.comparison-player--compact .comparison-switch span{display:inline}');
  expectSource(script).toContain("'.comparison-waveform-stage, .compact-waveform-frame'");
  expectSource(script).toContain('waveformSeekSeconds(');
  expectSource(component).toContain('.comparison-player[data-initialized="true"]:not([data-audio-fallback="true"]) .comparison-waveform-stage,.comparison-player[data-initialized="true"]:not([data-audio-fallback="true"]) .compact-waveform-frame{cursor:pointer;touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-select:none}');
});

it('fills the played part of every A/B waveform in the accent over neutral unplayed bars', () => {
  expectSource(component).toMatch(/\.comparison-player\{border:1pxsolidvar\(--rule\);border-radius:4px;padding:1rem;--wave-unplayed:color-mix\(insrgb,var\(--muted\)\d+%,var\(--paper\)\)\}/);
  expectSource(component).toContain('.comparison-waveform{height:44px;color:var(--wave-unplayed)}');
  expectSource(component).toContain('.comparison-waveform-played{position:absolute;top:0;left:0;width:100%;height:100%;color:var(--accent);pointer-events:none;clip-path:inset(0 calc(100% - var(--position,0%)) 0 0)}');
  expectSource(component).toContain('.comparison-player--compact .compact-waveform{display:block;width:100%;height:38px;color:var(--wave-unplayed)}');
  expectSource(component).toContain('.comparison-player--compact .compact-waveform-played{position:absolute;top:0;left:0;color:var(--accent);pointer-events:none;clip-path:inset(0 calc(100% - var(--position,0%)) 0 0)}');
  expectSource(component).toContain('.comparison-player--compact .compact-waveform-frame{position:relative}');
  expectSource(component).toContain('<div class="compact-waveform-frame">');
  expectSource(component).toContain('class="comparison-waveform-played"');
  expectSource(component).toContain('class="compact-waveform compact-waveform-played"');
  expectSource(component).toContain('.comparison-player--compact .compact-waveform :global(line){transition:y1 180ms ease,y2 180ms ease}');
  expectSource(component).toContain('@media(prefers-reduced-motion:reduce){.comparison-player--compact .compact-waveform :global(line){transition:none}}');
  expectSource(script).toContain("root.querySelectorAll<SVGSVGElement>('.compact-waveform').forEach(svg => {");
  expectSource(script).toContain("svg.querySelectorAll<SVGLineElement>('[data-compact-wave-line]')");
});

it('drags across both waveforms with pointer events so mouse, pen and touch each scrub in their own way', () => {
  expectSource(script).toContain('setPointerCapture(event.pointerId)');
  expectSource(script).toContain("addEventListener('pointerdown'");
  expectSource(script).toContain("addEventListener('pointermove'");
  expectSource(script).toContain("addEventListener('pointerup'");
  expectSource(script).toContain('isWaveformScrub(event.pointerType, event.clientX - gesture.startX, event.clientY - gesture.startY)');
  expectSource(script).toContain('event.isPrimary');
});

it('tells visitors they can click, tap or drag the full waveform to seek', () => {
  expectSource(component).toContain('Switch versions. Keep your place. Click, tap or drag either waveform to seek.');
});

it('keeps the compact played fill above the unplayed bars by source order', () => {
  expect(sourceText(component).indexOf(sourceText('.comparison-player--compact .compact-waveform{'))).toBeLessThan(sourceText(component).indexOf(sourceText('.comparison-player--compact .compact-waveform-played{')));
});

it('seeks once per gesture, keeps playback through a drag past the end, and leaves fallback players alone', () => {
  expectSource(script).toContain("root.dataset.audioFallback === 'true'");
  expectSource(script).toContain('scrubbing: isWaveformScrub(event.pointerType, 0, 0)');
  expectSource(script).toContain("      stage.addEventListener('pointerup', event => {\n        if (!gesture || !stage.hasPointerCapture(event.pointerId)) return;\n        seekFromPointer(event);\n      });");
  expectSource(script).toContain('resume: Boolean(transport?.playing)');
  expectSource(script).toContain('position < transport.duration');
  expectSource(script).toContain('transport.play()');
  expectSource(script).toContain('if (!gesture.scrubbing) {');
  expectSource(script).toContain('gesture.scrubbing = true');
});

it('seeks only when the target time changes, so pen pressure and clamped drags cannot restart playback', () => {
  expectSource(script).toContain('const seconds = waveformSeekSeconds(');
  expectSource(script).toContain('if (seconds === gesture.lastSeconds) return;');
  expectSource(script).toContain('gesture.lastSeconds = seconds;');
  expect(sourceText(script).indexOf(sourceText('if (seconds === gesture.lastSeconds) return;'))).toBeLessThan(sourceText(script).indexOf(sourceText('seekTo(seconds);')));
});

it('draws the unplayed bars and both seek tracks at 3:1 or better against paper (WCAG 1.4.11)', () => {
  const global = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
  const hex = (name: string) => {
    const match = global.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) throw new Error(`--${name} not found in global.css`);
    return [1, 3, 5].map(i => parseInt(match[1].slice(i, i + 2), 16));
  };
  const luminance = (channels: number[]) => {
    const [r, g, b] = channels.map(c => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const share = Number(sourceText(component).match(/--wave-unplayed:color-mix\(insrgb,var\(--muted\)(\d+)%,var\(--paper\)\)/)![1]) / 100;
  const paper = hex('paper');
  const wave = hex('muted').map((c, i) => c * share + paper[i] * (1 - share));
  const [light, dark] = [luminance(paper), luminance(wave)].sort((x, y) => y - x);
  expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(3);
  // Every seek and volume track uses the same grey for its unplayed part, never the --rule hairline.
  expect(sourceText(component).match(/var\(--wave-unplayed\)var\(--fill,var\(--position,0%\)\)100%/g)).toHaveLength(2);
  expectSource(component).not.toMatch(/var\(--rule\)var\(--position/);
});

it('sets every player control in Libron at 14px or more (type board D4.4-B)', () => {
  expectSource(component).toContain('.comparison-match{display:flex;align-items:center;gap:.4rem;font:.875rem var(--font-serif)}');
  expectSource(component).not.toContain('var(--font-sans)');
  expectSource(component).not.toMatch(/Inter,sans-serif/);
  // The only size under 14px is the visually hidden seek label (font-size:0).
  const sizes = [...component.matchAll(/font(?:-size)?:([\d.]+)rem/g)].map(match => Number(match[1]));
  expect(sizes.length).toBeGreaterThan(10);
  expect(sizes.filter(size => size < .875)).toEqual([]);
  // The dimmed version letter stays at full opacity on the accent button (paper at 75% on the accent is 3.4:1).
  expectSource(component).toContain('.comparison-player--compact .comparison-switch button[data-select-version="after"][aria-pressed="true"] span:first-child{opacity:1}');
  // At 14px, Match loudness takes its own row on the smallest phones so it never meets the volume slider.
  expectSource(component).toContain('@media(max-width:370px){.comparison-match{grid-column:1/-1;grid-row:3;justify-self:start}.comparison-seek{grid-row:4}}');
});
