import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
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
      { name: 'audio-start', path: '/audio/start' }, { name: 'music-old-news', path: '/music/old-news' }, { name: 'services', path: '/services' },
      { name: 'building-personal-website', path: '/building/personal-website' }, { name: 'owner-today', path: '/owner' },
      { name: 'owner-requests', path: '/owner/requests' }, { name: 'owner-campaigns', path: '/owner/campaigns' },
      { name: 'studio-sign-in', path: '/studio/sign-in' },
    ], scenarios: [
      { name: 'services-print', title: 'Print', steps: [{ title: 'Letter', images: [{ file: 'services-print.png', caption: 'Print' }] }] },
      { name: 'owner-details', title: 'Owner details', steps: [{ title: 'Request', images: [{ file: 'owner.png', caption: 'Owner' }] }] },
      { name: 'studio-client', title: 'Studio', steps: [{ title: 'Project', images: [{ file: 'studio.png', caption: 'Studio' }] }] },
    ] };
    expect(relevantScreenshots(manifest, ['src/data/profile.ts']).pages.map((page: { name: string }) => page.name))
      .toEqual(['home', 'work', 'about', 'services']);
    expect(relevantScreenshots(manifest, ['src/content/pages/about.md']).pages.map((page: { name: string }) => page.name))
      .toEqual(['about']);
    expect(relevantScreenshots(manifest, ['src/layouts/ServiceSheet.astro', 'src/data/services.ts'])
      .pages.map((page: { name: string }) => page.name)).toEqual(['services']);
    for (const file of ['src/layouts/ServiceSheet.astro', 'src/data/services.ts', 'src/styles/service-pages.css', 'src/lib/software-inquiry.ts', 'src/data/profile.ts']) {
      expect(relevantScreenshots(manifest, [file]).scenarios.map((scenario: { name: string }) => scenario.name)).toEqual(['services-print']);
    }
    expect(relevantScreenshots(manifest, ['src/components/WorkDiagram.astro']).scenarios).toEqual([]);
    expect(relevantScreenshots(manifest, ['src/lib/software-inquiry.ts']).pages.map((page: { name: string }) => page.name)).toContain('services');
    expect(relevantScreenshots(manifest, ['src/styles/service-pages.css']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-services', 'services']);
    expect(relevantScreenshots(manifest, ['src/data/audio.ts']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio']);
    expect(relevantScreenshots(manifest, ['src/components/audio/LyricVideo.astro']).pages.map((page: { name: string }) => page.name))
      .toEqual(['music-old-news']);
    expect(relevantScreenshots(manifest, ['src/components/audio/AudioPlayer.astro']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-releases', 'music-old-news']);
    expect(relevantScreenshots(manifest, ['src/components/audio/MusicNav.astro']).pages.map((page: { name: string }) => page.name))
      .not.toContain('audio-start');
    expect(relevantScreenshots(manifest, ['src/styles/music-premiere.css']).pages.map((page: { name: string }) => page.name))
      .toEqual(['music-old-news']);
    expect(relevantScreenshots(manifest, ['src/content/releases/old-news-single.json']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-portfolio', 'audio-releases', 'music-old-news']);
    expect(relevantScreenshots(manifest, ['src/content/recordings/old-news-recording.json']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-portfolio', 'audio-releases', 'audio-services', 'music-old-news']);
    expect(relevantScreenshots(manifest, ['src/content/audio-examples/old-news-mastering.json']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-portfolio', 'audio-services']);
    expect(relevantScreenshots(manifest, ['src/content/audio-tracks/demo.json']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio']);
    expect(relevantScreenshots(manifest, ['src/styles/music.css']).pages.map((page: { name: string }) => page.name))
      .toEqual(['audio-portfolio', 'audio-releases', 'audio-services', 'music-old-news']);
    expect(relevantScreenshots(manifest, ['src/styles/project-journal.css']).pages.map((page: { name: string }) => page.name))
      .toEqual(['building-personal-website']);
    expect(relevantScreenshots(manifest, ['src/styles/owner.css']).pages.map((page: { name: string }) => page.name))
      .toEqual(['owner-today', 'owner-requests', 'owner-campaigns']);
    expect(relevantScreenshots(manifest, ['src/styles/owner.css']).scenarios.map((scenario: { name: string }) => scenario.name))
      .toEqual(['owner-details']);
    expect(relevantScreenshots(manifest, ['src/styles/studio.css']).pages.map((page: { name: string }) => page.name))
      .toEqual(['owner-today', 'studio-sign-in']);
    expect(relevantScreenshots(manifest, ['src/styles/studio.css']).scenarios.map((scenario: { name: string }) => scenario.name))
      .toEqual(['owner-details', 'studio-client']);
    expect(relevantScreenshots(manifest, ['src/components/owner/OwnerProjectFiles.astro']).scenarios.map((scenario: { name: string }) => scenario.name))
      .toEqual(['studio-client']);
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

  it('selects the software page and journey when software validation changes', () => {
    const manifest = { pages: [{ name: 'software-start', path: '/software/start' }],
      scenarios: [{ name: 'software-brief', title: 'Software brief journey', steps: [] }] };
    const selected = relevantScreenshots(manifest, ['src/lib/software-inquiry.ts']);
    expect(selected.pages.map((page: { name: string }) => page.name)).toEqual(['software-start']);
    expect(selected.scenarios.map((scenario: { name: string }) => scenario.name)).toEqual(['software-brief']);
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

it('software print styling never forces a receipt before submission', () => {
  const css = readFileSync(new URL('../../src/styles/software-intake.css', import.meta.url), 'utf8');
  expect(css).not.toMatch(/#software-success\s*\{\s*display:block/);
  expect(css).not.toMatch(/@media print[^}]*#software-inquiry/);
});

it('serves a scenario-local Turnstile API for silent and receipt widgets', async () => {
  const scenario = await import('../../scripts/screenshots/scenarios/software-brief.mjs');
  const routes = new Map<string, any>(), callback = vi.fn(), onload = vi.fn();
  const inputs: any[] = [], receipt = { appendChild: (input: any) => inputs.push(input) };
  const window: any = { loaded: onload };
  const document = {
    createElement: () => ({ remove: vi.fn() }), querySelectorAll: () => [receipt],
    currentScript: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=loaded' },
  };
  await scenario.default.run({ sql() {}, capture: async ({ file, prepare }: any) => {
    if (file !== 'software-brief-suggestion-phone.png') return file;
    await prepare({
      on() {}, route: async (path: string, handler: any) => { routes.set(path, handler); },
      addInitScript: async () => {}, reload: async () => {
        await routes.get('https://challenges.cloudflare.com/turnstile/**')({ fulfill: ({ body, contentType }: any) => {
          expect(contentType).toBe('application/javascript');
          runInNewContext(body, { window, document, URL, queueMicrotask });
        } });
      },
      waitForFunction: async () => expect(window.turnstile).toBeTruthy(),
      locator: () => ({ check: async () => {}, fill: async () => {}, waitFor: async () => {}, inputValue: async () => 'We track new clients' }),
    });
    const api = window.turnstile;
    expect(onload).toHaveBeenCalledOnce();
    expect(inputs[0]).toMatchObject({ name: 'cf-turnstile-response', value: 'XXXX.DUMMY.TOKEN.XXXX' });
    const id = api.render({}, { 'response-field': false, callback });
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith('XXXX.DUMMY.TOKEN.XXXX');
    expect(inputs).toHaveLength(1);
    expect(api.getResponse(id)).toBe('XXXX.DUMMY.TOKEN.XXXX');
    api.reset(id); api.execute(id); api.ready(callback);
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(4);
    api.remove(id); expect(api.getResponse(id)).toBe('');
    api.remove('screenshot-widget-1'); expect(inputs[0].remove).toHaveBeenCalledOnce();
    const fulfill = vi.fn();
    await routes.get('**/api/software/brief/pass')({ fulfill });
    expect(fulfill).toHaveBeenCalledWith({ json: { ok: true } });
    return file;
  } });
});

it.each(['reload', 'API wait', 'chip wait'])('prints %s failure diagnostics and rethrows the original capture failure', async (stage) => {
  const scenario = await import('../../scripts/screenshots/scenarios/software-brief.mjs');
  const failure = new Error('accept chip hidden'), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const request = { url: () => 'http://127.0.0.1:4321/api/software/brief/pass', method: () => 'POST' };
  try {
    await expect(scenario.default.run({ sql() {}, capture: async ({ file, prepare }: any) => {
      if (file !== 'software-brief-suggestion-phone.png') return file;
      await prepare({
        route: async () => {}, addInitScript: async () => {}, reload: async () => { if (stage === 'reload') throw failure; }, waitForFunction: async () => { if (stage === 'API wait') throw failure; },
        on: (event: string, handler: any) => {
          if (event === 'console') handler({ type: () => 'warning', text: () => 'test message' });
          if (event === 'request') handler(request);
          if (event === 'response') handler({ request: () => request, status: () => 200 });
        },
        evaluate: async () => ({ enabled: true, passState: 'token', lastError: null }),
        locator: () => ({ check: async () => {}, fill: async () => {}, waitFor: async () => { throw failure; } }),
      });
      return file;
    } })).rejects.toBe(failure);
    const diagnostic = JSON.parse(log.mock.calls[0][1]);
    expect(diagnostic.console).toEqual(['warning: test message']);
    expect(diagnostic.requests).toEqual([{ method: 'POST', path: '/api/software/brief/pass', status: 200 }]);
    expect(diagnostic.autocomplete).toEqual({ enabled: true, passState: 'pass 200', lastError: null });
  } finally { log.mockRestore(); }
});
