#!/usr/bin/env node
// Writes scripts/og-video/site-tokens.css from src/styles/global.css: the site colours and the label
// and status styles the scene kit mirrors at video scale. kit.css imports the file, so the renderer
// records it as an input of every scene, and a change to one of these values marks those scenes
// stale. Sizes stay in kit.css: scenes set type at video scale, 20px and up.
//
//   node scripts/og-video/site-tokens.mjs           write the file
//   node scripts/og-video/site-tokens.mjs --check   exit 1 if the file is out of date
//
// Node built-ins only, so CI runs it before npm ci.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TOKENS = join(ROOT, 'scripts/og-video/site-tokens.css');
const COLOURS = ['paper', 'ink', 'muted', 'rule', 'accent'];
// The site's font variables, as the kit names its own stacks.
const FACES = { '--font-sans': 'var(--sans)', '--font-serif': 'var(--serif)', '--font-mono': 'var(--mono)' };

function declarations(css, selector) {
  const match = css.match(new RegExp(`(?:^|[\\s}])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`global.css has no ${selector} rule`);
  return Object.fromEntries(match[1].split(';').map(part => part.split(/:(.*)/s).map(text => text.trim())).filter(([name, value]) => name && value));
}

function face(value, selector) {
  const variable = value.match(/var\((--font-[a-z]+)\)/)?.[1];
  if (!FACES[variable]) throw new Error(`${selector} uses a face the kit does not load: ${value}`);
  return FACES[variable];
}

function token(css, name) {
  const value = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`global.css does not define --${name}`);
  return value;
}

export function siteTokens(css) {
  const label = declarations(css, '.page-kicker');
  const status = declarations(css, '.project-status');
  const tracking = label['letter-spacing'] === 'var(--tracking-eyebrow)' ? token(css, 'tracking-eyebrow') : label['letter-spacing'];
  const lines = [
    ...COLOURS.map(name => `  --${name}: ${token(css, name)};`),
    `  --label-face: ${face(label['font-family'] ?? '', '.page-kicker')};`,
    `  --label-weight: ${label['font-weight'] ?? 400};`,
    `  --label-tracking: ${tracking ?? 'normal'};`,
    `  --label-case: ${label['text-transform'] ?? 'none'};`,
    `  --status-face: ${face(status.font ?? status['font-family'] ?? '', '.project-status')};`,
  ];
  return `/* Generated from src/styles/global.css by scripts/og-video/site-tokens.mjs. Do not edit; run the script. */\n:root {\n${lines.join('\n')}\n}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = siteTokens(readFileSync(join(ROOT, 'src/styles/global.css'), 'utf8'));
  let current = '';
  try { current = readFileSync(TOKENS, 'utf8'); } catch { /* Written below. */ }
  if (process.argv.includes('--check')) {
    if (current !== next) { console.error('scripts/og-video/site-tokens.css is out of date: run node scripts/og-video/site-tokens.mjs'); process.exit(1); }
  } else if (current !== next) {
    writeFileSync(TOKENS, next);
    console.log('site-tokens.css updated');
  }
}
