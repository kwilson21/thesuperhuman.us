#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// Mechanical checks for the copy rules in CLAUDE.md ("Things to Never Do",
// "Clearance posture"). This cannot judge tone or whether copy is true; it
// only catches the specific banned characters and phrases below.

const ROOTS = ['src', 'public', 'README.md'];
const EXTENSIONS = new Set(['.astro', '.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.mdx', '.html', '.txt', '.svg']);
const SKIP_BASENAMES = new Set(['CLAUDE.md', 'AGENTS.md']);
const ALLOW_MARKER = 'copy-check: allow';

/**
 * Rules, in the order CLAUDE.md lists them. Each pattern is matched per
 * line with the `g` flag so every occurrence on a line is reported.
 */
export const RULES = [
  { id: 'em-dash', label: 'em-dash (U+2014)', pattern: /—/g },
  { id: 'buzzword', label: 'buzzword', pattern: /\b(passionate|innovative|guru|ninja|rockstar)\b/gi },
  { id: 'hourly-rate', label: 'hourly rate copy', pattern: /\b(?:hourly|per hour)\b|\/hr\b|\/hour\b/gi },
  {
    id: 'implied-clearance',
    label: 'implied current clearance',
    pattern: /\b(?:TS\/SCI|active clearance|active security clearance|cleared engineer|cleared developer)\b/gi,
  },
];

/**
 * Violations on a single line of text. Returns `[]` for a clean line or a
 * line carrying the `copy-check: allow` escape hatch.
 */
export function lineViolations(line) {
  if (line.includes(ALLOW_MARKER)) return [];
  const hits = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = re.exec(line))) {
      hits.push({ rule: rule.id, label: rule.label, match: match[0] });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return hits;
}

/** Violations across a whole file's text, with 1-based line numbers. */
export function fileViolations(path, content) {
  const violations = [];
  content.split('\n').forEach((line, index) => {
    for (const hit of lineViolations(line)) violations.push({ path, line: index + 1, ...hit });
  });
  return violations;
}

/** True when a path (relative, posix-ish) should be scanned. */
export function isScannable(path) {
  const name = basename(path);
  if (SKIP_BASENAMES.has(name)) return false;
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return EXTENSIONS.has(name.slice(dot));
}

function collectFiles(root) {
  const stats = statSync(root, { throwIfNoEntry: false });
  if (!stats) return [];
  if (stats.isFile()) return isScannable(root) ? [root] : [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    else if (entry.isFile() && isScannable(path)) files.push(path);
  }
  return files;
}

function main() {
  const violations = [];
  for (const root of ROOTS) {
    for (const path of collectFiles(root)) {
      const content = readFileSync(path, 'utf8');
      violations.push(...fileViolations(path, content));
    }
  }
  if (violations.length) {
    const lines = violations.map(v => `${v.path}:${v.line}: ${v.label}: ${JSON.stringify(v.match)}`);
    console.error(`copy-check failed:\n- ${lines.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('copy-check passed: no banned copy patterns found.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
