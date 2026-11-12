import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expectSource } from '../helpers/source-text';

const player = readFileSync(new URL('../../src/components/audio/AudioPlayer.astro', import.meta.url), 'utf8');
const premiere = readFileSync(new URL('../../src/styles/music-premiere.css', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../../src/scripts/music-controls.ts', import.meta.url), 'utf8');

it('shows muted with a crossed speaker at full colour on every page that uses the player', () => {
  expectSource(player).toContain('<path class="volume-waves"');
  expectSource(player).toContain('<path class="volume-cross"');
  expectSource(player).toContain('.volume-button[aria-pressed=true] .volume-waves,.volume-button:not([aria-pressed=true]) .volume-cross{display:none}');
  expectSource(controls).toContain("mute.setAttribute('aria-pressed', String(audio.muted));");
  expect(premiere).not.toMatch(/\.volume-button\[aria-pressed=true\]\{opacity/);
});

it('marks the seek range as unavailable until the song can seek', () => {
  expectSource(player).toContain('data-seek disabled');
  expectSource(player).toContain('.player-progress input:disabled{opacity:.6;cursor:not-allowed}');
});
