-- File metadata is separate from the private R2 object. Publishing controls
-- client visibility; an uploaded object alone is never a delivery.
CREATE TABLE IF NOT EXISTS audio_project_files (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES audio_projects(request_id),
  version TEXT NOT NULL CHECK(version IN ('review','final')),
  object_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 160),
  media_type TEXT NOT NULL CHECK(media_type IN ('audio/mpeg','audio/wav')),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  downloadable INTEGER NOT NULL DEFAULT 0 CHECK(downloadable IN (0,1)),
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','published','revoked')),
  uploaded_at TEXT NOT NULL,
  published_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS audio_project_files_request ON audio_project_files(request_id,status,version);

-- One durable first-access record per session/file/action avoids logging every
-- range request while preserving delivery evidence.
CREATE TABLE IF NOT EXISTS audio_project_file_access (
  file_id TEXT NOT NULL REFERENCES audio_project_files(id),
  session_token_hash TEXT NOT NULL,
  access_kind TEXT NOT NULL CHECK(access_kind IN ('stream','download')),
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY(file_id,session_token_hash,access_kind)
);
