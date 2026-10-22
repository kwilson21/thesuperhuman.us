import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The owner's picks from the 2026-10-22 type and labels board (D4.1-D, D4.2-C, D4.4-B) and D10.3-B.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const rule = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start) + 1);
};
const global = read('src/styles/global.css');

describe('labels (D4.1, D4.2-C)', () => {
  it('sets labels in Inter 500 capitals at 11px with .12em tracking', () => {
    expect(global).toContain('--tracking-eyebrow: 0.12em;');
    for (const selector of ['.page-kicker', '.eyebrow']) {
      const css = rule(global, selector);
      expect(css).toContain('font-family: var(--font-sans);');
      expect(css).toContain('font-weight: 500;');
      expect(css).toMatch(/font-size: \.6875rem;/);
      expect(css).toContain('text-transform: uppercase;');
    }
  });

  it('keeps one project status style in global.css and uses it on Home and /building', () => {
    expect(rule(global, '.project-status')).toContain('var(--font-sans)');
    expect(read('src/styles/project-journal.css')).not.toContain('.project-status');
    const home = read('src/pages/index.astro');
    const building = read('src/pages/building.astro');
    expect(home.match(/<p class="project-status">\{\w+Story\.status\}<\/p>/g)).toHaveLength(2);
    expect(building).toContain('<p class="project-status">{project.status}</p>');
    expect(`${home}\n${building}`).not.toMatch(/class="page-kicker[^"]*">\{[\w.]*status\}/);
  });

  it('drops the labels that repeat a heading, a button or the nav', () => {
    expect(read('src/pages/work.astro')).not.toContain('<p class="page-kicker">Let’s talk</p>');
    expect(read('src/pages/about.astro')).not.toContain('Let’s connect');
    expect(read('src/layouts/ServiceSheet.astro')).not.toContain('<p class="page-kicker">Work with me</p>');
    const tally = read('src/pages/building/tally.astro');
    expect(tally).not.toContain('Three highlights from the journal');
    expect(tally).not.toContain('<span>Decision</span>');
    expect(tally).toContain('<span>Why it matters</span>');
  });
});

describe('public interface text in Libron (D4.4-B)', () => {
  it('leaves no Inter on the public captions, players, menu and fields', () => {
    for (const path of [
      'src/components/WorkWithMe.astro', 'src/layouts/ServiceSheet.astro', 'src/pages/writing/ai-gives-you-speed.astro',
      'src/pages/building/personal-website.astro', 'src/components/audio/ComparisonPlayer.astro', 'src/components/audio/AudioPlayer.astro',
      'src/components/audio/LyricVideo.astro', 'src/components/audio/MusicNav.astro', 'src/styles/music.css', 'src/styles/audio-intake.css',
    ]) expect(read(path), path).not.toMatch(/var\(--font-sans\)|Inter,\s*sans-serif/);
    expect(global).toMatch(/\.site-form textarea, \.site-form select \{[^}]*font: 1rem\/1\.5 var\(--font-serif\)/);
  });

  it('sets the door captions at 14px with the name mark', () => {
    const doors = read('src/components/WorkWithMe.astro');
    expect(doors).toMatch(/\.door-caption \{[^}]*font-family: var\(--font-serif\); font-size: \.875rem;/);
    expect(doors).toContain('<PersonalName variant={part.variant} />');
    expect(doors).not.toContain('style="inherit"');
  });

  it('keeps the services captions at 14px and the Lyft sentence at 15px', () => {
    const sheet = read('src/layouts/ServiceSheet.astro');
    expect(sheet).toContain('.software-figure small, .software-story p, figcaption { font: .875rem/1.5 var(--font-serif);');
    expect(sheet).toContain('.software-story p { font-size: .9375rem; }');
    expect(sheet).toMatch(/\.sheet-footnote \{[^}]*font: \.875rem\/1\.5 var\(--font-serif\)/);
  });
});

it('sets the footer name at the header wordmark size (D10.3-B)', () => {
  expect(read('src/components/SiteNav.astro')).toContain('.site-name { font-size: 1.5rem;');
  expect(read('src/components/Footer.astro')).toContain('.footer-name { font-size: 1.5rem;');
});
