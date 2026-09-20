
DROP TRIGGER IF EXISTS owner_requests_audit_personal_delete;
CREATE TABLE IF NOT EXISTS owner_request_audit_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  action TEXT NOT NULL CHECK(action IN ('created','reviewed','resolved','reopened','withdrawn','note-updated','personal-data-deleted','payment-approved','booking-invoice-created','balance-invoice-created','booking-payment-updated','balance-payment-updated','booking-invoice-replaced','balance-invoice-replaced')),
  actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
);
INSERT INTO owner_request_audit_v2(id,request_id,action,actor,note,occurred_at)
  SELECT id,request_id,action,actor,note,occurred_at FROM owner_request_audit;
DROP TABLE owner_request_audit;
ALTER TABLE owner_request_audit_v2 RENAME TO owner_request_audit;
CREATE TRIGGER IF NOT EXISTS owner_requests_audit_personal_delete
AFTER UPDATE OF name,email,city_region,details_json,private_note ON owner_requests
WHEN NEW.name='' AND NEW.email='' AND NEW.city_region='' AND NEW.details_json='{}' AND NEW.private_note=''
  AND (OLD.name<>'' OR OLD.email<>'' OR OLD.city_region<>'' OR OLD.details_json<>'{}' OR OLD.private_note<>'')
BEGIN
  INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
  VALUES(NEW.id,'personal-data-deleted','retention','',NEW.updated_at);
END;

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
  booking_status_updated_at TEXT,
  booking_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(booking_attempt_count >= 0),
  balance_invoice_id TEXT UNIQUE,
  balance_invoice_url TEXT,
  balance_status TEXT NOT NULL DEFAULT 'not_created'
    CHECK(balance_status IN ('not_created','draft','open','paid','payment_failed','void','uncollectible')),
  balance_status_updated_at TEXT,
  balance_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(balance_attempt_count >= 0),
  external_refs_deleted_at TEXT,
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
CREATE TABLE IF NOT EXISTS stripe_invoice_attempts (
  invoice_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  installment TEXT NOT NULL CHECK(installment IN ('booking','balance')),
  created_at TEXT NOT NULL,
  replaced_at TEXT
);
CREATE TABLE IF NOT EXISTS stripe_unmatched_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  installment TEXT NOT NULL CHECK(installment IN ('booking','balance')),
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('request-not-found','invoice-conflict'))
);
