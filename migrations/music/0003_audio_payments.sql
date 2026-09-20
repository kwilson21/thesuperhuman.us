

CREATE TABLE IF NOT EXISTS audio_payments (
  request_id TEXT PRIMARY KEY REFERENCES owner_requests(id),
  approved_service TEXT NOT NULL,
  total_amount_cents INTEGER NOT NULL CHECK(total_amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
  booking_amount_cents INTEGER NOT NULL CHECK(booking_amount_cents > 0),
  balance_amount_cents INTEGER NOT NULL CHECK(balance_amount_cents >= 0),
  offer_accepted_at TEXT NOT NULL,
  stripe_customer_id TEXT,
  booking_invoice_id TEXT UNIQUE,
  booking_invoice_url TEXT,
  booking_status TEXT NOT NULL DEFAULT 'not_created'
    CHECK(booking_status IN ('not_created','draft','open','paid','payment_failed','void','uncollectible')),
  balance_invoice_id TEXT UNIQUE,
  balance_invoice_url TEXT,
  balance_status TEXT NOT NULL DEFAULT 'not_created'
    CHECK(balance_status IN ('not_created','draft','open','paid','payment_failed','void','uncollectible')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(booking_amount_cents + balance_amount_cents = total_amount_cents)
);
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

