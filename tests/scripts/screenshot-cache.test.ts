import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { hashFiles, listFiles, routeFiles, routePattern, scenarioPlanner, sourceClosure, stateHash } from '../../scripts/screenshots/cache.mjs';

const PAGE_FILES = [
  'src/pages/404.astro',
  'src/pages/index.astro',
  'src/pages/services.astro',
  'src/pages/services.html.astro',
  'src/pages/owner/requests/index.astro',
  'src/pages/owner/requests/[id].astro',
  'src/pages/owner/requests/[id]/offer.astro',
  'src/pages/offer/[token]/verify.astro',
  'src/pages/api/owner/requests/[id]/software.ts',
  'src/pages/audio/file/[...path].ts',
];

describe('routeFiles', () => {
  it.each([
    ['/', ['src/pages/index.astro']],
    ['/services', ['src/pages/services.astro']],
    ['/services.html', ['src/pages/services.html.astro']],
    ['/owner/requests', ['src/pages/owner/requests/index.astro']],
    ['/owner/requests/', ['src/pages/owner/requests/index.astro']],
    ['/owner/requests/screenshot-offer', ['src/pages/owner/requests/[id].astro']],
    ['/owner/requests/screenshot-offer/offer', ['src/pages/owner/requests/[id]/offer.astro']],
    ['/offer/abc/verify', ['src/pages/offer/[token]/verify.astro']],
    ['/api/owner/requests/x/software', ['src/pages/api/owner/requests/[id]/software.ts']],
    ['/audio/file/a/b.mp3', ['src/pages/audio/file/[...path].ts']],
    ['/this-page-does-not-exist', ['src/pages/404.astro']],
  ])('%s is served by %j', (pathname, files) => {
    expect(routeFiles(pathname, PAGE_FILES)).toEqual(files);
  });

  it('does not let a parameter cross a slash', () => {
    expect(routePattern('src/pages/owner/requests/[id].astro').test('/owner/requests/a/b')).toBe(false);
  });
});

describe('sourceClosure', () => {
  const root = '/repo';
  const graph = {
    '/repo/src/pages/a.astro': { file: '/repo/src/pages/a.astro', imports: ['/repo/src/lib/x.ts', '\0astro:content'] },
    '/repo/src/pages/a.astro?astro&type=style&index=0&lang.css': { file: '/repo/src/pages/a.astro', imports: ['/repo/src/styles/a.css'] },
    '/repo/src/lib/x.ts': { file: '/repo/src/lib/x.ts', imports: ['/repo/node_modules/jose/index.js', '/repo/src/lib/y.ts'] },
    '/repo/src/lib/y.ts': { file: '/repo/src/lib/y.ts', imports: ['/repo/src/lib/x.ts'] },
    '/repo/src/styles/a.css': { file: '/repo/src/styles/a.css', imports: [] },
    '/repo/node_modules/jose/index.js': { file: '/repo/node_modules/jose/index.js', imports: [] },
    '\0astro:content': { file: null, imports: [] },
    '/repo/src/pages/b.astro': { file: '/repo/src/pages/b.astro', imports: ['/repo/src/lib/z.ts'] },
  };

  it('follows imports from a root file, skipping node_modules, cycles and stylesheet imports', () => {
    expect(sourceClosure(graph, ['src/pages/a.astro'], root)).toEqual({
      files: ['src/lib/x.ts', 'src/lib/y.ts', 'src/pages/a.astro'],
      content: true,
    });
  });

  it("does not follow a stylesheet's imports, which Tailwind fills with every scanned file", () => {
    const tailwind = {
      '/repo/src/pages/c.astro': { file: '/repo/src/pages/c.astro', imports: ['/repo/src/styles/global.css', '/repo/src/pages/c.astro?astro&type=style&index=0&lang.css'] },
      '/repo/src/styles/global.css': { file: '/repo/src/styles/global.css', imports: ['/repo/src/lib/unrelated.ts'] },
      '/repo/src/pages/c.astro?astro&type=style&index=0&lang.css': { file: '/repo/src/pages/c.astro', imports: ['/repo/src/lib/also-unrelated.ts'] },
    };
    expect(sourceClosure(tailwind, ['src/pages/c.astro'], root).files).toEqual(['src/pages/c.astro', 'src/styles/global.css']);
  });

  it('keeps a root the graph never loaded', () => {
    expect(sourceClosure(graph, ['src/pages/never.astro'], root)).toEqual({ files: ['src/pages/never.astro'], content: false });
  });
});

describe('scenarioPlanner', () => {
  const names = ['a-writer', 'b-reader', 'c-writer', 'd-reader'];
  const reference = { 'a-writer': { writer: true }, 'b-reader': { writer: false }, 'c-writer': { writer: true }, 'd-reader': { writer: false } };
  const run = (changed: string[], wrote: Record<string, boolean> = {}) => {
    const planner = scenarioPlanner(names, new Set(changed), reference);
    const ran: string[] = [];
    for (const name of names) {
      if (!planner.shouldRun(name)) continue;
      ran.push(name);
      planner.ran(name, wrote[name] ?? reference[name as keyof typeof reference].writer);
    }
    return ran;
  };

  it('runs nothing when no key changed', () => {
    expect(run([])).toEqual([]);
  });

  it('runs a changed reader after rebuilding the state written before it', () => {
    expect(run(['b-reader'])).toEqual(['a-writer', 'b-reader']);
  });

  it('runs everything after a changed writer', () => {
    expect(run(['c-writer'])).toEqual(['a-writer', 'c-writer', 'd-reader']);
  });

  it('runs everything after a reader that starts writing', () => {
    expect(run(['b-reader'], { 'b-reader': true })).toEqual(['a-writer', 'b-reader', 'c-writer', 'd-reader']);
  });

  it('treats a scenario missing from the reference as a writer', () => {
    const planner = scenarioPlanner(['new', 'old'], new Set(['new']), { old: { writer: false } });
    expect(planner.shouldRun('new')).toBe(true);
    planner.ran('new', true);
    expect(planner.shouldRun('old')).toBe(true);
  });
});

describe('hashFiles', () => {
  it('changes with content, names and deletions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'screenshot-cache-'));
    try {
      await mkdir(join(root, 'dir'));
      await writeFile(join(root, 'dir/a.txt'), 'a');
      await writeFile(join(root, 'b.txt'), 'b');
      const files = await listFiles(['dir', 'b.txt', 'missing'], root);
      expect(files).toEqual(['b.txt', 'dir/a.txt']);
      const before = await hashFiles(files, root);
      expect(await hashFiles([...files].reverse(), root)).toBe(before);
      await writeFile(join(root, 'dir/a.txt'), 'changed');
      expect(await hashFiles(files, root)).not.toBe(before);
      await rm(join(root, 'b.txt'));
      expect(await listFiles(['dir', 'b.txt'], root)).toEqual(['dir/a.txt']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('stateHash', () => {
  it("changes when a row does, not when Miniflare's query bookkeeping does", async () => {
    const root = await mkdtemp(join(tmpdir(), 'screenshot-state-'));
    try {
      await mkdir(join(root, 'd1'));
      await writeFile(join(root, 'blob'), 'kv value');
      const db = new DatabaseSync(join(root, 'd1/db.sqlite'));
      db.exec("PRAGMA journal_mode = WAL; CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB); CREATE TABLE requests (id TEXT PRIMARY KEY, body BLOB); INSERT INTO _cf_METADATA VALUES (1, x'01'); INSERT INTO requests VALUES ('a', x'ff');");
      const before = await stateHash(root);
      db.exec("UPDATE _cf_METADATA SET value = x'02'");
      expect(await stateHash(root)).toBe(before);
      db.exec("INSERT INTO requests VALUES ('b', NULL)");
      const written = await stateHash(root);
      expect(written).not.toBe(before);
      db.close();
      await writeFile(join(root, 'blob'), 'changed');
      expect(await stateHash(root)).not.toBe(written);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
