-- A file revocation is an owner action with its own immutable token and actor.
ALTER TABLE audio_project_files ADD COLUMN revocation_id TEXT;
ALTER TABLE audio_project_files ADD COLUMN revoked_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audio_project_files_revocation ON audio_project_files(revocation_id);
ALTER TABLE audio_projects ADD COLUMN access_revocation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audio_projects_access_revocation ON audio_projects(access_revocation_id);
