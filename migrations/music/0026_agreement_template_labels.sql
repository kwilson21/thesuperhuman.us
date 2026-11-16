ALTER TABLE software_agreement_templates ADD COLUMN version_label TEXT;
ALTER TABLE software_agreement_templates ADD COLUMN source_revision TEXT;
CREATE UNIQUE INDEX software_agreement_templates_label ON software_agreement_templates(kind,version_label) WHERE version_label IS NOT NULL;
