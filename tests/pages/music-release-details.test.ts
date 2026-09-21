import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const page = readFileSync(new URL('../../src/pages/music/[slug].astro', import.meta.url), 'utf8');

it('only offers the lyrics anchor when the release has lyrics to reveal', () => {
  expect(page).toContain("{first.lyrics && <a class=\"site-link\" href=\"#lyrics\">");
});

it('renders supplied YouTube and SoundCloud actions for a release', () => {
  expect(page).toContain('first.youtubeUrl');
  expect(page).toContain('Watch on YouTube');
  expect(page).toContain('first.soundcloudUrl');
  expect(page).toContain('Listen on SoundCloud');
  expect(page).toContain('track.youtubeUrl');
  expect(page).toContain('track.soundcloudUrl');
});
