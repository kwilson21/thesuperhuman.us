-- Idempotent MUSIC_DB baseline. Existing production tables were initialized
-- manually before per-binding migration directories were introduced.
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
CREATE TABLE IF NOT EXISTS music_event_daily (
  day TEXT NOT NULL, release_id TEXT NOT NULL, recording_id TEXT NOT NULL,
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','listen30')),
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY (day, release_id, recording_id, medium, event)
);
CREATE TRIGGER IF NOT EXISTS music_events_archive_before_delete
BEFORE DELETE ON music_events
BEGIN
  INSERT INTO music_event_daily (day,release_id,recording_id,medium,event,count)
  VALUES (substr(OLD.occurred_at,1,10),OLD.release_id,OLD.recording_id,OLD.medium,OLD.event,1)
  ON CONFLICT(day,release_id,recording_id,medium,event)
  DO UPDATE SET count = count + 1;
END;

CREATE TABLE IF NOT EXISTS owner_campaigns (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('release','service')),
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  secondary_signals TEXT NOT NULL DEFAULT '[]',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  approved_plan TEXT NOT NULL DEFAULT '',
  retrospective TEXT NOT NULL DEFAULT '',
  next_lesson TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','active','complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_campaign_tags (
  campaign_id TEXT NOT NULL REFERENCES owner_campaigns(id),
  channel TEXT NOT NULL,
  creative TEXT NOT NULL,
  PRIMARY KEY(campaign_id,channel,creative)
);
CREATE TABLE IF NOT EXISTS owner_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','merchandise','service','release-update')),
  release_id TEXT,
  service_id TEXT,
  campaign_id TEXT REFERENCES owner_campaigns(id),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  city_region TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK(status IN ('new','reviewed','resolved','withdrawn')),
  private_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  contact_delete_after TEXT
);
CREATE INDEX IF NOT EXISTS owner_requests_status_date ON owner_requests(status,created_at DESC);
CREATE TABLE IF NOT EXISTS owner_request_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  action TEXT NOT NULL CHECK(action IN ('created','reviewed','resolved','reopened','withdrawn','note-updated','personal-data-deleted')),
  actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_audience_permissions (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('subscribed','unsubscribed')),
  consent_version TEXT NOT NULL,
  source_request_id TEXT REFERENCES owner_requests(id),
  granted_at TEXT NOT NULL,
  withdrawn_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_audience_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  permission_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('subscribed','withdrawn')),
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS music_playback_events (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  playthrough_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','progress','listen30','complete','replay')),
  accumulated_seconds INTEGER NOT NULL CHECK(accumulated_seconds >= 0),
  media_duration_seconds INTEGER NOT NULL CHECK(media_duration_seconds >= 0),
  campaign_id TEXT,
  channel TEXT,
  creative TEXT,
  traffic_class TEXT NOT NULL CHECK(traffic_class IN ('human','automated')),
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  UNIQUE(session_id,playthrough_id,sequence)
);
CREATE INDEX IF NOT EXISTS music_playback_events_date ON music_playback_events(occurred_at);
CREATE INDEX IF NOT EXISTS music_playback_events_campaign ON music_playback_events(campaign_id,occurred_at);
CREATE TABLE IF NOT EXISTS music_playback_daily (
  day TEXT NOT NULL,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','progress','listen30','complete','replay')),
  campaign_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  creative TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city)
);
CREATE TABLE IF NOT EXISTS owner_retention_runs (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  playback_cutoff TEXT NOT NULL,
  playback_rows INTEGER NOT NULL CHECK(playback_rows >= 0),
  request_contacts INTEGER NOT NULL CHECK(request_contacts >= 0),
  completed_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS music_playback_events_archive_before_delete
BEFORE DELETE ON music_playback_events
WHEN OLD.traffic_class='human'
BEGIN
  INSERT INTO music_playback_daily(day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city,count)
  VALUES(substr(OLD.occurred_at,1,10),OLD.release_id,OLD.recording_id,OLD.medium,OLD.event,COALESCE(OLD.campaign_id,''),COALESCE(OLD.channel,''),COALESCE(OLD.creative,''),OLD.country,OLD.region,OLD.city,1)
  ON CONFLICT(day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city)
  DO UPDATE SET count=count+1;
END;
CREATE TRIGGER IF NOT EXISTS owner_requests_audit_personal_delete
AFTER UPDATE OF name,email,city_region,details_json,private_note ON owner_requests
WHEN NEW.name='' AND NEW.email='' AND NEW.city_region='' AND NEW.details_json='{}' AND NEW.private_note=''
  AND (OLD.name<>'' OR OLD.email<>'' OR OLD.city_region<>'' OR OLD.details_json<>'{}' OR OLD.private_note<>'')
BEGIN
  INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
  VALUES(NEW.id,'personal-data-deleted','retention','',NEW.updated_at);
END;
