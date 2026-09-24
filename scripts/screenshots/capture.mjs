#!/usr/bin/env node
// Opens every page at desktop and phone size, then runs each scenario in scripts/screenshots/scenarios.
// Exits non-zero on a page error, a console error, or an unexpected HTTP status.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { chromium } from 'playwright';
import { ACCESS_AUDIENCE, ACCESS_ISSUER, missingScenarioRoutes, OUT, OWNER_EMAIL, PAGES, REDIRECTS, SCENARIO_PAGES, VIEWPORTS } from './config.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4321';
const statusText = { 404: 'Not Found' };

// A throwaway Access issuer so owner pages render with the real JWT check.
const { publicKey, privateKey } = await generateKeyPair('RS256');
// A fresh key id per run, so a dev server that cached an earlier run's key fetches this one.
const kid = randomUUID();
const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
const issuer = createServer((_, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ keys: [jwk] })); });
await new Promise(done => issuer.listen(Number(new URL(ACCESS_ISSUER).port), '127.0.0.1', done));
const ownerToken = await new SignJWT({ email: OWNER_EMAIL }).setProtectedHeader({ alg: 'RS256', kid })
  .setIssuer(ACCESS_ISSUER).setAudience(ACCESS_AUDIENCE).setIssuedAt().setExpirationTime('1h').sign(privateKey);
const ownerHeaders = { 'cf-access-jwt-assertion': ownerToken };

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
// Every path that rendered with the expected status, so seeded pages can be checked afterwards.
const captured = [];

/** Saves one PNG. Pass `owner` for owner pages, `cookie` for a studio session, `selector` for one section. */
async function capture({ file, path, viewport = 'desktop', owner = false, cookie, selector, status = 200 }) {
  const size = VIEWPORTS.find(item => item.name === viewport);
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });
  // Access adds this header at the edge, so only our own origin sees it. Fonts and other hosts reject it.
  if (owner) await context.route(url => url.origin === new URL(BASE).origin,
    route => route.continue({ headers: { ...route.request().headers(), ...ownerHeaders } }));
  if (cookie) await context.addCookies([{ ...cookie, url: BASE }]);
  const page = await context.newPage();
  const where = `${path} (${viewport})`;
  page.on('console', message => {
    // The browser logs an intentional non-200 document, such as the 404 page, as a failed resource.
    // Ignore exactly that message for the page itself; any other error on the page still fails.
    const ownStatus = status !== 200 && message.location().url === BASE + path
      && message.text() === `Failed to load resource: the server responded with a status of ${status} (${statusText[status] ?? ''})`;
    if (message.type() === 'error' && !ownStatus) errors.push(`${where}: ${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`${where}: ${error.message}`));
  const response = await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 });
  if (response?.status() !== status) errors.push(`${where}: HTTP ${response?.status()}, expected ${status}`);
  else captured.push({ scenario: currentScenario, path });
  // Turnstile keeps requesting in the background, so network idle is a best effort, not a requirement.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const target = selector ? page.locator(selector).first() : page;
  await target.screenshot({ path: `${OUT}/${file}`, ...(selector ? {} : { fullPage: true }), animations: 'disabled' });
  await context.close();
  return file;
}

const sql = command => execFileSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'MUSIC_DB', '--local',
  '--config', resolve('.screenshots/wrangler.json'), '--persist-to', resolve('.wrangler/state'), '--json', '--command', command],
  { encoding: 'utf8', env: { ...process.env, CI: '1' } });
async function ownerFetch(path, body, method = 'POST', headers = {}) {
  const binary = body instanceof Uint8Array;
  const response = await fetch(BASE + path, { method, body: binary ? body : JSON.stringify(body),
    headers: { ...ownerHeaders, origin: BASE, 'content-type': binary ? 'application/octet-stream' : 'application/json', ...headers } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

let currentScenario;
try {
  for (const { from, to, status } of Object.values(REDIRECTS)) {
    const response = await fetch(BASE + from, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status !== status || (location && new URL(location, BASE).pathname) !== to) {
      errors.push(`${from}: HTTP ${response.status} to ${location}, expected ${status} to ${to}`);
    }
  }
  const pages = [];
  for (const page of PAGES) {
    for (const viewport of VIEWPORTS) await capture({ file: `${page.name}-${viewport.name}.png`, path: page.path, viewport: viewport.name, owner: page.owner, status: page.status });
    pages.push(page);
  }
  const scenarios = [];
  const directory = resolve('scripts/screenshots/scenarios');
  for (const name of (await readdir(directory)).filter(file => file.endsWith('.mjs')).sort()) {
    const scenario = (await import(pathToFileURL(`${directory}/${name}`).href)).default;
    currentScenario = name.replace(/\.mjs$/, '');
    scenarios.push({ title: scenario.title, steps: await scenario.run({ base: BASE, capture, sql, ownerFetch }) });
  }
  errors.push(...missingScenarioRoutes(SCENARIO_PAGES, captured).map(file => `${file}: its scenario captured no page under its route`));
  await writeFile(`${OUT}/manifest.json`, JSON.stringify({ pages, scenarios }, null, 2));
} finally {
  await browser.close();
  issuer.close();
}
if (errors.length) {
  console.error(`Screenshot checks failed:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`Saved screenshots to ${OUT}/`);
