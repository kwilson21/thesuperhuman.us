import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const studio = readFileSync(new URL('../../src/styles/studio.css', import.meta.url), 'utf8');
const rule = (selector: string) => {
  const start = studio.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} not found in studio.css`);
  return studio.slice(start, studio.indexOf('}', start));
};

it('draws studio and agreement fields with the 3:1 field-border token', () => {
  expect(rule('.studio-textarea')).toContain('border: 1px solid var(--field-border)');
});

it('shows the site focus ring at once on studio and agreement fields', () => {
  const fields = rule('.studio-textarea');
  expect(fields).not.toContain('transition');
  const focus = rule('.studio-textarea:focus-visible');
  expect(focus).toContain('outline: 2px solid var(--accent)');
  expect(focus).not.toContain('box-shadow');
  expect(focus).not.toContain('outline: none');
});
