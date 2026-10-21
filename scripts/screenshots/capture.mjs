#!/usr/bin/env node
// Opens every page at desktop and phone size, then runs each scenario in scripts/screenshots/scenarios.
// Exits non-zero on a page error, a console error, or an unexpected HTTP status.
// Images whose inputs match an earlier run in .screenshots/reference are copied from it instead (see
// cache.mjs); SCREENSHOTS_FULL=1 captures everything.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { chromium } from 'playwright';
import { ASSET_TYPES, globalKey, listFiles, REFERENCE, routeFiles, routePattern, scenarioKey, scenarioPlanner, sha256, sourceClosure, stateHash } from './cache.mjs';
import { prepareWithDiagnostics } from './prepare.mjs';
import { ACCESS_AUDIENCE, ACCESS_ISSUER, expectedResourceError, missingScenarioRoutes, OUT, OWNER_EMAIL, PAGES, REDIRECTS, SCENARIO_PAGES, VIEWPORTS } from './config.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4321';
// Enough to keep a 4-core runner busy alongside the dev server.
const PAGE_CONCURRENCY = 4;

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
// Same-origin requests each capture made, by file: the inputs a reused image is checked against.
const requestsByFile = new Map();

const global = await globalKey({ node: process.version, browser: browser.version() });
const reference = await readReference();
const cache = { global, pagesWrote: false, pages: {}, scenarios: {} };

async function readReference() {
  if (process.env.SCREENSHOTS_FULL === '1') return console.log('SCREENSHOTS_FULL is set: capturing everything.');
  const data = await readFile(`${REFERENCE}/cache.json`, 'utf8').then(JSON.parse).catch(() => null);
  if (!data) return console.log('No earlier run to reuse: capturing everything.');
  if (data.global !== global) return console.log('Capture code, dependencies or config changed since the earlier run: capturing everything.');
  return data;
}

/** Saves one PNG. Pass `owner` for owner pages, `cookie` for a studio session, `selector` for one section. */
async function capture({ file, path, viewport = 'desktop', owner = false, cookie, selector, status = 200, prepare, expectedResponses = [], expectedResourceErrors = [] }) {
  const size = VIEWPORTS.find(item => item.name === viewport);
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });
  // Access adds this header at the edge, so only our own origin sees it. Fonts and other hosts reject it.
  if (owner) await context.route(url => url.origin === new URL(BASE).origin,
    route => route.continue({ headers: { ...route.request().headers(), ...ownerHeaders } }));
  if (cookie) await context.addCookies([{ ...cookie, url: BASE }]);
  const requests = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === new URL(BASE).origin) requests.push({ url: url.pathname + url.search, method: request.method(), type: request.resourceType(), accept: request.headers().accept ?? '' });
  });
  requestsByFile.set(file, requests);
  const page = await context.newPage();
  const where = `${path} (${viewport})`;
  page.on('console', message => {
    const expected = expectedResourceError(message, [{ url: BASE + path, status }, ...expectedResourceErrors, ...expectedResponses.map(({ path, status }) => ({ url: BASE + path, status }))]);
    if (message.type() === 'error' && !expected) errors.push(`${where}: ${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`${where}: ${error.message}`));
  const response = await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 });
  if (response?.status() !== status) errors.push(`${where}: HTTP ${response?.status()}, expected ${status}`);
  else captured.push({ scenario: currentScenario, path });
  // Turnstile keeps requesting in the background, so network idle is a best effort, not a requirement.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  if (prepare) await prepareWithDiagnostics(page, prepare, OUT, currentScenario, file);
  const target = selector ? page.locator(selector).first() : page;
  await target.screenshot({ path: `${OUT}/${file}`, ...(selector ? {} : { fullPage: true }), animations: 'disabled' });
  await context.close();
  return file;
}

const sql = command => execFileSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'MUSIC_DB', '--local',
  '--config', resolve('.screenshots/wrangler.json'), '--persist-to', resolve('.wrangler/state'), '--json', '--command', command],
  { encoding: 'utf8', env: { ...process.env, CI: '1' } });
async function ownerFetch(path, body, method = 'POST', headers = {}) {
  scenarioPaths.push(new URL(BASE + path).pathname);
  const binary = body instanceof Uint8Array;
  const response = await fetch(BASE + path, { method, body: binary ? body : JSON.stringify(body),
    headers: { ...ownerHeaders, origin: BASE, 'content-type': binary ? 'application/octet-stream' : 'application/json', ...headers } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

const replayed = new Map();
/** Requests a recorded URL again and hashes what the server sends: status, redirect and body. */
function replay({ url, accept }, owner) {
  const key = `${owner}\n${accept}\n${url}`;
  if (!replayed.has(key)) {
    replayed.set(key, fetch(BASE + url, { redirect: 'manual', headers: { accept, ...(owner ? ownerHeaders : {}) } })
      .then(async response => `${response.status} ${response.headers.get('location') ?? ''} ${sha256(Buffer.from(await response.arrayBuffer()))}`)
      .catch(error => `failed ${error.message}`));
  }
  return replayed.get(key);
}
async function replayHash(requests, owner) {
  const unique = [...new Map(requests.map(request => [`${request.accept}\n${request.url}`, request])).values()]
    .sort((a, b) => (a.url + a.accept).localeCompare(b.url + b.accept));
  return sha256(JSON.stringify(await Promise.all(unique.map(async request => [request.url, request.accept, await replay(request, owner)]))));
}
const reusable = files => Promise.all(files.map(file => access(`${REFERENCE}/${file}`))).then(() => true, () => false);

/** A page at one size: copied when every response it loaded is unchanged, otherwise captured. */
async function shoot(page, viewport) {
  const file = `${page.name}-${viewport.name}.png`;
  const params = { path: page.path, owner: Boolean(page.owner), status: page.status ?? 200 };
  const earlier = reference?.pages?.[file];
  if (earlier && JSON.stringify(Object.values(params)) === JSON.stringify([earlier.path, earlier.owner, earlier.status])
    && await reusable([file]) && await replayHash(earlier.requests, params.owner) === earlier.hash) {
    await copyFile(`${REFERENCE}/${file}`, `${OUT}/${file}`);
    cache.pages[file] = earlier;
    reusedPages++;
    return;
  }
  await capture({ file, path: page.path, viewport: viewport.name, owner: page.owner, status: page.status });
  const requests = requestsByFile.get(file).map(({ url, method, accept }) => ({ url, method, accept }));
  // A page that sent anything but GET can't be checked by replaying it.
  if (requests.every(request => request.method === 'GET')) cache.pages[file] = { ...params, requests, hash: await replayHash(requests, params.owner) };
}

let reusedPages = 0;
let currentScenario;
// Paths each running scenario sent to ownerFetch, which runs server code without a browser.
let scenarioPaths = [];
try {
  for (const { from, to, status } of Object.values(REDIRECTS)) {
    const response = await fetch(BASE + from, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status !== status || (location && new URL(location, BASE).pathname) !== to) {
      errors.push(`${from}: HTTP ${response.status} to ${location}, expected ${status} to ${to}`);
    }
  }
  // Pages only read data, so a few render at once. Scenarios below stay serial: each one sees the
  // rows the ones before it seeded.
  const shots = PAGES.flatMap(page => VIEWPORTS.map(viewport => ({ page, viewport })));
  const stateBeforePages = await stateHash();
  await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, async () => {
    for (let shot = shots.shift(); shot; shot = shots.shift()) await shoot(shot.page, shot.viewport);
  }));
  // Scenarios are checked against a run whose pages left the database untouched.
  cache.pagesWrote = (await stateHash()) !== stateBeforePages;

  const scenarios = [];
  const directory = resolve('scripts/screenshots/scenarios');
  const names = (await readdir(directory)).filter(file => file.endsWith('.mjs')).sort().map(file => file.replace(/\.mjs$/, ''));
  const script = name => `scripts/screenshots/scenarios/${name}.mjs`;
  // Scenarios seed dates from the clock, so a scenario image is reused only on the day it was taken.
  const day = new Date().toISOString().slice(0, 10);
  const keyFor = async (name, { files, content, assets }) => scenarioKey({ global, day, script: script(name), files, content, assets: await replayHash(assets, false) });
  // A scenario that no longer exists may have seeded rows the later ones showed.
  const removed = Object.keys(reference?.scenarios ?? {}).some(name => !names.includes(name));
  const changed = new Set();
  for (const name of names) {
    const earlier = reference?.scenarios?.[name];
    if (!earlier || removed || reference.pagesWrote || cache.pagesWrote || !await reusable(earlier.images) || await keyFor(name, earlier) !== earlier.key) changed.add(name);
  }
  const pageFiles = (await listFiles(['src/pages'])).filter(file => /\.(astro|ts|js|mjs)$/.test(file));
  // Static files are replayed and hashed. Anything a route serves, such as an owner-only image from
  // an API route, runs server code and may need credentials, so it is followed through the module graph.
  const isAsset = request => request.method === 'GET' && ASSET_TYPES.includes(request.type)
    && !pageFiles.some(file => routePattern(file).test(new URL(BASE + request.url).pathname));
  const planner = scenarioPlanner(names, changed, reference?.scenarios);
  const ran = [];
  for (const name of names) {
    if (!planner.shouldRun(name)) {
      const earlier = reference.scenarios[name];
      for (const file of earlier.images) await copyFile(`${REFERENCE}/${file}`, `${OUT}/${file}`);
      captured.push(...earlier.captured);
      scenarios.push({ name, title: earlier.title, steps: earlier.steps });
      cache.scenarios[name] = earlier;
      continue;
    }
    const scenario = (await import(pathToFileURL(script(name)).href)).default;
    currentScenario = name;
    scenarioPaths = [];
    const filesBefore = new Set(requestsByFile.keys());
    const stateBefore = await stateHash();
    const steps = await scenario.run({ base: BASE, capture, sql, ownerFetch });
    const wrote = (await stateHash()) !== stateBefore;
    planner.ran(name, wrote);
    scenarios.push({ name, title: scenario.title, steps });
    const images = [...requestsByFile.keys()].filter(file => !filesBefore.has(file));
    const requests = images.flatMap(file => requestsByFile.get(file));
    ran.push({ name, title: scenario.title, steps, images, wrote,
      paths: [...scenarioPaths, ...requests.filter(request => !isAsset(request)).map(request => new URL(BASE + request.url).pathname)],
      assets: requests.filter(isAsset).map(({ url, accept }) => ({ url, accept })),
      captured: captured.filter(item => item.scenario === name) });
  }
  currentScenario = undefined;
  if (ran.length) {
    // The dev server's module graph names the source files behind each route a scenario hit.
    const graph = await fetch(`${BASE}/__screenshots/deps`).then(response => response.json()).catch(() => {
      throw new Error('No module graph at /__screenshots/deps: start the dev server with --config scripts/screenshots/dev.config.mjs.');
    });
    for (const { name, paths, wrote, ...rest } of ran) {
      const roots = ['src/middleware.ts', ...new Set(paths.flatMap(path => routeFiles(path, pageFiles)))];
      const { files, content } = sourceClosure(graph, roots);
      cache.scenarios[name] = { ...rest, files, content, key: await keyFor(name, { files, content, assets: rest.assets }), writer: wrote };
    }
  }
  console.log(`Reused ${reusedPages} of ${PAGES.length * VIEWPORTS.length} page images.`);
  console.log(`Scenarios run: ${ran.map(item => item.name).join(', ') || 'none'}. Reused: ${names.filter(name => !ran.some(item => item.name === name)).join(', ') || 'none'}.`);
  errors.push(...missingScenarioRoutes(SCENARIO_PAGES, captured).map(file => `${file}: its scenario captured no page under its route`));
  await writeFile(`${OUT}/manifest.json`, JSON.stringify({ pages: PAGES, scenarios }, null, 2));
  await writeFile(`${OUT}/cache.json`, JSON.stringify(cache));
} finally {
  await browser.close();
  issuer.close();
}
if (errors.length) {
  console.error(`Screenshot checks failed:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`Saved screenshots to ${OUT}/`);
