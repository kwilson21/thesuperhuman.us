import type { APIRoute } from 'astro';
import { applyStripeInvoiceEvent, getAudioPayment, isKnownInvoiceAttempt, recordUnmatchedStripeEvent, recoverInvoiceFromWebhook, type InvoiceStatus } from '~/lib/audio-payments';
import { verifyStripeWebhook } from '~/lib/stripe-invoicing';

export const prerender = false;

const eventStatuses: Record<string, Exclude<InvoiceStatus, 'not_created' | 'draft'>> = {
  'invoice.sent': 'open',
  'invoice.paid': 'paid',
  'invoice.payment_failed': 'payment_failed',
  'invoice.voided': 'void',
  'invoice.marked_uncollectible': 'uncollectible',
};

export const POST: APIRoute = async ({ request, locals }) => {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ received: false }, { status: 400 });
  const db = locals.runtime.env.MUSIC_DB;
  if (!db) return Response.json({ received: false }, { status: 503 });
  const rawBody = await request.text();
  let event: Awaited<ReturnType<typeof verifyStripeWebhook>>;
  try {
    event = await verifyStripeWebhook(locals.runtime.env, rawBody, signature);
  } catch {
    return Response.json({ received: false }, { status: 400 });
  }
  const status = eventStatuses[event.type];
  if (!status) return Response.json({ received: true });
  const invoice = event.data.object as unknown as {
    id?: string;
    customer?: string | { id?: string } | null;
    hosted_invoice_url?: string | null;
    total?: number | null;
    currency?: string | null;
    metadata?: { audio_request_id?: string; installment?: string };
  };
  const requestId = invoice.metadata?.audio_request_id;
  const installment = invoice.metadata?.installment;
  if (!invoice.id || !requestId || !['booking', 'balance'].includes(installment ?? '')) {
    return Response.json({ received: true });
  }
  const payment = await getAudioPayment(db, requestId);
  const expectedInvoiceId = installment === 'booking' ? payment?.bookingInvoiceId : payment?.balanceInvoiceId;
  if (!payment || expectedInvoiceId !== invoice.id) {
    if (await isKnownInvoiceAttempt(db, invoice.id)) {
      await recordUnmatchedStripeEvent(db, {
        eventId: event.id, eventType: event.type, invoiceId: invoice.id, requestId,
        installment: installment as 'booking' | 'balance', status,
        occurredAt: new Date(event.created * 1000).toISOString(), reason: 'invoice-conflict',
      });
      return Response.json({ received: true });
    }
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
    await recoverInvoiceFromWebhook(db, {
      eventId: event.id, eventType: event.type, requestId, installment: installment as 'booking' | 'balance',
      invoiceId: invoice.id, stripeCustomerId: customerId, hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      status, occurredAt: new Date(event.created * 1000).toISOString(), totalAmountCents: invoice.total ?? -1,
      currency: invoice.currency ?? '',
    });
    return Response.json({ received: true });
  }
  try {
    await applyStripeInvoiceEvent(db, {
      eventId: event.id,
      eventType: event.type,
      invoiceId: invoice.id,
      status,
      occurredAt: new Date(event.created * 1000).toISOString(),
    });
    return Response.json({ received: true });
  } catch {
    return Response.json({ received: false }, { status: 500 });
  }
};
