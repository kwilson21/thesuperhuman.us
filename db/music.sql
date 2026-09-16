-- Dedicated MUSIC_DB only. Do not apply to the publication database.
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
