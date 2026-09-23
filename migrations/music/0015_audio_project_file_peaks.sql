-- Waveform bars measured by the owner's browser at upload. Display only; the
-- audio object stays authoritative, and a file without peaks shows a plain bar.
ALTER TABLE audio_project_files ADD COLUMN peaks TEXT CHECK(peaks IS NULL OR json_valid(peaks));
