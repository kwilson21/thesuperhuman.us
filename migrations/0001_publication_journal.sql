-- Accepted event identity and ordering survive correction and content withdrawal.
CREATE TABLE publication_events (
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  operation TEXT NOT NULL CHECK (operation IN ('publish', 'correct', 'withdraw')),
  origin TEXT NOT NULL CHECK (origin IN ('work', 'shutdown', 'backfill')),
  payload_hash TEXT NOT NULL,
  payload TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, event_id),
  UNIQUE (project_id, revision)
);
CREATE INDEX publication_entry ON publication_events(project_id, entry_id, revision);
