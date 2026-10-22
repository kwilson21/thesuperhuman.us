import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ALLOWLIST, GATES, applyAllowlist, cssDeclarations, fileViolations, fontFamilies, styleBlocks, systemFamilies,
} from '../../scripts/check-design.mjs';

const GLOBAL = `@font-face { font-family: 'Libron'; src: url('/fonts/libron.woff2') format('woff2'); }
@font-face { font-family: 'Kazon Name Text'; src: url('/fonts/name.woff2') format('woff2'); }
@theme {
  --font-serif: 'Libron', Georgia, serif;
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', Menlo, monospace;
}
:root { --paper: #FBF8F2; --accent: #AE5534; --ease-site: cubic-bezier(.2, .7, .2, 1); }
*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;
const faces = systemFamilies(GLOBAL);
const gates = (path: string, source: string) => fileViolations(path, source, { faces }).map(v => v.gate);
const css = (source: string) => gates('src/styles/x.css', source);

describe('cssDeclarations', () => {
  it('reads declarations with their line and enclosing selectors, ignoring comments', () => {
    const decls = cssDeclarations('/* a; b: c */\n@media (min-width: 40rem) {\n  .a:hover { color: var(--ink); }\n}\n.b{margin:0}');
    expect(decls).toEqual([
      { prop: 'color', value: 'var(--ink)', line: 3, context: ['@media (min-width: 40rem)', '.a:hover'] },
      { prop: 'margin', value: '0', line: 5, context: ['.b'] },
    ]);
  });

  it('keeps semicolons and braces inside strings and url()', () => {
    const decls = cssDeclarations(".a { background: url(data:image/svg+xml;base64,AAA); content: '{;}'; }");
    expect(decls.map(d => d.prop)).toEqual(['background', 'content']);
  });

  it('finds the style blocks of an .astro file and the line each starts on', () => {
    const blocks = styleBlocks('---\nconst a = 1;\n---\n<p>x</p>\n<style is:global>\n.a { color: red; }\n</style>');
    expect(blocks).toHaveLength(1);
    expect(cssDeclarations(blocks[0].css, blocks[0].line)[0].line).toBe(6);
  });
});

describe('fontFamilies and systemFamilies', () => {
  it('reads families from font-family and the font shorthand, skipping generics and tokens', () => {
    expect(fontFamilies('font-family', "'Kazon Name Text', var(--font-serif)")).toEqual(['Kazon Name Text']);
    expect(fontFamilies('font', '500 .78rem/1.4 Inter, sans-serif')).toEqual(['Inter']);
    expect(fontFamilies('font', '400 clamp(2rem, 4vw, 3rem)/1.1 Libron, Georgia, serif')).toEqual(['Libron', 'Georgia']);
    expect(fontFamilies('font', 'italic 2.5rem/1.3 Newsreader,Georgia,serif')).toEqual(['Newsreader', 'Georgia']);
    expect(fontFamilies('font', '.8rem var(--font-sans)')).toEqual([]);
    expect(fontFamilies('font', 'inherit')).toEqual([]);
  });

  it('drops theme() and --theme() like var(), instead of reading them as a family', () => {
    expect(fontFamilies('font-family', '--theme(--font-serif)')).toEqual([]);
    expect(fontFamilies('font-family', 'theme(--font-serif), Roboto')).toEqual(['Roboto']);
    expect(fontFamilies('font', '1rem/1.4 theme(--font-sans)')).toEqual([]);
    expect(css('.a { font-family: --theme(--font-serif); } .b { font: 1rem/1.4 theme(--font-sans); }')).toEqual([]);
  });

  it('finds the size of a font shorthand that keeps a var() in its line-height or size', () => {
    expect(fontFamilies('font', '1rem/var(--line-height) Papyrus, sans-serif')).toEqual(['Papyrus']);
    expect(fontFamilies('font', 'var(--size)/1.4 Papyrus, sans-serif')).toEqual(['Papyrus']);
    expect(fontFamilies('font', '700 var(--size) Papyrus')).toEqual(['Papyrus']);
    expect(fontFamilies('font', '1rem/1.4 var(--font-sans), Roboto')).toEqual(['Roboto']);
    expect(css('.a { font: 1rem/var(--line-height) Papyrus, sans-serif; }')).toEqual(['font-outside-system']);
  });

  it('takes the system faces from the font tokens and @font-face rules', () => {
    expect([...faces].sort()).toEqual(['georgia', 'inter', 'jetbrains mono', 'kazon name text', 'libron', 'menlo']);
  });

  it('reads the real global.css', () => {
    const real = systemFamilies(readFileSync('src/styles/global.css', 'utf8'));
    for (const face of ['libron', 'inter', 'jetbrains mono', 'kazon name text', 'kazon name display']) expect(real.has(face)).toBe(true);
  });
});

describe('gates', () => {
  it('passes the site patterns', () => {
    expect(css(GLOBAL)).toEqual([]);
    expect(css(`.a { font: 1rem/1.5 var(--font-sans); transition: transform 160ms var(--ease-site), opacity 900ms var(--ease-site); }
.b { font-family: 'Kazon Name Text', var(--font-serif); --ill-line: #cbc5ba; color: var(--ill-line); }
.c { mask-image: linear-gradient(to right, transparent, #000 8%); fill: url(#glow); animation: rise 600ms var(--ease-site) both; }
.d { font: 400 1.6rem/1.2 Libron,Georgia,serif; transition: none; }`)).toEqual([]);
  });

  it('flags a quoted generic family, in tokens too', () => {
    expect(css(".a { font-family: 'Inter', 'sans-serif'; }")).toEqual(['quoted-generic']);
    expect(css(':root { --font-mono: "JetBrains Mono", "monospace"; }')).toEqual(['quoted-generic']);
  });

  it('flags a family the design system does not declare, outside @font-face only', () => {
    expect(css('.a { font-family: Roboto, sans-serif; }')).toEqual(['font-outside-system']);
    expect(css('.a { font: italic 2.5rem/1.3 Newsreader, Georgia, serif; }')).toEqual(['font-outside-system']);
    expect(css("@font-face { font-family: 'Newsreader'; src: url(x.woff2); }")).toEqual([]);
  });

  it('flags raw hex outside custom properties, but not mask stops or url() fragments', () => {
    expect(css('.a { color: #514d47; }')).toEqual(['raw-hex']);
    expect(css('.a { box-shadow: 0 14px 30px -18px #000c; }')).toEqual(['raw-hex']);
    expect(css('.a { --x: #514d47; -webkit-mask-image: linear-gradient(#000, transparent); filter: url(#abc); }')).toEqual([]);
  });

  it('flags transition: all, as a declaration, an @apply or a utility class', () => {
    expect(css('.a { transition: all 200ms var(--ease-site); }')).toEqual(['transition-all']);
    expect(css('.a { transition: opacity 1s var(--ease-site), all 2s var(--ease-site); }')).toEqual(['transition-all']);
    expect(css('.a { transition-property: all; }')).toEqual(['transition-all']);
    expect(css('.a { @apply transition-all duration-200; }')).toEqual(['transition-all']);
    expect(gates('src/pages/x.astro', '<a class="block transition-all">x</a>')).toEqual(['transition-all']);
    expect(gates('src/pages/x.astro', '<a class="transition-colors">x</a>')).toEqual([]);
  });

  it('treats a transition item that names no property as transition: all', () => {
    expect(css('.a { transition: 200ms var(--ease-site); }')).toEqual(['transition-all']);
    expect(css('.a { transition: 200ms; }')).toEqual(['transition-all']);
    expect(css('.a { transition: opacity 1s var(--ease-site), 300ms linear; }')).toEqual(['transition-all']);
    expect(css('.a { transition: var(--dur-hover) cubic-bezier(.2, .7, .2, 1); }')).toEqual(['transition-all']);
    // A var() that may hold the property name, a named property and none are not implicit all.
    expect(css('.a { transition: var(--t); }')).toEqual([]);
    expect(css('.a { transition: opacity var(--dur-hover) var(--ease-site), transform 200ms var(--ease-site); }')).toEqual([]);
    expect(css('.a { transition: none; } .b { transition: inherit; }')).toEqual([]);
  });

  it('flags the bare ease keyword but not the named easing or other keywords', () => {
    expect(css('.a { transition: background 200ms ease; }')).toEqual(['bare-ease']);
    expect(css('.a { animation-timing-function: ease; }')).toEqual(['bare-ease']);
    expect(css('.a { transition: transform 1s var(--ease-site); animation: ease-glow 2s ease-out; }')).toEqual([]);
  });

  it('records a bare-ease hit as its declaration text', () => {
    const [hit] = fileViolations('src/styles/owner.css', '.drop { transition: border-color 140ms ease, background 140ms ease; }', { faces });
    expect(hit).toMatchObject({ gate: 'bare-ease', match: 'transition: border-color 140ms ease, background 140ms ease' });
  });

  it('flags outline: none only when a :focus-visible rule replaces it', () => {
    expect(css('.a:focus { outline: none; }')).toEqual(['outline-none']);
    expect(css('.a:focus { outline: 0; } .a:focus-visible { box-shadow: 0 0 0 2px var(--accent); }')).toEqual([]);
    expect(css('.a:focus:not(:focus-visible) { outline: none; }')).toEqual([]);
    expect(gates('src/pages/x.astro', '<input class="focus:outline-none" />')).toEqual(['outline-none']);
    expect(gates('src/pages/x.astro', '<input class="outline-none focus-visible:outline-2" />')).toEqual([]);
  });

  it('matches the outline replacement to the selector that removes it, not to the file', () => {
    // A :focus-visible rule for another selector does not replace it.
    expect(css('.a:focus { outline: none; } .b:focus-visible { box-shadow: 0 0 0 2px var(--accent); }')).toEqual(['outline-none']);
    // A replacement that is itself an outline removal is not one.
    expect(css('.a:focus-visible { outline: none; }')).toEqual(['outline-none']);
    expect(css('.a:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent); }')).toEqual([]);
    // Every element, a descendant scope, and CSS nesting all count for the elements they style.
    expect(css(':focus-visible { outline: 2px solid var(--accent); } .a:focus { outline: none; }')).toEqual([]);
    expect(css('.x :focus-visible { outline: 2px solid var(--accent); } .x h1:focus { outline: none; }')).toEqual([]);
    expect(css('.x :focus-visible { outline: 2px solid var(--accent); } h1:focus { outline: none; }')).toEqual(['outline-none']);
    expect(css('.a { &:focus { outline: none; } &:focus-visible { box-shadow: 0 0 0 2px var(--accent); } }')).toEqual([]);
    expect(css('.a { &:focus { outline: none; } .b:focus-visible { box-shadow: 0 0 0 2px var(--accent); } }')).toEqual(['outline-none']);
  });

  it('judges a class-list outline removal per element, with its own hint', () => {
    const astro = 'src/pages/x.astro';
    // Another element's focus-visible: utility does not count, even on the same line.
    expect(gates(astro, '<a class="outline-none">x</a><b class="focus-visible:ring-2">y</b>')).toEqual(['outline-none']);
    // A focus-visible: variant that draws nothing is not a replacement.
    expect(gates(astro, '<a class="outline-none focus-visible:block">x</a>')).toEqual(['outline-none']);
    expect(gates(astro, '<a class="outline-none focus-visible:ring-2">x</a>')).toEqual([]);
    // A focus-visible: utility that removes the outline is not a replacement.
    expect(gates(astro, '<a class="focus-visible:outline-none">x</a>')).toEqual(['outline-none']);
    // The hint names what clears a markup hit: a utility on the element, not a style block.
    const source = '<button class="outline-none">x</button>\n<style>button:focus-visible { outline: 2px solid var(--accent); }</style>';
    const [hit] = fileViolations(astro, source, { faces });
    expect(hit).toMatchObject({ gate: 'outline-none', line: 1 });
    expect(hit.hint).toContain('same element');
    expect(gates(astro, '<button class="outline-none focus-visible:ring-2">x</button>')).toEqual([]);
    // A stylesheet hit keeps the selector hint.
    expect(fileViolations('src/styles/x.css', '.a:focus { outline: none; }', { faces })[0].hint).toContain('same selector');
  });

  it('reads whole class attributes: multi-line class:list and class, single quotes, comments, prose', () => {
    const astro = 'src/pages/x.astro';
    const list = (focus: string) => `<button\n  class:list={[\n    'rounded border outline-none',\n    '${focus}',\n  ]}\n>x</button>`;
    expect(gates(astro, list('focus-visible:ring-2 focus-visible:ring-[var(--accent)]'))).toEqual([]);
    const [missing] = fileViolations(astro, list('px-2'), { faces });
    expect(missing).toMatchObject({ gate: 'outline-none', line: 3, match: 'outline-none' });
    expect(gates(astro, '<button\n  class="rounded\n    outline-none\n    focus-visible:outline-2"\n>x</button>')).toEqual([]);
    expect(gates(astro, "<button class='rounded outline-none'>x</button>")).toEqual(['outline-none']);
    expect(fileViolations(astro, '<p>\n<a\n  class="block\n   transition-all"\n>x</a></p>', { faces })[0]).toMatchObject({ gate: 'transition-all', line: 4 });
    // Not class attributes: HTML comments, prose, frontmatter, data-class.
    expect(gates(astro, '<!-- removed outline-none and transition-all -->\n<p class="lede">Use transition-all sparingly.</p>')).toEqual([]);
    expect(gates(astro, "---\nconst note = 'transition-all outline-none';\n---\n<p data-class=\"transition-all\">x</p>")).toEqual([]);
  });

  it('flags hex colours in Tailwind arbitrary values, but not custom properties, url() or quoted strings', () => {
    const astro = 'src/pages/x.astro';
    expect(gates(astro, '<p class="text-[#ff0000] border-[#123] bg-[#123456]/50 hover:shadow-[0_0_0_1px_#abc]">x</p>')).toEqual(['raw-hex', 'raw-hex', 'raw-hex', 'raw-hex']);
    expect(gates(astro, '<p class:list={[\n  \'p-2\',\n  \'bg-[#123456]\',\n]}>x</p>')).toEqual(['raw-hex']);
    expect(gates(astro, '<p class="bg-[var(--paper)] [--accent:#fff] bg-[url(/a.svg#abc)] [&[href=\'#abc\']]:underline w-[calc(100%-2rem)]">x</p>')).toEqual([]);
    expect(css('.a { @apply bg-[#123456]; }')).toEqual(['raw-hex']);
  });

  it('applies the utility gates to @apply with variants too', () => {
    expect(css('.a { @apply hover:transition-all; }')).toEqual(['transition-all']);
    expect(css('.a { @apply focus:outline-none; }')).toEqual(['outline-none']);
    expect(css('.a { @apply focus:outline-none focus-visible:ring-2; }')).toEqual([]);
    expect(css('.a:focus { @apply outline-none; } .a:focus-visible { box-shadow: 0 0 0 2px var(--accent); }')).toEqual([]);
    expect(css('.a { @apply transition-colors duration-200; }')).toEqual([]);
  });

  it('reports the line inside an .astro style block', () => {
    const [hit] = fileViolations('src/pages/x.astro', '<div />\n<style>\n.a {\n  color: #123456;\n}\n</style>', { faces });
    expect(hit).toMatchObject({ path: 'src/pages/x.astro', line: 4, gate: 'raw-hex', match: '#123456' });
  });

  it('names a Hallmark rule for every gate', () => {
    const source = readFileSync('scripts/check-design.mjs', 'utf8');
    for (const id of Object.keys(GATES)) {
      const block = source.slice(source.indexOf(`'${id}': {`), source.indexOf('},', source.indexOf(`'${id}': {`)));
      expect(block).toMatch(/Hallmark|[Gg]ate \d+|motion\.md|interaction-and-states\.md/);
    }
  });
});

describe('allowlist', () => {
  const hit = { path: 'src/styles/owner.css', line: 1, gate: 'raw-hex', match: '#526D4D', label: '', hint: '' };

  it('allows a listed match case-insensitively and reports unused entries as stale', () => {
    const entries = [
      { gate: 'raw-hex', file: 'src/styles/owner.css', match: '#526d4d', reason: 'r' },
      { gate: 'raw-hex', file: 'src/styles/gone.css', match: '#111111', reason: 'r' },
    ];
    const { failures, stale } = applyAllowlist([hit], entries);
    expect(failures).toEqual([]);
    expect(stale).toEqual([entries[1]]);
  });

  it('does not allow the same match in another file or for another gate', () => {
    const entries = [{ gate: 'raw-hex', file: 'src/styles/studio.css', match: '#526d4d', reason: 'r' }];
    expect(applyAllowlist([hit], entries).failures).toEqual([hit]);
  });

  it('compares matches for equality, so a longer value that starts with an entry still fails', () => {
    const entries = [{ gate: 'raw-hex', file: 'src/pages/index.astro', match: '#000c', reason: 'r' }];
    const longer = { ...hit, path: 'src/pages/index.astro', match: '#000cff' };
    expect(applyAllowlist([longer], entries).failures).toEqual([longer]);
    const real = fileViolations('src/pages/index.astro', '<style>.a { box-shadow: 0 1px 2px #000cff; }</style>', { faces });
    expect(applyAllowlist(real).failures.map(v => v.match)).toEqual(['#000cff']);
  });

  it('allows the listed declaration in a bare-ease file but not another ease in it', () => {
    const listed = '.drop { transition: border-color 140ms ease, background 140ms ease; }';
    expect(applyAllowlist(fileViolations('src/styles/owner.css', listed, { faces })).failures).toEqual([]);
    const added = fileViolations('src/styles/owner.css', `${listed} .new-thing { transition: color 2s ease; }`, { faces });
    expect(applyAllowlist(added).failures.map(v => v.match)).toEqual(['transition: color 2s ease']);
  });

  it('allows an entry only as many times as its count, and calls a looser count stale', () => {
    const entry = { gate: 'font-outside-system', file: 'src/styles/studio.css', match: 'Newsreader', count: 1, reason: 'r' };
    const twice = fileViolations('src/styles/studio.css', '.a { font-family: Newsreader; } .b { font-family: Newsreader; }', { faces });
    const split = applyAllowlist(twice, [entry]);
    expect(split.failures).toHaveLength(1);
    expect(split.failures[0]).toMatchObject({ line: 1, match: 'Newsreader' });
    expect(split.failures[0].hint).toContain('allowlist covers 1');
    expect(applyAllowlist(twice).failures).toHaveLength(1);
    const loose = applyAllowlist(twice.slice(0, 1), [{ ...entry, count: 2 }]);
    expect(loose.failures).toEqual([]);
    expect(loose.stale).toHaveLength(1);
    expect(loose.uses.get(loose.stale[0])).toBe(1);
  });

  it('gives every entry a known gate, a reason and a positive count', () => {
    for (const entry of ALLOWLIST) {
      expect(Object.keys(GATES)).toContain(entry.gate);
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(Number.isInteger(entry.count) && entry.count > 0).toBe(true);
    }
  });
});

describe('runner', () => {
  const checker = resolve('scripts/check-design.mjs');
  const roots: string[] = [];
  afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
  function fixture(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'design-check-')); roots.push(root);
    for (const [path, text] of Object.entries({ 'src/styles/global.css': GLOBAL, ...files })) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  }
  const run = (cwd: string) => spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });

  it('passes a clean tree and warns about allowlist entries that no longer match', () => {
    const result = run(fixture({ 'src/pages/a.astro': '<p class="site-link">x</p>\n<style>.a { color: var(--ink); }</style>' }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('design-check passed');
    expect(result.stderr).toContain('allowlist entry no longer matches');
  });

  it('fails with the file, line and gate of each hit', () => {
    const result = run(fixture({ 'src/components/B.astro': '<b />\n<style>\n.b { transition: all 1s ease; }\n</style>' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/components/B.astro:3: transition: all');
    expect(result.stderr).toContain('src/components/B.astro:3: browser-default ease');
  });

  it('points a multi-line class:list hit at its line and names the element-level fix', () => {
    const field = '<button\n  class:list={[\n    \'rounded border outline-none\',\n  ]}\n>x</button>';
    const result = run(fixture({ 'src/components/Field.astro': field }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/components/Field.astro:3: outline removed without a :focus-visible replacement: "outline-none"');
    expect(result.stderr).toContain('focus-visible: utility with a visible ring on the same element');
  });

  it('fails when an allowlisted file gains another use, and passes on the listed ones', () => {
    const result = run(fixture({ 'src/styles/studio.css': '.a { font-family: Newsreader; } .b { font-family: Newsreader; }' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/styles/studio.css:1: font family outside the design system: "Newsreader"');
    expect(result.stderr).toContain('allowlist covers 1');
  });
});
