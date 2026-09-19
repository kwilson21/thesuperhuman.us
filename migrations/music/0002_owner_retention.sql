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
