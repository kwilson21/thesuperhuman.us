import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const token = (css: string, name: string) => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`--${name} not found in global.css`);
  return match[1];
};
const luminance = (channels: number[]) => {
  const [r, g, b] = channels.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

it('keeps intake placeholders at WCAG AA contrast on paper', () => {
  const global = read('src/styles/global.css');
  const paper = rgb(token(global, 'paper'));
  const muted = rgb(token(global, 'muted'));
  const rule = read('src/styles/audio-intake.css').match(
    /\.intake-field input::placeholder,\.intake-field textarea::placeholder\{color:color-mix\(in srgb,var\(--muted\) (\d+)%,var\(--paper\)\)\}/,
  );
  if (!rule) throw new Error('intake placeholder colour rule not found in audio-intake.css');
  const share = Number(rule[1]) / 100;
  const mixed = muted.map((c, i) => c * share + paper[i] * (1 - share));
  const [light, dark] = [luminance(paper), luminance(mixed)].sort((a, b) => b - a);
  expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
});

it('loads the shared placeholder rule on both intake forms', () => {
  for (const page of ['src/pages/audio/start.astro', 'src/pages/software/start.astro']) {
    expect(read(page)).toContain("import '~/styles/audio-intake.css';");
  }
});
