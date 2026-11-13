-- Sign-in codes belong to the browser that asked for them. Each code is one row,
-- keyed by a hash of a random value kept in that browser's pending sign-in cookie,
-- so several people asking for the same address no longer share or replace one row.
-- The code's hash covers the cookie value. Attempts are counted per row.
--
-- This adds a table and leaves audio_client_codes alone, so the code running before
-- this deploy keeps working against it until the new code is live. Codes pending at
-- the deploy stop working; the client asks for a new one (they expire in 10 minutes).
-- audio_client_codes is dropped by a later migration, after the deploy.
CREATE TABLE IF NOT EXISTS audio_client_signin_codes (
  nonce_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  session_token_hash TEXT
);
CREATE INDEX IF NOT EXISTS audio_client_signin_codes_email ON audio_client_signin_codes(email, expires_at);
