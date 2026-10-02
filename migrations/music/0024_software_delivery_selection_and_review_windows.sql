-- Snapshot the planned items included in each delivery and preserve the full
-- milestone acceptance model. Long review periods from executed agreements
-- live in a separate additive column so the original 5–30-day constraint
-- remains unchanged for older databases and rows.
ALTER TABLE software_project_updates ADD COLUMN delivered_deliverables_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE software_project_updates ADD COLUMN review_window_days_extended INTEGER
  CHECK(review_window_days_extended IS NULL OR review_window_days_extended BETWEEN 31 AND 365);
