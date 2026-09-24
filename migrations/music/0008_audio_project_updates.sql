-- Owner-authored progress and date changes form the client timeline. Email
-- delivery is tracked separately from saving the underlying project change.
CREATE TABLE IF NOT EXISTS audio_project_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES audio_projects(request_id),
  kind TEXT NOT NULL CHECK(kind IN ('accepted','progress','work_started','date_changed')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  reason TEXT CHECK(reason IN ('protect_song','client_clarification','schedule_conflict')),
  previous_due_at TEXT,
  new_due_at TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(notification_status IN ('pending','sending','sent','failed')),
  notification_attempted_at TEXT,
  notification_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS audio_project_updates_request ON audio_project_updates(request_id,id);
