export type NextStepInput = {
  stage: string;
  requestStatus: string;
  revoked: boolean;
  payment: { bookingStatus: string; balanceStatus: string; bookingCreationStartedAt?: string | null; balanceCreationStartedAt?: string | null } | null;
  stripeEnabled: boolean;
};

/** One instruction for the owner, and the section of the request page where it is done. */
export type NextStep = { title: string; detail: string; target?: string; waiting?: boolean };

const files = '#project-files-heading';
const payment = '#payment-heading';
const reconciling: NextStep = { title: 'Check the invoice in Stripe', detail: 'Invoice creation started but was not recorded. Book the work shows what to check before trying again.', target: payment };
const stripeOff: NextStep = { title: 'Waiting on invoices', detail: 'Invoices are off until Stripe is set up, so this payment cannot be requested yet. Messages and date changes still work meanwhile.', target: payment, waiting: true };
/** A voided, failed or uncollectible invoice: Book the work says how to replace or retry it. */
const invoiceProblem = (which: string, status: string, stripeEnabled: boolean): NextStep => status === 'void'
  ? stripeEnabled ? { title: `Replace the ${which} invoice`, detail: `The ${which} invoice was voided. Create a replacement in Book the work.`, target: payment } : stripeOff
  : { title: `Sort out the ${which} invoice`, detail: `The ${which} invoice was not paid. Follow the note in Book the work before taking another step.`, target: payment };

/** What the owner does next to move a studio project along, or null once there is nothing left. */
export function ownerNextStep({ stage, requestStatus, revoked, payment: pay, stripeEnabled }: NextStepInput): NextStep | null {
  if (revoked || requestStatus === 'withdrawn' || stage === 'complete') return null;
  if (stage === 'files_under_review') return requestStatus === 'new'
    ? { title: 'Mark the request reviewed', detail: 'Check the files and details, then use Mark reviewed under Request. That opens the Accept form.', target: '#request-heading' }
    : requestStatus === 'reviewed'
      ? { title: 'Accept the project', detail: 'Set a cautious delivery date and send the first update. The client sees both in their studio.', target: '#accept-project' }
      : { title: 'Reopen to accept', detail: 'This request is resolved. To take it on, Reopen it under Request, then Mark reviewed.', target: '#request-heading' };
  if (stage === 'accepted') {
    if (!pay) return { title: 'Record the agreed terms', detail: 'Once the client accepts your written offer, confirm the service and price in Book the work.', target: payment };
    if (pay.bookingStatus === 'paid') return { title: 'Start the work', detail: 'The booking is paid. Tell the client what you are focusing on first.', target: '#start-work' };
    if (pay.bookingStatus === 'not_created') return pay.bookingCreationStartedAt ? reconciling : stripeEnabled
      ? { title: 'Send the booking invoice', detail: 'Create the booking invoice in Book the work. Stripe emails it to the client.', target: payment }
      : { title: 'Waiting on booking payments', detail: 'Invoices are off until Stripe is set up, so the booking cannot be paid yet and work cannot start. Messages and date changes still work meanwhile.', target: payment, waiting: true };
    if (pay.bookingStatus === 'draft' || pay.bookingStatus === 'open') return { title: 'Waiting on the booking payment', detail: 'Work unlocks when Stripe confirms the client paid. Nothing to do until then.', target: payment, waiting: true };
    return invoiceProblem('booking', pay.bookingStatus, stripeEnabled);
  }
  if (stage === 'in_progress') return { title: 'Share a review mix', detail: 'Upload the mix under Review and delivery as a review version, then publish it. The client is emailed a link to listen.', target: files };
  if (stage === 'revision_in_progress') return { title: 'Share the revised mix', detail: 'Upload the revision as a review version and publish it with a note on what changed.', target: files };
  if (stage === 'review_ready') {
    const balance = pay?.balanceStatus ?? 'not_created';
    if (balance === 'paid') return { title: 'Deliver the final files', detail: 'The balance is paid. Upload the final version under Review and delivery and publish it.', target: files };
    if (balance === 'not_created') return pay?.balanceCreationStartedAt ? reconciling
      : { title: 'Wait for notes, then revise or finish', detail: stripeEnabled
        ? 'If the client asks for changes, begin a revision. If they approve the mix, create the balance invoice in Book the work; the final can be shared once it is paid.'
        : 'If the client asks for changes, begin a revision. Finishing needs the balance invoice, which waits until Stripe is set up.', target: '#project-messages-heading' };
    if (balance === 'draft' || balance === 'open') return { title: 'Waiting on the balance payment', detail: 'The final file can be uploaded now, but it stays private until Stripe confirms the balance.', target: payment, waiting: true };
    return invoiceProblem('balance', balance, stripeEnabled);
  }
  if (stage === 'final_files_ready') return { title: 'Close the project', detail: 'Once the client has the final files, mark the project complete. Their download stays available until it expires.', target: '#close-project' };
  return null;
}
