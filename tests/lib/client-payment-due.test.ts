import { describe, expect, it } from 'vitest';
import { clientPaymentDue } from '~/lib/audio-client-access';

const base = { booking_status: 'not_created', balance_status: 'not_created', booking_invoice_url: null, balance_invoice_url: null, booking_amount_cents: 7500, balance_amount_cents: 7500 };
const invoice = 'https://invoice.stripe.com/i/acct_1/test_abc';

describe('clientPaymentDue', () => {
  it('offers an open or failed booking invoice, then the balance once the booking is paid', () => {
    expect(clientPaymentDue(base)).toBeNull();
    expect(clientPaymentDue({ ...base, booking_status: 'open', booking_invoice_url: invoice })).toEqual({ installment: 'booking', href: invoice, amountCents: 7500 });
    expect(clientPaymentDue({ ...base, booking_status: 'payment_failed', booking_invoice_url: invoice })).toMatchObject({ installment: 'booking' });
    expect(clientPaymentDue({ ...base, booking_status: 'paid', balance_status: 'open', balance_invoice_url: invoice })).toEqual({ installment: 'balance', href: invoice, amountCents: 7500 });
  });

  it('offers nothing once paid, voided, or paid outside Stripe', () => {
    expect(clientPaymentDue({ ...base, booking_status: 'paid', booking_invoice_url: invoice })).toBeNull();
    expect(clientPaymentDue({ ...base, booking_status: 'void', booking_invoice_url: invoice })).toBeNull();
    expect(clientPaymentDue({ ...base, booking_status: 'paid', balance_status: 'paid' })).toBeNull();
  });

  it('links only to Stripe’s hosted invoice page', () => {
    expect(clientPaymentDue({ ...base, booking_status: 'open', booking_invoice_url: 'https://evil.example/pay' })).toBeNull();
    expect(clientPaymentDue({ ...base, booking_status: 'open', booking_invoice_url: 'http://invoice.stripe.com/x' })).toBeNull();
    expect(clientPaymentDue({ ...base, booking_status: 'open', booking_invoice_url: null })).toBeNull();
  });
});
