import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { requiresEarlierStartAgreement, softwareDate } from '~/lib/software-projects';
import { newYorkTime } from '~/lib/agreement-artifacts';

it('uses the site date formats for signing metadata', () => {
  expect(softwareDate('2026-09-30')).toBe('Sep 30, 2026');
  expect(newYorkTime('2026-09-30T13:15:43.382Z')).toBe('Sep 30, 2026, 9:15 AM EDT');
  for (const path of ['src/pages/offer/[token]/sign.astro', 'src/components/owner/SoftwareAgreementPanel.astro', 'src/pages/agreements.astro']) {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/\{[das]\.(effective_on|signed_at)\}/);
  }
});
it('shows earlier-start evidence only before the SOW service start', () => {
  expect(requiresEarlierStartAgreement('2026-10-01', '2026-09-30')).toBe(true);
  expect(requiresEarlierStartAgreement('2026-09-30', '2026-09-30')).toBe(false);
  expect(requiresEarlierStartAgreement('2026-09-29', '2026-09-30')).toBe(false);
  expect(requiresEarlierStartAgreement(undefined, '2026-09-30')).toBe(false);
  const panel = readFileSync('src/components/owner/SoftwareProjectPanel.astro', 'utf8');
  expect(panel).toContain('requiresEarlierStartAgreement(startDetails?.planned_start, today) && <>');
});
