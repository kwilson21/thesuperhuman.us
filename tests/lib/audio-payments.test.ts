import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyStripeInvoiceEvent,
  approveAudioPayment,
  getAudioPayment,
  paymentDefaults,
  recordInvoice,
  recordManualPayment,
  recoverInvoiceFromWebhook,
  reserveInvoiceCreation,
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
    await expect(approveAudioPayment(fixture().db, { ...approval, totalAmountCents: 1 })).rejects.toThrow('price');
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

  it('reserves invoice creation before calling Stripe and refuses a second attempt', async () => {
    const { db } = fixture();
    await approveAudioPayment(db, approval);
    expect((await reserveInvoiceCreation(db, { requestId: 'request-1', installment: 'booking' })).bookingCreationStartedAt).toBeTruthy();
    await expect(reserveInvoiceCreation(db, { requestId: 'request-1', installment: 'booking' })).rejects.toThrow('pending or complete');
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

  it('keeps a paid invoice paid when an older event follows a stale read', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1',
      invoiceId: 'in_booking', hostedInvoiceUrl: 'https://invoice.stripe.com/booking', status: 'open', actor: approval.actor,
    });
    await applyStripeInvoiceEvent(db, {
      eventId: 'evt_paid', eventType: 'invoice.paid', invoiceId: 'in_booking', status: 'paid',
      occurredAt: '2026-09-20T15:00:00.000Z',
    });
    // The old handler selected "open" before payment committed, then reaches its guarded update.
    sql.prepare(`UPDATE audio_payments SET booking_status='open',booking_status_updated_at='2026-09-20T14:00:00.000Z'
      WHERE request_id='request-1'`).run();
    const originalBatch = db.batch.bind(db);
    (db as any).batch = async (statements: unknown[]) => {
      // A competing paid event commits after this handler's SELECT, before its UPDATE.
      sql.prepare(`UPDATE audio_payments SET booking_status='paid',booking_status_updated_at='2026-09-20T15:00:00.000Z'
        WHERE request_id='request-1'`).run();
      return originalBatch(statements as any);
    };
    await applyStripeInvoiceEvent(db, {
      eventId: 'evt_old_sent', eventType: 'invoice.sent', invoiceId: 'in_booking', status: 'open',
      occurredAt: '2026-09-20T14:00:00.000Z',
    });
    expect((await getAudioPayment(db, 'request-1'))?.bookingStatus).toBe('paid');
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 2 });
  });

  it('replaces only voided invoices while retaining the old attempt', async () => {
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
      .rejects.toThrow('void');
  });

  it('keeps an uncollectible invoice associated until it is voided in Stripe', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1', invoiceId: 'in_uncollectible',
      hostedInvoiceUrl: 'https://invoice.stripe.com/uncollectible', status: 'uncollectible', actor: approval.actor,
    });
    await expect(replaceTerminalInvoice(db, { requestId: 'request-1', installment: 'booking', actor: approval.actor }))
      .rejects.toThrow('void');
    expect(await getAudioPayment(db, 'request-1')).toMatchObject({ bookingInvoiceId: 'in_uncollectible', bookingStatus: 'uncollectible' });
    expect(sql.prepare('SELECT replaced_at FROM stripe_invoice_attempts WHERE invoice_id=?').get('in_uncollectible')?.replaced_at).toBeNull();
  });

  it('does not replace an invoice when payment is confirmed after its terminal-state read', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await recordInvoice(db, {
      requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1', invoiceId: 'in_void',
      hostedInvoiceUrl: 'https://invoice.stripe.com/void', status: 'void', actor: approval.actor,
    });
    const originalBatch = db.batch.bind(db);
    (db as any).batch = async (statements: unknown[]) => {
      sql.prepare(`UPDATE audio_payments SET booking_status='paid' WHERE request_id='request-1'`).run();
      return originalBatch(statements as any);
    };
    const payment = await replaceTerminalInvoice(db, { requestId: 'request-1', installment: 'booking', actor: approval.actor });
    expect(payment).toMatchObject({ bookingInvoiceId: 'in_void', bookingStatus: 'paid', bookingAttemptCount: 0 });
    expect(sql.prepare('SELECT replaced_at FROM stripe_invoice_attempts WHERE invoice_id=?').get('in_void')?.replaced_at).toBeNull();
  });

  it('dead-letters the invoice that loses a concurrent recovery race', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    const recover = (eventId: string, invoiceId: string) => recoverInvoiceFromWebhook(db, {
      eventId, eventType: 'invoice.paid', requestId: 'request-1', installment: 'booking', invoiceId,
      stripeCustomerId: 'cus_1', hostedInvoiceUrl: `https://invoice.stripe.com/${invoiceId}`,
      status: 'paid', occurredAt: '2026-09-20T15:00:00.000Z', totalAmountCents: 10_001, currency: 'usd',
    });
    const results = await Promise.all([recover('evt_first', 'in_first'), recover('evt_second', 'in_second')]);
    expect(results.sort()).toEqual(['recovered', 'unmatched']);
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 1 });
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_invoice_attempts').get()).toEqual({ total: 1 });
    expect(sql.prepare('SELECT invoice_id,reason FROM stripe_unmatched_events').get())
      .toEqual({ invoice_id: 'in_second', reason: 'invoice-conflict' });

    sql.prepare(`UPDATE audio_payments SET booking_invoice_id=NULL,booking_invoice_url=NULL,booking_status='not_created'
      WHERE request_id='request-1'`).run();
    expect(await recover('evt_second', 'in_second')).toBe('recovered');
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_unmatched_events').get()).toEqual({ total: 0 });
  });

  it('applies a later concurrent event for the same recovered invoice', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    const recover = (eventId: string, status: 'open' | 'paid', occurredAt: string) => recoverInvoiceFromWebhook(db, {
      eventId, eventType: status === 'paid' ? 'invoice.paid' : 'invoice.sent', requestId: 'request-1',
      installment: 'booking', invoiceId: 'in_same', stripeCustomerId: 'cus_1', hostedInvoiceUrl: 'https://invoice.stripe.com/in_same',
      status, occurredAt, totalAmountCents: 10_001, currency: 'usd',
    });
    await Promise.all([
      recover('evt_sent', 'open', '2026-09-20T14:00:00.000Z'),
      recover('evt_paid', 'paid', '2026-09-20T15:00:00.000Z'),
    ]);
    expect((await getAudioPayment(db, 'request-1'))?.bookingStatus).toBe('paid');
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 2 });
  });

  it('rejects recovery with the wrong amount or a premature balance invoice', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    const base = {
      eventId: 'evt_wrong', eventType: 'invoice.paid', requestId: 'request-1', invoiceId: 'in_wrong',
      stripeCustomerId: 'cus_1', hostedInvoiceUrl: 'https://invoice.stripe.com/in_wrong', status: 'paid' as const,
      occurredAt: '2026-09-20T15:00:00.000Z', currency: 'usd',
    };
    expect(await recoverInvoiceFromWebhook(db, { ...base, installment: 'booking', totalAmountCents: 1 })).toBe('unmatched');
    expect(await recoverInvoiceFromWebhook(db, { ...base, eventId: 'evt_balance', invoiceId: 'in_balance', installment: 'balance', totalAmountCents: 10_000 })).toBe('unmatched');
    expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_unmatched_events').get()).toEqual({ total: 2 });
  });

  it('records a payment received outside Stripe, balance only after booking, and never over an invoice', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    const manual = { requestId: 'request-1', method: 'Zelle' as const, reference: ' zelle   1234 ', actor: 'Owner@example.com' };
    await expect(recordManualPayment(db, { ...manual, installment: 'balance' })).rejects.toThrow('booking must be paid');
    const booked = await recordManualPayment(db, { ...manual, installment: 'booking' });
    expect(booked).toMatchObject({ bookingStatus: 'paid', bookingInvoiceId: null, balanceStatus: 'not_created' });
    expect(sql.prepare("SELECT action,actor,note FROM owner_request_audit WHERE action='booking-payment-updated'").get())
      .toEqual({ action: 'booking-payment-updated', actor: 'owner@example.com', note: 'Received outside Stripe: USD 100.01 via Zelle; zelle 1234' });
    // Repeating it is harmless and writes nothing new.
    await recordManualPayment(db, { ...manual, installment: 'booking' });
    expect(sql.prepare("SELECT COUNT(*) AS total FROM owner_request_audit WHERE action='booking-payment-updated'").get()).toEqual({ total: 1 });
    // A paid booking can no longer be invoiced, and a stray Stripe invoice cannot be adopted over it.
    await expect(reserveInvoiceCreation(db, { requestId: 'request-1', installment: 'booking' })).rejects.toThrow();
    expect(await recoverInvoiceFromWebhook(db, { eventId: 'evt_late', eventType: 'invoice.sent', requestId: 'request-1', installment: 'booking',
      invoiceId: 'in_late', stripeCustomerId: 'cus_1', hostedInvoiceUrl: 'https://invoice.stripe.com/in_late', status: 'open',
      occurredAt: '2026-09-20T15:00:00.000Z', totalAmountCents: 10_001, currency: 'usd' })).toBe('unmatched');
    expect(await getAudioPayment(db, 'request-1')).toMatchObject({ bookingStatus: 'paid', bookingInvoiceId: null });
    expect(await recordManualPayment(db, { ...manual, installment: 'balance', method: 'Cash', reference: '' })).toMatchObject({ balanceStatus: 'paid' });
  });

  it('refuses a manual payment once an invoice exists or is being created', async () => {
    const { db } = fixture();
    await approveAudioPayment(db, approval);
    await reserveInvoiceCreation(db, { requestId: 'request-1', installment: 'booking' });
    const manual = { requestId: 'request-1', installment: 'booking' as const, method: 'Zelle' as const, actor: 'owner@example.com' };
    await expect(recordManualPayment(db, manual)).rejects.toThrow('already has an invoice');
    await recordInvoice(db, { requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1', invoiceId: 'in_1',
      hostedInvoiceUrl: 'https://invoice.stripe.com/in_1', status: 'open', actor: 'owner@example.com' });
    await expect(recordManualPayment(db, manual)).rejects.toThrow('already has an invoice');
    expect(await getAudioPayment(db, 'request-1')).toMatchObject({ bookingStatus: 'open' });
  });

  it('holds a recovered Stripe invoice as unmatched when a manual payment lands between its read and its write', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    let raced = false;
    const racing = { ...db, prepare: db.prepare.bind(db), batch: async (items: Parameters<D1Database['batch']>[0]) => {
      if (!raced) { raced = true; sql.exec("UPDATE audio_payments SET booking_status='paid'"); }
      return db.batch(items);
    } } as unknown as D1Database;
    expect(await recoverInvoiceFromWebhook(racing, { eventId: 'evt_race', eventType: 'invoice.paid', requestId: 'request-1', installment: 'booking',
      invoiceId: 'in_race', stripeCustomerId: 'cus_1', hostedInvoiceUrl: 'https://invoice.stripe.com/in_race', status: 'paid',
      occurredAt: '2026-09-20T15:00:00.000Z', totalAmountCents: 10_001, currency: 'usd' })).toBe('unmatched');
    expect(await getAudioPayment(db, 'request-1')).toMatchObject({ bookingStatus: 'paid', bookingInvoiceId: null });
  });

  it('does not attach a late invoice to a payment recorded outside Stripe', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    await recordManualPayment(db, { requestId: 'request-1', installment: 'booking', method: 'Cash', actor: 'owner@example.com' });
    await expect(recordInvoice(db, { requestId: 'request-1', installment: 'booking', stripeCustomerId: 'cus_1', invoiceId: 'in_late',
      hostedInvoiceUrl: 'https://invoice.stripe.com/in_late', status: 'open', actor: 'owner@example.com' })).rejects.toThrow();
    expect(await getAudioPayment(db, 'request-1')).toMatchObject({ bookingStatus: 'paid', bookingInvoiceId: null });
    expect(sql.prepare("SELECT COUNT(*) AS total FROM owner_request_audit WHERE action='booking-invoice-created'").get()).toEqual({ total: 0 });
  });

  it('refuses a manual payment after retention or with a reference that is not a transaction ID', async () => {
    const { db, sql } = fixture();
    await approveAudioPayment(db, approval);
    const manual = { requestId: 'request-1', installment: 'booking' as const, method: 'Zelle' as const, actor: 'owner@example.com' };
    await expect(recordManualPayment(db, { ...manual, reference: 'Jane Doe <555-1234>' })).rejects.toThrow('reference');
    sql.exec("UPDATE audio_payments SET external_refs_deleted_at='2026-09-21T00:00:00.000Z'");
    await expect(recordManualPayment(db, manual)).rejects.toThrow();
  });
});

describe('payment form defaults', () => {
  it('starts from the requested service, song title and published starting price', () => {
    expect(paymentDefaults('vocal-mix', { title: '  PVP  ' })).toEqual({ approvedService: 'Two-track vocal mixing: PVP', totalAmount: '150.00' });
    expect(paymentDefaults('mastering', { title: 'Old News' })).toEqual({ approvedService: 'Mastering: Old News', totalAmount: '75.00' });
    expect(paymentDefaults('bundle', {})).toEqual({ approvedService: 'Two-track vocal mix + master', totalAmount: '200.00' });
    expect(paymentDefaults('vocal-mix', { title: 'x'.repeat(300) }).approvedService).toHaveLength(160);
  });

  it('leaves custom and unknown requests for the owner to write', () => {
    expect(paymentDefaults('custom', { title: 'Album' })).toEqual({ approvedService: '', totalAmount: '' });
    expect(paymentDefaults(null, {})).toEqual({ approvedService: '', totalAmount: '' });
    expect(paymentDefaults('unknown', { title: 'Song' })).toEqual({ approvedService: '', totalAmount: '' });
  });
});
