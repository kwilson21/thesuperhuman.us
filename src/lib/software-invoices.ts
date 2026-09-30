import type { OfferTerms } from './software-offers';
import type { CreatedStripeInvoice } from './stripe-invoicing';

export type SoftwareInvoiceKind = 'deposit' | 'balance' | 'milestone';
export type SoftwareInvoice = {
  id: string; request_id: string; milestone_index: number; kind: SoftwareInvoiceKind;
  amount_cents: number; days_until_due: 7 | 15 | 30; allow_card: number; attempt: number;
  stripe_customer_id: string | null; stripe_invoice_id: string | null; hosted_invoice_url: string | null;
  status: 'creating' | 'open' | 'paid' | 'payment_failed' | 'void' | 'uncollectible';
  status_updated_at: string | null; created_by: string; created_at: string; updated_at: string;
};

export function softwareInvoiceTerms(terms: OfferTerms, milestone: number, kind: SoftwareInvoiceKind) {
  const item = terms.milestones[milestone];
  if (!['deposit', 'balance', 'milestone'].includes(kind) || !Number.isInteger(milestone) || milestone < 0 || !item
    || (terms.paymentMode === 'standard' ? kind === 'milestone' : kind !== 'milestone')) {
    throw new Error('Choose an invoice from the agreed milestone payment schedule.');
  }
  const deposit = Math.floor(item.feeCents / 2);
  return {
    amountCents: kind === 'deposit' ? deposit : kind === 'balance' ? item.feeCents - deposit : item.feeCents,
    daysUntilDue: (kind === 'deposit' ? 7 : kind === 'balance' ? 15 : 30) as 7 | 15 | 30,
  };
}

type InvoiceResult = { id: string; status?: string | null; hosted_invoice_url?: string | null };
// The existing audio adapter uses this same small structural surface for mocked Stripe checks.
type SoftwareStripeClient = {
  customers: { create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }> };
  invoices: {
    create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }>;
    finalizeInvoice(id: string, params: object, options: { idempotencyKey: string }): Promise<InvoiceResult>;
    sendInvoice(id: string, params: object, options: { idempotencyKey: string }): Promise<InvoiceResult>;
  };
  invoiceItems: { create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }> };
};

export async function createSoftwareInvoiceWithClient(
  stripe: SoftwareStripeClient,
  request: { name: string; email: string },
  terms: OfferTerms,
  invoice: SoftwareInvoice,
): Promise<CreatedStripeInvoice> {
  const agreed = softwareInvoiceTerms(terms, invoice.milestone_index, invoice.kind);
  if (invoice.amount_cents !== agreed.amountCents || invoice.days_until_due !== agreed.daysUntilDue
    || ![0, 1].includes(invoice.allow_card) || !Number.isSafeInteger(invoice.attempt) || invoice.attempt < 0) {
    throw new Error('Invoice does not match the project payment terms.');
  }
  const customerKey = `software-request:${invoice.request_id}`;
  const rootKey = `${customerKey}:milestone-${invoice.milestone_index}:${invoice.kind}:attempt-${invoice.attempt}`;
  const metadata = { software_request_id: invoice.request_id, milestone_index: String(invoice.milestone_index), kind: invoice.kind, software_invoice_id: invoice.id };
  const customerId = invoice.stripe_customer_id ?? (await stripe.customers.create({
    email: request.email, name: request.name || undefined,
    metadata: { software_request_id: invoice.request_id },
  }, { idempotencyKey: `${customerKey}:customer` })).id;
  const created = await stripe.invoices.create({
    customer: customerId, collection_method: 'send_invoice', days_until_due: invoice.days_until_due,
    auto_advance: false, description: `${terms.outcome} · Software by The Superhuman Group LLC`, metadata,
    payment_settings: { payment_method_types: invoice.allow_card ? ['us_bank_account', 'card'] : ['us_bank_account'] },
  }, { idempotencyKey: `${rootKey}:invoice` });
  const label = { deposit: '50% deposit', balance: 'remaining balance', milestone: 'full milestone price' }[invoice.kind];
  await stripe.invoiceItems.create({
    customer: customerId, invoice: created.id, amount: invoice.amount_cents, currency: 'usd',
    description: `Milestone ${invoice.milestone_index + 1} · ${terms.milestones[invoice.milestone_index].name} · ${label}`, metadata,
  }, { idempotencyKey: `${rootKey}:item` });
  await stripe.invoices.finalizeInvoice(created.id, {}, { idempotencyKey: `${rootKey}:finalize` });
  const sent = await stripe.invoices.sendInvoice(created.id, {}, { idempotencyKey: `${rootKey}:send` });
  if (sent.id !== created.id || sent.status !== 'open' || !sent.hosted_invoice_url?.startsWith('https://')) {
    throw new Error('Stripe did not return a hosted payment URL.');
  }
  return { stripeCustomerId: customerId, invoiceId: sent.id, hostedInvoiceUrl: sent.hosted_invoice_url, status: 'open' };
}
