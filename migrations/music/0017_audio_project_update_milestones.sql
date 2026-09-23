-- Names the owner updates that change the stage without their own kind, so the
-- timeline can say "Revision started" and "Project complete". Additive: kind stays.
ALTER TABLE audio_project_updates ADD COLUMN milestone TEXT CHECK(milestone IS NULL OR milestone IN ('revision_started','completed'));
-- Each note was written in one batch with its audit row, at the same instant. Label a note
-- only when that pairing is unambiguous: the only update of any kind at that instant, and
-- the only stage audit row. Starting work also writes a stage-changed row, so a note that
-- shares its instant with any other update stays unlabeled.
UPDATE audio_project_updates SET milestone='revision_started'
  WHERE milestone IS NULL AND kind='progress' AND file_id IS NULL
    AND (SELECT COUNT(*) FROM audio_project_updates u WHERE u.request_id=audio_project_updates.request_id
      AND u.created_at=audio_project_updates.created_at)=1
    AND (SELECT COUNT(*) FROM audio_project_audit a WHERE a.request_id=audio_project_updates.request_id
      AND a.occurred_at=audio_project_updates.created_at AND a.action IN ('stage-changed','completed'))=1
    AND EXISTS(SELECT 1 FROM audio_project_audit a WHERE a.request_id=audio_project_updates.request_id
      AND a.occurred_at=audio_project_updates.created_at AND a.action='stage-changed');
UPDATE audio_project_updates SET milestone='completed'
  WHERE milestone IS NULL AND kind='progress' AND file_id IS NULL
    AND (SELECT COUNT(*) FROM audio_project_updates u WHERE u.request_id=audio_project_updates.request_id
      AND u.created_at=audio_project_updates.created_at)=1
    AND (SELECT COUNT(*) FROM audio_project_audit a WHERE a.request_id=audio_project_updates.request_id
      AND a.occurred_at=audio_project_updates.created_at AND a.action IN ('stage-changed','completed'))=1
    AND EXISTS(SELECT 1 FROM audio_project_audit a WHERE a.request_id=audio_project_updates.request_id
      AND a.occurred_at=audio_project_updates.created_at AND a.action='completed');
