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

const css = readFileSync(new URL('../../src/styles/music-premiere.css', import.meta.url), 'utf8');

it('sets the all-caps masthead in Libron Bold, sized so its longest word fits the column, keeping the approved line-height', () => {
  expect(page).toContain("const longestWord = Math.max(...mainTitle.split(/\\s+/).map(word => word.length));");
  expect(page).toContain('style={`--masthead-word:${longestWord}`}');
  expect(css).toContain('.premiere-masthead{text-align:center;container-type:inline-size}');
  expect(css).toContain('font-size:min(var(--masthead-size),calc(110cqi / var(--masthead-word,1)))');
  expect(css).toMatch(/\.masthead-title\{[^}]*font-family:var\(--font-serif\);font-weight:700;/);
  expect(css).not.toContain('Georgia');
  expect(css).toMatch(/\.masthead-title\{[^}]*line-height:\.93;/);
});
