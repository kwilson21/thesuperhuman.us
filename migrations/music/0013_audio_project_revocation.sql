-- A file revocation is an owner action with its own immutable token and actor.
ALTER TABLE audio_project_files ADD COLUMN revocation_id TEXT;
ALTER TABLE audio_project_files ADD COLUMN revoked_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audio_project_files_revocation ON audio_project_files(revocation_id);
ALTER TABLE audio_projects ADD COLUMN access_revocation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audio_projects_access_revocation ON audio_projects(access_revocation_id);
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
