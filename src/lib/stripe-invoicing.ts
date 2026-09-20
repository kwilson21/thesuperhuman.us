import Stripe from 'stripe';
import type { AudioPayment, Installment } from './audio-payments';

type InvoiceResult = { id: string; status?: string | null; hosted_invoice_url?: string | null };
type StripeInvoicingClient = {
  customers: { create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }> };
  invoices: {
    create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }>;
    finalizeInvoice(id: string, params: object, options: { idempotencyKey: string }): Promise<InvoiceResult>;
    sendInvoice(id: string, params: object, options: { idempotencyKey: string }): Promise<InvoiceResult>;
  };
  invoiceItems: { create(params: object, options: { idempotencyKey: string }): Promise<{ id: string }> };
};

type InvoiceRequest = { name: string; email: string; summary: string };
export type CreatedStripeInvoice = {
  stripeCustomerId: string;
  invoiceId: string;
  hostedInvoiceUrl: string;
  status: 'open';
};

export function stripeAvailable(env: Env): boolean {
  return env.STRIPE_PAYMENTS_ENABLED === 'true'
    && stripeWebhookAvailable(env);
}

export function stripeWebhookAvailable(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY) && Boolean(env.STRIPE_WEBHOOK_SECRET);
}

function stripeClient(env: Env, invoiceCreation = true): Stripe {
  if (invoiceCreation ? !stripeAvailable(env) : !stripeWebhookAvailable(env)) {
    throw new Error(invoiceCreation ? 'Stripe invoice creation is unavailable.' : 'Stripe webhooks are unavailable.');
  }
  return new Stripe(env.STRIPE_SECRET_KEY!, { httpClient: Stripe.createFetchHttpClient() });
}

export async function createInvoiceWithClient(
  stripe: StripeInvoicingClient,
  request: InvoiceRequest,
  payment: AudioPayment,
  installment: Installment,
): Promise<CreatedStripeInvoice> {
  const customerKey = `audio-request:${payment.requestId}`;
  const attempt = installment === 'booking' ? payment.bookingAttemptCount : payment.balanceAttemptCount;
  const rootKey = `${customerKey}:${installment}:attempt-${attempt}`;
  const customerId = payment.stripeCustomerId ?? (await stripe.customers.create({
    email: request.email,
    name: request.name || undefined,
    metadata: { audio_request_id: payment.requestId },
  }, { idempotencyKey: `${customerKey}:customer` })).id;
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: 7,
    auto_advance: false,
    description: `${request.summary} · Audio services by Kazon`,
    metadata: { audio_request_id: payment.requestId, installment },
  }, { idempotencyKey: `${rootKey}:invoice` });
  const booking = installment === 'booking';
  await stripe.invoiceItems.create({
    customer: customerId,
    invoice: invoice.id,
    amount: booking ? payment.bookingAmountCents : payment.balanceAmountCents,
    currency: payment.currency,
    description: `Audio services by Kazon · ${payment.approvedService} · ${booking ? '50% booking payment' : 'remaining balance'}`,
    metadata: { audio_request_id: payment.requestId, installment },
  }, { idempotencyKey: `${rootKey}:item` });
  await stripe.invoices.finalizeInvoice(invoice.id, {}, { idempotencyKey: `${rootKey}:finalize` });
  const sent = await stripe.invoices.sendInvoice(invoice.id, {}, { idempotencyKey: `${rootKey}:send` });
  if (sent.status !== 'open' || !sent.hosted_invoice_url?.startsWith('https://')) {
    throw new Error('Stripe did not return a hosted payment URL.');
  }
  return { stripeCustomerId: customerId, invoiceId: sent.id, hostedInvoiceUrl: sent.hosted_invoice_url, status: 'open' };
}

export async function createBookingInvoice(env: Env, request: InvoiceRequest, payment: AudioPayment) {
  return createInvoiceWithClient(stripeClient(env), request, payment, 'booking');
}

export async function createBalanceInvoice(env: Env, request: InvoiceRequest, payment: AudioPayment) {
  return createInvoiceWithClient(stripeClient(env), request, payment, 'balance');
}

export async function verifyStripeWebhook(env: Env, rawBody: string, signature: string): Promise<Stripe.Event> {
  return stripeClient(env, false).webhooks.constructEventAsync(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET!,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
