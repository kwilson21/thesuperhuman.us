-- The message row is the durable record of who said what and when. Read state
-- belongs to the recipient; messages are never edited after creation.
CREATE TABLE IF NOT EXISTS audio_project_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES audio_projects(request_id),
  actor TEXT NOT NULL CHECK(actor IN ('owner','client')),
  actor_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS audio_project_messages_request ON audio_project_messages(request_id,id);
