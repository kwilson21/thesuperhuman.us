import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileViolations, isScannable, lineViolations } from '../../scripts/check-copy.mjs';

describe('lineViolations', () => {
  it('clears an ordinary line', () => {
    expect(lineViolations('Fixed-price engagements, async-first, no fluff.')).toEqual([]);
  });

  it('flags an em-dash', () => {
    const hits = lineViolations('people who want more—whether that means merch');
    expect(hits).toEqual([{ rule: 'em-dash', label: 'em-dash (U+2014)', match: '—' }]);
  });

  it('flags each buzzword, case-insensitively', () => {
    expect(lineViolations('a Passionate engineer').map(h => h.rule)).toEqual(['buzzword']);
    expect(lineViolations('an innovative approach').map(h => h.rule)).toEqual(['buzzword']);
    expect(lineViolations('guru ninja rockstar').map(h => h.match)).toEqual(['guru', 'ninja', 'rockstar']);
  });

  it('does not flag a buzzword as part of a longer word', () => {
    expect(lineViolations('Guruship is not a word we use')).toEqual([]);
    expect(lineViolations('ninjastar is not a real word')).toEqual([]);
  });

  it('flags hourly-rate phrasing', () => {
    expect(lineViolations('billed hourly').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150 per hour').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150/hr').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150/hour').map(h => h.rule)).toEqual(['hourly-rate']);
  });

  it('does not flag unrelated uses of "hour"', () => {
    expect(lineViolations('hour: "numeric"')).toEqual([]);
    expect(lineViolations('What took hours can sometimes take minutes.')).toEqual([]);
    expect(lineViolations('Open hours: 9 to 5')).toEqual([]);
  });

  it('flags implied current clearance phrases', () => {
    expect(lineViolations('a TS/SCI cleared engineer').map(h => h.rule)).toEqual(['implied-clearance', 'implied-clearance']);
    expect(lineViolations('active security clearance required').map(h => h.rule)).toEqual(['implied-clearance']);
    expect(lineViolations('holds an active clearance').map(h => h.rule)).toEqual(['implied-clearance']);
    expect(lineViolations('a cleared developer').map(h => h.rule)).toEqual(['implied-clearance']);
  });

  it('is case-insensitive for clearance phrases', () => {
    expect(lineViolations('Active Clearance').map(h => h.rule)).toEqual(['implied-clearance']);
  });

  it('skips a line carrying the allow marker', () => {
    expect(lineViolations('a passionate guru — copy-check: allow')).toEqual([]);
  });

  it('reports multiple violations on one line', () => {
    const hits = lineViolations('a passionate guru — billed hourly');
    expect(hits.map(h => h.rule).sort()).toEqual(['buzzword', 'buzzword', 'em-dash', 'hourly-rate'].sort());
  });
});

describe('fileViolations', () => {
  it('reports 1-based line numbers', () => {
    const content = 'line one\nline two has a passionate tone\nline three';
    expect(fileViolations('src/foo.astro', content)).toEqual([
      { path: 'src/foo.astro', line: 2, rule: 'buzzword', label: 'buzzword', match: 'passionate' },
    ]);
  });
});

describe('isScannable', () => {
  it('scans copy-bearing extensions', () => {
    for (const path of ['a.astro', 'a.ts', 'a.tsx', 'a.js', 'a.mjs', 'a.json', 'a.md', 'a.mdx', 'a.html', 'a.txt', 'a.svg']) {
      expect(isScannable(path)).toBe(true);
    }
  });

  it('skips CSS and binary/image files', () => {
    for (const path of ['a.css', 'a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.avif', 'a.gif', 'a.ico', 'a.woff2']) {
      expect(isScannable(path)).toBe(false);
    }
  });

  it('skips CLAUDE.md and AGENTS.md by basename regardless of directory', () => {
    expect(isScannable('CLAUDE.md')).toBe(false);
    expect(isScannable('nested/dir/CLAUDE.md')).toBe(false);
    expect(isScannable('AGENTS.md')).toBe(false);
  });
});

const checker = resolve('scripts/check-copy.mjs');
const roots: string[] = [];
const run = (cwd: string) => spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'website-copy-check-'));
  mkdirSync(join(root, 'src/pages'), { recursive: true });
  mkdirSync(join(root, 'public'), { recursive: true });
  return root;
}

describe('copy-check CLI', () => {
  it('passes on clean src/public/README content', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'src/pages/index.astro'), '<p>Fixed-price engagements, async-first.</p>\n');
    writeFileSync(join(root, 'public/robots.txt'), 'User-agent: *\n');
    writeFileSync(join(root, 'README.md'), '# Site\n');
    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('copy-check passed');
  });

  it('fails and reports file:line for a violation in src/', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'src/pages/index.astro'), 'line one\nA passionate ninja billed hourly.\n');
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/pages/index.astro:2');
    expect(result.stderr).toContain('buzzword');
    expect(result.stderr).toContain('hourly rate copy');
  });

  it('ignores CSS files even with banned characters', () => {
    const root = fixtureRepo();
    mkdirSync(join(root, 'src/styles'), { recursive: true });
    writeFileSync(join(root, 'src/styles/owner.css'), '.x:before{content:"—"}\n');
    const result = run(root);
    expect(result.status).toBe(0);
  });

  it('does not scan CLAUDE.md even though it states the banned words', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'CLAUDE.md'), 'Never use buzzwords: passionate, innovative, guru, ninja, rockstar\n');
    const result = run(root);
    expect(result.status).toBe(0);
  });

  it('honors the copy-check: allow escape hatch', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'src/pages/index.astro'), 'a passionate guru <!-- copy-check: allow -->\n');
    const result = run(root);
    expect(result.status).toBe(0);
  });
});
