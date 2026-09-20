import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';

const invoiceMocks = vi.hoisted(() => ({
  booking: vi.fn(),
  balance: vi.fn(),
}));
vi.mock('~/lib/stripe-invoicing', () => ({
  createBookingInvoice: invoiceMocks.booking,
  createBalanceInvoice: invoiceMocks.balance,
}));

import { POST } from '~/pages/api/owner/requests/[id]/payment';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;

beforeEach(() => {
  vi.clearAllMocks();
  sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,status,created_at,updated_at)
    VALUES ('request-1','service','two-track-mix-master','Artist','artist@example.com','Old News mix','reviewed','2026-09-19T12:00:00Z','2026-09-19T12:00:00Z')`);
  const statement = (query: string, args: unknown[] = []) => ({
    query, args, bind: (...values: unknown[]) => statement(query, values),
    run: async () => { const result = sql.prepare(query).run(...args); return { meta: { changes: result.changes }, results: [] }; },
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
  });
  db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try {
      const result = items.map(item => ({ results: /RETURNING/i.test(item.query)
        ? sql.prepare(item.query).all(...item.args)
        : (sql.prepare(item.query).run(...item.args), []) }));
      sql.exec('COMMIT'); return result;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  invoiceMocks.booking.mockResolvedValue({
    stripeCustomerId: 'cus_1', invoiceId: 'in_booking',
    hostedInvoiceUrl: 'https://invoice.stripe.com/booking', status: 'open',
  });
  invoiceMocks.balance.mockResolvedValue({
    stripeCustomerId: 'cus_1', invoiceId: 'in_balance',
    hostedInvoiceUrl: 'https://invoice.stripe.com/balance', status: 'open',
  });
});

function context(body: unknown, owner = true, env: Record<string, unknown> = {}) {
  return {
    params: { id: 'request-1' },
    request: new Request('https://thesuperhuman.us/api/owner/requests/request-1/payment', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    locals: { owner: owner ? { email: 'owner@example.com' } : undefined, runtime: { env: { MUSIC_DB: db, ...env } } },
  } as any;
}

it('requires owner access and valid explicit offer acceptance', async () => {
  expect((await POST(context({ action: 'approve', approvedService: 'Mix', totalAmountCents: 20_000, offerAccepted: true }, false))).status).toBe(403);
  expect((await POST(context({ action: 'approve', approvedService: 'Mix', totalAmountCents: 20_000, offerAccepted: false }))).status).toBe(400);
  expect((await POST(context({ action: 'approve', approvedService: 'Mix', totalAmountCents: 150.5, offerAccepted: true }))).status).toBe(400);
});

it('persists approved terms before any Stripe call', async () => {
  const response = await POST(context({
    action: 'approve', approvedService: 'Two-track vocal mix + master', totalAmountCents: 20_000, offerAccepted: true,
  }));
  expect(response.status).toBe(200);
  expect(invoiceMocks.booking).not.toHaveBeenCalled();
  expect(sql.prepare('SELECT total_amount_cents,booking_status FROM audio_payments').get())
    .toEqual({ total_amount_cents: 20_000, booking_status: 'not_created' });
});

it('creates and records one booking invoice after approval', async () => {
  await POST(context({ action: 'approve', approvedService: 'Two-track vocal mix + master', totalAmountCents: 20_000, offerAccepted: true }));
  const response = await POST(context({ action: 'create-booking-invoice' }, true, { STRIPE_PAYMENTS_ENABLED: 'true' }));
  expect(response.status).toBe(200);
  expect(invoiceMocks.booking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: 'artist@example.com' }), expect.objectContaining({ bookingAmountCents: 10_000 }));
  expect(sql.prepare('SELECT booking_invoice_id,booking_status FROM audio_payments').get())
    .toEqual({ booking_invoice_id: 'in_booking', booking_status: 'open' });
  await POST(context({ action: 'create-booking-invoice' }, true, { STRIPE_PAYMENTS_ENABLED: 'true' }));
  expect(invoiceMocks.booking).toHaveBeenCalledTimes(1);
});

it('does not create a balance invoice before Stripe confirms the booking payment', async () => {
  await POST(context({ action: 'approve', approvedService: 'Two-track vocal mix + master', totalAmountCents: 20_000, offerAccepted: true }));
  const response = await POST(context({ action: 'create-balance-invoice' }, true, { STRIPE_PAYMENTS_ENABLED: 'true' }));
  expect(response.status).toBe(409);
  expect(invoiceMocks.balance).not.toHaveBeenCalled();
});

it('does not record invoice success when Stripe fails', async () => {
  await POST(context({ action: 'approve', approvedService: 'Mastering', totalAmountCents: 7_500, offerAccepted: true }));
  invoiceMocks.booking.mockRejectedValueOnce(new Error('Stripe unavailable'));
  const response = await POST(context({ action: 'create-booking-invoice' }, true, { STRIPE_PAYMENTS_ENABLED: 'true' }));
  expect(response.status).toBe(502);
  expect(sql.prepare('SELECT booking_invoice_id,booking_status FROM audio_payments').get())
    .toEqual({ booking_invoice_id: null, booking_status: 'not_created' });
});
