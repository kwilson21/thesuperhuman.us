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
