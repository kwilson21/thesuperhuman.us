-- A project exists before its email invitation is attempted. Keep delivery
-- state visible to the owner without turning an email failure into lost intake.
ALTER TABLE audio_projects ADD COLUMN invitation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK(invitation_status IN ('pending','sending','sent','failed'));
ALTER TABLE audio_projects ADD COLUMN invitation_attempted_at TEXT;
ALTER TABLE audio_projects ADD COLUMN invitation_sent_at TEXT;
