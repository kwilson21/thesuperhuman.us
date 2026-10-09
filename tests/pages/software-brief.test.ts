import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const page = readFileSync(new URL('../../src/pages/software/start.astro', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../src/scripts/software-inquiry.ts', import.meta.url), 'utf8');
it('contains the approved receipt and three next steps, with no print or answer readback', () => {
  for (const copy of ['Software brief · sent', 'Your brief is in.', 'I reply with a fixed-price first milestone, or a question or two.', 'If it looks right, you sign the agreement online. It takes about two minutes.', 'Work starts, and you follow it on your own private project page.', "It has everything you wrote, so you don't need to save this page."]) expect(page).toContain(copy);
  expect(page).not.toMatch(/data-print|data-receipt[ >]|Print or save/);
  expect(page.match(/No booking or payment at this stage\./g)).toHaveLength(1);
  expect(script).toContain("index !== 2");
  expect(script).not.toContain('Not provided');
});
it('personalizes the receipt and handles unconfirmed or failed delivery', () => {
  expect(script).toContain('Thanks, ${firstName}. I\'ll read it myself and reply within two business days.');
  expect(script).toContain('A copy is on its way to ${brief.email}.');
  expect(script).toContain("I couldn't send your copy just now, but your brief is saved and I'll still reply.");
  expect(script).toContain("result.clientCopyStatus === 'sent'");
});
it('shows the brief copy outcome on the owner request', () => {
  const owner = readFileSync(new URL('../../src/pages/owner/requests/[id].astro', import.meta.url), 'utf8');
  expect(owner).toContain('Client copy:');
  expect(owner).toContain('request.details.clientCopyStatus');
  expect(owner).toContain("didn't send");
});
