import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyStripeInvoiceEvent,
  approveAudioPayment,
  getAudioPayment,
  recordInvoice,
  replaceTerminalInvoice,
} from '~/lib/audio-payments';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

function fixture(kind: 'service' | 'purchase' = 'service') {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  const now = '2026-09-20T12:00:00.000Z';
  sql.prepare(`INSERT INTO owner_requests
    (id,kind,service_id,email,summary,status,created_at,updated_at)
    VALUES ('request-1',?, 'two-track-mix-master','artist@example.com','Old News mix','reviewed',?,?)`)
    .run(kind, now, now);
  const statement = (query: string, args: unknown[] = []) => ({
    query, args,
    bind: (...values: unknown[]) => statement(query, values),
    run: async () => {
      const result = sql.prepare(query).run(...args);
      return { success: true, meta: { changes: result.changes }, results: [] };
    },
    all: async () => ({ success: true, results: sql.prepare(query).all(...args) }),
    first: async () => sql.prepare(query).get(...args) ?? null,
  });
  const db = {
    prepare: (query: string) => statement(query),
    batch: async (statements: ReturnType<typeof statement>[]) => {
      sql.exec('BEGIN');
      try {
        const results = statements.map(item => {
          const prepared = sql.prepare(item.query);
          if (/\bRETURNING\b/i.test(item.query)) return { success: true, results: prepared.all(...item.args) };
          const result = prepared.run(...item.args);
          return { success: true, meta: { changes: result.changes }, results: [] };
        });
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sql };
}

const approval = {
  requestId: 'request-1',
  approvedService: 'Two-track vocal mix + master',
  totalAmountCents: 20_001,
  offerAcceptedAt: '2026-09-20T13:00:00.000Z',
  actor: 'owner@example.com',
};

describe('audio payments', () => {
  it('approves fixed USD pricing for service requests and preserves exact installment cents', async () => {
    const { db, sql } = fixture();
    const payment = await approveAudioPayment(db, approval);
    expect(payment).toMatchObject({
      requestId: 'request-1', totalAmountCents: 20_001,
      bookingAmountCents: 10_001, balanceAmountCents: 10_000,
      bookingStatus: 'not_created', balanceStatus: 'not_created',
    });
    expect(await getAudioPayment(db, 'request-1')).toEqual(payment);
    expect(sql.prepare('SELECT action,actor FROM owner_request_audit WHERE request_id=? ORDER BY id DESC LIMIT 1').get('request-1'))
      .toEqual({ action: 'payment-approved', actor: 'owner@example.com' });
  });

  it('rejects non-service requests and invalid prices', async () => {
    await expect(approveAudioPayment(fixture('purchase').db, approval)).rejects.toThrow('service request');
    await expect(approveAudioPayment(fixture().db, { ...approval, totalAmountCents: 0 })).rejects.toThrow('price');
    await expect(approveAudioPayment(fixture().db, { ...approval, totalAmountCents: 150.5 })).rejects.toThrow('price');
  });

  it('records each invoice once and requires a paid booking invoice before the balance', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await expect(recordInvoice(db, {
      requestId: 'request-1', installment: 'balance', stripeCustomerId: 'cus_1',
      invoiceId: 'in_balance', hostedInvoiceUrl: 'https://invoice.stripe.com/balance', status: 'open', actor: approval.actor,
    })).rejects.toThrow('booking invoice');
    const booking = await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1',
      invoiceId: 'in_booking', hostedInvoiceUrl: 'https://invoice.stripe.com/booking', status: 'open', actor: approval.actor,
    });
    expect(booking).toMatchObject({ bookingInvoiceId: 'in_booking', bookingStatus: 'open' });
    expect(sql.prepare('SELECT action FROM owner_request_audit WHERE request_id=? ORDER BY id DESC LIMIT 1').get('request-1'))
      .toEqual({ action: 'booking-invoice-created' });
    expect((await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1',
      invoiceId: 'in_booking', hostedInvoiceUrl: 'https://invoice.stripe.com/booking', status: 'open', actor: approval.actor,
    })).bookingInvoiceId).toBe('in_booking');
    expect(sql.prepare(`SELECT COUNT(*) AS total FROM owner_request_audit
      WHERE request_id=? AND action='booking-invoice-created'`).get('request-1')).toEqual({ total: 1 });
    await expect(recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1',
      invoiceId: 'in_other', hostedInvoiceUrl: 'https://invoice.stripe.com/other', status: 'open', actor: approval.actor,
    })).rejects.toThrow('already exists');
  });

  it('applies a Stripe event once and unlocks the balance only after confirmed payment', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1',
      invoiceId: 'in_booking', hostedInvoiceUrl: 'https://invoice.stripe.com/booking', status: 'open', actor: approval.actor,
    });
    const event = {
      eventId: 'evt_paid', eventType: 'invoice.paid', invoiceId: 'in_booking',
      status: 'paid' as const, occurredAt: '2026-09-20T14:00:00.000Z',
    };
    expect((await applyStripeInvoiceEvent(db, event)).applied).toBe(true);
    expect((await applyStripeInvoiceEvent(db, event)).applied).toBe(false);
    expect((await getAudioPayment(db, 'request-1'))?.bookingStatus).toBe('paid');
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 1 });
    expect(sql.prepare('SELECT action,actor FROM owner_request_audit WHERE request_id=? ORDER BY id DESC LIMIT 1').get('request-1'))
      .toEqual({ action: 'booking-payment-updated', actor: 'stripe' });
    const balance = await recordInvoice(db, {
      requestId: 'request-1', installment: 'balance', stripeCustomerId: 'cus_1',
      invoiceId: 'in_balance', hostedInvoiceUrl: 'https://invoice.stripe.com/balance', status: 'open', actor: approval.actor,
    });
    expect(balance.balanceInvoiceId).toBe('in_balance');
  });

  it('records but does not apply an older event after payment is confirmed', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1',
      invoiceId: 'in_booking', hostedInvoiceUrl: 'https://invoice.stripe.com/booking', status: 'open', actor: approval.actor,
    });
    expect((await applyStripeInvoiceEvent(db, {
      eventId: 'evt_paid', eventType: 'invoice.paid', invoiceId: 'in_booking', status: 'paid',
      occurredAt: '2026-09-20T15:00:00.000Z',
    })).applied).toBe(true);
    expect((await applyStripeInvoiceEvent(db, {
      eventId: 'evt_old', eventType: 'invoice.sent', invoiceId: 'in_booking', status: 'open',
      occurredAt: '2026-09-20T14:00:00.000Z',
    })).applied).toBe(false);
    expect((await getAudioPayment(db, 'request-1'))?.bookingStatus).toBe('paid');
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 2 });
  });

  it('replaces only terminal invoices while retaining the old attempt', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1', invoiceId: 'in_void',
      hostedInvoiceUrl: 'https://invoice.stripe.com/void', status: 'void', actor: approval.actor,
    });
    const reset = await replaceTerminalInvoice(db, { requestId: 'request-1', installment: 'booking', actor: approval.actor });
    expect(reset).toMatchObject({ bookingInvoiceId: null, bookingInvoiceUrl: null, bookingStatus: 'not_created', bookingAttemptCount: 1 });
    expect(sql.prepare('SELECT replaced_at FROM stripe_invoice_attempts WHERE invoice_id=?').get('in_void')?.replaced_at).toBeTruthy();
    expect(sql.prepare(`SELECT COUNT(*) AS total FROM owner_request_audit
      WHERE request_id=? AND action='booking-invoice-replaced'`).get('request-1')).toEqual({ total: 1 });
    await expect(replaceTerminalInvoice(db, { requestId: 'request-1', installment: 'booking', actor: approval.actor }))
      .rejects.toThrow('void or uncollectible');
  });
});
