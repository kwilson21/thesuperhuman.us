import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ownerNextStep, type NextStepInput } from '~/lib/audio-project-next-step';

const base: NextStepInput = { stage: 'accepted', requestStatus: 'reviewed', revoked: false, payment: null, stripeEnabled: true };
const pay = (bookingStatus: string, balanceStatus = 'not_created') => ({ bookingStatus, balanceStatus });
const step = (input: Partial<NextStepInput>) => ownerNextStep({ ...base, ...input });

describe('ownerNextStep', () => {
  it('leads from review to acceptance', () => {
    expect(step({ stage: 'files_under_review', requestStatus: 'new' })).toMatchObject({ title: 'Mark the request reviewed', target: '#mark-reviewed', action: 'Mark reviewed' });
    expect(step({ stage: 'files_under_review' })).toMatchObject({ title: 'Accept the project', target: '#accept-project' });
  });

  it('leads an accepted project through booking to starting work', () => {
    expect(step({})).toMatchObject({ title: 'Record the agreed terms', target: '#confirm-terms', action: 'Confirm terms' });
    expect(step({ payment: pay('not_created') })).toMatchObject({ title: 'Send the booking invoice' });
    expect(step({ payment: pay('open') })).toMatchObject({ title: 'Waiting on the booking payment', waiting: true });
    expect(step({ payment: pay('payment_failed') })).toMatchObject({ title: 'Sort out the booking invoice' });
    expect(step({ payment: pay('paid') })).toMatchObject({ title: 'Start the work', target: '#start-work' });
  });

  it('says plainly that the booking cannot be paid while Stripe is off', () => {
    expect(step({ payment: pay('not_created'), stripeEnabled: false })).toMatchObject({ title: 'Record the booking payment', target: '#record-booking-payment', action: 'Record booking received' });
  });

  it('leads from reviews to the final delivery and close', () => {
    expect(step({ stage: 'in_progress', payment: pay('paid') })).toMatchObject({ title: 'Share a review mix', target: '#upload-file' });
    expect(step({ stage: 'revision_in_progress', payment: pay('paid') })).toMatchObject({ title: 'Share the revised mix' });
    expect(step({ stage: 'review_ready', payment: pay('paid') })).toMatchObject({ title: 'Waiting on the client’s answer', waiting: true });
    // Stopping revokes the project, and the owner still gets a step until the request is resolved.
    expect(step({ stage: 'review_ready', revoked: true, payment: pay('paid'), reviewDecision: 'stopped' })).toMatchObject({ title: 'The client stopped the project', target: '#request-heading' });
    expect(step({ stage: 'review_ready', revoked: true, requestStatus: 'resolved', payment: pay('paid'), reviewDecision: 'stopped' })).toBeNull();
    expect(step({ stage: 'review_ready', revoked: true, requestStatus: 'withdrawn', payment: pay('paid'), reviewDecision: 'stopped' })).toBeNull();
    expect(step({ stage: 'review_ready', payment: pay('paid'), reviewDecision: 'changes' })).toMatchObject({ title: 'Begin the revision', target: '#begin-revision', action: 'Begin revision' });
    expect(step({ stage: 'review_ready', payment: pay('paid'), reviewDecision: 'approved' })).toMatchObject({ title: 'Send the balance invoice', target: '#create-balance-invoice' });
    expect(step({ stage: 'review_ready', payment: pay('paid'), reviewDecision: 'approved', stripeEnabled: false })).toMatchObject({ title: 'Record the balance payment', target: '#record-balance-payment', action: 'Record balance received' });
    expect(step({ stage: 'review_ready', payment: pay('paid', 'open') })).toMatchObject({ title: 'Waiting on the balance payment', waiting: true });
    expect(step({ stage: 'review_ready', payment: pay('paid', 'paid') })).toMatchObject({ title: 'Deliver the final files' });
    expect(step({ stage: 'final_files_ready', payment: pay('paid', 'paid') })).toMatchObject({ title: 'Close the project', target: '#close-project' });
  });

  it('names the real action when an invoice is pending, voided, failed or unavailable', () => {
    expect(step({ payment: { ...pay('not_created'), bookingCreationStartedAt: '2026-09-24T12:00:00Z' } })).toMatchObject({ title: 'Check the invoice in Stripe' });
    expect(step({ payment: pay('void') })).toMatchObject({ title: 'Replace the booking invoice' });
    expect(step({ payment: pay('void'), stripeEnabled: false })).toMatchObject({ title: 'Waiting on invoices', waiting: true });
    expect(step({ stage: 'review_ready', payment: pay('paid', 'void') })).toMatchObject({ title: 'Replace the balance invoice' });
    expect(step({ stage: 'review_ready', payment: pay('paid', 'payment_failed') })).toMatchObject({ title: 'Sort out the balance invoice' });
    expect(step({ stage: 'review_ready', payment: pay('paid', 'uncollectible') })).toMatchObject({ title: 'Sort out the balance invoice' });
    expect(step({ stage: 'review_ready', payment: { ...pay('paid'), balanceCreationStartedAt: '2026-09-24T12:00:00Z' } })).toMatchObject({ title: 'Check the invoice in Stripe' });
    expect(step({ stage: 'review_ready', payment: pay('paid'), stripeEnabled: false })?.detail).toContain('record the balance yourself');
  });

  it('has nothing to suggest for a closed, withdrawn or revoked project', () => {
    expect(step({ stage: 'complete' })).toBeNull();
    expect(step({ requestStatus: 'withdrawn' })).toBeNull();
    expect(step({ revoked: true })).toBeNull();
  });

  it('points every step at a control the request page renders, and names it', () => {
    const page = ['src/pages/owner/requests/[id].astro', 'src/components/AudioProjectUpdates.astro', 'src/components/owner/AudioPaymentPanel.astro',
      'src/components/owner/OwnerProjectFiles.astro', 'src/components/ProjectMessages.astro'].map(file => readFileSync(file, 'utf8')).join('\n');
    const stages = ['files_under_review', 'accepted', 'in_progress', 'review_ready', 'revision_in_progress', 'final_files_ready'];
    const payments = [null, pay('not_created'), pay('open'), pay('void'), pay('payment_failed'), pay('paid'), pay('paid', 'open'), pay('paid', 'void'), pay('paid', 'paid')];
    for (const stage of stages) for (const requestStatus of ['new', 'reviewed']) for (const payment of payments) for (const stripeEnabled of [true, false]) for (const reviewDecision of [null, 'approved', 'changes', 'stopped'] as const) {
      const next = step({ stage, requestStatus, payment, stripeEnabled, reviewDecision });
      if (!next) continue;
      // The link names the control it lands on, so its label is text the page shows.
      const label = next.action!.replace(/^Create replacement (booking|balance) invoice$/, 'Create replacement {replaceAction} invoice')
        .replace(/^Record (booking|balance) received$/, 'Record {manual} received');
      expect(next.target === '#payment-heading' || next.target === '#project-messages-heading' || next.target === '#request-heading' || page.includes(label), `${next.title}: ${label}`).toBe(true);
      const id = next.target!.slice(1).replace(/^record-(booking|balance)-payment$/, 'record-${manual}-payment');
      expect(page.includes(`id="${id}"`) || page.includes(`'${id}'`) || page.includes(`\`${id}\``), next.target).toBe(true);
    }
  });
});
