// Decides which screenshots CI can reuse from an earlier run. An image is reused only when every
// input it was drawn from is unchanged: the bytes the browser loaded for a page, and for a scenario
// its script, the source files behind each route it hit and the assets it loaded.
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Bump to discard every stored reference after changing what a key covers. */
export const CACHE_VERSION = 1;
export const REFERENCE = '.screenshots/reference';

/** Inputs that can change any image. A change to one of them recaptures everything. */
export const GLOBAL_INPUTS = ['package-lock.json', 'astro.config.mjs', 'tsconfig.json', 'wrangler.jsonc', 'migrations', 'scripts/screenshots', '.github/workflows/screenshots.yml'];
// Each scenario's own script goes into its own key instead.
const NOT_GLOBAL = ['scripts/screenshots/scenarios'];
// Content collections reach pages through Astro's data store, not imports.
const CONTENT_MODULES = ['\0astro:content', '\0astro:data-layer-content'];
const CONTENT_DIR = 'src/content';
// Tailwind lists every file it scans as an import of each stylesheet. The stylesheet reaches the
// browser as an asset whose bytes are replayed, so its own imports are not followed.
const STYLESHEET = /\.css($|\?)|[?&]lang\.css|[?&]type=style/;
// Requests for these are replayed and hashed; any other request runs server code for a route.
export const ASSET_TYPES = ['stylesheet', 'script', 'image', 'font', 'media'];

export const sha256 = data => createHash('sha256').update(data).digest('hex');

// Vite tags optimized dependencies with ?v=<hash>, and the hash changes each time the dev server
// starts. Those files come from package-lock.json, already in the global key, so the tag is dropped
// from recorded URLs and from response bodies before hashing.
const VITE_VERSION = /([?&])v=[0-9a-f]{6,}(&|$)/;
export const withoutViteVersion = url => url.replace(VITE_VERSION, (_, before, after) => (after ? before : ''));
// Vite's own client embeds a token made at each server start; its code comes from package-lock.json.
export const UNHASHED_URLS = ['/@vite/client'];
export const hashBody = body => sha256(Buffer.from(body).toString('latin1').replace(/([?&]v=)[0-9a-f]{6,}/g, '$1'));

/** Every file under the given paths, relative to root and sorted. Missing paths are skipped. */
export async function listFiles(paths, root = process.cwd(), exclude = []) {
  const files = [];
  const walk = async path => {
    if (exclude.includes(path)) return;
    const info = await stat(join(root, path)).catch(() => null);
    if (!info) return;
    if (!info.isDirectory()) return void files.push(path);
    for (const name of await readdir(join(root, path))) await walk(`${path}/${name}`);
  };
  for (const path of paths) await walk(path);
  return [...new Set(files)].sort();
}

/** Hash of the files' names and contents, so an edit, a rename or a deletion each change it. */
export async function hashFiles(files, root = process.cwd()) {
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    const content = await readFile(join(root, file)).catch(() => null);
    hash.update(`${file}\0${content === null ? 'missing' : sha256(content)}\0`);
  }
  return hash.digest('hex');
}

export async function globalKey(runtime, root = process.cwd()) {
  return sha256(JSON.stringify({ version: CACHE_VERSION, runtime, files: await hashFiles(await listFiles(GLOBAL_INPUTS, root, NOT_GLOBAL), root) }));
}

// Miniflare updates this table on every D1 query, reads included.
const BOOKKEEPING_TABLES = ['_cf_METADATA'];

/**
 * What the local D1, KV and R2 storage holds: every SQLite database's schema and rows (read from a
 * copy, so the live files are untouched) and every other file's bytes.
 */
export async function stateHash(directory = '.wrangler/state') {
  const root = resolve(directory);
  const hash = createHash('sha256');
  const copies = await mkdtemp(join(tmpdir(), 'screenshot-state-'));
  try {
    for (const file of (await listFiles(['.'], root)).filter(file => !/-(wal|shm)$/.test(file))) {
      if (!file.endsWith('.sqlite')) {
        hash.update(`${file}\0${sha256(await readFile(join(root, file)))}\0`);
        continue;
      }
      const copy = join(copies, 'db.sqlite');
      await rm(`${copy}-wal`, { force: true });
      await copyFile(join(root, file), copy);
      await copyFile(join(root, `${file}-wal`), `${copy}-wal`).catch(() => {});
      const db = new DatabaseSync(copy);
      try {
        const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
          .filter(table => !BOOKKEEPING_TABLES.includes(table.name));
        for (const { name, sql } of tables) {
          const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
            .map(row => JSON.stringify(row, (_, value) => (value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value))).sort();
          hash.update(`${file}\0${sql}\0${sha256(rows.join('\n'))}\0`);
        }
      } finally {
        db.close();
      }
      await rm(copy, { force: true });
    }
  } finally {
    await rm(copies, { recursive: true, force: true });
  }
  return hash.digest('hex');
}

/** A pattern matching the URL paths a file in src/pages serves. */
export function routePattern(file) {
  const route = file.replace(/^src\/pages/, '').replace(/\.(astro|ts|js|mjs)$/, '').replace(/\/index$/, '') || '/';
  const source = route.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]|[^[]+/g, part =>
    part.startsWith('[...') ? '.*' : part.startsWith('[') ? '[^/]+' : part.replace(/[.*+?^${}()|\\]/g, '\\$&'));
  return new RegExp(`^${source}/?$`);
}

/** Every page file that could serve the path, or the 404 page when none can. */
export function routeFiles(pathname, pageFiles) {
  const matches = pageFiles.filter(file => routePattern(file).test(pathname));
  return matches.length ? matches : pageFiles.filter(file => file === 'src/pages/404.astro');
}

/**
 * Source files the server loaded for the given files, following the dev server's module graph
 * (`{ [id]: { file, imports: [id] } }`). Returns repository files outside node_modules, and whether
 * any of them read content collections.
 */
export function sourceClosure(graph, roots, root = process.cwd()) {
  const files = new Set(roots);
  const absolute = new Set(roots.map(file => resolve(root, file)));
  const queue = Object.entries(graph).filter(([, mod]) => absolute.has(mod.file)).map(([id]) => id);
  const seen = new Set(queue);
  let content = false;
  while (queue.length) {
    const id = queue.pop();
    if (CONTENT_MODULES.includes(id)) content = true;
    const mod = graph[id];
    if (!mod) continue;
    if (mod.file) {
      const file = relative(root, mod.file).split(sep).join('/');
      if (!file.startsWith('..') && !file.split('/').includes('node_modules')) files.add(file);
    }
    if (STYLESHEET.test(id)) continue;
    for (const next of mod.imports ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return { files: [...files].sort(), content };
}

/** A scenario's key: the day, its script, the source files behind its routes, and its replayed assets. */
export async function scenarioKey({ global, day, script, files, content, assets }, root = process.cwd()) {
  const sources = content ? [...files, ...await listFiles([CONTENT_DIR], root)] : files;
  return sha256(JSON.stringify({ global, day, script: await hashFiles([script], root), sources: await hashFiles(sources, root), assets }));
}

/**
 * Whether to run each scenario, decided in order as they go. Scenarios share one database, so one
 * that writes to it shapes the ones after it. A scenario runs when its key changed; every writer
 * before the last changed scenario runs too, to rebuild the state that scenario expects; and once a
 * run writes differently from the reference, everything after it runs.
 */
export function scenarioPlanner(names, changed, reference) {
  const writer = name => reference?.[name]?.writer ?? true;
  const last = Math.max(-1, ...names.map((name, index) => (changed.has(name) ? index : -1)));
  let diverged = false;
  return {
    shouldRun: name => diverged || changed.has(name) || (writer(name) && names.indexOf(name) < last),
    /** Call after running a scenario, with whether it changed the stored state. */
    ran(name, wrote) {
      if (wrote !== writer(name) || (wrote && changed.has(name))) diverged = true;
    },
  };
}
