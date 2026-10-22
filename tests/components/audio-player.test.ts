import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const player = readFileSync(new URL('../../src/components/audio/AudioPlayer.astro', import.meta.url), 'utf8');
const premiere = readFileSync(new URL('../../src/styles/music-premiere.css', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../../src/scripts/music-controls.ts', import.meta.url), 'utf8');

it('shows muted with a crossed speaker at full colour on every page that uses the player', () => {
  expect(player).toContain('<path class="volume-waves"');
  expect(player).toContain('<path class="volume-cross"');
  expect(player).toContain('.volume-button[aria-pressed=true] .volume-waves,.volume-button:not([aria-pressed=true]) .volume-cross{display:none}');
  expect(controls).toContain("mute.setAttribute('aria-pressed', String(audio.muted));");
  expect(premiere).not.toMatch(/\.volume-button\[aria-pressed=true\]\{opacity/);
});

it('marks the seek range as unavailable until the song can seek', () => {
  expect(player).toContain('data-seek disabled');
  expect(player).toContain('.player-progress input:disabled{opacity:.6;cursor:not-allowed}');
});
