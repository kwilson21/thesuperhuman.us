import { createHash } from 'node:crypto';
import { templateFields } from '../../src/lib/agreement-template-fields.mjs';
const signingTemplates = Object.fromEntries(['msa', 'sow'].map(kind => [kind, templateFields[kind as keyof typeof templateFields].filter(field => !field.startsWith('milestone.')).map(field => `${field}: {{${field}}}`).join('\n') + (kind === 'sow' ? '\n{{#milestones}}\n' + templateFields.sow.filter(field => field.startsWith('milestone.')).map(field => `${field}: {{${field}}}`).join('\n') + '\n{{/milestones}}' : '')]));
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { prepareWithDiagnostics } from '../../scripts/screenshots/prepare.mjs';
import { POST as sendOffer } from '../../src/pages/api/owner/requests/[id]/software';
import { contractorSchema } from '../../src/lib/agreement-fields';
import {
  BARE_LINK_LANDINGS, expectedResourceError, missingScenarioRoutes, NOT_PAGES, PAGES, parseJsonc, PREVIEW_OVERRIDES, previewWrangler, REDIRECTS, SCENARIO_PAGES,
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

it('saves full-page prepare failure diagnostics and rethrows the original error', async () => {
  const out = await mkdtemp(join(tmpdir(), 'screenshot-failure-'));
  const error = new Error('Agreement message did not appear');
  const page = {
    url: () => 'http://localhost/owner/requests/example',
    locator: (selector: string) => {
      expect(selector).toBe('[role=status]');
      return { allTextContents: async () => ['', 'Complete and validate Agreement details before sending.'] };
    },
    screenshot: async (options: { path: string; fullPage: boolean }) => {
      expect(options.fullPage).toBe(true);
      await writeFile(options.path, 'failure image');
    },
  };
  try {
    await expect(prepareWithDiagnostics(page, async () => { throw error; }, out, 'software-signing', 'software-signing-missing-send-field-phone.png')).rejects.toBe(error);
    const name = '_failure-software-signing-missing-send-field-phone';
    expect(await readFile(join(out, `${name}.png`), 'utf8')).toBe('failure image');
    expect(await readFile(join(out, `${name}.txt`), 'utf8')).toBe(`URL: ${page.url()}\nError: ${error.message}\nStatuses:\n1: \n2: Complete and validate Agreement details before sending.\n`);
    expect(sanitizeManifest({ scenarios: [{ steps: [{ images: [{ file: `${name}.png` }] }] }] }, [`${name}.png`]).scenarios).toEqual([]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

it('seeds a completed send so missing details reach the real agreement validation', async () => {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('db/music.sql', 'utf8'));
  const stop = new Error('fixture ready');
  const statement = (query: string, args: any[] = []): any => ({
    bind: (...values: any[]) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
  });
  try {
    const scenario = await import('../../scripts/screenshots/scenarios/software-signing.mjs');
    await expect(scenario.default.run({
      templates: signingTemplates,
      sql: (query: string) => sql.exec(query),
      ownerFetch: async () => { throw new Error('No API setup is needed before this shot.'); },
      capture: async ({ file }: { file: string }) => { if (file.includes('missing-send-field')) throw stop; return file; },
    })).rejects.toBe(stop);
    const config = JSON.parse(sql.prepare('SELECT values_json FROM software_contractor_config').get().values_json);
    expect(contractorSchema.safeParse(config).success).toBe(true);
    const draft = sql.prepare("SELECT updated_at FROM software_offers WHERE status='draft'").get();
    const send = () => sendOffer({
      params: { id: 'screenshot-signing' },
      request: new Request('https://example.com/api/owner/requests/screenshot-signing/software', {
        method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'send', version: 2, expectedUpdatedAt: draft.updated_at }),
      }),
      locals: { owner: { email: 'owner@example.com' }, runtime: { env: { MUSIC_DB: { prepare: statement } } } },
    } as any) as Promise<Response>;
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'Complete and validate Agreement details before sending.' });
    sql.prepare('UPDATE software_offer_links SET created_at=?').run(new Date().toISOString());
    const sending = await send();
    expect(sending.status).toBe(409);
    expect(await sending.json()).toMatchObject({ message: 'An offer is still being sent. Try again in a moment.' });
  } finally {
    sql.close();
  }
});

it('prepares attachment captures with visible Remove controls and a shrinking list', async () => {
  const scenario = await import('../../scripts/screenshots/scenarios/software-signing.mjs');
  let captures=0;
  await scenario.default.run({
    templates: signingTemplates,
    sql: () => '[{"results":[{"status":"ready"}]}]',
    ownerFetch: async () => ({documents:[{id:'msa',kind:'msa',hash:'a'.repeat(64)},{id:'sow',kind:'sow',hash:'b'.repeat(64)}]}),
    capture: async ({file,prepare}: any) => {
      if (!file.includes('attachment-remove-control') && !file.includes('attachment-removed')) return file;
      // Earlier desktop/phone captures can leave multiple saved uploads in the draft.
      let remaining=3;
      const remove={
        count:async()=>remaining,
        first:()=>({waitFor:async()=>expect(remaining).toBeGreaterThan(0),click:async()=>{expect(remaining).toBeGreaterThan(0);remaining--;}}),
        all:async()=>Array.from({length:remaining},(_,index)=>({click:async()=>{expect(index).toBeLessThan(remaining);remaining--;}})),
      };
      const locator:any={locator:(selector:string)=>selector==='[data-remove-attachment]'?remove:locator,
        setInputFiles:async()=>{},fill:async()=>{},click:async()=>{},filter:()=>locator,waitFor:async()=>{}};
      await prepare({locator:()=>locator,viewportSize:()=>({width:1280,height:800}),setViewportSize:async()=>{},evaluate:async()=>false});
      expect(remaining).toBe(file.includes('attachment-removed')?0:3);
      captures++;
      return file;
    },
  });
  expect(captures).toBe(4);
});

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
        templates: signingTemplates,
        base: 'http://127.0.0.1:4321',
        sql: (query: string) => query.startsWith('SELECT status FROM software_agreement_artifacts') ? '[{"results":[{"status":"ready"}]}]' : '[]',
        ownerFetch: async (path: string) => path.startsWith('/api/offer/') && path.endsWith('/review') ? {documents:[{id:'00000000-0000-4000-8000-000000000001',kind:'msa',hash:'a'.repeat(64)},{id:'00000000-0000-4000-8000-000000000002',kind:'sow',hash:'b'.repeat(64)}]} : {},
        capture: async ({ file, path }: { file: string; path: string }) => { captured.push({ scenario, path }); return file; },
      });
      expect(steps.length).toBeGreaterThan(0);
    }
    expect(missingScenarioRoutes(SCENARIO_PAGES, captured)).toEqual([]);
  });

  it('captures bare, expired and valid one-time landings with their document statuses and destinations', async () => {
    const scenario = await import('../../scripts/screenshots/scenarios/software-signing.mjs');
    const landings: { path: string; status: number }[] = [];
    const seeds: string[] = [];
    const documents = [{ id: 'msa', kind: 'msa', hash: 'a'.repeat(64) }, { id: 'sow', kind: 'sow', hash: 'b'.repeat(64) }];
    await scenario.default.run({
      templates: signingTemplates,
      sql: (query: string) => {
        seeds.push(query);
        return query.startsWith('SELECT status FROM software_agreement_artifacts') ? '[{"results":[{"status":"ready"}]}]' : '[]';
      },
      ownerFetch: async () => ({ documents }),
      capture: async ({ file, path, status = 200, prepare }: any) => {
        const url = new URL(path, 'http://localhost');
        if (!url.pathname.endsWith('/verify')) return file;
        landings.push({ path, status });
        if (url.searchParams.has('key')) {
          const expired = file.includes('expired');
          expect(status).toBe(expired ? 401 : 200);
          const key = url.searchParams.get('key')!;
          const seed = seeds.find(query => query.includes(createHash('sha256').update(key).digest('hex')));
          expect(seed).toContain(expired ? '2000-01-01' : '2099-01-01');
          const page = {
            url: () => url.href,
            getByText: (text: string) => { expect(text).toBe(expired?'Links work once and last an hour.':'This link works once.'); return {isVisible:async()=>true}; },
            getByRole: (role: string, options: any) => {
              expect(options.exact).toBe(true);
              expect(options.name).toBe(expired ? 'This link has expired.' : role==='button' ? (url.pathname.startsWith('/offer/')?'Continue to sign':'Continue') : url.pathname.startsWith('/offer/')?'Your agreement is ready.':'Your documents are ready.');
              return { waitFor: async () => {} };
            },
          };
          await prepare(page);
        } else expect(status).toBe(401);
        return file;
      },
    });
    expect(BARE_LINK_LANDINGS.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: '/agreements/verify', status: 401 },
      { path: `/offer/${'g'.repeat(43)}/verify`, status: 401 },
    ]);
    for (const { path: route, status } of BARE_LINK_LANDINGS) {
      const visits = landings.filter(visit => new URL(visit.path, 'http://localhost').pathname === route);
      expect(visits.filter(visit => !visit.path.includes('?'))).toHaveLength(2);
      expect(visits.filter(visit => !visit.path.includes('?')).every(visit => visit.status === status)).toBe(true);
      expect(visits.filter(visit => visit.path.includes('?') && visit.status === 401)).toHaveLength(2);
      expect(visits.filter(visit => visit.status === 200)).toHaveLength(2);
    }
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
    expect(preview.vars.SITE_ORIGIN).toBe("http://127.0.0.1:4321");
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

it('allows only exact deliberate HTTP resource failures, preserving other console errors', () => {
  const base = 'http://127.0.0.1:4321';
  const expected = [{ url: base + '/api/offer/sample/session', status: 401 }];
  const resource = (text: string, url: string) => ({ text: () => text, location: () => ({ url }) });
  const message = 'Failed to load resource: the server responded with a status of 401 (Unauthorized)';
  expect(expectedResourceError(resource(message, expected[0].url), expected)).toBe(true);
  expect(expectedResourceError(resource(message, base + '/api/offer/other/session'), expected)).toBe(false);
  expect(expectedResourceError(resource(message.replace('401', '500'), expected[0].url), expected)).toBe(false);
  expect(expectedResourceError(resource('Unexpected script error', expected[0].url), expected)).toBe(false);
});

it('captures the work-first project states at desktop and phone sizes',async()=>{
  const scenario=await import('../../scripts/screenshots/scenarios/software-project.mjs');
  const files:string[]=[];
  await scenario.default.run({sql:()=> '[]',ownerFetch:async()=>({}),capture:async({file}:{file:string})=>{files.push(file);return file;}});
  for(const state of ['first','shared','direction-review','delivery-review','progress-pending-review','changes-open','delivery-complete','delivery-invoice-terms','accepted','earlier-accepted','paid-handoff-pending','earlier-paid-handoff-pending','handoff','earlier-versions','progress-after-handoff','next-milestone-starting']) {
    for(const viewport of ['desktop','phone']) expect(files).toContain(`software-project-${state}-${viewport}.png`);
  }
});

it('can seed empty details after link-landing captures have autosaved a draft',async()=>{
 const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('db/music.sql','utf8'));
 const stop=new Error('draft collision passed');
 const scenario=await import('../../scripts/screenshots/scenarios/software-signing.mjs');
 try {
  await expect(scenario.default.run({templates:signingTemplates,sql:(query:string)=>sql.exec(query),
   capture:async({file}:{file:string})=>{
    if(file.includes('link-open'))sql.exec("INSERT OR REPLACE INTO software_agreement_drafts VALUES('screenshot-signing-offer','signer@example.com','{}','now')");
    return file;
   },ownerFetch:async()=>{throw stop;},
  })).rejects.toBe(stop);
 } finally {sql.close();}
});


it.each([false,true])('runs the change-request capture checks with a saved Not yet mark: %s',async(saved)=>{
  const scenario=await import('../../scripts/screenshots/scenarios/software-project.mjs');
  let prepared=0;
  await scenario.default.run({sql:()=> '[]',ownerFetch:async()=>({}),capture:async({file,prepare}:any)=>{
    if(file.includes('changes-open')) {
      let marked=saved,checked=false,manual=false;
      const first=(value:any)=>({...value,first:()=>value});
      const mark={getAttribute:async()=>String(marked),click:async()=>{marked=!marked;if(!manual)checked=marked;}};
      const checkbox={isChecked:async()=>checked,uncheck:async()=>{checked=false;manual=true;},check:async()=>{checked=true;manual=true;}};
      await prepare({locator:(selector:string)=>selector.includes('not-yet') ? first(mark) : selector.includes('works') ? first({click:async()=>{marked=false;if(!manual)checked=false;}}) : selector==='[name=criteria]' ? first(checkbox) : selector.includes('summary') ? {click:async()=>{if(!manual)checked=marked;}} : {fill:async()=>{}},waitForFunction:async()=>{expect(checked).toBe(true);}});
      expect(checked).toBe(true);prepared++;
    }
    return file;
  }});
  expect(prepared).toBe(2);
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
  await scenario.default.run({ base: 'http://127.0.0.1:4321', sql() {}, capture: async ({ file, prepare }: any) => {
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
      locator: () => ({ dispatchEvent: async () => {}, check: async () => {}, fill: async () => {}, waitFor: async () => {}, inputValue: async () => 'We track new clients' }),
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

it.each(['reload', 'API wait', 'ghost wait'])('prints %s failure diagnostics and rethrows the original capture failure', async (stage) => {
  const scenario = await import('../../scripts/screenshots/scenarios/software-brief.mjs');
  const failure = new Error('ghost text hidden'), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const request = { url: () => 'http://127.0.0.1:4321/api/software/brief/pass', method: () => 'POST' };
  try {
    await expect(scenario.default.run({ base: 'http://127.0.0.1:4321', sql() {}, capture: async ({ file, prepare }: any) => {
      if (file !== 'software-brief-suggestion-phone.png') return file;
      await prepare({
        route: async () => {}, addInitScript: async () => {}, reload: async () => { if (stage === 'reload') throw failure; }, waitForFunction: async () => { if (stage === 'API wait') throw failure; },
        on: (event: string, handler: any) => {
          if (event === 'console') handler({ type: () => 'warning', text: () => 'test message' });
          if (event === 'request') handler(request);
          if (event === 'response') handler({ request: () => request, status: () => 200 });
        },
        evaluate: async () => ({ enabled: true, passState: 'token', lastError: null }),
        locator: () => ({ dispatchEvent: async () => {}, check: async () => {}, fill: async () => {}, waitFor: async () => { throw failure; } }),
      });
      return file;
    } })).rejects.toBe(failure);
    const diagnostic = JSON.parse(log.mock.calls[0][1]);
    expect(diagnostic.console).toEqual(['warning: test message']);
    expect(diagnostic.requests).toEqual([{ method: 'POST', path: '/api/software/brief/pass', status: 200 }]);
    expect(diagnostic.autocomplete).toEqual({ enabled: true, passState: 'pass 200', lastError: null });
  } finally { log.mockRestore(); }
});

it.each(['desktop', 'phone'])('captures the ghost text with the %s input hint', async viewport => {
  const scenario = await import('../../scripts/screenshots/scenarios/software-brief.mjs');
  const dispatchEvent = vi.fn(), waits: string[] = [];
  await scenario.default.run({ base: 'http://127.0.0.1:4321', sql() {}, capture: async ({ file, prepare }: any) => {
    if (file !== `software-brief-suggestion-${viewport}.png`) return file;
    await prepare({
      on() {}, route: async () => {}, addInitScript: async () => {}, reload: async () => {}, waitForFunction: async () => {},
      locator: (selector: string) => ({ dispatchEvent, check: async () => {}, fill: async () => {}, waitFor: async () => { waits.push(selector); }, inputValue: async () => 'We track new clients' }),
    });
    return file;
  } });
  expect(dispatchEvent).toHaveBeenCalledWith('pointerdown', { pointerType: viewport === 'phone' ? 'touch' : 'mouse' });
  expect(waits).toEqual(['[data-step="1"] [data-ghost-text]']);
});


it('allows only the exact declared failed resource URL and status', () => {
  const url = 'http://127.0.0.1:4321/api/software-inquiry';
  const message = (resource: string, text: string) => ({ location: () => ({ url: resource }), text: () => text });
  const failed = (status: number) => `Failed to load resource: the server responded with a status of ${status} (Service Unavailable)`;
  const allowed = [{ url, status: 503 }];
  expect(expectedResourceError(message(url, failed(503)), allowed)).toBe(true);
  expect(expectedResourceError(message(url, failed(503)), [])).toBe(false);
  for (const resource of [url + '?other=1', url + '/other', 'https://other.example/api/software-inquiry']) {
    expect(expectedResourceError(message(resource, failed(503)), allowed)).toBe(false);
  }
  expect(expectedResourceError(message(url, failed(500)), allowed)).toBe(false);
  expect(expectedResourceError(message(url, 'Unexpected application error'), allowed)).toBe(false);
  expect(expectedResourceError(message(url, failed(503) + ' extra'), allowed)).toBe(false);
  expect(expectedResourceError(message(url, failed(200)), [{ url, status: 200 }])).toBe(false);
});

it('declares the mocked 503 only for send-failed captures at both widths', async () => {
  const scenario = await import('../../scripts/screenshots/scenarios/software-brief.mjs');
  const allowances: string[] = [];
  await scenario.default.run({ base: 'http://127.0.0.1:4321', sql() {}, capture: async ({ file, expectedResourceErrors = [] }: any) => {
    if (expectedResourceErrors.length) {
      allowances.push(file);
      expect(expectedResourceErrors).toEqual([{ url: 'http://127.0.0.1:4321/api/software-inquiry', status: 503 }]);
    }
    return file;
  } });
  expect(allowances).toEqual(['software-brief-send-failed-desktop.png', 'software-brief-send-failed-phone.png']);
});

it.each(['The $1,200 balance is invoiced on delivery and due within 15 days.', 'This milestone is invoiced on delivery and due within 30 days.'])('checks delivery payment terms after Accept: %s',async wording=>{
  const scenario=await import('../../scripts/screenshots/scenarios/software-project.mjs');
  let prepared=0;
  await scenario.default.run({sql:()=> '[]',ownerFetch:async()=>({}),capture:async({file,prepare}:any)=>{
    if(file.includes('delivery-complete')) {
      await prepare({
        getByText:()=>({isVisible:async()=>true}),
        locator:(selector:string)=>selector.includes('data-review-mark') ? {first:()=>({click:async()=>{}})} : (()=>{
          expect(selector).toBe('[data-software-review] button[value=milestone_accepted] + p');
          return {isVisible:async()=>true,textContent:async()=>wording};
        })(),
      });
      prepared++;
    }
    return file;
  }});
  expect(prepared).toBe(2);
});
