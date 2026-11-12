import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const global = read('src/styles/global.css');

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const token = (name: string) => {
  const match = global.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`--${name} not found in global.css`);
  return rgb(match[1]);
};
const luminance = (channels: number[]) => {
  const [r, g, b] = channels.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

it('declares the panel and radius tokens', () => {
  expect(global).toContain('--panel: color-mix(in srgb, var(--rule) 50%, var(--paper));');
  expect(global).toContain('--radius-panel: 32px;');
  expect(global).toContain('--radius-button: 999px;');
});

it('makes the shared button a pill that never wraps', () => {
  const css = global.slice(global.indexOf('.site-button {'), global.indexOf('}', global.indexOf('.site-button {')) + 1);
  expect(css).toContain('border-radius: var(--radius-button);');
  expect(css).toContain('padding: .55rem 1.5rem;');
  expect(css).toContain('white-space: nowrap;');
  expect(css).toContain('min-height: 44px;');
  expect(css).toContain('max-width: 100%;');
});

it('adds the large size used in the closing panel', () => {
  expect(global).toMatch(/\.site-button-large \{[^}]*min-height: 52px;[^}]*font-size: 1\.0625rem;[^}]*padding-inline: 1\.75rem;/);
});

it('keeps text and the focus ring readable on the panel', () => {
  const paper = token('paper');
  const ruleColour = token('rule');
  const panel = paper.map((c, i) => (c + ruleColour[i]) / 2);
  const ratio = (name: string) => {
    const [l, d] = [luminance(panel), luminance(token(name))].sort((a, b) => b - a);
    return (l + 0.05) / (d + 0.05);
  };
  expect(ratio('ink')).toBeGreaterThanOrEqual(15);
  expect(ratio('muted')).toBeGreaterThanOrEqual(7);
  expect(ratio('accent')).toBeGreaterThanOrEqual(3);
});

it('draws the door art with the panel token', () => {
  expect(read('src/components/WorkWithMe.astro')).toContain('background: var(--panel);');
});
