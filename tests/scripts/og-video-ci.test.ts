import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteTokens } from '../../scripts/og-video/site-tokens.mjs';
import { withFiles, withNote } from '../../scripts/og-video/record.mjs';
import { check } from '../../scripts/og-video/publish.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('link-preview site tokens', () => {
  it('match src/styles/global.css (run node scripts/og-video/site-tokens.mjs)', () => {
    expect(readFileSync('scripts/og-video/site-tokens.css', 'utf8')).toBe(siteTokens(readFileSync('src/styles/global.css', 'utf8')));
  });

  it('refuse a label face the scene kit does not load', () => {
    const css = readFileSync('src/styles/global.css', 'utf8').replace(/(\.page-kicker \{ font-family: )var\(--font-sans\)/, '$1var(--font-display)');
    expect(() => siteTokens(css)).toThrow(/face the kit does not load/);
  });
});

describe('link-preview asset record', () => {
  const record = '# Asset\n\n- one\n\n## home\n\n```json\n{\n  "outcome": "ready",\n  "files": [\n    {"path": "old"}\n  ]\n}\n```\n';

  it('adds a note at the end of the header list', () => {
    expect(withNote(record, 'two')).toContain('- one\n- two\n\n## home');
    expect(() => withNote(record, 'two\nthree')).toThrow();
  });

  it('lists every poster and video with its hash and size', () => {
    const manifest = { home: { image: '/og/home-0123456789.png', video: '/og/home-abcdef0123.mp4' } };
    const updated = withFiles(record, manifest, () => Buffer.from('x'));
    expect(updated).toContain('"path": "public/og/home-0123456789.png"');
    expect(updated).toContain('"path": "public/og/raw/home-abcdef0123.mp4"');
    expect(updated).toContain('"bytes": 1');
    expect(updated).not.toContain('"path": "old"');
  });
});

describe('link-preview publish checks', () => {
  it('accepts preview media at their paths', () => {
    expect(check('public/og/home-0123456789.png', PNG)).toBeNull();
    expect(check('public/og/raw/home-0123456789.mp4', Buffer.from('\0\0\0\x20ftypisom'))).toBeNull();
  });

  it('refuses other paths and mismatched contents', () => {
    expect(check('src/pages/index.astro', PNG)).toMatch(/may change/);
    expect(check('public/og/home-0123456789.png', Buffer.from('<svg/>'))).toMatch(/file type/);
    expect(check('public/og/raw/home-0123456789.mp4', PNG)).toMatch(/MP4/);
  });

  it('refuses a manifest with unexpected files or inputs', () => {
    const entry = { image: '/og/home-0123456789.png', video: '/og/home-0123456789.mp4', inputs: ['scripts/og-video/kit.css'] };
    expect(check('src/data/og-media.json', Buffer.from(JSON.stringify({ home: entry })))).toBeNull();
    expect(check('src/data/og-media.json', Buffer.from(JSON.stringify({ home: { ...entry, inputs: ['../secret'] } })))).toMatch(/inputs/);
    expect(check('src/data/og-media.json', Buffer.from(JSON.stringify({ home: { ...entry, image: '/index.html' } })))).toMatch(/files/);
  });

  it('accepts only lines the token generator writes', () => {
    expect(check('scripts/og-video/site-tokens.css', readFileSync('scripts/og-video/site-tokens.css'))).toBeNull();
    expect(check('scripts/og-video/site-tokens.css', Buffer.from(':root {\n  --paper: url(https://example.com/x);\n}\n'))).toMatch(/line/);
  });
});
