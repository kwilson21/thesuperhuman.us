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
  stripeAvailable: (env: Record<string, unknown>) => env.STRIPE_PAYMENTS_ENABLED === 'true'
    && Boolean(env.STRIPE_SECRET_KEY) && Boolean(env.STRIPE_WEBHOOK_SECRET),
}));

import { POST } from '~/pages/api/owner/requests/[id]/payment';
import { applyOwnerRetention, previewOwnerRetention } from '../../scripts/owner-retention.mjs';

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

const stripeEnv = { STRIPE_PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' };

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
  expect((await POST(context({ action: 'approve', approvedService: 'Mix', totalAmountCents: 1, offerAccepted: true }))).status).toBe(400);
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

it('rejects changed terms after approval instead of reporting stale terms as saved', async () => {
  await POST(context({ action: 'approve', approvedService: 'Mastering', totalAmountCents: 7_500, offerAccepted: true }));
  const response = await POST(context({
    action: 'approve', approvedService: 'Two-track vocal mix + master', totalAmountCents: 20_000, offerAccepted: true,
  }));
  expect(response.status).toBe(409);
  expect(sql.prepare('SELECT approved_service,total_amount_cents FROM audio_payments').get())
    .toEqual({ approved_service: 'Mastering', total_amount_cents: 7_500 });
});

it('creates and records one booking invoice after approval', async () => {
  await POST(context({ action: 'approve', approvedService: 'Two-track vocal mix + master', totalAmountCents: 20_000, offerAccepted: true }));
  const response = await POST(context({ action: 'create-booking-invoice' }, true, stripeEnv));
  expect(response.status).toBe(200);
  expect(invoiceMocks.booking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: 'artist@example.com' }), expect.objectContaining({ bookingAmountCents: 10_000 }));
  expect(sql.prepare('SELECT booking_invoice_id,booking_status FROM audio_payments').get())
    .toEqual({ booking_invoice_id: 'in_booking', booking_status: 'open' });
  await POST(context({ action: 'create-booking-invoice' }, true, stripeEnv));
  expect(invoiceMocks.booking).toHaveBeenCalledTimes(1);
});

it('does not create an invoice after retention deletes a withdrawn request', async () => {
  await POST(context({ action: 'approve', approvedService: 'Mix', totalAmountCents: 20_000, offerAccepted: true }));
  sql.exec("UPDATE owner_requests SET status='withdrawn' WHERE id='request-1'");
  const retentionDb = {
    query: async (query: string) => sql.prepare(query).all(),
    batch: async (queries: string[]) => {
      sql.exec('BEGIN');
      try { const result = queries.map(query => sql.prepare(query).all()); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  const retentionNow = new Date();
  const review = await previewOwnerRetention(retentionDb, 'Local test data', retentionNow);
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((query: string) => {
    const prepared = originalPrepare(query);
    if (!query.startsWith('UPDATE audio_payments SET booking_creation_started_at=')) return prepared;
    return { bind: (...args: unknown[]) => {
      const bound = prepared.bind(...args);
      return { run: async () => {
        await applyOwnerRetention(retentionDb, review, 'Local test data', retentionNow);
        return bound.run();
      }};
    }};
  }) as typeof db.prepare;
  const response = await POST(context({ action: 'create-booking-invoice' }, true, stripeEnv));
  expect(response.status).toBe(409);
  expect(invoiceMocks.booking).not.toHaveBeenCalled();
  expect(sql.prepare('SELECT name,email FROM owner_requests WHERE id=?').get('request-1'))
    .toEqual({ name: '', email: '' });
});

it('does not create a balance invoice before Stripe confirms the booking payment', async () => {
  await POST(context({ action: 'approve', approvedService: 'Two-track vocal mix + master', totalAmountCents: 20_000, offerAccepted: true }));
  const response = await POST(context({ action: 'create-balance-invoice' }, true, stripeEnv));
  expect(response.status).toBe(409);
  expect(invoiceMocks.balance).not.toHaveBeenCalled();
});

it('returns service unavailable without calling Stripe when invoice creation is disabled', async () => {
  await POST(context({ action: 'approve', approvedService: 'Mastering', totalAmountCents: 7_500, offerAccepted: true }));
  const response = await POST(context({ action: 'create-booking-invoice' }, true, { STRIPE_PAYMENTS_ENABLED: 'false' }));
  expect(response.status).toBe(503);
  expect(invoiceMocks.booking).not.toHaveBeenCalled();
});

it('does not record invoice success when Stripe fails', async () => {
  await POST(context({ action: 'approve', approvedService: 'Mastering', totalAmountCents: 7_500, offerAccepted: true }));
  invoiceMocks.booking.mockRejectedValueOnce(new Error('Stripe unavailable'));
  const response = await POST(context({ action: 'create-booking-invoice' }, true, stripeEnv));
  expect(response.status).toBe(502);
  expect(sql.prepare('SELECT booking_invoice_id,booking_status FROM audio_payments').get())
    .toEqual({ booking_invoice_id: null, booking_status: 'not_created' });
  expect(sql.prepare('SELECT booking_creation_started_at FROM audio_payments').get()?.booking_creation_started_at).toBeTruthy();
});

it('reports pending recovery when D1 fails after Stripe sends the invoice', async () => {
  await POST(context({ action: 'approve', approvedService: 'Mastering', totalAmountCents: 7_500, offerAccepted: true }));
  const working = db;
  db = { ...working, batch: async () => { throw new Error('D1 unavailable'); } } as unknown as D1Database;
  const response = await POST(context({ action: 'create-booking-invoice' }, true, stripeEnv));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false, recoveryPending: true });
  expect(invoiceMocks.booking).toHaveBeenCalledOnce();
});

it('creates a replacement after a voided booking invoice', async () => {
  await POST(context({ action: 'approve', approvedService: 'Mastering', totalAmountCents: 7_500, offerAccepted: true }));
  await POST(context({ action: 'create-booking-invoice' }, true, stripeEnv));
  sql.prepare("UPDATE audio_payments SET booking_status='void' WHERE request_id='request-1'").run();
  invoiceMocks.booking.mockResolvedValueOnce({
    stripeCustomerId: 'cus_1', invoiceId: 'in_replacement',
    hostedInvoiceUrl: 'https://invoice.stripe.com/replacement', status: 'open',
  });
  const response = await POST(context({ action: 'replace-booking-invoice' }, true, stripeEnv));
  expect(response.status).toBe(200);
  expect(sql.prepare('SELECT booking_invoice_id,booking_status FROM audio_payments').get())
    .toEqual({ booking_invoice_id: 'in_replacement', booking_status: 'open' });
});
