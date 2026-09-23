-- A publication token ties the file, project stage, and client notice to the
-- same owner action inside one D1 batch.
ALTER TABLE audio_project_files ADD COLUMN publication_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audio_project_files_publication ON audio_project_files(publication_id);
ALTER TABLE audio_project_updates ADD COLUMN file_id TEXT REFERENCES audio_project_files(id);
