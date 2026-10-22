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

it('keeps the nameplate centred over the lead column, with the credit, actions and platform links beside the poster', () => {
  const masthead = page.slice(page.indexOf('<header class="premiere-masthead">'), page.indexOf('</header>'));
  expect(masthead).toContain('class="masthead-artist"');
  expect(masthead).toContain('masthead-title');
  expect(masthead).not.toContain('premiere-actions');
  const lead = page.slice(page.indexOf('<div class="premiere-lead">'), page.indexOf('{tracks.length > 1'));
  const order = ['class="masthead-credit"', 'class="premiere-actions"', '<LyricVideo', 'class="release-platform-links"'].map(part => lead.indexOf(part));
  expect(order.every(index => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // The column layout starts at 1024px; narrower screens keep the single-column stack.
  expect(css).toMatch(/@media\(min-width:1024px\)\{\.premiere-lead\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\);/);
  expect(css).toContain('.premiere-lead>.premiere-stage{grid-column:2;grid-row:1/span 2}');
  expect(css).toContain('.premiere-lead>.release-platform-links{grid-column:1;grid-row:2;');
});

it('shrinks the masthead on short screens until the whole poster fits, still capped by the long-word guard', () => {
  const fit = css.slice(css.indexOf('@media(min-width:1024px) and (min-height:451px)'));
  expect(fit).toContain('--masthead-room:calc(100svh - 16.25rem - (100cqi - var(--space-8)) / 2.94)');
  expect(fit).toContain('.masthead-title{');
  expect(fit).toContain('--masthead-size:clamp(5rem,min(14.5vw,var(--masthead-room) / 1.08),12.5rem)');
  expect(fit).toContain('.masthead-title-long{--masthead-size:clamp(3rem,min(8vw,var(--masthead-room) / 2.15),7rem)}');
  // The fit sets --masthead-size only, so font-size's min() with the long-word guard still applies.
  expect(fit.slice(0, fit.indexOf('}}'))).not.toContain('font-size');
});
