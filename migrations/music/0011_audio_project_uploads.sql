-- Incomplete multipart uploads are private owner work, never client deliveries.
CREATE TABLE IF NOT EXISTS audio_project_uploads (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES audio_projects(request_id),
  upload_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL CHECK(version IN ('review','final')),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 160),
  media_type TEXT NOT NULL CHECK(media_type IN ('audio/mpeg','audio/wav')),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','discarding')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audio_project_uploads_request ON audio_project_uploads(request_id,created_at);
