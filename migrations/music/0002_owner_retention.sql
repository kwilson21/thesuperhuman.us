CREATE TABLE IF NOT EXISTS owner_retention_runs (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  playback_cutoff TEXT NOT NULL,
  playback_rows INTEGER NOT NULL CHECK(playback_rows >= 0),
  request_contacts INTEGER NOT NULL CHECK(request_contacts >= 0),
  audience_contacts INTEGER NOT NULL CHECK(audience_contacts >= 0),
  completed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS music_playback_geography_daily (
  day TEXT NOT NULL,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  creative TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(day,release_id,recording_id,campaign_id,channel,creative,country,region,city)
);
CREATE TRIGGER IF NOT EXISTS owner_requests_audit_personal_delete
AFTER UPDATE OF name,email,city_region,details_json,private_note ON owner_requests
WHEN NEW.name='' AND NEW.email='' AND NEW.city_region='' AND NEW.details_json='{}' AND NEW.private_note=''
  AND (OLD.name<>'' OR OLD.email<>'' OR OLD.city_region<>'' OR OLD.details_json<>'{}' OR OLD.private_note<>'')
BEGIN
  INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
  VALUES(NEW.id,'personal-data-deleted','retention','',NEW.updated_at);
END;
