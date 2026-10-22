import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const global = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

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

it('keeps form field edges at 3:1 or better against paper (WCAG 1.4.11)', () => {
  const rule = global.match(/--field-border:\s*color-mix\(in srgb,\s*var\(--muted\)\s*(\d+)%,\s*var\(--paper\)\);/);
  if (!rule) throw new Error('--field-border colour-mix not found in global.css');
  const share = Number(rule[1]) / 100;
  const paper = token('paper');
  const border = token('muted').map((c, i) => c * share + paper[i] * (1 - share));
  const [light, dark] = [luminance(paper), luminance(border)].sort((a, b) => b - a);
  expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(3);
});

it('draws the shared form fields with the field-border token, not the hairline', () => {
  expect(global).toMatch(/\.site-form input:not\(\[type=checkbox\]\)[^{]*\{[^}]*border: 1px solid var\(--field-border\)/);
});

it('shows the accent error edge on invalid inputs, not only on textareas', () => {
  // The field rule's :not() chain outranks a bare [aria-invalid=true]; the error rule must match it.
  expect(global).toContain('.site-form input:not([type=checkbox]):not([type=radio]):not([type=hidden])[aria-invalid=true] { border-color: var(--accent); }');
});

it('borders the studio sign-in code boxes with the field-border token and the shared focus outline', () => {
  const signIn = readFileSync(new URL('../../src/pages/studio/sign-in.astro', import.meta.url), 'utf8');
  expect(signIn).toMatch(/\.code-box \{[^}]*border: 1px solid var\(--field-border\)/);
  expect(signIn).toContain('.code-box:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }');
});
