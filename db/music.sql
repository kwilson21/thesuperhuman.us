-- Idempotent MUSIC_DB baseline. Existing production tables were initialized
-- manually before per-binding migration directories were introduced.
CREATE TABLE IF NOT EXISTS music_interest (
  release_id TEXT NOT NULL, email TEXT NOT NULL, interest TEXT NOT NULL,
  merchandise TEXT NOT NULL, suggestion TEXT NOT NULL,
  consent_version TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (release_id, email)
);
CREATE TABLE IF NOT EXISTS music_events (
  release_id TEXT NOT NULL, recording_id TEXT NOT NULL, session_id TEXT NOT NULL,
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','listen30')), occurred_at TEXT NOT NULL,
  PRIMARY KEY (release_id, recording_id, session_id, medium, event)
);
CREATE INDEX IF NOT EXISTS music_events_date ON music_events(occurred_at);
CREATE TABLE IF NOT EXISTS music_event_daily (
  day TEXT NOT NULL, release_id TEXT NOT NULL, recording_id TEXT NOT NULL,
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','listen30')),
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY (day, release_id, recording_id, medium, event)
);
CREATE TRIGGER IF NOT EXISTS music_events_archive_before_delete
BEFORE DELETE ON music_events
BEGIN
  INSERT INTO music_event_daily (day,release_id,recording_id,medium,event,count)
  VALUES (substr(OLD.occurred_at,1,10),OLD.release_id,OLD.recording_id,OLD.medium,OLD.event,1)
  ON CONFLICT(day,release_id,recording_id,medium,event)
  DO UPDATE SET count = count + 1;
END;

CREATE TABLE IF NOT EXISTS owner_campaigns (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('release','service')),
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  secondary_signals TEXT NOT NULL DEFAULT '[]',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  approved_plan TEXT NOT NULL DEFAULT '',
  retrospective TEXT NOT NULL DEFAULT '',
  next_lesson TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','active','complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_campaign_tags (
  campaign_id TEXT NOT NULL REFERENCES owner_campaigns(id),
  channel TEXT NOT NULL,
  creative TEXT NOT NULL,
  PRIMARY KEY(campaign_id,channel,creative)
);
CREATE TABLE IF NOT EXISTS owner_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','merchandise','service')),
  release_id TEXT,
  service_id TEXT,
  campaign_id TEXT REFERENCES owner_campaigns(id),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  city_region TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK(status IN ('new','reviewed','resolved','withdrawn')),
  private_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  contact_delete_after TEXT
);
CREATE INDEX IF NOT EXISTS owner_requests_status_date ON owner_requests(status,created_at DESC);
CREATE TABLE IF NOT EXISTS owner_request_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  action TEXT NOT NULL CHECK(action IN ('created','reviewed','resolved','reopened','withdrawn','note-updated','personal-data-deleted')),
  actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS music_playback_events (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  playthrough_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','progress','listen30','complete','replay')),
  accumulated_seconds INTEGER NOT NULL CHECK(accumulated_seconds >= 0),
  media_duration_seconds INTEGER NOT NULL CHECK(media_duration_seconds >= 0),
  campaign_id TEXT,
  channel TEXT,
  creative TEXT,
  traffic_class TEXT NOT NULL CHECK(traffic_class IN ('human','automated')),
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  UNIQUE(session_id,playthrough_id,sequence)
);
CREATE INDEX IF NOT EXISTS music_playback_events_date ON music_playback_events(occurred_at);
CREATE INDEX IF NOT EXISTS music_playback_events_campaign ON music_playback_events(campaign_id,occurred_at);
CREATE TABLE IF NOT EXISTS music_playback_daily (
  day TEXT NOT NULL,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','progress','listen30','complete','replay')),
  campaign_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  creative TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city)
);
CREATE TABLE IF NOT EXISTS owner_retention_runs (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  playback_cutoff TEXT NOT NULL,
  playback_rows INTEGER NOT NULL CHECK(playback_rows >= 0),
  request_contacts INTEGER NOT NULL CHECK(request_contacts >= 0),
  completed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS music_playback_geography_daily (
  day TEXT NOT NULL,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  creative TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(day,release_id,recording_id,campaign_id,channel,creative,country,region,city)
);
CREATE TRIGGER IF NOT EXISTS owner_requests_audit_personal_delete
AFTER UPDATE OF name,email,city_region,details_json,private_note ON owner_requests
WHEN NEW.name='' AND NEW.email='' AND NEW.city_region='' AND NEW.details_json='{}' AND NEW.private_note=''
  AND (OLD.name<>'' OR OLD.email<>'' OR OLD.city_region<>'' OR OLD.details_json<>'{}' OR OLD.private_note<>'')
BEGIN
  INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
  VALUES(NEW.id,'personal-data-deleted','retention','',NEW.updated_at);
END;
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
-- A service request has one provisional project. Client access is introduced
-- separately; this migration does not expose project data to visitors.
CREATE TABLE IF NOT EXISTS audio_projects (
  request_id TEXT PRIMARY KEY REFERENCES owner_requests(id),
  stage TEXT NOT NULL DEFAULT 'files_under_review'
    CHECK(stage IN ('files_under_review','accepted','in_progress','review_ready','revision_in_progress','final_files_ready','complete')),
  original_due_at TEXT,
  current_due_at TEXT,
  completed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audio_project_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES audio_projects(request_id),
  action TEXT NOT NULL CHECK(action IN ('created','accepted','stage-changed','date-changed','revoked','completed')),
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audio_project_audit_request ON audio_project_audit(request_id,id);

-- Existing open service requests can use the same portal when it is enabled.
INSERT INTO audio_projects(request_id,created_at,updated_at)
  SELECT id,created_at,created_at FROM owner_requests
  WHERE kind='service' AND status IN ('new','reviewed') AND email<>''
    AND NOT EXISTS (SELECT 1 FROM audio_projects WHERE request_id=owner_requests.id);
INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
  SELECT request_id,'created','migration',created_at FROM audio_projects
  WHERE NOT EXISTS (SELECT 1 FROM audio_project_audit WHERE request_id=audio_projects.request_id AND action='created');

-- Keeping this in the database makes request and project creation atomic for
-- both the current intake route and any future service-request entry point.
CREATE TRIGGER IF NOT EXISTS audio_project_after_service_request
AFTER INSERT ON owner_requests
WHEN NEW.kind='service' AND NEW.email<>''
BEGIN
  INSERT INTO audio_projects(request_id,created_at,updated_at)
    VALUES(NEW.id,NEW.created_at,NEW.created_at);
  INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
    VALUES(NEW.id,'created','system',NEW.created_at);
END;
