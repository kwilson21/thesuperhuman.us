// What CI screenshots and how the images reach a PR description. Pure; shared by the scripts beside it.

/** Every public page. tests/scripts/screenshots.test.ts fails when a page file is missing here. */
export const PAGES = [
  { name: 'home', path: '/' },
  { name: 'work', path: '/work' },
  { name: 'building', path: '/building' },
  { name: 'building-personal-website', path: '/building/personal-website' },
  { name: 'building-kaillera-next', path: '/building/kaillera-next' },
  { name: 'building-tally', path: '/building/tally' },
  { name: 'building-threadline', path: '/building/threadline' },
  { name: 'building-the-engineers-daily', path: '/building/the-engineers-daily' },
  { name: 'writing', path: '/writing' },
  { name: 'writing-ai-gives-you-speed', path: '/writing/ai-gives-you-speed' },
  { name: 'about', path: '/about' },
  { name: 'services', path: '/services' },
  { name: 'privacy', path: '/privacy' },
  { name: 'audio', path: '/audio' },
  { name: 'audio-about', path: '/audio/about' },
  { name: 'audio-portfolio', path: '/audio/portfolio' },
  { name: 'audio-releases', path: '/audio/releases' },
  { name: 'audio-services', path: '/audio/services' },
  { name: 'audio-start', path: '/audio/start' },
  { name: 'music-old-news', path: '/music/old-news' },
  { name: 'studio-sign-in', path: '/studio/sign-in' },
  { name: 'not-found', path: '/this-page-does-not-exist', status: 404 },
  { name: 'owner-today', path: '/owner', owner: true },
  { name: 'owner-requests', path: '/owner/requests', owner: true },
  { name: 'owner-campaigns', path: '/owner/campaigns', owner: true },
];

/** Page files that are covered another way. */
export const NOT_PAGES = {
  'src/pages/404.astro': 'Captured through not-found.',
  'src/pages/music/[slug].astro': 'Captured through music-old-news.',
};

/** Page files that only redirect. Capture checks each one answers with this status and location. */
export const REDIRECTS = {
  'src/pages/services.html.astro': { from: '/services.html', to: '/services', status: 301 },
};

/** Pages that need seeded data. The coverage test checks the named scenario captures the route. */
export const SCENARIO_PAGES = {
  'src/pages/owner/requests/[id].astro': { scenario: 'owner-details', route: '/owner/requests/' },
  'src/pages/owner/campaigns/[id].astro': { scenario: 'owner-details', route: '/owner/campaigns/' },
  'src/pages/studio/index.astro': { scenario: 'studio-client', route: '/studio' },
  'src/pages/studio/projects/[id].astro': { scenario: 'studio-client', route: '/studio/projects/' },
};

// Show representative routes when shared UI changes, and focused routes for content changes.
// The full capture still runs in CI; this only selects which validated captures appear in the PR.
const SHARED_SITE_PAGES = ['home', 'work', 'audio', 'services', 'audio-services'];
const AUDIO_SHELL_PAGES = ['audio', 'audio-about', 'audio-portfolio', 'audio-releases', 'audio-services', 'audio-start', 'music-old-news'];
const PAGE_NAMES_BY_FILE = {
  'src/components/SiteNav.astro': SHARED_SITE_PAGES,
  'src/components/Footer.astro': SHARED_SITE_PAGES,
  'src/layouts/BaseLayout.astro': SHARED_SITE_PAGES,
  'src/components/ExperienceRow.astro': ['work'],
  'src/components/SoftwareServiceIllustration.astro': ['services'],
  'src/layouts/ServiceSheet.astro': ['services'],
  'src/content/pages/about.md': ['about'],
  'src/data/profile.ts': ['home', 'work', 'about'],
  'src/data/audio.ts': ['audio'],
  'src/data/services.ts': ['services'],
  'src/styles/global.css': SHARED_SITE_PAGES,
  'src/components/audio/AudioHero.astro': ['audio'],
  'src/components/audio/AudioFooter.astro': AUDIO_SHELL_PAGES,
  'src/components/audio/MusicNav.astro': AUDIO_SHELL_PAGES,
  'src/components/audio/BookingForm.astro': ['audio'],
  'src/components/audio/ServiceSection.astro': ['audio'],
  'src/components/audio/ServiceIcon.astro': ['audio', 'audio-portfolio'],
  'src/components/audio/TrackRow.astro': ['audio'],
  'src/components/audio/ComparisonPlayer.astro': ['audio-portfolio', 'audio-services'],
  'src/components/audio/PlayIcon.astro': ['audio-portfolio', 'audio-releases', 'audio-services', 'music-old-news'],
  'src/components/audio/LyricVideo.astro': ['music-old-news'],
  'src/components/audio/ReleaseInterest.astro': ['music-old-news'],
  'src/components/audio/AudioPlayer.astro': ['audio-releases', 'music-old-news'],
};

function routeForPageFile(file) {
  if (file === 'src/pages/404.astro') return '/this-page-does-not-exist';
  if (!file.startsWith('src/pages/') || !file.endsWith('.astro')) return null;
  const route = file.replace(/^src\/pages/, '').replace(/\.astro$/, '').replace(/\/index$/, '');
  return route || '/';
}

/** Select a small set of validated captures that represent files changed by the PR. */
export function relevantScreenshots(manifest, changedFiles) {
  const pageNames = new Set();
  const scenarioNames = new Set();
  const files = Array.isArray(changedFiles) ? changedFiles.filter(file => typeof file === 'string') : [];

  for (const file of files) {
    for (const name of (Object.hasOwn(PAGE_NAMES_BY_FILE, file) ? PAGE_NAMES_BY_FILE[file] : [])) pageNames.add(name);

    const scenario = Object.hasOwn(SCENARIO_PAGES, file) ? SCENARIO_PAGES[file] : null;
    if (scenario) scenarioNames.add(scenario.scenario);

    const route = routeForPageFile(file);
    if (route) {
      const dynamicPrefix = route.replace(/\[[^\]]+\]/g, '');
      for (const page of manifest.pages) {
        if (page.path === route || (dynamicPrefix !== route
          && (page.path === dynamicPrefix.replace(/\/$/, '') || page.path.startsWith(dynamicPrefix)))) pageNames.add(page.name);
      }
    }

    if (file.startsWith('src/content/audio-tracks/')) pageNames.add('audio-portfolio');
  }

  return {
    pages: manifest.pages.filter(page => pageNames.has(page.name)),
    scenarios: manifest.scenarios.filter(scenario => scenarioNames.has(scenario.name)),
  };
}

/**
 * Page files in SCENARIO_PAGES whose scenario never rendered the route: a page under it when the
 * route ends in a slash, otherwise that exact path.
 * `captured` lists `{ scenario, path }` for every capture that returned its expected status.
 */
export function missingScenarioRoutes(scenarioPages, captured) {
  return Object.entries(scenarioPages).filter(([, { scenario, route }]) =>
    !captured.some(item => item.scenario === scenario && (route.endsWith('/')
      ? item.path.startsWith(route) && item.path.length > route.length : item.path === route)))
    .map(([file]) => file);
}

export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

export const OUT = 'screenshots';
export const OWNER_EMAIL = 'owner@example.com';
export const ACCESS_ISSUER = 'http://127.0.0.1:9911';
export const ACCESS_AUDIENCE = 'screenshots';

/**
 * Settings the preview deliberately changes from wrangler.jsonc. Every other var is mirrored,
 * so a feature flag flipped there shows up in the screenshots.
 */
export const PREVIEW_OVERRIDES = {
  // Turnstile's always-pass test keys: the production site key rejects localhost.
  PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  // A throwaway Access issuer run by capture.mjs, so owner pages go through the real JWT check.
  OWNER_ACCESS_TEAM_DOMAIN: ACCESS_ISSUER,
  OWNER_ACCESS_AUD: ACCESS_AUDIENCE,
  OWNER_EMAIL,
  // Production keeps this secret; the preview needs some key to issue studio codes.
  AUDIO_CLIENT_CODE_KEY: 'screenshots-only-code-key-0123456789abcdef',
  // Gated pages stay reviewable in PRs before launch.
  AUDIO_CLIENT_PORTAL_ENABLED: 'true',
};

/** Parses JSON with comments and trailing commas, the format of wrangler.jsonc. */
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (character === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (character === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (character !== ',' || !/^\s*[}\]]/.test(text.slice(i + 1))) out += character;
  }
  return JSON.parse(out);
}

/**
 * The local preview config: wrangler.jsonc's compatibility settings, vars and binding names,
 * with local storage in place of every production resource and PREVIEW_OVERRIDES applied.
 */
export function previewWrangler(config) {
  return {
    name: 'screenshots-preview',
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags ?? [],
    vars: { ...config.vars, ...PREVIEW_OVERRIDES },
    d1_databases: (config.d1_databases ?? []).map((database, index) => ({ binding: database.binding,
      database_name: `screenshots-${database.binding.toLowerCase()}`,
      database_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      ...(database.migrations_dir ? { migrations_dir: database.migrations_dir } : {}) })),
    kv_namespaces: (config.kv_namespaces ?? []).map(({ binding }) => ({ binding, id: `screenshots-${binding.toLowerCase()}` })),
    r2_buckets: (config.r2_buckets ?? []).map(({ binding }) => ({ binding, bucket_name: `screenshots-${binding.toLowerCase()}` })),
  };
}

const START = '<!-- screenshots:start -->';
const END = '<!-- screenshots:end -->';

/** Puts the screenshot section into a PR description, replacing an earlier one. */
export function withScreenshots(body, section) {
  const text = body ?? '';
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start !== -1 && end > start) return text.slice(0, start) + section + text.slice(end + END.length);
  return text ? `${text}\n\n${section}` : section;
}

const escape = value => String(value).replace(/[&<>"'`|\\*_[\]#]/g, character => `&#${character.charCodeAt(0)};`).slice(0, 200);
const imageName = /^[a-z0-9-]{1,100}\.png$/;

/**
 * The manifest arrives from untrusted pull request code. Keep only entries whose images passed
 * validation, escape every piece of text, and cap the lengths.
 */
export function sanitizeManifest(manifest, images) {
  const available = new Set(images.filter(name => imageName.test(name)));
  const has = file => typeof file === 'string' && available.has(file);
  const pages = (Array.isArray(manifest?.pages) ? manifest.pages : []).slice(0, 100)
    .filter(page => typeof page?.name === 'string' && has(`${page.name}-desktop.png`) && has(`${page.name}-phone.png`))
    .map(page => ({ name: page.name, path: escape(page.path ?? '') }));
  const scenarios = (Array.isArray(manifest?.scenarios) ? manifest.scenarios : []).slice(0, 20).map(scenario => ({
    name: /^[a-z0-9-]{1,100}$/.test(scenario?.name ?? '') ? scenario.name : '',
    title: escape(scenario?.title ?? 'Scenario'),
    steps: (Array.isArray(scenario?.steps) ? scenario.steps : []).slice(0, 40).map(step => ({
      title: escape(step?.title ?? ''),
      images: (Array.isArray(step?.images) ? step.images : []).slice(0, 8).filter(image => has(image?.file))
        .map(image => ({ file: image.file, caption: escape(image.caption ?? '') })),
    })).filter(step => step.images.length),
  })).filter(scenario => scenario.steps.length);
  return { pages, scenarios };
}

/** Builds the PR description section from a sanitized capture manifest. */
export function screenshotSection(manifest, rawBase, sha) {
  const [desktop, phone] = VIEWPORTS;
  const img = (file, alt, width) => `<img src="${rawBase}/${file}" width="${width}" alt="${alt.replaceAll('"', '&quot;')}">`;
  const lines = [START, '## Relevant screenshots',
    `_Captured by CI at ${sha.slice(0, 7)} on a local preview. Desktop ${desktop.width}×${desktop.height}, phone ${phone.width}×${phone.height}._`, ''];
  for (const scenario of manifest.scenarios) {
    lines.push(`### ${scenario.title}`, '');
    scenario.steps.forEach((step, index) => {
      lines.push(`**${index + 1}. ${step.title}**`, '', step.images.map(image => img(image.file, image.caption, image.file.includes('-phone') ? 180 : 420)).join(' '), '');
    });
  }
  if (manifest.pages.length) lines.push('| Page | Desktop | Phone |', '|---|---|---|',
    ...manifest.pages.map(page => `| \`${page.path}\` | ${img(`${page.name}-desktop.png`, `${page.name}, desktop`, 420)} | ${img(`${page.name}-phone.png`, `${page.name}, phone`, 160)} |`));
  if (!manifest.pages.length && !manifest.scenarios.length) lines.push('_No captured page matched the changed files._');
  lines.push(END);
  return lines.join('\n');
}
