import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { approveAudioPayment, getAudioPayment, recordInvoice, replaceTerminalInvoice, type AudioPayment } from '~/lib/audio-payments';
import { getOwnerRequest } from '~/lib/owner-requests';
import { createBalanceInvoice, createBookingInvoice, stripeAvailable } from '~/lib/stripe-invoicing';

export const prerender = false;

const commandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    approvedService: z.string().trim().min(1).max(160),
    totalAmountCents: z.number().int().min(1).max(100_000_000),
    offerAccepted: z.literal(true),
  }),
  z.object({ action: z.literal('create-booking-invoice') }),
  z.object({ action: z.literal('create-balance-invoice') }),
  z.object({ action: z.literal('replace-booking-invoice') }),
  z.object({ action: z.literal('replace-balance-invoice') }),
]);

function ownerView(payment: AudioPayment) {
  const { stripeCustomerId: _stripeCustomerId, ...visible } = payment;
  return visible;
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const db = locals.runtime.env.MUSIC_DB;
  if (!db || !params.id) return Response.json({ ok: false }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const requestRecord = await getOwnerRequest(db, params.id);
  if (!requestRecord) return Response.json({ ok: false }, { status: 404 });
  if (requestRecord.kind !== 'service') return Response.json({ ok: false }, { status: 409 });
  const headers = { 'cache-control': 'private, no-store' };

  try {
    if (parsed.data.action === 'approve') {
      const existing = await getAudioPayment(db, requestRecord.id);
      if (existing && (existing.approvedService !== parsed.data.approvedService
        || existing.totalAmountCents !== parsed.data.totalAmountCents)) {
        return Response.json({ ok: false }, { status: 409, headers });
      }
      const payment = existing ?? await approveAudioPayment(db, {
        requestId: requestRecord.id,
        approvedService: parsed.data.approvedService,
        totalAmountCents: parsed.data.totalAmountCents,
        offerAcceptedAt: new Date().toISOString(),
        actor: locals.owner.email,
      });
      return Response.json({ ok: true, payment: ownerView(payment) }, { headers });
    }

    let payment = await getAudioPayment(db, requestRecord.id);
    if (!payment) return Response.json({ ok: false }, { status: 409, headers });
    if (parsed.data.action.startsWith('replace-')) {
      if (!stripeAvailable(locals.runtime.env)) return Response.json({ ok: false }, { status: 503, headers });
      const installment = parsed.data.action === 'replace-booking-invoice' ? 'booking' : 'balance';
      payment = await replaceTerminalInvoice(db, { requestId: requestRecord.id, installment, actor: locals.owner.email });
    }
    const installment = ['create-booking-invoice', 'replace-booking-invoice'].includes(parsed.data.action) ? 'booking' : 'balance';
    const existingId = installment === 'booking' ? payment.bookingInvoiceId : payment.balanceInvoiceId;
    if (existingId) return Response.json({ ok: true, payment: ownerView(payment) }, { headers });
    if (installment === 'balance' && payment.bookingStatus !== 'paid') {
      return Response.json({ ok: false }, { status: 409, headers });
    }
    const invoice = installment === 'booking'
      ? await createBookingInvoice(locals.runtime.env, requestRecord, payment)
      : await createBalanceInvoice(locals.runtime.env, requestRecord, payment);
    const updated = await recordInvoice(db, {
      requestId: requestRecord.id,
      installment,
      ...invoice,
      actor: locals.owner.email,
    });
    return Response.json({ ok: true, payment: ownerView(updated) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const stripeFailure = /Stripe|hosted payment URL/i.test(message);
    return Response.json({ ok: false }, { status: stripeFailure ? 502 : 409, headers });
  }
};
