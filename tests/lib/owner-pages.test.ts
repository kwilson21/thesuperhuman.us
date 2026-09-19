import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

it('renders shared navigation, one primary action and accessible guidance', () => {
  const layout = read('src/layouts/OwnerLayout.astro');
  const today = read('src/pages/owner/index.astro');
  for (const label of ['Today', 'Requests', 'Campaigns', 'Audience']) expect(layout).toContain(label);
  expect(today).toContain('Open Campaign Desk');
  expect(today.match(/owner-primary-action/g)).toHaveLength(1);
  expect(today).toContain('First area to inspect');
  expect(today).toContain('Next useful area');
});

it('keeps the owner interface editorial and responsive', () => {
  const css = read('src/styles/owner.css');
  expect(css).toContain('var(--paper)');
  expect(css).toContain('@media(max-width: 700px)');
  expect(css).toContain('prefers-reduced-motion');
  expect(css).not.toMatch(/gradient|box-shadow|backdrop-filter/);
});

it('provides connected request, campaign and audience views', () => {
  for (const path of ['src/pages/owner/requests/index.astro', 'src/pages/owner/requests/[id].astro', 'src/pages/owner/campaigns/index.astro', 'src/pages/owner/campaigns/[id].astro', 'src/pages/owner/audience.astro']) {
    expect(read(path)).toContain('OwnerLayout');
  }
  expect(read('src/pages/owner/campaigns/[id].astro')).toContain('Return to Today');
  expect(read('src/pages/owner/requests/[id].astro')).toContain('Supplied by requester');
});
