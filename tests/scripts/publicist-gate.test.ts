import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentsBlock, captureProblems, entriesNeedingNotes, entryIds, frontMatter, hardRules, noteProblems, syncAgents, textProblems } from '../../scripts/publicist/lib.mjs';

const note = ({ tier = 'shipped', draft = 'verified', publish = 'yes', readiness = 'ready', bullets = true, draftText = true } = {}) => `---
entry: tally-home-screen
tier: ${tier}
---

## Refresher
A two-minute read.

${bullets ? '- **One line:** Home leads with safe to spend.' : ''}

## Draft entry
**The Home screen** · 2026-09-23
${draftText ? '> Home leads with safe to spend.' : ''}

## Visual aids
Screenshot.

## 1. What changed
Home leads with safe to spend. · status: unverified

## 2. How it works, at a high level
Answer. · status: verified

## 3. Why this approach
Answer. · status: corrected

## 4. Misuse and failure cases
Answer. · status: verified

## 5. Status at the time
Built. · status: verified

## 6. Sources checked
## 7. Unresolved

## Owner review
- Corrections: none
- Draft entry: ${draft}
- Whiteboard defense: ${readiness}
- Publish: ${publish}
`;

describe('noteProblems', () => {
  it('clears a fully verified shipped note marked ready', () => {
    expect(noteProblems(note())).toEqual([]);
  });
  it('clears on an approved draft even with unverified detail answers', () => {
    expect(noteProblems(note({ draft: 'corrected' }))).toEqual([]);
  });
  it('accepts decisions recorded from conversation with their source', () => {
    const src = ' (owner, in conversation, 2026-09-23)';
    expect(noteProblems(note({ draft: `verified${src}`, publish: `yes${src}`, readiness: `ready${src}` }))).toEqual([]);
  });
  it('holds a draft the owner has not approved', () => {
    expect(noteProblems(note({ draft: 'unverified' }))).toContain('draft entry not approved');
  });
  it('holds a note without draft text', () => {
    expect(noteProblems(note({ draftText: false }))).toContain('draft entry missing');
  });
  it('holds a note without refresher bullets', () => {
    expect(noteProblems(note({ bullets: false }))).toContain('refresher missing');
  });
  it('holds a shipped note marked not yet', () => {
    expect(noteProblems(note({ readiness: 'not yet' }))).toContain('shipped entry not marked ready');
  });
  it('requires not applicable for exploration work', () => {
    expect(noteProblems(note({ tier: 'exploration', readiness: 'not applicable' }))).toEqual([]);
    expect(noteProblems(note({ tier: 'exploration', readiness: 'ready' }))).toContain('exploration entry needs not applicable');
  });
  it('holds anything but publish yes', () => {
    expect(noteProblems(note({ publish: 'hold' }))).toContain('publish is not yes');
  });
  it('never treats an unfilled template as approved', () => {
    const template = readFileSync('docs/publicist/review-note-template.md', 'utf8');
    const block = template.match(/```markdown\n([\s\S]*?)\n```/)![1];
    const problems = noteProblems(block);
    expect(problems).toContain('publish is not yes');
    expect(problems).toContain('tier missing or invalid');
    expect(problems).toContain('draft entry not approved');
  });
});

describe('text checks', () => {
  it('flags em dashes and secret-shaped strings', () => {
    expect(textProblems('A — B')).toEqual(['contains an em dash']);
    expect(textProblems('token ghp_abcdefghijklmnopqrstuvwxyz0123')).toEqual(['contains a secret-shaped string']);
    expect(textProblems('Plain text.')).toEqual([]);
  });
  it('requires Tally captures to be labeled demo data', () => {
    expect(captureProblems("artifact(a, 'Home', 'Caption.', 'Browser capture · demo data')")).toEqual([]);
    expect(captureProblems("artifact(a, 'Home', 'Caption.', 'Browser capture')")).toHaveLength(1);
  });
  it('reads entry IDs and queue front matter', () => {
    expect(entryIds("{ id: 'tally-home-screen', day: '2026-09-23' }, { id: 'tally-phase-0' }")).toEqual(['tally-home-screen', 'tally-phase-0']);
    expect(frontMatter('---\nsource: tally-home-screen   # comment\nplatform: x\n---\nBody')).toEqual({ source: 'tally-home-screen', platform: 'x' });
  });
});

describe('entries needing notes', () => {
  const source = "[{ id: 'site-old', day: '2026-09-20' }, { id: 'site-new', day: '2026-09-27' }, { id: 'site-undated' }]";
  it('needs a note for every entry without a start date', () => {
    expect(entriesNeedingNotes(source)).toEqual(['site-old', 'site-new', 'site-undated']);
  });
  it('leaves out entries dated before the project joined, never undated ones', () => {
    expect(entriesNeedingNotes(source, '2026-09-27')).toEqual(['site-new', 'site-undated']);
  });
  it('keeps the website joined from September 27', () => {
    const config = JSON.parse(readFileSync('publicist/config.json', 'utf8'));
    expect(config.projects['personal-website']).toMatchObject({ repo: 'kwilson21/thesuperhuman.us', notesSince: '2026-09-27' });
  });
});

describe('AGENTS.md sync', () => {
  const skill = '# S\n\n## Hard rules (never break these)\n\n1. Rule one.\n\n## Review notes\n\nText.\n';
  it('extracts the hard rules and inserts the block idempotently', () => {
    expect(hardRules(skill)).toBe('1. Rule one.');
    const once = syncAgents('# Agents\n', skill);
    expect(once).toContain(agentsBlock(skill));
    expect(syncAgents(once, skill)).toBe(once);
  });
  it('keeps the committed AGENTS.md in sync with the canonical skill', () => {
    const canonical = readFileSync('.agents/skills/publicist/SKILL.md', 'utf8');
    expect(readFileSync('AGENTS.md', 'utf8')).toContain(agentsBlock(canonical));
  });
});

describe('gate runner', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  function fixture(entrySource: string | null, websiteSource?: string) {
    const root = mkdtempSync(join(tmpdir(), 'publicist-gate-')); roots.push(root);
    for (const dir of ['publicist', '.agents/skills/publicist', 'src/data/project-stories']) mkdirSync(join(root, dir), { recursive: true });
    const skill = readFileSync('.agents/skills/publicist/SKILL.md', 'utf8');
    writeFileSync(join(root, '.agents/skills/publicist/SKILL.md'), skill);
    writeFileSync(join(root, 'AGENTS.md'), syncAgents('# Agents\n', skill));
    writeFileSync(join(root, 'publicist/config.json'), readFileSync('publicist/config.json'));
    if (entrySource) writeFileSync(join(root, 'src/data/project-stories/tally.ts'), entrySource);
    if (websiteSource) writeFileSync(join(root, 'src/data/project-stories/personal-website.ts'), websiteSource);
    return root;
  }
  const run = (root: string, env: Record<string, string>) => spawnSync(process.execPath, [resolve('scripts/publicist/gate.mjs')], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env },
  });
  it('passes with no publicist entries', () => {
    expect(run(fixture(null), { CI: 'true' }).status).toBe(0);
  });
  it('fails in CI when entries exist but the private token is missing', () => {
    const result = run(fixture("export const x = [{ id: 'tally-home-screen', day: '2026-09-23' }];"), { CI: 'true' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PUBLICIST_PRIVATE_TOKEN is not set');
  });
  it('does not ask for notes on website entries from before the website joined', () => {
    const result = run(fixture(null, "export const x = [{ id: 'website-start', day: '2026-09-09' }];"), { CI: 'true' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 entries checked');
  });
  it('asks for notes on website entries from the day it joined', () => {
    const result = run(fixture(null, "export const x = [{ id: 'website-motion', day: '2026-09-27' }];"), { CI: 'true' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PUBLICIST_PRIVATE_TOKEN is not set');
  });
  it('warns instead of failing on a local build without the token', () => {
    const result = run(fixture("export const x = [{ id: 'tally-home-screen', day: '2026-09-23' }];"), {});
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('skipped private note lookup');
  });
});
