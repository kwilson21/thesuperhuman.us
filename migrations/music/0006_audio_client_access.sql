-- Passwordless client access. Codes and sessions store hashes, never bearer
-- credentials. Both are scoped to one normalized email address.
CREATE TABLE IF NOT EXISTS audio_client_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  session_token_hash TEXT
);
CREATE TABLE IF NOT EXISTS audio_client_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS audio_client_sessions_email ON audio_client_sessions(email);
CREATE TABLE IF NOT EXISTS audio_client_access_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('code-issued','code-delivery-failed','signed-in','access-revoked')),
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audio_client_access_audit_request ON audio_client_access_audit(request_id,id);
