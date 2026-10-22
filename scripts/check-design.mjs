#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Design check: a few objective gates from Hallmark, the design standard this site
// follows (docs/design-standard.md). Hallmark is made by Together AI and the Hallmark
// contributors and published under the MIT license at https://github.com/nutlope/hallmark;
// the vendored copy is .agents/skills/hallmark (commit 13ac0ec). Each gate names the
// Hallmark rule it ports. Only gates a script can judge without false alarms are here.
// Composition, hierarchy and contrast in context stay with `hallmark audit` and review.
//
// Scope: stylesheets under src/ (.css files and <style> blocks in .astro files) and the
// class lists in .astro markup. SVG files are images, covered by image QA. TypeScript is
// out of scope: email templates need literal colours and faces.
//
// The faces a stylesheet may name come from src/styles/global.css: the families in its
// --font-* tokens and its @font-face rules. A known exception goes in ALLOWLIST with a
// reason; an entry that no longer matches anything prints a warning so it can be removed.

const ROOT = 'src';
const GLOBAL_CSS = 'src/styles/global.css';

/** CSS generic families and keywords. Quoted, each names a font that does not exist. */
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SYSTEM_FONT_KEYWORDS = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);

export const GATES = {
  'quoted-generic': {
    label: 'quoted generic font family',
    // Hallmark has no numbered gate for this. Its font tokens (typography.md, "The 2+1 rule")
    // leave generics unquoted, and the October 22, 2026 Hallmark audit of this site flagged
    // quoted ones (docs/prelaunch-qa-2026-10-22-hallmark-audit-fixes.md).
    hint: 'unquote it; quoted, it names a font that does not exist',
  },
  'font-outside-system': {
    label: 'font family outside the design system',
    // Gate 48, "Mid-render token improvisation" (a font-family that bypasses the token
    // block), and gate 37 (at most three families). Relaxed for this site: a literal name
    // passes when it is a face the token block or an @font-face in global.css declares.
    hint: 'use a var(--font-*) token or a face declared in src/styles/global.css',
  },
  'raw-hex': {
    label: 'raw hex colour outside a token',
    // Gate 48, "Mid-render token improvisation": every colour comes through a named token.
    // Token definitions (custom properties) may hold hex; mask stops are transparency.
    hint: 'name it as a custom property and reference it with var()',
  },
  'transition-all': {
    label: 'transition: all',
    // Gate 10: "Is transition-all (or transition: all) used anywhere? (Specify the properties.)"
    hint: 'list the properties that change',
  },
  'bare-ease': {
    label: 'browser-default ease',
    // motion.md, "Bans": "`ease` (browser default, mediocre)"; SKILL.md, Build: "never the
    // browser default `ease`". This site's one easing is --ease-site.
    hint: 'use var(--ease-site)',
  },
  'outline-none': {
    label: 'outline removed without a :focus-visible replacement',
    // Gate 26 (interactive elements need :focus-visible) and interaction-and-states.md,
    // "Focus rings": "Never `outline: none` without a replacement."
    hint: 'add a :focus-visible rule with a visible ring in the same file',
  },
};

/**
 * Known exceptions on the tree this check was calibrated on (October 22, 2026). Each
 * allows `match` for one gate in one file. Remove an entry when its warning says it no
 * longer matches. Add one only with a reason the owner or a reviewer could check.
 */
export const ALLOWLIST = [
  { gate: 'font-outside-system', file: 'src/styles/studio.css', match: 'Newsreader', reason: 'Agreement page serif before D9.3-C moves agreement and offer pages to Libron.' },
  { gate: 'font-outside-system', file: 'src/components/SoftwareAgreedTerms.astro', match: 'Newsreader', reason: '"What we agreed" headings, retired with Newsreader under D9.3-C.' },
  { gate: 'font-outside-system', file: 'src/components/SoftwareProjectUpdate.astro', match: 'Newsreader', reason: 'Client project updates, retired with Newsreader under D9.3-C.' },
  { gate: 'font-outside-system', file: 'src/components/owner/SoftwareAgreementPanel.astro', match: 'Newsreader', reason: 'Owner agreement screen, retired with Newsreader under D9.3-C.' },
  { gate: 'font-outside-system', file: 'src/pages/offer/[token]/sign.astro', match: 'Newsreader', reason: 'Typed signature on the offer signing page, moving to Libron Italic under D9.3-C.' },
  { gate: 'font-outside-system', file: 'src/pages/owner/requests/[id]/update.astro', match: 'Newsreader', reason: 'Owner project update screen, retired with Newsreader under D9.3-C.' },
  { gate: 'font-outside-system', file: 'src/styles/music-premiere.css', match: 'Times New Roman', reason: 'Old News masthead fallback stack, replaced by Libron Bold under D8.1-B.' },
  { gate: 'raw-hex', file: 'src/pages/index.astro', match: '#000c', reason: 'Drop shadow of the resting glow on Home\'s dark project cards (D2.2-B keeps the resting glow).' },
  { gate: 'raw-hex', file: 'src/pages/index.astro', match: '#000e', reason: 'Hover drop shadow on Home\'s project cards, deleted with the hover glow under D2.2-B.' },
  { gate: 'raw-hex', file: 'src/styles/owner.css', match: '#526d4d', reason: 'Private owner pages: the green for paid and confirmed states predates the token block; not part of the public design picks.' },
  { gate: 'raw-hex', file: 'src/styles/studio.css', match: '#514d47', reason: 'Private studio pages: secondary text colour that predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/styles/studio.css', match: '#4a5639', reason: 'Private studio pages: done-state text that predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/components/StudioUnavailable.astro', match: '#514d47', reason: 'Private studio notice, same colour as studio.css; predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/pages/studio/index.astro', match: '#3a3833', reason: 'Private studio page text colour that predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/components/owner/OwnerProjectFiles.astro', match: '#a79e91', reason: 'Private owner upload icon fill that predates the token block.' },
  { gate: 'bare-ease', file: 'src/components/audio/ComparisonPlayer.astro', match: 'ease', reason: 'A/B player marker lines; changing the curve changes approved motion, so it waits for a reviewed change.' },
  { gate: 'bare-ease', file: 'src/components/owner/OwnerProjectFiles.astro', match: 'ease', reason: 'Private owner upload progress; not part of the public design picks.' },
  { gate: 'bare-ease', file: 'src/styles/owner.css', match: 'ease', reason: 'Private owner drop zone hover; not part of the public design picks.' },
];

/** Blank out comments, keeping newlines so line numbers stay true. */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
}

/**
 * Declarations in a stylesheet, in order: { prop, value, line, context }. `context` is the
 * list of enclosing block preludes (selectors and at-rules), outermost first. Statements
 * such as `@apply ...;` come back with `prop` set to the at-rule name and no value split.
 */
export function cssDeclarations(css, firstLine = 1) {
  const text = stripComments(css);
  const out = [];
  const stack = [];
  let buffer = '';
  let start = -1;
  let quote = '';
  let depth = 0;
  let line = firstLine;
  let startLine = firstLine;
  const flush = () => {
    const raw = buffer.trim();
    buffer = ''; start = -1;
    if (!raw) return;
    if (raw.startsWith('@')) {
      const name = raw.match(/^@[\w-]+/)[0];
      out.push({ prop: name, value: raw.slice(name.length).trim(), line: startLine, context: [...stack] });
      return;
    }
    const colon = raw.indexOf(':');
    if (colon <= 0) return;
    const prop = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    out.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, line: startLine, context: [...stack] });
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (start === -1 && !/\s/.test(ch) && ch !== ';' && ch !== '{' && ch !== '}') { start = i; startLine = line; }
    if (ch === '\n') line += 1;
    if (quote) { buffer += ch; if (ch === quote && text[i - 1] !== '\\') quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buffer += ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === '{') { stack.push(buffer.trim()); buffer = ''; start = -1; continue; }
    if (depth === 0 && ch === '}') { flush(); stack.pop(); continue; }
    if (depth === 0 && ch === ';') { flush(); continue; }
    buffer += ch;
  }
  flush();
  return out;
}

/** The <style> blocks of an .astro file, with the line each block's CSS starts on. */
export function styleBlocks(source) {
  const blocks = [];
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    const offset = match.index + match[0].indexOf('>') + 1;
    blocks.push({ css: match[1], line: source.slice(0, offset).split('\n').length });
  }
  return blocks;
}

/** An .astro file with its <style> and <script> blocks blanked, keeping line numbers. */
function markupOnly(source) {
  return source.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, block => block.replace(/[^\n]/g, ' '));
}

/** Remove var() references and reduce other functions to a placeholder length. */
function flattenFunctions(value) {
  let v = value;
  let previous;
  do {
    previous = v;
    v = v.replace(/var\([^()]*\)/gi, '').replace(/[a-z-]*\([^()]*\)/gi, '1px');
  } while (v !== previous);
  return v;
}

const SIZE = /(?:^|\s)(?:\d*\.?\d+(?:px|rem|em|%|pt|pc|vw|vh|vmin|vmax|vi|vb|ch|ex|lh|rlh|cap|ic|svh|lvh|dvh|cqi|cqw|cqh|q|mm|cm|in)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)(?:\s*\/\s*[^\s,]+)?(?=\s|$)/i;

/** Family names in a `font` or `font-family` value, without generics or keywords. */
export function fontFamilies(prop, value) {
  let v = flattenFunctions(value.replace(/!important/gi, '')).trim();
  if (prop === 'font') {
    if (CSS_WIDE.has(v.toLowerCase()) || SYSTEM_FONT_KEYWORDS.has(v.toLowerCase())) return [];
    const size = v.match(SIZE);
    if (!size) return [];
    v = v.slice(size.index + size[0].length);
  }
  return v.split(',')
    .map(name => name.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\s+/g, ' ').trim())
    .filter(name => name && !GENERIC_FAMILIES.has(name.toLowerCase()) && !CSS_WIDE.has(name.toLowerCase()));
}

/** Lower-cased faces the design system declares: --font-* token families and @font-face names. */
export function systemFamilies(globalCss) {
  const faces = new Set();
  for (const decl of cssDeclarations(globalCss)) {
    const inFontFace = decl.context.some(prelude => /^@font-face\b/i.test(prelude));
    if (decl.prop.startsWith('--font') || (inFontFace && decl.prop === 'font-family')) {
      for (const name of fontFamilies('font-family', decl.value)) faces.add(name.toLowerCase());
    }
  }
  return faces;
}

const QUOTED_GENERIC = /(['"])\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|-apple-system|BlinkMacSystemFont|inherit|initial|unset)\s*\1/gi;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const MASK_PROP = /^(?:-webkit-)?mask(?:-image|-border(?:-source)?)?$/;
const FOCUS_REPLACEMENT_PROP = /^(?:outline(?:-color|-style|-width)?|box-shadow|border(?:-color|-bottom|-bottom-color)?|background(?:-color)?|text-decoration(?:-color|-line)?)$/;

const isFontProp = prop => prop === 'font' || prop === 'font-family';
const removesOutline = ({ prop, value }) => (prop === 'outline' && /^(?:none|0(?:px)?)(?:\s*!important)?$/i.test(value))
  || (prop === 'outline-style' && /^none\b/i.test(value)) || (prop === 'outline-width' && /^0(?:px)?\b/.test(value));
const topLevelItems = value => flattenFunctions(value).split(',').map(item => item.trim()).filter(Boolean);

/** Gate hits in one stylesheet's declarations. */
export function declarationViolations(decls, { faces = new Set() } = {}) {
  const hits = [];
  const hit = (gate, decl, match) => hits.push({ gate, line: decl.line, match });
  for (const decl of decls) {
    const { prop, value, context } = decl;
    if (prop === '@apply') {
      if (/(?:^|\s)transition-all(?=\s|$)/.test(value)) hit('transition-all', decl, 'transition-all');
      continue;
    }
    if (prop.startsWith('@')) continue;
    const inFontFace = context.some(prelude => /^@font-face\b/i.test(prelude));
    if (isFontProp(prop) || /^--[\w-]*font/i.test(prop)) {
      for (const match of value.matchAll(QUOTED_GENERIC)) hit('quoted-generic', decl, match[0]);
    }
    if (isFontProp(prop) && !inFontFace) {
      for (const name of fontFamilies(prop, value)) if (!faces.has(name.toLowerCase())) hit('font-outside-system', decl, name);
    }
    if (!prop.startsWith('--') && !MASK_PROP.test(prop)) {
      for (const match of value.replace(/url\([^)]*\)/gi, '').matchAll(HEX)) hit('raw-hex', decl, match[0]);
    }
    if (prop === 'transition' || prop === 'transition-property') {
      if (topLevelItems(value).some(item => item.split(/\s+/)[0].toLowerCase() === 'all')) hit('transition-all', decl, `${prop}: ${value}`);
    }
    if (/^(?:transition|animation)(?:-timing-function)?$/.test(prop)) {
      if (topLevelItems(value).some(item => item.split(/\s+/).some(word => word.toLowerCase() === 'ease'))) hit('bare-ease', decl, 'ease');
    }
  }
  const hasReplacement = decls.some(decl => decl.context.some(prelude => prelude.includes(':focus-visible') && !prelude.includes(':not(:focus-visible)'))
    && FOCUS_REPLACEMENT_PROP.test(decl.prop) && !removesOutline(decl));
  if (!hasReplacement) {
    for (const decl of decls) {
      const selector = decl.context.at(-1) ?? '';
      if (removesOutline(decl) && !selector.includes(':not(:focus-visible)')) hit('outline-none', decl, `${decl.prop}: ${decl.value}`);
    }
  }
  return hits;
}

/** Gate hits in Tailwind utilities written in .astro markup. */
export function markupViolations(markup) {
  const hits = [];
  markup.split('\n').forEach((line, index) => {
    if (/(?<![\w-])transition-all(?![\w-])/.test(line)) hits.push({ gate: 'transition-all', line: index + 1, match: 'transition-all' });
    const outline = line.match(/(?<![\w-])(?:[\w-]+:)*outline-(?:none|0)(?![\w-])/);
    if (outline && !line.includes('focus-visible:')) hits.push({ gate: 'outline-none', line: index + 1, match: outline[0] });
  });
  return hits;
}

/** Every gate hit in one source file, as { path, line, gate, label, hint, match }. */
export function fileViolations(path, source, { faces } = {}) {
  let hits;
  if (path.endsWith('.css')) hits = declarationViolations(cssDeclarations(source), { faces });
  else if (path.endsWith('.astro')) {
    const decls = styleBlocks(source).flatMap(block => cssDeclarations(block.css, block.line));
    hits = [...declarationViolations(decls, { faces }), ...markupViolations(markupOnly(source))];
  } else hits = [];
  return hits.map(h => ({ path, ...h, label: GATES[h.gate].label, hint: GATES[h.gate].hint }));
}

/** Split hits into failures and allowed ones; report allowlist entries that matched nothing. */
export function applyAllowlist(violations, allowlist = ALLOWLIST) {
  const used = new Set();
  const failures = [];
  for (const v of violations) {
    const entry = allowlist.find(e => e.gate === v.gate && e.file === v.path && v.match.toLowerCase().includes(e.match.toLowerCase()));
    if (entry) used.add(entry); else failures.push(v);
  }
  return { failures, stale: allowlist.filter(entry => !used.has(entry)) };
}

function collectFiles(root) {
  const stats = statSync(root, { throwIfNoEntry: false });
  if (!stats) return [];
  if (stats.isFile()) return /\.(?:css|astro)$/.test(root) ? [root] : [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => collectFiles(join(root, entry.name)));
}

function main() {
  const globalCss = readFileSync(GLOBAL_CSS, 'utf8');
  const faces = systemFamilies(globalCss);
  const violations = collectFiles(ROOT).flatMap(path => {
    const posix = relative('.', path).split(sep).join('/');
    return fileViolations(posix, readFileSync(path, 'utf8'), { faces });
  });
  const { failures, stale } = applyAllowlist(violations);
  for (const entry of stale) console.warn(`design-check: allowlist entry no longer matches; remove it: ${entry.gate} ${entry.file} ${JSON.stringify(entry.match)}`);
  if (failures.length) {
    const lines = failures.map(v => `${v.path}:${v.line}: ${v.label}: ${JSON.stringify(v.match)} (${v.hint})`);
    console.error(`design-check failed (Hallmark gates, see docs/design-standard.md):\n- ${lines.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`design-check passed: ${Object.keys(GATES).length} Hallmark gates, ${violations.length} allowlisted exceptions.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
