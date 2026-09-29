CREATE TABLE software_projects (
  request_id TEXT PRIMARY KEY REFERENCES owner_requests(id),
  offer_id TEXT NOT NULL REFERENCES software_offers(id),
  terms_json TEXT NOT NULL,
  payment_mode TEXT NOT NULL CHECK(payment_mode IN ('standard','invoice')),
  state TEXT NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','building','waiting_for_input','ready_for_review','complete')),
  waiting_for TEXT NOT NULL DEFAULT '' CHECK(length(waiting_for) <= 200),
  milestone_index INTEGER NOT NULL DEFAULT 0 CHECK(milestone_index BETWEEN 0 AND 2),
  step TEXT NOT NULL DEFAULT 'direction' CHECK(step IN ('direction','build','review','handoff')),
  signatures_recorded_at TEXT NOT NULL,
  first_payment_recorded_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  started_by TEXT NOT NULL,
  next_update_on TEXT,
  invitation_status TEXT NOT NULL DEFAULT 'pending' CHECK(invitation_status IN ('pending','sending','sent','failed')),
  invitation_attempted_at TEXT,
  invitation_sent_at TEXT,
  revoked_at TEXT,
  completed_at TEXT,
  content_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE software_project_updates (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES software_projects(request_id),
  kind TEXT NOT NULL CHECK(kind IN ('progress','direction_review','delivery_review','handoff')),
  status TEXT NOT NULL CHECK(status IN ('draft','shared','superseded')),
  milestone_index INTEGER NOT NULL CHECK(milestone_index BETWEEN 0 AND 2),
  title TEXT NOT NULL,
  artifact_version TEXT NOT NULL DEFAULT '',
  evidence_type TEXT NOT NULL CHECK(evidence_type IN ('concept','prototype','working_preview','demonstration','investigation','handoff')),
  visual_key TEXT,
  visual_media_type TEXT CHECK(visual_media_type IS NULL OR visual_media_type IN ('image/png','image/jpeg','image/webp')),
  visual_alt TEXT NOT NULL DEFAULT '',
  preview_url TEXT,
  what_changed TEXT NOT NULL DEFAULT '',
  checks_limitations TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  client_request TEXT NOT NULL DEFAULT '',
  criteria_json TEXT NOT NULL DEFAULT '[]',
  links_json TEXT NOT NULL DEFAULT '[]',
  review_window_days INTEGER CHECK(review_window_days IS NULL OR review_window_days BETWEEN 5 AND 30),
  next_update_on TEXT,
  email_client INTEGER NOT NULL DEFAULT 0 CHECK(email_client IN (0,1)),
  notification_status TEXT NOT NULL DEFAULT 'not_requested' CHECK(notification_status IN ('not_requested','pending','sending','sent','failed')),
  notification_attempted_at TEXT,
  notification_sent_at TEXT,
  shared_at TEXT,
  shared_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX software_project_updates_one_draft ON software_project_updates(request_id) WHERE status='draft';
CREATE INDEX software_project_updates_shared ON software_project_updates(request_id,shared_at);
CREATE TABLE software_project_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES software_projects(request_id),
  actor TEXT NOT NULL CHECK(actor IN ('owner','client')),
  actor_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  update_id TEXT REFERENCES software_project_updates(id),
  decision TEXT CHECK(decision IS NULL OR decision IN ('direction_confirmed','milestone_accepted','changes_requested')),
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX software_project_messages_request ON software_project_messages(request_id,id);
CREATE UNIQUE INDEX software_project_messages_one_decision ON software_project_messages(update_id) WHERE decision IS NOT NULL;
CREATE TABLE software_project_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES software_projects(request_id),
  action TEXT NOT NULL CHECK(action IN ('started','state-changed','update-draft-saved','update-shared','update-withdrawn','visual-replaced','decision-recorded','milestone-paid','handoff-shared','access-revoked','completed','content-deleted')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX software_project_audit_request ON software_project_audit(request_id,id);
CREATE TABLE software_milestone_payments (
  request_id TEXT NOT NULL REFERENCES software_projects(request_id),
  milestone_index INTEGER NOT NULL CHECK(milestone_index BETWEEN 0 AND 2),
  paid_recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  PRIMARY KEY(request_id,milestone_index)
);
