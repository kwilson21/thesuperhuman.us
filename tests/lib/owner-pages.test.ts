import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

it('renders shared navigation, one primary action and accessible guidance', () => {
  const layout = read('src/layouts/OwnerLayout.astro');
  const today = read('src/pages/owner/index.astro');
  for (const label of ['Today', 'Requests', 'Campaigns']) expect(layout).toContain(label);
  expect(today).toContain('Open Campaign Desk');
  expect(today.match(/owner-primary-action/g)).toHaveLength(1);
  expect(today).toContain('First area to inspect');
  expect(today).toContain('Next useful area');
});

it('keeps the empty campaign state compact and names the owner center plainly', () => {
  const layout = read('src/layouts/OwnerLayout.astro');
  const today = read('src/pages/owner/index.astro');
  expect(layout.toLowerCase()).not.toContain('studio ledger');
  expect(today.toLowerCase()).not.toContain('studio ledger');
  expect(layout).toContain('owner center');
  expect(today).toContain('ledger.activeCampaign ? <ListeningPath');
  expect(today).not.toContain('campaign-empty-path');
});

it('keeps listening explanations beside their metric copy', () => {
  const component = read('src/components/owner/ListeningPath.astro');
  const css = read('src/styles/owner.css');
  expect(component).toContain('class="path-copy"');
  expect(component).toMatch(/path-copy[\s\S]*MetricDefinition/);
  expect(css).toContain('.path-copy{');
  expect(css).not.toContain('.campaign-empty-path{');
});

it('keeps the owner interface editorial and responsive', () => {
  const css = read('src/styles/owner.css');
  expect(css).toContain('var(--paper)');
  expect(css).toContain('@media(max-width: 700px)');
  expect(css).toContain('prefers-reduced-motion');
  expect(css).not.toMatch(/gradient|box-shadow|backdrop-filter/);
});

it('provides connected request and campaign views', () => {
  for (const path of ['src/pages/owner/requests/index.astro', 'src/pages/owner/requests/[id].astro', 'src/pages/owner/campaigns/index.astro', 'src/pages/owner/campaigns/[id].astro']) {
    expect(read(path)).toContain('OwnerLayout');
  }
  expect(read('src/pages/owner/campaigns/[id].astro')).toContain('Return to Today');
  expect(read('src/pages/owner/requests/[id].astro')).toContain('Supplied by requester');
  expect(read('src/pages/owner/requests/[id].astro')).toContain('Submitted with this request');
  expect(read('src/pages/owner/requests/[id].astro')).toContain('for="owner-private-note"');
  expect(read('src/scripts/owner-request-actions.ts')).toContain('Connection lost');
});

it('keeps audio payment work inside the service request with one clear next action', () => {
  const page = read('src/pages/owner/requests/[id].astro');
  const panel = read('src/components/owner/AudioPaymentPanel.astro');
  const script = read('src/scripts/owner-payment-actions.ts');
  expect(page).toContain("request.kind === 'service'");
  expect(page).toContain('AudioPaymentPanel');
  expect(panel).toContain('Payment');
  expect(panel).toContain('Client accepted the written offer');
  expect(panel).toContain('Create booking invoice');
  expect(panel).toContain('Create balance invoice');
  expect(panel).toContain("payment.bookingStatus === 'paid'");
  // While an invoice is unpaid, remind the owner how to close it when the client paid another way.
  expect(panel).toContain('Mark as paid</strong>, not Void');
  expect(panel).not.toContain('stripeCustomerId');
  expect(script).toContain('/payment');
  expect(script).toContain('That invoice was not created');
});
