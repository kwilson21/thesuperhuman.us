CREATE TABLE software_invoices (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  offer_id TEXT NOT NULL REFERENCES software_offers(id),
  due_at TEXT,
  refunded_at TEXT,
  creation_started_at TEXT,
  external_refs_deleted_at TEXT,
  retention_fenced_at TEXT,
  milestone_index INTEGER NOT NULL CHECK(milestone_index BETWEEN 0 AND 2),
  kind TEXT NOT NULL CHECK(kind IN ('deposit','balance','milestone')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  days_until_due INTEGER NOT NULL CHECK(days_until_due IN (7,15,30)),
  allow_card INTEGER NOT NULL DEFAULT 0 CHECK(allow_card IN (0,1)),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  stripe_customer_id TEXT,
  stripe_invoice_id TEXT UNIQUE,
  hosted_invoice_url TEXT,
  status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','open','paid','payment_failed','void','uncollectible')),
  status_updated_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX software_invoices_one_active ON software_invoices(request_id,offer_id,milestone_index,kind)
  WHERE status IN ('creating','open','payment_failed','uncollectible');
CREATE INDEX software_invoices_request ON software_invoices(request_id);
-- stripe_webhook_events has no audio foreign key or installment constraint; reuse it.
CREATE TABLE software_stripe_unmatched_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE software_project_audit_0022 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  action TEXT NOT NULL CHECK(action IN ('started','state-changed','update-draft-saved','update-shared','update-withdrawn','visual-replaced','decision-recorded','milestone-paid','deposit-paid','handoff-shared','access-revoked','completed','content-deleted','invoice-created','invoice-status-updated','invoice-replaced')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
INSERT INTO software_project_audit_0022(id,request_id,action,note,actor,occurred_at)
  SELECT id,request_id,action,note,actor,occurred_at FROM software_project_audit;
DROP TABLE software_project_audit;
ALTER TABLE software_project_audit_0022 RENAME TO software_project_audit;
CREATE INDEX software_project_audit_request ON software_project_audit(request_id,id);

CREATE TABLE software_milestone_deposits (
  request_id TEXT NOT NULL REFERENCES software_projects(request_id),
  milestone_index INTEGER NOT NULL CHECK(milestone_index BETWEEN 0 AND 2),
  paid_recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  PRIMARY KEY (request_id,milestone_index)
);
