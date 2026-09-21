ALTER TABLE audio_payments ADD COLUMN external_refs_deleted_at TEXT;
ALTER TABLE audio_payments ADD COLUMN booking_recovery_event_id TEXT;
ALTER TABLE audio_payments ADD COLUMN balance_recovery_event_id TEXT;
ALTER TABLE audio_payments ADD COLUMN booking_creation_started_at TEXT;
ALTER TABLE audio_payments ADD COLUMN balance_creation_started_at TEXT;
CREATE TABLE stripe_unmatched_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  installment TEXT NOT NULL CHECK(installment IN ('booking','balance')),
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('request-not-found','invoice-conflict')),
  resolved_at TEXT,
  resolution TEXT NOT NULL DEFAULT ''
);
