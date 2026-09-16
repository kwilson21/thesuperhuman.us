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

-- Anonymous daily totals survive operator-reviewed raw-event cleanup.
CREATE TABLE IF NOT EXISTS music_event_daily (
  day TEXT NOT NULL, release_id TEXT NOT NULL, recording_id TEXT NOT NULL,
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','listen30')),
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY (day, release_id, recording_id, medium, event)
);
-- Each deletion and its corresponding aggregate increment are one transaction.
-- There is no timer: only an explicit operator command removes raw events.
CREATE TRIGGER IF NOT EXISTS music_events_archive_before_delete
BEFORE DELETE ON music_events
BEGIN
  INSERT INTO music_event_daily (day,release_id,recording_id,medium,event,count)
  VALUES (substr(OLD.occurred_at,1,10),OLD.release_id,OLD.recording_id,OLD.medium,OLD.event,1)
  ON CONFLICT(day,release_id,recording_id,medium,event)
  DO UPDATE SET count = count + 1;
END;
