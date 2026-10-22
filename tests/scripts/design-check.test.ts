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

  it('flags the bare ease keyword but not the named easing or other keywords', () => {
    expect(css('.a { transition: background 200ms ease; }')).toEqual(['bare-ease']);
    expect(css('.a { animation-timing-function: ease; }')).toEqual(['bare-ease']);
    expect(css('.a { transition: transform 1s var(--ease-site); animation: ease-glow 2s ease-out; }')).toEqual([]);
  });

  it('flags outline: none only when the file has no :focus-visible replacement', () => {
    expect(css('.a:focus { outline: none; }')).toEqual(['outline-none']);
    expect(css('.a:focus { outline: 0; } .a:focus-visible { box-shadow: 0 0 0 2px var(--accent); }')).toEqual([]);
    expect(css('.a:focus:not(:focus-visible) { outline: none; }')).toEqual([]);
    expect(gates('src/pages/x.astro', '<input class="focus:outline-none" />')).toEqual(['outline-none']);
    expect(gates('src/pages/x.astro', '<input class="outline-none focus-visible:outline-2" />')).toEqual([]);
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

  it('gives every entry a known gate and a reason', () => {
    for (const entry of ALLOWLIST) {
      expect(Object.keys(GATES)).toContain(entry.gate);
      expect(entry.reason.length).toBeGreaterThan(20);
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
});
