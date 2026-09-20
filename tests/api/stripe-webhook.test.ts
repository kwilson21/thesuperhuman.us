import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';

const verify = vi.hoisted(() => vi.fn());
vi.mock('~/lib/stripe-invoicing', () => ({ verifyStripeWebhook: verify }));
import { POST } from '~/pages/api/stripe/webhook';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;

beforeEach(() => {
  vi.clearAllMocks();
  sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('request-1','service','artist@example.com','Mix','reviewed','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,stripe_customer_id,booking_invoice_id,booking_invoice_url,booking_status,created_at,updated_at)
    VALUES ('request-1','Mix',20000,10000,10000,'2026-09-20T12:00:00Z','cus_1','in_booking','https://invoice.stripe.com/booking','open','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z')`);
  const statement = (query: string, args: unknown[] = []) => ({
    query, args, bind: (...values: unknown[]) => statement(query, values),
    run: async () => { const result = sql.prepare(query).run(...args); return { meta: { changes: result.changes }, results: [] }; },
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
  });
  db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try {
      const results = items.map(item => ({ results: (sql.prepare(item.query).run(...item.args), []) }));
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
});

function context(signature = 'valid') {
  return {
    request: new Request('https://thesuperhuman.us/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': signature, 'content-type': 'application/json' }, body: '{"raw":true}',
    }),
    locals: { runtime: { env: { MUSIC_DB: db, STRIPE_PAYMENTS_ENABLED: 'true' } } },
  } as any;
}

function event(type: string, id = 'evt_1') {
  return {
    id, type, created: 1_790_000_000,
    data: { object: { id: 'in_booking', metadata: { audio_request_id: 'request-1', installment: 'booking' } } },
  };
}

it('rejects missing or invalid signatures without changing D1', async () => {
  expect((await POST(context(''))).status).toBe(400);
  verify.mockRejectedValueOnce(new Error('bad signature'));
  expect((await POST(context())).status).toBe(400);
  expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 0 });
  expect(sql.prepare('SELECT booking_status FROM audio_payments').get()).toEqual({ booking_status: 'open' });
});

it.each([
  ['invoice.sent', 'open'],
  ['invoice.paid', 'paid'],
  ['invoice.payment_failed', 'payment_failed'],
  ['invoice.voided', 'void'],
  ['invoice.marked_uncollectible', 'uncollectible'],
])('projects %s as %s', async (type, status) => {
  verify.mockResolvedValueOnce(event(type));
  expect((await POST(context())).status).toBe(200);
  expect(sql.prepare('SELECT booking_status FROM audio_payments').get()).toEqual({ booking_status: status });
});

it('acknowledges unrelated events without storing them', async () => {
  verify.mockResolvedValueOnce(event('customer.created'));
  expect((await POST(context())).status).toBe(200);
  expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 0 });
});

it('applies a replayed event only once', async () => {
  verify.mockResolvedValue(event('invoice.paid'));
  expect((await POST(context())).status).toBe(200);
  expect((await POST(context())).status).toBe(200);
  expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 1 });
});

it('retries an audio invoice whose request metadata does not match a stored payment', async () => {
  const value = event('invoice.paid');
  value.data.object.metadata.audio_request_id = 'another-request';
  verify.mockResolvedValueOnce(value);
  expect((await POST(context())).status).toBe(503);
  expect(sql.prepare('SELECT booking_status FROM audio_payments').get()).toEqual({ booking_status: 'open' });
});

it('asks Stripe to retry a recognized audio invoice that is not recorded yet', async () => {
  sql.prepare(`UPDATE audio_payments SET booking_invoice_id=NULL,booking_invoice_url=NULL,booking_status='not_created'
    WHERE request_id='request-1'`).run();
  verify.mockResolvedValueOnce(event('invoice.paid'));
  expect((await POST(context())).status).toBe(503);
  expect(sql.prepare('SELECT COUNT(*) AS total FROM stripe_webhook_events').get()).toEqual({ total: 0 });
});
