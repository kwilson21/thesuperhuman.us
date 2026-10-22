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
// Scope: stylesheets under src/ (.css files, <style> blocks in .astro files, and <style>
// blocks in the string and template literals of .ts route handlers under src/pages/ that
// return HTML; comments and bare code there are not read), plus the class attributes
// (class="..." and class:list={...}, single or multi-line) in .astro markup, which are
// checked for transition-all, outline-none and Tailwind arbitrary hex values, and @apply
// lines, which get the same three checks. Prose, HTML comments and frontmatter are not
// scanned. SVG files are images, covered by image QA. Other TypeScript is out of scope,
// src/lib/ above all: email HTML is built there with inline styles, and email needs
// literal colours and faces because it cannot use the site's CSS variables.
//
// The faces a stylesheet may name come from src/styles/global.css: the families in its
// --font-* tokens and its @font-face rules. A known exception goes in ALLOWLIST with a
// reason, its exact match text and how many times it may appear; an entry that matches
// less than that prints a warning so it can be removed or lowered.

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
    // A `transition` item with no property name (`transition: 200ms var(--ease-site)`) is `all`.
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
    // "Focus rings": "Never `outline: none` without a replacement." A stylesheet removal
    // needs a :focus-visible rule for the same selector that applies whenever the removal
    // does (no @media, @supports or @container condition the removal lacks); a class-list
    // removal needs a focus-visible: utility in the same class attribute (OUTLINE_MARKUP_HINT).
    hint: 'add a :focus-visible rule with a visible ring for the same selector, under the same @media, @supports and @container conditions (or none)',
  },
};

/**
 * Known exceptions on the tree this check was calibrated on (October 22, 2026). Each
 * allows exactly `match` (case-insensitive) for one gate in one file, up to `count`
 * times. A further use fails, so it needs its own reason. Remove an entry when its warning
 * says it no longer matches, and lower `count` when it matches fewer. Add one only with a
 * reason the owner or a reviewer could check.
 */
export const ALLOWLIST = [
  { gate: 'raw-hex', file: 'src/pages/index.astro', match: '#000c', count: 1, reason: 'Drop shadow of the resting glow on Home\'s dark project cards (D2.2-B keeps the resting glow).' },
  { gate: 'raw-hex', file: 'src/styles/owner.css', match: '#526d4d', count: 3, reason: 'Private owner pages: the green for paid and confirmed states predates the token block; not part of the public design picks.' },
  { gate: 'raw-hex', file: 'src/styles/studio.css', match: '#514d47', count: 1, reason: 'Private studio pages: secondary text colour that predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/styles/studio.css', match: '#4a5639', count: 1, reason: 'Private studio pages: done-state text that predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/components/StudioUnavailable.astro', match: '#514d47', count: 1, reason: 'Private studio notice, same colour as studio.css; predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/pages/studio/index.astro', match: '#3a3833', count: 1, reason: 'Private studio page text colour that predates the studio tokens.' },
  { gate: 'raw-hex', file: 'src/components/owner/OwnerProjectFiles.astro', match: '#a79e91', count: 1, reason: 'Private owner upload icon fill that predates the token block.' },
  { gate: 'bare-ease', file: 'src/components/audio/ComparisonPlayer.astro', match: 'transition: y1 180ms ease,y2 180ms ease', count: 1, reason: 'A/B player marker lines; changing the curve changes approved motion, so it waits for a reviewed change.' },
  { gate: 'bare-ease', file: 'src/components/owner/OwnerProjectFiles.astro', match: 'transition: background 200ms ease', count: 1, reason: 'Private owner upload progress; not part of the public design picks.' },
  { gate: 'bare-ease', file: 'src/styles/owner.css', match: 'transition: border-color 140ms ease, background 140ms ease', count: 1, reason: 'Private owner drop zone hover; not part of the public design picks.' },
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

/** The <style> blocks of an .astro file or a .ts route's HTML, with the line each block's CSS starts on. */
export function styleBlocks(source) {
  const blocks = [];
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    const offset = match.index + match[0].indexOf('>') + 1;
    blocks.push({ css: match[1], line: source.slice(0, offset).split('\n').length });
  }
  return blocks;
}

/** Words after which a `/` starts a regular expression, not a division. */
const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|case|void|delete|throw|in|of|else|do|yield|await|new)\s*$/;

/**
 * The text a TypeScript file puts in string and template literals, for finding the HTML a
 * route emits. The result has the same length and line breaks as `source`: comments, code
 * and the quotes themselves are blanked, so a <style> inside a comment or bare code is
 * never found, and `//` inside a literal (a URL) is kept. A template's `${...}`
 * interpolation is code, except that the string literals inside it stay, so
 * `color: ${dark ? '#fff' : '#000'}` still shows both colours. Escapes such as \' keep
 * their character. Regular expressions are skipped by a heuristic (what precedes the `/`).
 */
export function literalText(source) {
  const view = source.replace(/[^\n]/g, ' ').split('');
  const n = source.length;
  const escape = at => {
    // Backslash plus the next character: a quote, backtick, $ or backslash keeps that character; others (\n, \t) are not CSS text.
    if (at + 1 < n && '\'"`$\\{}'.includes(source[at + 1])) view[at + 1] = source[at + 1];
    else if (source[at + 1] === '\n') view[at + 1] = '\n';
    return at + 2;
  };
  const scanString = at => {
    const quote = source[at];
    let i = at + 1;
    while (i < n && source[i] !== quote && source[i] !== '\n') {
      if (source[i] === '\\') { i = escape(i); continue; }
      view[i] = source[i]; i += 1;
    }
    return i + 1;
  };
  const scanTemplate = at => {
    let i = at + 1;
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') { i = escape(i); continue; }
      if (source[i] === '$' && source[i + 1] === '{') { i = scanCode(i + 2, true); continue; }
      view[i] = source[i]; i += 1;
    }
    return i + 1;
  };
  const scanRegex = at => {
    let i = at + 1;
    let inClass = false;
    while (i < n && source[i] !== '\n' && (inClass || source[i] !== '/')) {
      if (source[i] === '\\') i += 1;
      else if (source[i] === '[') inClass = true;
      else if (source[i] === ']') inClass = false;
      i += 1;
    }
    return i + 1;
  };
  function scanCode(at, inTemplate) {
    let i = at;
    let depth = 0;
    let previous = '';
    while (i < n) {
      const ch = source[i];
      if (ch === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
      if (ch === '/' && source[i + 1] === '*') { const close = source.indexOf('*/', i + 2); i = close === -1 ? n : close + 2; continue; }
      if (ch === '"' || ch === "'") { i = scanString(i); previous = ch; continue; }
      if (ch === '`') { i = scanTemplate(i); previous = ch; continue; }
      if (ch === '/' && (!previous || /[(,=:[!&|?{};+\-*%<>~^]/.test(previous) || REGEX_AFTER_WORD.test(source.slice(Math.max(0, i - 12), i)))) { i = scanRegex(i); previous = ')'; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') { if (depth === 0 && inTemplate) return i + 1; depth -= 1; }
      if (!/\s/.test(ch)) previous = ch;
      i += 1;
    }
    return i;
  }
  scanCode(0, false);
  return view.join('');
}

/** Files the check reads: .css and .astro under src/, and the .ts route handlers under src/pages/ (they return HTML pages with a <style> block). src/lib/ builds email, which needs literal colours. */
export function isScanned(path) {
  return /\.(?:css|astro)$/.test(path) || (/\.ts$/.test(path) && !path.endsWith('.d.ts') && path.startsWith('src/pages/'));
}

/** An .astro file with its HTML comments and <style> and <script> blocks blanked, keeping line numbers. */
function markupOnly(source) {
  const blank = text => text.replace(/[^\n]/g, ' ');
  // Astro frontmatter (the leading --- block) is code, not markup.
  const body = source.replace(/^(\uFEFF?---\r?\n[\s\S]*?\r?\n---)(?=\r?\n|$)/, blank);
  return body.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(style|script)\b[\s\S]*?<\/\1>/g, blank);
}

/** Split at top-level commas or whitespace, keeping parentheses and quoted strings whole. */
function splitTop(value, separator) {
  const parts = [];
  let buffer = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) { buffer += ch; if (ch === quote && value[i - 1] !== '\\') quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buffer += ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (separator === ',' ? ch === ',' : /\s/.test(ch))) { parts.push(buffer); buffer = ''; continue; }
    buffer += ch;
  }
  parts.push(buffer);
  return parts;
}
const words = text => splitTop(text.trim(), ' ').filter(Boolean);
const commaItems = value => splitTop(value, ',').map(item => item.trim()).filter(Boolean);

const UNITS = 'px|rem|em|%|pt|pc|vw|vh|vmin|vmax|vi|vb|ch|ex|lh|rlh|cap|ic|svh|lvh|dvh|cqi|cqw|cqh|q|mm|cm|in';
const KEYWORD_SIZES = 'xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger';
/** A `font` size token, with its optional /line-height (which may hold a var()). */
const SIZE_TOKEN = new RegExp(`^(?:\\d*\\.?\\d+(?:${UNITS})|${KEYWORD_SIZES}|(?:clamp|calc|min|max)\\(.*\\))(?:/\\S+)?$`, 'is');
/** A size or line-height that comes from a token. Used only when no literal size is found. */
const TOKEN_SIZE = /^(?:var|theme|--theme|env)\(.*\)(?:\/\S+)?$/is;
const FUNCTION_CALL = /^[\w-]+\(/;

/**
 * Family names in a `font` or `font-family` value, without generics, keywords or any
 * var(), theme() or --theme() reference (those stand for a token, not a literal face).
 * In the `font` shorthand the size and line-height may themselves be tokens, so the size
 * is found with the var() calls still in place.
 */
export function fontFamilies(prop, value) {
  const cleaned = value.replace(/!important/gi, '').trim();
  let list = cleaned;
  if (prop === 'font') {
    if (CSS_WIDE.has(cleaned.toLowerCase()) || SYSTEM_FONT_KEYWORDS.has(cleaned.toLowerCase())) return [];
    const tokens = words(cleaned.replace(/\s*\/\s*/g, '/'));
    let size = tokens.findIndex(token => SIZE_TOKEN.test(token));
    if (size === -1) size = tokens.findIndex(token => TOKEN_SIZE.test(token));
    if (size === -1) return [];
    list = tokens.slice(size + 1).join(' ');
  }
  return commaItems(list)
    .map(item => words(item).filter(token => !FUNCTION_CALL.test(token)).join(' '))
    .map(name => name.replace(/^(['"])(.*)\1$/, '$2').replace(/\s+/g, ' ').trim())
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
const TRANSITION_ALL_UTILITY = /(?<![\w-])transition-(?:all|\[all\])(?![\w-])/g;
const OUTLINE_UTILITY = /(?<![\w-])((?:[\w-]+:)*)outline-(?:none|0)(?![\w-])/g;
const OUTLINE_MARKUP_HINT = 'put a focus-visible: utility with a visible ring on the same element';

const isFontProp = prop => prop === 'font' || prop === 'font-family';
const removesOutline = ({ prop, value }) => (prop === 'outline' && /^(?:none|0(?:px)?)(?:\s*!important)?$/i.test(value))
  || (prop === 'outline-style' && /^none\b/i.test(value)) || (prop === 'outline-width' && /^0(?:px)?\b/.test(value));

/**
 * Hex colours inside Tailwind arbitrary values (`text-[#ff0000]`), as { match, offset }.
 * Custom-property definitions (`[--x:#fff]`), url() and quoted strings are not colours.
 */
export function arbitraryHex(text) {
  const found = [];
  for (const bracket of text.matchAll(/\[([^[\]\s]+)\]/g)) {
    const inner = bracket[1];
    if (inner.startsWith('--')) continue;
    const scrubbed = inner.replace(/url\([^)]*\)/gi, run => ' '.repeat(run.length));
    for (const hex of scrubbed.matchAll(HEX)) {
      if (/['"]/.test(scrubbed[hex.index - 1] ?? '')) continue;
      found.push({ match: hex[0], offset: bracket.index + 1 + hex.index });
    }
  }
  return found;
}

/** True when a class list or @apply value has a focus-visible: utility that draws a visible indicator
 * (an outline, ring, border, background, shadow or underline), not a removal or an unrelated variant
 * such as focus-visible:block. */
function hasFocusVisibleUtility(text) {
  for (const found of text.matchAll(/(?<![\w-])(?:[\w-]+:)*focus-visible:(?:[\w-]+:)*([\w-]+)/g)) {
    const utility = found[1];
    if (/^outline-(?:none|0)$/.test(utility)) continue;
    if (/^(?:outline|ring|border|bg|shadow|underline|decoration)(?:-|$)/.test(utility)) return true;
  }
  return false;
}

/** The property each comma item of a `transition` value names, or 'all' when it names none. An item whose property could sit in an unknown var() is skipped. */
function transitionProperties(value) {
  const TIME = /^[+-]?\d*\.?\d+m?s$/;
  const TIMING = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete)$|^(?:cubic-bezier|steps|linear|calc|min|max|clamp)\(|^var\(\s*--[\w-]*(?:ease|easing|timing|curve|dur|duration|delay|speed)/;
  const found = [];
  for (const item of commaItems(value.replace(/!important/gi, ''))) {
    let property = '';
    let unknown = false;
    for (const token of words(item)) {
      const lower = token.toLowerCase();
      if (TIME.test(lower) || TIMING.test(lower)) continue;
      if (FUNCTION_CALL.test(lower)) { unknown = true; break; }
      property = lower;
      break;
    }
    if (!unknown) found.push(property || 'all');
  }
  return found;
}

/** Selectors a declaration applies to, with `&` nesting resolved and at-rules skipped. */
function resolvedSelectors(context) {
  let parents = [''];
  for (const prelude of context) {
    if (prelude.startsWith('@')) continue;
    const parts = commaItems(prelude);
    parents = parents.flatMap(parent => parts.map(part => (part.includes('&') ? part.replaceAll('&', parent) : (parent ? `${parent} ${part}` : part))));
  }
  return parents.map(selector => selector.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
/** At-rules that decide whether the rules inside them apply at all. */
const CONDITION_AT_RULE = /^@(media|supports|container)\b/i;

/** Split at the top-level matches of `separator` (a sticky regex), keeping parenthesized groups whole. */
function splitAtTopLevel(text, separator) {
  const parts = [];
  let buffer = '';
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    if (depth === 0) {
      separator.lastIndex = i;
      const found = separator.exec(text);
      if (found) { parts.push(buffer); buffer = ''; i += found[0].length - 1; continue; }
    }
    buffer += text[i];
  }
  parts.push(buffer);
  return parts;
}

/**
 * One condition clause with whitespace squeezed and only its keywords lower-cased: words outside
 * parentheses (`screen`, `not`, `selector`) and the feature name that opens a group (`(MIN-WIDTH: 1px)`).
 * Custom idents (`--name`) and values keep their case.
 */
function normalizeClause(clause) {
  const squeezed = clause.replace(/\s+/g, ' ').replace(/\s*([():,<>=/])\s*/g, '$1').trim();
  let depth = 0;
  let afterOpen = false;
  let out = '';
  for (const token of squeezed.match(/[()]|[^()]+/g) ?? []) {
    if (token === '(') { depth += 1; out += token; afterOpen = true; continue; }
    if (token === ')') { depth = Math.max(0, depth - 1); out += token; afterOpen = false; continue; }
    if (depth === 0) out += token.toLowerCase();
    else if (afterOpen) out += token.replace(/^(?!--)[a-z][\w-]*/i, word => word.toLowerCase());
    else out += token;
    afterOpen = false;
  }
  return out;
}

/**
 * The @media, @supports and @container conditions enclosing a declaration, as one flat list of
 * clauses ("@media (min-width:64rem)"). A prelude splits at its top-level `and`, and nested
 * at-rules of one type join, so `@media (a) and (b)` equals `@media (b) and (a)` and
 * `@media (a) { @media (b) { ... } }`. A prelude with `not`, `or` or a comma stays one clause.
 * A container name is a case-sensitive custom ident, kept as written and attached to each clause.
 */
function conditionsOf(context) {
  const clauses = new Set();
  for (const prelude of context) {
    const at = CONDITION_AT_RULE.exec(prelude);
    if (!at) continue;
    const type = `@${at[1].toLowerCase()}`;
    let rest = prelude.slice(at[0].length).replace(/\s+/g, ' ').trim();
    let name = '';
    if (type === '@container') {
      const named = /^([^\s()]+)\s(?=\S)/.exec(rest);
      if (named && named[1].toLowerCase() !== 'not') { name = `${named[1]} `; rest = rest.slice(named[0].length); }
    }
    const opaque = /^not\b/i.test(rest) || splitAtTopLevel(rest, /\s*,\s*|\s+or\s+/iy).length > 1;
    for (const clause of opaque ? [rest] : splitAtTopLevel(rest, /\s+and\s+/iy)) clauses.add(`${type} ${name}${normalizeClause(clause)}`);
  }
  return [...clauses];
}
/** A replacement applies whenever a removal does when each of its clauses is also one of the removal's. No conditions is always. */
const appliesWhenever = (replacement, removal) => replacement.every(clause => removal.includes(clause));
const NOT_FOCUS_VISIBLE = /:not\(\s*:focus-visible\s*\)/g;
const hasFocusVisible = selector => /:focus-visible\b/.test(selector.replace(NOT_FOCUS_VISIBLE, ''));
/** The element a selector styles, without its focus pseudo-classes. A bare `:focus-visible` is `*:focus-visible`, so `.a :focus-visible` has the base `.a *`. */
const focusBase = selector => selector.replace(NOT_FOCUS_VISIBLE, '')
  .replace(/(^|[\s>+~])(?=:focus)/g, '$1*')
  .replace(/:(?:focus-visible|focus-within|focus)\b/g, '')
  .replace(/\s+/g, ' ').trim();
/** Whether a :focus-visible rule on `base` styles the element `target` selects: the same element, any element, or any descendant of a prefix (`.a *`). */
const covers = (base, target) => base === '*' || base === target || (base.endsWith(' *') && target.startsWith(base.slice(0, -1)));

/** Gate hits in one stylesheet's declarations. */
export function declarationViolations(decls, { faces = new Set() } = {}) {
  const hits = [];
  const hit = (gate, decl, match) => hits.push({ gate, line: decl.line, match });
  const removals = [];
  const replacements = [];
  for (const decl of decls) {
    const { prop, value, context } = decl;
    if (prop === '@apply') {
      for (const found of value.matchAll(TRANSITION_ALL_UTILITY)) hit('transition-all', decl, found[0]);
      for (const found of arbitraryHex(value)) hit('raw-hex', decl, found.match);
      for (const found of value.matchAll(OUTLINE_UTILITY)) {
        if (!found[1].includes('not-focus-visible:')) removals.push({ decl, match: found[0], selectors: resolvedSelectors(context), conditions: conditionsOf(context), covered: hasFocusVisibleUtility(value) });
      }
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
      const all = prop === 'transition'
        ? transitionProperties(value).includes('all')
        : commaItems(value).some(item => words(item)[0]?.toLowerCase() === 'all');
      if (all) hit('transition-all', decl, `${prop}: ${value}`);
    }
    if (/^(?:transition|animation)(?:-timing-function)?$/.test(prop)) {
      if (commaItems(value).some(item => words(item).some(word => word.toLowerCase() === 'ease'))) hit('bare-ease', decl, `${prop}: ${value}`);
    }
    const selectors = resolvedSelectors(context);
    if (removesOutline(decl)) {
      const onlyUnfocused = selectors.length > 0 && selectors.every(selector => selector.replace(/\s+/g, '').includes(':not(:focus-visible)'));
      if (!onlyUnfocused) removals.push({ decl, match: `${prop}: ${value}`, selectors, conditions: conditionsOf(context), covered: false });
    } else if (FOCUS_REPLACEMENT_PROP.test(prop)) {
      const focused = selectors.filter(hasFocusVisible).map(focusBase);
      if (focused.length) replacements.push({ bases: focused, conditions: conditionsOf(context) });
    }
  }
  // A removal is replaced by a :focus-visible rule for the same selector (or for every
  // element), not by one for another selector in the file. The rule must also apply
  // whenever the removal does: a replacement inside `@media (min-width: 64rem)` leaves an
  // unconditional removal bare at narrower widths.
  const isCovered = removal => removal.covered
    || replacements.some(({ bases, conditions }) => appliesWhenever(conditions, removal.conditions)
      && bases.some(base => removal.selectors.some(selector => covers(base, focusBase(selector)))));
  for (const removal of removals) if (!isCovered(removal)) hit('outline-none', removal.decl, removal.match);
  return hits;
}

/** The class attributes of .astro markup: class="...", class='...', class={...} and class:list={...}, as { text, index }. */
export function classAttributes(markup) {
  const spans = [];
  for (const found of markup.matchAll(/(?<![\w:.-])class(?::list)?\s*=(?!=)\s*/g)) {
    const start = found.index + found[0].length;
    const open = markup[start];
    let end = -1;
    if (open === '"' || open === "'") end = markup.indexOf(open, start + 1);
    else if (open === '{') end = closingBrace(markup, start);
    else {
      const bare = /^[^\s>]+/.exec(markup.slice(start));
      if (bare) { spans.push({ text: bare[0], index: start }); continue; }
    }
    if (end !== -1) spans.push({ text: markup.slice(start + 1, end), index: start + 1 });
  }
  return spans;
}

/** The index of the `}` that closes the `{` at `open`, skipping braces inside strings. */
function closingBrace(text, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Gate hits in the Tailwind utilities of .astro class attributes. Each attribute is judged
 * whole, so a multi-line class:list works. Prose and frontmatter are never scanned.
 */
export function markupViolations(markup) {
  const hits = [];
  const lineAt = offset => markup.slice(0, offset).split('\n').length;
  for (const { text, index } of classAttributes(markup)) {
    for (const found of text.matchAll(TRANSITION_ALL_UTILITY)) hits.push({ gate: 'transition-all', line: lineAt(index + found.index), match: found[0] });
    for (const found of arbitraryHex(text)) hits.push({ gate: 'raw-hex', line: lineAt(index + found.offset), match: found.match });
    const replaced = hasFocusVisibleUtility(text);
    for (const found of text.matchAll(OUTLINE_UTILITY)) {
      if (!replaced && !found[1].includes('not-focus-visible:')) hits.push({ gate: 'outline-none', line: lineAt(index + found.index), match: found[0], hint: OUTLINE_MARKUP_HINT });
    }
  }
  return hits;
}

/** Every gate hit in one source file, as { path, line, gate, label, hint, match }. */
export function fileViolations(path, source, { faces } = {}) {
  let hits = [];
  if (!isScanned(path)) hits = [];
  else if (path.endsWith('.css')) hits = declarationViolations(cssDeclarations(source), { faces });
  else {
    // A .ts route's CSS is whatever its string and template literals hold, not its comments or code.
    const decls = styleBlocks(path.endsWith('.ts') ? literalText(source) : source).flatMap(block => cssDeclarations(block.css, block.line));
    hits = declarationViolations(decls, { faces });
    if (path.endsWith('.astro')) hits.push(...markupViolations(markupOnly(source)));
  }
  return hits.map(h => ({ path, ...h, label: GATES[h.gate].label, hint: h.hint ?? GATES[h.gate].hint }));
}

/**
 * Split hits into failures and allowed ones. An entry allows hits whose match equals its
 * `match` (case-insensitive) in its file, up to `count` times when it sets one; a further
 * hit fails. `uses` counts what each entry allowed. An entry that matched nothing, or fewer
 * hits than its count, comes back as stale.
 * @param {{ gate: string, path: string, match: string, hint?: string }[]} violations
 * @param {{ gate: string, file: string, match: string, count?: number, reason: string }[]} [allowlist]
 */
export function applyAllowlist(violations, allowlist = ALLOWLIST) {
  const uses = new Map();
  const failures = [];
  for (const v of violations) {
    const entry = allowlist.find(e => e.gate === v.gate && e.file === v.path && v.match.toLowerCase() === e.match.toLowerCase());
    const used = entry ? (uses.get(entry) ?? 0) : 0;
    if (entry && (entry.count === undefined || used < entry.count)) uses.set(entry, used + 1);
    else failures.push(entry ? { ...v, hint: `${v.hint}; the allowlist covers ${entry.count} of these in this file` } : v);
  }
  const stale = allowlist.filter(entry => (uses.get(entry) ?? 0) === 0 || (entry.count !== undefined && uses.get(entry) < entry.count));
  return { failures, stale, uses };
}

function collectFiles(root) {
  const stats = statSync(root, { throwIfNoEntry: false });
  if (!stats) return [];
  if (stats.isFile()) return isScanned(root.split(sep).join('/')) ? [root] : [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => collectFiles(join(root, entry.name)));
}

function main() {
  const globalCss = readFileSync(GLOBAL_CSS, 'utf8');
  const faces = systemFamilies(globalCss);
  const violations = collectFiles(ROOT).flatMap(path => {
    const posix = relative('.', path).split(sep).join('/');
    return fileViolations(posix, readFileSync(path, 'utf8'), { faces });
  });
  const { failures, stale, uses } = applyAllowlist(violations);
  for (const entry of stale) {
    const matched = uses.get(entry) ?? 0;
    const what = matched === 0 ? 'no longer matches; remove it' : `matches ${matched} of ${entry.count}; lower its count`;
    console.warn(`design-check: allowlist entry ${what}: ${entry.gate} ${entry.file} ${JSON.stringify(entry.match)}`);
  }
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
