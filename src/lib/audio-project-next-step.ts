export type NextStepInput = {
  stage: string;
  requestStatus: string;
  revoked: boolean;
  payment: { bookingStatus: string; balanceStatus: string; bookingCreationStartedAt?: string | null; balanceCreationStartedAt?: string | null } | null;
  stripeEnabled: boolean;
  /** The client's answer to the latest published review, if any. */
  reviewDecision?: 'approved' | 'changes' | null;
};

/** One instruction for the owner, the control on the request page that does it, and that control's name. */
export type NextStep = { title: string; detail: string; target?: string; action?: string; waiting?: boolean };

const upload = '#upload-file';
const payment = '#payment-heading';
const reconciling: NextStep = { title: 'Check the invoice in Stripe', detail: 'Invoice creation started but was not recorded. Book the work shows what to check before trying again.', target: payment, action: 'See the invoice status' };
const stripeOff: NextStep = { title: 'Waiting on invoices', detail: 'Invoices are off until Stripe is set up, so this payment cannot be requested yet. Messages and date changes still work meanwhile.', target: payment, action: 'See the payment status', waiting: true };
/** A voided, failed or uncollectible invoice: Book the work says how to replace or retry it. */
const invoiceProblem = (which: string, status: string, stripeEnabled: boolean): NextStep => status === 'void'
  ? stripeEnabled ? { title: `Replace the ${which} invoice`, detail: `The ${which} invoice was voided. Create a replacement in Book the work.`, target: '#replace-invoice', action: `Create replacement ${which} invoice` } : stripeOff
  : { title: `Sort out the ${which} invoice`, detail: `The ${which} invoice was not paid. Follow the note in Book the work before taking another step.`, target: payment, action: 'See the invoice status' };

/** What the owner does next to move a studio project along, or null once there is nothing left. */
export function ownerNextStep({ stage, requestStatus, revoked, payment: pay, stripeEnabled, reviewDecision = null }: NextStepInput): NextStep | null {
  if (revoked || requestStatus === 'withdrawn' || stage === 'complete') return null;
  // Resolving an unaccepted request closes its studio (migration 0015), so only new and reviewed remain.
  if (stage === 'files_under_review') return requestStatus === 'new'
    ? { title: 'Mark the request reviewed', detail: 'Check the files and details, then use Mark reviewed under Request. That opens the Accept form.', target: '#mark-reviewed', action: 'Mark reviewed' }
    : requestStatus === 'reviewed'
      ? { title: 'Accept the project', detail: 'Set a cautious delivery date and send the first update. The client sees both in their studio.', target: '#accept-project', action: 'Accept and update client' }
      : null;
  if (stage === 'accepted') {
    if (!pay) return { title: 'Record the agreed terms', detail: 'Once the client accepts your written offer, check the service and price in Book the work, tick that the client accepted, then confirm the terms.', target: '#confirm-terms', action: 'Confirm terms' };
    if (pay.bookingStatus === 'paid') return { title: 'Start the work', detail: 'The booking is paid. Tell the client what you are focusing on first.', target: '#start-work', action: 'Mark in progress' };
    if (pay.bookingStatus === 'not_created') return pay.bookingCreationStartedAt ? reconciling : stripeEnabled
      ? { title: 'Send the booking invoice', detail: 'Create the booking invoice in Book the work. Stripe emails it to the client. If they paid another way, use Paid another way? instead.', target: '#create-booking-invoice', action: 'Create booking invoice' }
      : { title: 'Record the booking payment', detail: 'Stripe invoices are off, so collect the booking another way. Once it arrives, record it in Book the work; that unlocks Start the work.', target: '#record-booking-payment', action: 'Record booking received' };
    if (pay.bookingStatus === 'draft' || pay.bookingStatus === 'open') return { title: 'Waiting on the booking payment', detail: 'Work unlocks when Stripe confirms the client paid. Nothing to do until then.', target: payment, action: 'See the booking status', waiting: true };
    return invoiceProblem('booking', pay.bookingStatus, stripeEnabled);
  }
  if (stage === 'in_progress') return { title: 'Share a review mix', detail: 'Upload the mix under Review and delivery as a review version, then publish it. The client is emailed a link to listen.', target: upload, action: 'Upload file' };
  if (stage === 'revision_in_progress') return { title: 'Share the revised mix', detail: 'Upload the revision as a review version and publish it with a note on what changed.', target: upload, action: 'Upload file' };
  if (stage === 'review_ready') {
    const balance = pay?.balanceStatus ?? 'not_created';
    if (balance === 'paid') return { title: 'Deliver the final files', detail: 'The balance is paid. Upload the final file under Review and delivery with Version set to Final, then publish it.', target: upload, action: 'Upload file' };
    if (balance === 'not_created') {
      if (pay?.balanceCreationStartedAt) return reconciling;
      if (reviewDecision === 'changes') return { title: 'Begin the revision', detail: 'The client requested changes. Their notes are in the conversation. Begin the revision to tell them you are on it.', target: '#begin-revision', action: 'Begin revision' };
      if (reviewDecision === 'approved') return stripeEnabled
        ? { title: 'Send the balance invoice', detail: 'The client approved the mix. Create the balance invoice in Book the work; the final can be shared once it is paid.', target: '#create-balance-invoice', action: 'Create balance invoice' }
        : { title: 'Record the balance payment', detail: 'The client approved the mix. Collect the balance another way, then record it in Book the work; that unlocks the final delivery.', target: '#record-balance-payment', action: 'Record balance received' };
      return { title: 'Waiting on the client’s answer', detail: 'The client was emailed the review and asked to approve it or request changes. Their answer appears in the conversation and updates this step. If they answer another way, begin a revision or record the balance yourself.', target: '#project-messages-heading', action: 'Read the conversation', waiting: true };
    }
    if (balance === 'draft' || balance === 'open') return { title: 'Waiting on the balance payment', detail: 'The final file can be uploaded now, but it stays private until Stripe confirms the balance.', target: payment, action: 'See the balance status', waiting: true };
    return invoiceProblem('balance', balance, stripeEnabled);
  }
  if (stage === 'final_files_ready') return { title: 'Close the project', detail: 'Once the client has the final files, mark the project complete. Their download stays available until it expires.', target: '#close-project', action: 'Mark complete' };
  return null;
}
