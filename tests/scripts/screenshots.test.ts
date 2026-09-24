import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  missingScenarioRoutes, NOT_PAGES, PAGES, parseJsonc, PREVIEW_OVERRIDES, previewWrangler, REDIRECTS, SCENARIO_PAGES,
  relevantScreenshots, sanitizeManifest, screenshotSection, withScreenshots,
} from '../../scripts/screenshots/config.mjs';

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
      && !SCENARIO_PAGES[file as keyof typeof SCENARIO_PAGES] && !REDIRECTS[file as keyof typeof REDIRECTS]
      && !captured.has(routeFor(file)));
    expect(missing).toEqual([]);
  });

  it('checks each redirect page from its own route', () => {
    for (const [file, { from }] of Object.entries(REDIRECTS)) expect(routeFor(file)).toBe(from);
  });

  it('runs each seeding scenario and sees it capture a page under every route it covers', async () => {
    const captured: { scenario: string; path: string }[] = [];
    for (const scenario of new Set(Object.values(SCENARIO_PAGES).map(item => item.scenario))) {
      const module = await import(pathToFileURL(`scripts/screenshots/scenarios/${scenario}.mjs`).href);
      const steps = await module.default.run({
        base: 'http://127.0.0.1:4321', sql: () => '[]', ownerFetch: async () => ({}),
        capture: async ({ file, path }: { file: string; path: string }) => { captured.push({ scenario, path }); return file; },
      });
      expect(steps.length).toBeGreaterThan(0);
    }
    expect(missingScenarioRoutes(SCENARIO_PAGES, captured)).toEqual([]);
  });

  it('reports a seeded page whose scenario never captured it', () => {
    const pages = { 'src/pages/a/[id].astro': { scenario: 'flow', route: '/a/' } };
    expect(missingScenarioRoutes(pages, [{ scenario: 'flow', path: '/a/' }, { scenario: 'other', path: '/a/1' }])).toEqual(['src/pages/a/[id].astro']);
    expect(missingScenarioRoutes(pages, [{ scenario: 'flow', path: '/a/1' }])).toEqual([]);
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
    expect(clean.scenarios[0].name).toBe('');
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
    expect(section.indexOf('### A flow')).toBeLessThan(section.indexOf('| Page |'));
    expect(section).toContain('alt="First &quot;step&quot;"');
    expect(section).toContain('https://raw.example/pr-1/abc1234/home-phone.png');
  });

  it('publishes representative routes for shared navigation and only the changed content route', () => {
    const manifest = {
      pages: [
        { name: 'home', path: '/' }, { name: 'work', path: '/work' }, { name: 'audio', path: '/audio' },
        { name: 'about', path: '/about' }, { name: 'services', path: '/services' }, { name: 'audio-services', path: '/audio/services' },
        { name: 'privacy', path: '/privacy' }, { name: 'owner-today', path: '/owner' },
      ],
      scenarios: [{ name: 'owner-details', title: 'Owner detail pages', steps: [] }],
    };
    const selected = relevantScreenshots(manifest, ['src/components/SiteNav.astro', 'src/data/profile.ts']);
    expect(selected.pages.map((page: { name: string }) => page.name)).toEqual(['home', 'work', 'audio', 'about', 'services', 'audio-services']);
    expect(selected.scenarios).toEqual([]);
  });

  it('shows pages that consume changed public content and shared components', () => {
    const manifest = { pages: [
      { name: 'home', path: '/' }, { name: 'work', path: '/work' }, { name: 'about', path: '/about' },
      { name: 'audio', path: '/audio' }, { name: 'audio-portfolio', path: '/audio/portfolio' },
      { name: 'audio-releases', path: '/audio/releases' }, { name: 'audio-services', path: '/audio/services' },
      { name: 'music-old-news', path: '/music/old-news' }, { name: 'services', path: '/services' },
    ], scenarios: [] };
    expect(relevantScreenshots(manifest, ['src/data/profile.ts']).pages.map((page: { name: string }) => page.name))
      .toEqual(['home', 'work', 'about']);
    expect(relevantScreenshots(manifest, ['src/content/pages/about.md']).pages.map((page: { name: string }) => page.name))
      .toEqual(['about']);
    expect(relevantScreenshots(manifest, ['src/layouts/ServiceSheet.astro', 'src/components/SoftwareServiceIllustration.astro'])
      .pages.map((page: { name: string }) => page.name)).toEqual(['services']);
    expect(relevantScreenshots(manifest, ['src/data/audio.ts']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio']);
    expect(relevantScreenshots(manifest, ['src/components/audio/LyricVideo.astro']).pages.map((page: { name: string }) => page.name))
      .toEqual(['music-old-news']);
    expect(relevantScreenshots(manifest, ['src/components/audio/AudioPlayer.astro']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-releases', 'music-old-news']);
  });

  it('includes a seeded scenario only when one of its routes changed', () => {
    const manifest = {
      pages: [{ name: 'owner-requests', path: '/owner/requests' }, { name: 'work', path: '/work' }],
      scenarios: [
        { name: 'owner-details', title: 'Owner detail pages', steps: [{ title: 'Request', images: [] }] },
        { name: 'studio-client', title: 'Client studio', steps: [{ title: 'Project', images: [] }] },
      ],
    };
    const selected = relevantScreenshots(manifest, ['src/pages/owner/requests/[id].astro']);
    expect(selected.pages.map((page: { name: string }) => page.name)).toEqual(['owner-requests']);
    expect(selected.scenarios.map((scenario: { name: string }) => scenario.name)).toEqual(['owner-details']);
  });

  it('keeps page-specific audio captures focused on that route', () => {
    const manifest = { pages: [
      { name: 'audio', path: '/audio' }, { name: 'audio-services', path: '/audio/services' },
      { name: 'audio-about', path: '/audio/about' },
    ], scenarios: [] };
    expect(relevantScreenshots(manifest, ['src/pages/audio/services.astro']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-services']);
  });

  it('fails closed to no unrelated images when changed files have no mapped route', () => {
    const selected = relevantScreenshots({
      pages: [{ name: 'home', path: '/' }, { name: 'work', path: '/work' }], scenarios: [],
    }, ['src/assets/unmapped-artwork.webp']);
    expect(selected).toEqual({ pages: [], scenarios: [] });
    expect(screenshotSection(selected, 'https://raw.example/pr-1/abc1234', 'abc1234def'))
      .toContain('No captured page matched the changed files.');
  });
});

describe('screenshot preview config', () => {
  const wrangler = parseJsonc(readFileSync('wrangler.jsonc', 'utf8'));

  it('reads JSONC comments, trailing commas and slashes inside strings', () => {
    expect(parseJsonc('{\n  // note\n  "a": "http://x/*y*/", /* block */ "b": [1, 2,],\n}')).toEqual({ a: 'http://x/*y*/', b: [1, 2] });
  });

  it('mirrors wrangler.jsonc apart from the listed overrides and local storage', () => {
    const preview = previewWrangler(wrangler);
    expect(preview.compatibility_date).toBe(wrangler.compatibility_date);
    expect(preview.compatibility_flags).toEqual(wrangler.compatibility_flags);
    expect(preview.vars).toEqual({ ...wrangler.vars, ...PREVIEW_OVERRIDES });
    const bindings = (items: { binding: string }[] = []) => items.map(item => item.binding);
    expect(bindings(preview.d1_databases)).toEqual(bindings(wrangler.d1_databases));
    expect(bindings(preview.kv_namespaces)).toEqual(bindings(wrangler.kv_namespaces));
    expect(bindings(preview.r2_buckets)).toEqual(bindings(wrangler.r2_buckets));
    expect(preview.d1_databases.map((item: { migrations_dir?: string }) => item.migrations_dir))
      .toEqual(wrangler.d1_databases.map((item: { migrations_dir?: string }) => item.migrations_dir));
  });

  it('points no binding at a production resource', () => {
    const text = JSON.stringify(previewWrangler(wrangler));
    const ids = [...wrangler.d1_databases.flatMap((item: Record<string, string>) => [item.database_id, item.database_name]),
      ...wrangler.kv_namespaces.map((item: Record<string, string>) => item.id),
      ...wrangler.r2_buckets.map((item: Record<string, string>) => item.bucket_name)];
    for (const id of ids) expect(text).not.toContain(id);
    expect(text).not.toContain(wrangler.vars.PUBLIC_TURNSTILE_SITE_KEY);
  });
});
