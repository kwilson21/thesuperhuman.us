-- Private delivery state. Successful delivery retains identity/receipt, not prose.
CREATE TABLE publication_outbox (
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload TEXT,
  receipt TEXT,
  PRIMARY KEY (project_id, event_id)
);
CREATE INDEX publication_outbox_entry ON publication_outbox(project_id, entry_id);
-- Withdrawals through either the HTTP receiver or MCP clear queued prose atomically.
CREATE TRIGGER publication_outbox_withdraw AFTER INSERT ON publication_events
WHEN NEW.operation = 'withdraw'
BEGIN
  UPDATE publication_outbox SET payload = NULL
  WHERE project_id = NEW.project_id AND entry_id = NEW.entry_id;
END;
