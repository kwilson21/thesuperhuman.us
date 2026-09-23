// What CI screenshots and how the images reach a PR description. Pure; shared by the scripts beside it.

/** Every public page. tests/scripts/screenshots.test.ts fails when a page file is missing here. */
export const PAGES = [
  { name: 'home', path: '/' },
  { name: 'work', path: '/work' },
  { name: 'building', path: '/building' },
  { name: 'building-personal-website', path: '/building/personal-website' },
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
  { name: 'not-found', path: '/this-page-does-not-exist', status: 404 },
  { name: 'owner-today', path: '/owner', owner: true },
  { name: 'owner-requests', path: '/owner/requests', owner: true },
  { name: 'owner-campaigns', path: '/owner/campaigns', owner: true },
];

/** Page files that are covered another way. */
export const NOT_PAGES = {
  'src/pages/404.astro': 'Captured through not-found.',
  'src/pages/services.html.astro': 'Redirects to /services.',
  'src/pages/music/[slug].astro': 'Captured through music-old-news.',
};

/** Pages that need seeded data. The coverage test checks the named scenario captures the route. */
export const SCENARIO_PAGES = {
  'src/pages/owner/requests/[id].astro': { scenario: 'owner-details', route: '/owner/requests/' },
  'src/pages/owner/campaigns/[id].astro': { scenario: 'owner-details', route: '/owner/campaigns/' },
};

export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

export const OUT = 'screenshots';
export const OWNER_EMAIL = 'owner@example.com';
export const ACCESS_ISSUER = 'http://127.0.0.1:9911';
export const ACCESS_AUDIENCE = 'screenshots';

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
  const lines = [START, '## Screenshots',
    `_Taken by CI at ${sha.slice(0, 7)} on a local preview with seeded data. Desktop ${desktop.width}×${desktop.height}, phone ${phone.width}×${phone.height}. Owner pages use a test Access identity._`, ''];
  for (const scenario of manifest.scenarios) {
    lines.push(`### ${scenario.title}`, '');
    scenario.steps.forEach((step, index) => {
      lines.push(`**${index + 1}. ${step.title}**`, '', step.images.map(image => img(image.file, image.caption, image.file.includes('-phone') ? 180 : 420)).join(' '), '');
    });
  }
  lines.push('<details><summary>Every page</summary>', '', '| Page | Desktop | Phone |', '|---|---|---|',
    ...manifest.pages.map(page => `| \`${page.path}\` | ${img(`${page.name}-desktop.png`, `${page.name}, desktop`, 420)} | ${img(`${page.name}-phone.png`, `${page.name}, phone`, 160)} |`),
    '', '</details>', END);
  return lines.join('\n');
}
