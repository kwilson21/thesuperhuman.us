export type NextStepInput = {
  stage: string;
  requestStatus: string;
  revoked: boolean;
  payment: { bookingStatus: string; balanceStatus: string } | null;
  stripeEnabled: boolean;
};

/** One instruction for the owner, and the section of the request page where it is done. */
export type NextStep = { title: string; detail: string; target?: string; waiting?: boolean };

const files = '#project-files-heading';
const payment = '#payment-heading';

/** What the owner does next to move a studio project along, or null once there is nothing left. */
export function ownerNextStep({ stage, requestStatus, revoked, payment: pay, stripeEnabled }: NextStepInput): NextStep | null {
  if (revoked || requestStatus === 'withdrawn' || stage === 'complete') return null;
  if (stage === 'files_under_review') return requestStatus === 'new'
    ? { title: 'Mark the request reviewed', detail: 'Check the files and details, then use Mark reviewed under Request. That opens the Accept form.', target: '#request-heading' }
    : { title: 'Accept the project', detail: 'Set a cautious delivery date and send the first update. The client sees both in their studio.', target: '#accept-project' };
  if (stage === 'accepted') {
    if (!pay) return { title: 'Record the agreed terms', detail: 'Once the client accepts your written offer, confirm the service and price in Book the work.', target: payment };
    if (pay.bookingStatus === 'paid') return { title: 'Start the work', detail: 'The booking is paid. Tell the client what you are focusing on first.', target: '#start-work' };
    if (pay.bookingStatus === 'not_created') return stripeEnabled
      ? { title: 'Send the booking invoice', detail: 'Create the booking invoice in Book the work. Stripe emails it to the client.', target: payment }
      : { title: 'Waiting on booking payments', detail: 'Invoices are off until Stripe is set up, so the booking cannot be paid yet and work cannot start. Messages and date changes still work meanwhile.', target: payment, waiting: true };
    if (pay.bookingStatus === 'draft' || pay.bookingStatus === 'open') return { title: 'Waiting on the booking payment', detail: 'Work unlocks when Stripe confirms the client paid. Nothing to do until then.', target: payment, waiting: true };
    return { title: 'Sort out the booking invoice', detail: 'The booking invoice was not paid. Follow the note in Book the work before taking another step.', target: payment };
  }
  if (stage === 'in_progress') return { title: 'Share a review mix', detail: 'Upload the mix under Review and delivery as a review version, then publish it. The client is emailed a link to listen.', target: files };
  if (stage === 'revision_in_progress') return { title: 'Share the revised mix', detail: 'Upload the revision as a review version and publish it with a note on what changed.', target: files };
  if (stage === 'review_ready') {
    if (pay?.balanceStatus === 'paid') return { title: 'Deliver the final files', detail: 'The balance is paid. Upload the final version under Review and delivery and publish it.', target: files };
    if (pay?.balanceStatus === 'not_created') return { title: 'Wait for notes, then revise or finish', detail: 'If the client asks for changes, begin a revision. If they approve the mix, create the balance invoice in Book the work; the final can be shared once it is paid.', target: '#project-messages-heading' };
    return { title: 'Waiting on the balance payment', detail: 'The final file can be uploaded now, but it stays private until Stripe confirms the balance.', target: payment, waiting: true };
  }
  if (stage === 'final_files_ready') return { title: 'Close the project', detail: 'Once the client has the final files, mark the project complete. Their download stays available until it expires.', target: '#close-project' };
  return null;
}
