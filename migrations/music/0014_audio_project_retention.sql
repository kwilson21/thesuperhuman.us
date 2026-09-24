-- Keep the project shell after its client content is removed, so payment and
-- operational history can still be reconciled without retaining private files.
ALTER TABLE audio_projects ADD COLUMN content_deleted_at TEXT;
