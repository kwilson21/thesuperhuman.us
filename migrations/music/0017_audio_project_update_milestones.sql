-- Names the owner updates that change the stage without their own kind, so the
-- timeline can say "Revision started" and "Project complete". Additive: kind stays.
ALTER TABLE audio_project_updates ADD COLUMN milestone TEXT CHECK(milestone IS NULL OR milestone IN ('revision_started','completed'));
-- Each note was written in one batch with its audit row, at the same instant.
UPDATE audio_project_updates SET milestone='revision_started'
  WHERE milestone IS NULL AND kind='progress' AND file_id IS NULL AND EXISTS(SELECT 1 FROM audio_project_audit a
    WHERE a.request_id=audio_project_updates.request_id AND a.action='stage-changed' AND a.occurred_at=audio_project_updates.created_at);
UPDATE audio_project_updates SET milestone='completed'
  WHERE milestone IS NULL AND kind='progress' AND file_id IS NULL AND EXISTS(SELECT 1 FROM audio_project_audit a
    WHERE a.request_id=audio_project_updates.request_id AND a.action='completed' AND a.occurred_at=audio_project_updates.created_at);
