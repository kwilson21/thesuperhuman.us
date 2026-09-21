import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const page = readFileSync(new URL('../../src/pages/music/[slug].astro', import.meta.url), 'utf8');

it('only offers the lyrics anchor when the release has lyrics to reveal', () => {
  expect(page).toContain("{first.lyrics && <a class=\"site-link\" href=\"#lyrics\">");
});
