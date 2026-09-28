#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// Mechanical checks for the copy rules in CLAUDE.md ("Things to Never Do",
// "Clearance posture"). This cannot judge tone or whether copy is true; it
// only catches the specific banned characters and phrases below.
//
// Scope: text files under src/ and public/, plus README.md, limited to the
// copy-bearing extensions in EXTENSIONS below. Code comments are scanned
// along with everything else in a file; there is no special carve-out for
// them. CLAUDE.md and AGENTS.md are excluded because they document these
// rules and so legitimately contain the banned words themselves. A line
// containing the marker "copy-check: allow" is skipped entirely; use it
// sparingly and only for a real, reviewed exception.

const ROOTS = ['src', 'public', 'README.md'];
const EXTENSIONS = new Set(['.astro', '.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.mdx', '.html', '.txt', '.svg']);
const SKIP_BASENAMES = new Set(['CLAUDE.md', 'AGENTS.md']);
const ALLOW_MARKER = 'copy-check: allow';

/** Runs a regex (forced global) against a line and returns the matched substrings, in order. */
function matchAll(line, pattern) {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const hits = [];
  let match;
  while ((match = re.exec(line))) {
    hits.push(match[0]);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return hits;
}

// The literal em-dash character, its common HTML entities (named, decimal,
// hex), and a literal backslash-u escape sequence for it, as text a source
// file might contain instead of the character itself.
const EM_DASH_RE = /—|&mdash;|&#8212;|&#x2014;|\\u2014/gi;

const BUZZWORD_RE = /\b(passionate|innovative|guru|ninja|rockstar)\b/gi;

// Rate-related hourly phrasing, and a dollar amount billed by the hour.
// Plain uses of "hourly" or "per hour" that are not about a billing rate
// (an hourly cleanup job, 5 requests per hour, "never hourly") are left
// alone on purpose, as is a flat amount with no hourly indicator (the
// approved audio starting prices).
const HOURLY_PHRASE_RE = /\bhourly (?:rates?|billing|pricing)\b|\bbill(?:ed|s|ing)? hourly\b|\bcharge[sd]? hourly\b|\bper[-\s]hour (?:rates?|pricing|billing)\b/gi;
const HOURLY_MONEY_RE = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:hr|hour|h)\b|[-\s]*(?:per|an|a|each)[-\s]+hour\b|[-\s]*hourly\b)/gi;

function findHourlyRate(line) {
  return [...matchAll(line, HOURLY_PHRASE_RE), ...matchAll(line, HOURLY_MONEY_RE)];
}

// TS/SCI and "cleared engineer/developer" always claim current clearance.
// "active clearance" and "active security clearance" are allowed only when
// a negation applies directly to them: the text since the start of the
// current clause (the part after the last sentence- or list-level
// punctuation) is a negation word optionally followed by a short run of
// filler words ("no", "does not currently hold an", "without") leading
// right up to the claim. A negation in an earlier clause of the same line
// ("No problem: I hold an active clearance") does not count.
const CLEARANCE_UNCONDITIONAL_RE = /\b(?:TS\/SCI|cleared engineer|cleared developer)\b/gi;
const ACTIVE_CLEARANCE_RE = /\bactive(?: security)? clearance\b/gi;
const NEGATED_RE = /(?:\bno|\bnot|\bnever|\bwithout|n't)\s+(?:(?:hold|have|holding|having|currently|yet|an?)\s+){0,3}$/i;

function findClearance(line) {
  const hits = matchAll(line, CLEARANCE_UNCONDITIONAL_RE);
  const re = new RegExp(ACTIVE_CLEARANCE_RE.source, ACTIVE_CLEARANCE_RE.flags);
  let match;
  while ((match = re.exec(line))) {
    const clause = line.slice(0, match.index).split(/[.:;?!,()]/).pop() ?? '';
    if (!NEGATED_RE.test(clause)) hits.push(match[0]);
  }
  return hits;
}

/**
 * Rules, in the order CLAUDE.md lists them. Each rule's `find` takes a
 * line and returns the matched substrings, in order.
 */
export const RULES = [
  { id: 'em-dash', label: 'em-dash (U+2014)', find: line => matchAll(line, EM_DASH_RE) },
  { id: 'buzzword', label: 'buzzword', find: line => matchAll(line, BUZZWORD_RE) },
  { id: 'hourly-rate', label: 'hourly rate copy', find: findHourlyRate },
  { id: 'implied-clearance', label: 'implied current clearance', find: findClearance },
];

/**
 * Violations on a single line of text. Returns `[]` for a clean line or a
 * line carrying the `copy-check: allow` escape hatch.
 */
export function lineViolations(line) {
  if (line.includes(ALLOW_MARKER)) return [];
  const hits = [];
  for (const rule of RULES) {
    for (const match of rule.find(line)) hits.push({ rule: rule.id, label: rule.label, match });
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
