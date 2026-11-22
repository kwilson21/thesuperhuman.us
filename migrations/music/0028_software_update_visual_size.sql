-- The pixel size of a project update's image, stored when the owner uploads it so the
-- page can reserve the space before the image loads. Both columns are NULL for an image
-- uploaded before this migration, and for one whose size could not be read with
-- certainty (for example a rotated photo); such an image renders with no width or
-- height, as before. A new upload writes both columns together with the new image.
--
-- This only adds two nullable columns, so the code running before this deploy keeps
-- working against it. Apply it before deploying the code that reads them.
ALTER TABLE software_project_updates ADD COLUMN visual_width INTEGER;
ALTER TABLE software_project_updates ADD COLUMN visual_height INTEGER;
