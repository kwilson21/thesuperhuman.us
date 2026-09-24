import { describe, expect, it } from 'vitest';
import { ownerNextStep, type NextStepInput } from '~/lib/audio-project-next-step';

const base: NextStepInput = { stage: 'accepted', requestStatus: 'reviewed', revoked: false, payment: null, stripeEnabled: true };
const pay = (bookingStatus: string, balanceStatus = 'not_created') => ({ bookingStatus, balanceStatus });
const step = (input: Partial<NextStepInput>) => ownerNextStep({ ...base, ...input });

describe('ownerNextStep', () => {
  it('leads from review to acceptance', () => {
    expect(step({ stage: 'files_under_review', requestStatus: 'new' })).toMatchObject({ title: 'Mark the request reviewed', target: '#request-heading' });
    expect(step({ stage: 'files_under_review' })).toMatchObject({ title: 'Accept the project', target: '#accept-project' });
  });

  it('leads an accepted project through booking to starting work', () => {
    expect(step({})).toMatchObject({ title: 'Record the agreed terms', target: '#payment-heading' });
    expect(step({ payment: pay('not_created') })).toMatchObject({ title: 'Send the booking invoice' });
    expect(step({ payment: pay('open') })).toMatchObject({ title: 'Waiting on the booking payment', waiting: true });
    expect(step({ payment: pay('payment_failed') })).toMatchObject({ title: 'Sort out the booking invoice' });
    expect(step({ payment: pay('paid') })).toMatchObject({ title: 'Start the work', target: '#start-work' });
  });

  it('says plainly that the booking cannot be paid while Stripe is off', () => {
    expect(step({ payment: pay('not_created'), stripeEnabled: false })).toMatchObject({ title: 'Waiting on booking payments', waiting: true });
  });

  it('leads from reviews to the final delivery and close', () => {
    expect(step({ stage: 'in_progress', payment: pay('paid') })).toMatchObject({ title: 'Share a review mix', target: '#project-files-heading' });
    expect(step({ stage: 'revision_in_progress', payment: pay('paid') })).toMatchObject({ title: 'Share the revised mix' });
    expect(step({ stage: 'review_ready', payment: pay('paid') })).toMatchObject({ title: 'Wait for notes, then revise or finish' });
    expect(step({ stage: 'review_ready', payment: pay('paid', 'open') })).toMatchObject({ title: 'Waiting on the balance payment', waiting: true });
    expect(step({ stage: 'review_ready', payment: pay('paid', 'paid') })).toMatchObject({ title: 'Deliver the final files' });
    expect(step({ stage: 'final_files_ready', payment: pay('paid', 'paid') })).toMatchObject({ title: 'Close the project', target: '#close-project' });
  });

  it('has nothing to suggest for a closed, withdrawn or revoked project', () => {
    expect(step({ stage: 'complete' })).toBeNull();
    expect(step({ requestStatus: 'withdrawn' })).toBeNull();
    expect(step({ revoked: true })).toBeNull();
  });
});
