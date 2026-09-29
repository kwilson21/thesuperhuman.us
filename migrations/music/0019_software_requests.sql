PRAGMA defer_foreign_keys = true;
CREATE TABLE owner_requests_0019_stash (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','merchandise','service','software')),
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
INSERT INTO owner_requests_0019_stash (id,kind,release_id,service_id,campaign_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at,resolved_at,contact_delete_after) SELECT id,kind,release_id,service_id,campaign_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at,resolved_at,contact_delete_after FROM owner_requests;
DROP TABLE owner_requests;
CREATE TABLE owner_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','merchandise','service','software')),
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
  contact_delete_after TEXT,
  submission_id TEXT
);
INSERT INTO owner_requests (id,kind,release_id,service_id,campaign_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at,resolved_at,contact_delete_after) SELECT id,kind,release_id,service_id,campaign_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at,resolved_at,contact_delete_after FROM owner_requests_0019_stash;
DROP TABLE owner_requests_0019_stash;
CREATE INDEX owner_requests_status_date ON owner_requests(status,created_at DESC);
CREATE UNIQUE INDEX owner_requests_submission_id ON owner_requests(submission_id) WHERE submission_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS owner_requests_audit_personal_delete
AFTER UPDATE OF name,email,city_region,details_json,private_note ON owner_requests
WHEN NEW.name='' AND NEW.email='' AND NEW.city_region='' AND NEW.details_json='{}' AND NEW.private_note=''
  AND (OLD.name<>'' OR OLD.email<>'' OR OLD.city_region<>'' OR OLD.details_json<>'{}' OR OLD.private_note<>'')
BEGIN
  INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
  VALUES(NEW.id,'personal-data-deleted','retention','',NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS audio_project_after_service_request
AFTER INSERT ON owner_requests
WHEN NEW.kind='service'
BEGIN
  INSERT INTO audio_projects(request_id,created_at,updated_at)
    VALUES(NEW.id,NEW.created_at,NEW.created_at);
  INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
    VALUES(NEW.id,'created','system',NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS audio_project_close_declined_request
AFTER UPDATE OF status ON owner_requests
WHEN NEW.kind='service' AND NEW.status='resolved' AND OLD.status<>'resolved'
BEGIN
  UPDATE audio_projects SET revoked_at=NEW.updated_at,updated_at=NEW.updated_at
    WHERE request_id=NEW.id AND stage='files_under_review' AND revoked_at IS NULL;
  INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
    SELECT request_id,'revoked','request-resolution',NEW.updated_at FROM audio_projects
    WHERE request_id=NEW.id AND stage='files_under_review' AND revoked_at=NEW.updated_at AND changes()=1;
END;
PRAGMA defer_foreign_keys = false;
