import { createHash } from 'node:crypto';
import { templateFields } from '../../src/lib/agreement-template-fields.mjs';
const signingTemplates = Object.fromEntries(['msa', 'sow'].map(kind => [kind, templateFields[kind as keyof typeof templateFields].filter(field => !field.startsWith('milestone.')).map(field => `${field}: {{${field}}}`).join('\n') + (kind === 'sow' ? '\n{{#milestones}}\n' + templateFields.sow.filter(field => field.startsWith('milestone.')).map(field => `${field}: {{${field}}}`).join('\n') + '\n{{/milestones}}' : '')]));
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
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
          const destination = url.pathname.replace(/\/verify$/, url.pathname.startsWith('/offer/') ? '/sign' : '');
          const page = {
            url: () => `http://localhost${destination}`,
            getByRole: (role: string, options: any) => {
              expect(role).toBe('heading');
              expect(options).toEqual({ name: 'This link has expired.', exact: true });
              return { waitFor: async () => {} };
            },
          };
          await prepare(page);
          if (!expired) await expect(prepare({ ...page, url: () => url.href })).rejects.toThrow('did not redirect');
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
  const expected = [{ path: '/api/offer/sample/session', status: 401 }];
  const message = 'Failed to load resource: the server responded with a status of 401 (Unauthorized)';
  const base = 'http://127.0.0.1:4321';
  expect(expectedResourceError(message, base + expected[0].path, base, expected)).toBe(true);
  expect(expectedResourceError(message, base + '/api/offer/other/session', base, expected)).toBe(false);
  expect(expectedResourceError(message.replace('401', '500'), base + expected[0].path, base, expected)).toBe(false);
  expect(expectedResourceError('Unexpected script error', base + expected[0].path, base, expected)).toBe(false);
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
