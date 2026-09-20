import { describe, expect, it, vi } from 'vitest';
import { createInvoiceWithClient, stripeAvailable } from '~/lib/stripe-invoicing';

const payment = {
  requestId: 'request-1', approvedService: 'Two-track vocal mix + master', totalAmountCents: 20_001,
  currency: 'usd' as const, bookingAmountCents: 10_001, balanceAmountCents: 10_000,
  offerAcceptedAt: '2026-09-20T13:00:00.000Z', stripeCustomerId: null,
  bookingInvoiceId: null, bookingInvoiceUrl: null, bookingStatus: 'not_created' as const,
  balanceInvoiceId: null, balanceInvoiceUrl: null, balanceStatus: 'not_created' as const,
  createdAt: '2026-09-20T13:00:00.000Z', updatedAt: '2026-09-20T13:00:00.000Z',
};
const request = { name: 'Artist Name', email: 'artist@example.com', summary: 'Old News mix' };

function fakeStripe() {
  return {
    customers: { create: vi.fn(async () => ({ id: 'cus_1' })) },
    invoices: {
      create: vi.fn(async () => ({ id: 'in_1' })),
      finalizeInvoice: vi.fn(async () => ({ id: 'in_1', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/i/in_1' })),
      sendInvoice: vi.fn(async () => ({ id: 'in_1', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/i/in_1' })),
    },
    invoiceItems: { create: vi.fn(async () => ({ id: 'ii_1' })) },
  };
}

describe('Stripe invoicing', () => {
  it('fails closed unless the explicit gate and both secrets are configured', () => {
    expect(stripeAvailable({ STRIPE_PAYMENTS_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' } as Env)).toBe(false);
    expect(stripeAvailable({ STRIPE_PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_1' } as Env)).toBe(false);
    expect(stripeAvailable({ STRIPE_PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' } as Env)).toBe(true);
  });

  it('creates, finalizes, and sends the booking invoice with bounded metadata and idempotency', async () => {
    const stripe = fakeStripe();
    const result = await createInvoiceWithClient(stripe, request, payment, 'booking');
    expect(stripe.customers.create).toHaveBeenCalledWith({
      email: 'artist@example.com', name: 'Artist Name', metadata: { audio_request_id: 'request-1' },
    }, { idempotencyKey: 'audio-request:request-1:customer' });
    expect(stripe.invoices.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_1', collection_method: 'send_invoice', days_until_due: 7,
      metadata: { audio_request_id: 'request-1', installment: 'booking' },
    }), { idempotencyKey: 'audio-request:request-1:booking:invoice' });
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_1', invoice: 'in_1', amount: 10_001, currency: 'usd',
      description: 'Audio services by Kazon · Two-track vocal mix + master · 50% booking payment',
    }), { idempotencyKey: 'audio-request:request-1:booking:item' });
    expect(result).toEqual({
      stripeCustomerId: 'cus_1', invoiceId: 'in_1',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1', status: 'open',
    });
  });

  it('reuses the customer and bills the exact remaining balance', async () => {
    const stripe = fakeStripe();
    const result = await createInvoiceWithClient(stripe, request, { ...payment, stripeCustomerId: 'cus_existing' }, 'balance');
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_existing', amount: 10_000,
      description: 'Audio services by Kazon · Two-track vocal mix + master · remaining balance',
    }), expect.anything());
    expect(result.stripeCustomerId).toBe('cus_existing');
  });

  it('rejects incomplete Stripe invoice responses instead of claiming success', async () => {
    const stripe = fakeStripe();
    stripe.invoices.sendInvoice.mockResolvedValueOnce({ id: 'in_1', status: 'open', hosted_invoice_url: null } as never);
    await expect(createInvoiceWithClient(stripe, request, payment, 'booking')).rejects.toThrow('hosted payment URL');
  });
});
