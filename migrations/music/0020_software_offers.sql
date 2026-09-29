DROP TRIGGER IF EXISTS owner_requests_audit_personal_delete;
CREATE TABLE IF NOT EXISTS owner_request_audit_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  action TEXT NOT NULL CHECK(action IN ('created','reviewed','resolved','reopened','withdrawn','note-updated','personal-data-deleted','payment-approved','booking-invoice-created','balance-invoice-created','booking-payment-updated','balance-payment-updated','booking-invoice-replaced','balance-invoice-replaced','fit-reviewed','question-sent','declined','offer-draft-saved','offer-sent','offer-link-revoked')),
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

CREATE TABLE software_fit_reviews (
  request_id TEXT PRIMARY KEY REFERENCES owner_requests(id),
  label TEXT NOT NULL CHECK(label IN ('potential-fit','needs-clarification','stated-mismatch')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE software_offers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  version INTEGER NOT NULL CHECK(version > 0),
  status TEXT NOT NULL CHECK(status IN ('draft','sent','superseded','withdrawn')),
  terms_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  sent_by TEXT,
  UNIQUE(request_id,version)
);
CREATE UNIQUE INDEX software_offers_one_draft ON software_offers(request_id) WHERE status='draft';
CREATE UNIQUE INDEX software_offers_one_sent ON software_offers(request_id) WHERE status='sent';
CREATE TABLE software_offer_links (
  request_id TEXT PRIMARY KEY REFERENCES owner_requests(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
