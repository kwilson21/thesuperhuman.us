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

  it('flags em-dash HTML entities, case-insensitively', () => {
    expect(lineViolations('more&mdash;less').map(h => h.match)).toEqual(['&mdash;']);
    expect(lineViolations('more&MDash;less').map(h => h.match)).toEqual(['&MDash;']);
    expect(lineViolations('more&#8212;less').map(h => h.match)).toEqual(['&#8212;']);
    expect(lineViolations('more&#x2014;less').map(h => h.match)).toEqual(['&#x2014;']);
    expect(lineViolations('more&#X2014;less').map(h => h.match)).toEqual(['&#X2014;']);
  });

  it('flags a backslash-u escape for the em-dash character', () => {
    expect(lineViolations('more\\u2014less').map(h => h.rule)).toEqual(['em-dash']);
    expect(lineViolations('more\\U2014less').map(h => h.rule)).toEqual(['em-dash']);
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

  it('flags hourly-rate phrases', () => {
    expect(lineViolations('our hourly rate is set').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('hourly rates vary').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('billed hourly').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('we charge hourly').map(h => h.rule)).toEqual(['hourly-rate']);
  });

  it('flags a dollar amount billed by the hour', () => {
    expect(lineViolations('$150/hr').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150/hour').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150 per hour').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150 an hour').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150 / hr').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150-per-hour').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('rate: $150 hourly').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('$150/h').map(h => h.rule)).toEqual(['hourly-rate']);
  });

  it('flags hourly billing and per-hour pricing phrasing', () => {
    expect(lineViolations('hourly billing').map(h => h.rule)).toEqual(['hourly-rate']);
    expect(lineViolations('per-hour pricing').map(h => h.rule)).toEqual(['hourly-rate']);
  });

  it('does not flag plain mentions of hourly or per-hour cadence', () => {
    expect(lineViolations('fixed-price, never hourly')).toEqual([]);
    expect(lineViolations('5 requests per hour')).toEqual([]);
    expect(lineViolations('an hourly cleanup job')).toEqual([]);
    expect(lineViolations('see /hr-team for details')).toEqual([]);
    expect(lineViolations('hour: "numeric"')).toEqual([]);
    expect(lineViolations('What took hours can sometimes take minutes.')).toEqual([]);
    expect(lineViolations('Open hours: 9 to 5')).toEqual([]);
    expect(lineViolations('$150 a head')).toEqual([]);
  });

  it('does not flag the approved flat audio starting prices', () => {
    expect(lineViolations('Two-track vocal mixing starts at $150.')).toEqual([]);
    expect(lineViolations('Mastering starts at $75.')).toEqual([]);
    expect(lineViolations('Vocal mix plus master starts at $200.')).toEqual([]);
  });

  it('does not mistake a dollar amount before an unrelated "h" word for a rate', () => {
    expect(lineViolations('$150/hero')).toEqual([]);
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

  it('does not flag approved negative clearance wording', () => {
    expect(lineViolations('No active security clearance.')).toEqual([]);
    expect(lineViolations('no active clearance')).toEqual([]);
    expect(lineViolations('He does not currently hold an active clearance.')).toEqual([]);
    expect(lineViolations("doesn't have an active security clearance")).toEqual([]);
  });

  it('still flags active clearance claims without a negation nearby', () => {
    expect(lineViolations('Currently has an active security clearance.').map(h => h.rule)).toEqual(['implied-clearance']);
    expect(lineViolations('Holds an active clearance today.').map(h => h.rule)).toEqual(['implied-clearance']);
  });

  it('flags a real claim even when an earlier negation is in a different clause', () => {
    expect(lineViolations('No problem: I hold an active clearance').map(h => h.rule)).toEqual(['implied-clearance']);
    expect(lineViolations('Not sure? I hold an active security clearance.').map(h => h.rule)).toEqual(['implied-clearance']);
    expect(lineViolations("I don't do fluff. I hold an active clearance").map(h => h.rule)).toEqual(['implied-clearance']);
    expect(lineViolations('No, I hold an active clearance').map(h => h.rule)).toEqual(['implied-clearance']);
  });

  it('still allows negation adjacent to the claim within the same clause', () => {
    expect(lineViolations('No active security clearance, but open to pursuing one for the right engagement.')).toEqual([]);
    expect(lineViolations('I do not hold an active clearance')).toEqual([]);
    expect(lineViolations("I don't currently hold an active clearance")).toEqual([]);
    expect(lineViolations('without an active clearance')).toEqual([]);
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
  roots.push(root);
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

  it('passes approved negative clearance wording', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'src/pages/about.astro'), '<p>No active security clearance, but open to pursuing one.</p>\n');
    const result = run(root);
    expect(result.status).toBe(0);
  });

  it('fails on an em-dash HTML entity', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'src/pages/about.astro'), 'more&mdash;less\n');
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('em-dash');
  });

  it('does not flag ordinary per-hour or hourly-adjacent copy', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'src/pages/about.astro'), 'Fixed-price, never hourly. Rate limited to 5 requests per hour.\n');
    const result = run(root);
    expect(result.status).toBe(0);
  });
});
