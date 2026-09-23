import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_PAGES, PAGES, SCENARIO_PAGES, sanitizeManifest, screenshotSection, withScreenshots } from '../../scripts/screenshots/config.mjs';

function pageFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'api' ? [] : pageFiles(path);
    return name.endsWith('.astro') ? [relative(process.cwd(), path)] : [];
  });
}

function routeFor(file: string): string {
  const route = file.replace(/^src\/pages/, '').replace(/\.astro$/, '').replace(/\/index$/, '');
  return route || '/';
}

describe('screenshot coverage', () => {
  it('captures every page file or says why not', () => {
    const captured = new Set(PAGES.map(page => page.path));
    const missing = pageFiles('src/pages').filter(file => !NOT_PAGES[file as keyof typeof NOT_PAGES]
      && !SCENARIO_PAGES[file as keyof typeof SCENARIO_PAGES] && !captured.has(routeFor(file)));
    expect(missing).toEqual([]);
  });

  it('backs every seeded page with a scenario that captures its route', () => {
    for (const { scenario, route } of Object.values(SCENARIO_PAGES)) {
      const source = readFileSync(`scripts/screenshots/scenarios/${scenario}.mjs`, 'utf8');
      expect(source, `${scenario} should capture ${route}`).toContain(route);
      expect(source).toContain('capture(');
    }
  });

  it('publishes only validated images and escaped text from an untrusted manifest', () => {
    const manifest = {
      pages: [{ name: 'home', path: '/' }, { name: '../evil', path: '/x' }, { name: 'missing', path: '/m' }],
      scenarios: [{ title: '<img src=x onerror=alert(1)> | table', steps: [
        { title: 'Step `one`', images: [{ file: 'flow-desktop.png', caption: '"quoted" <b>' }, { file: '../../secret.png', caption: 'no' }] },
        { title: 'Empty', images: [{ file: 'not-uploaded.png', caption: 'gone' }] },
      ] }],
    };
    const clean = sanitizeManifest(manifest, ['home-desktop.png', 'home-phone.png', 'flow-desktop.png', 'Evil.PNG']);
    expect(clean.pages).toEqual([{ name: 'home', path: '/' }]);
    expect(clean.scenarios).toHaveLength(1);
    expect(clean.scenarios[0].steps).toHaveLength(1);
    expect(clean.scenarios[0].steps[0].images).toEqual([{ file: 'flow-desktop.png', caption: '&#34;quoted&#34; &#60;b&#62;' }]);
    const section = screenshotSection(clean, 'https://raw.example/pr-1/abc1234', 'abc1234def');
    expect(section).not.toContain('<img src=x');
    expect(section).not.toContain('secret');
    expect(sanitizeManifest(null, [])).toEqual({ pages: [], scenarios: [] });
  });

  it('replaces an earlier screenshot section and keeps the rest of the description', () => {
    const section = '<!-- screenshots:start -->new<!-- screenshots:end -->';
    expect(withScreenshots('Intro\n\n<!-- screenshots:start -->old<!-- screenshots:end -->\n\nOutro', section))
      .toBe(`Intro\n\n${section}\n\nOutro`);
    expect(withScreenshots(null, section)).toBe(section);
    expect(withScreenshots('Intro', section)).toBe(`Intro\n\n${section}`);
  });

  it('lists scenario steps before the page table', () => {
    const section = screenshotSection({
      pages: [{ name: 'home', path: '/' }],
      scenarios: [{ title: 'A flow', steps: [{ title: 'First', images: [{ file: 'flow-01-desktop.png', caption: 'First "step"' }] }] }],
    }, 'https://raw.example/pr-1/abc1234', 'abc1234def');
    expect(section.indexOf('### A flow')).toBeLessThan(section.indexOf('Every page'));
    expect(section).toContain('alt="First &quot;step&quot;"');
    expect(section).toContain('https://raw.example/pr-1/abc1234/home-phone.png');
  });
});
