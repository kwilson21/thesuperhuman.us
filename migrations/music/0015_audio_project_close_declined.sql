-- Resolving an unaccepted service request means the provisional studio did not proceed.
-- Close that project's access in the same transaction as the request status change.
CREATE TRIGGER IF NOT EXISTS audio_project_close_declined_request
AFTER UPDATE OF status ON owner_requests
WHEN NEW.kind='service' AND NEW.status='resolved' AND OLD.status<>'resolved'
BEGIN
  UPDATE audio_projects SET revoked_at=NEW.updated_at,updated_at=NEW.updated_at
    WHERE request_id=NEW.id AND stage='files_under_review' AND revoked_at IS NULL;
  INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
    SELECT request_id,'revoked','request-resolution',NEW.updated_at FROM audio_projects
    WHERE request_id=NEW.id AND stage='files_under_review' AND revoked_at=NEW.updated_at AND changes()=1;
END;
