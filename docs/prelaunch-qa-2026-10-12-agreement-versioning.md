# Pre-launch QA: agreement versioning (planned)

Date: October 12, 2026  
Branch: `claude/agreement-versioning-v1-b28b03`  
Status: planned. Migration 0026 is not applied to production and this code is not deployed. Production evidence and the rollback revision are recorded at release.  
Scope: software agreement version labels, optional source revisions, the template change diff, version history and returning-client MSA continuity on the Agreements page, the client signing page and the signed PDFs. Migration `0026_agreement_template_labels.sql` is additive only: nullable `version_label` and `source_revision` columns on `software_agreement_templates` and a partial unique index on `(kind, version_label)`. Existing template rows keep NULL values.  
Deploy order: apply additive 0026 after `0025_brief_suggestion_budget.sql` and before merging this branch to main, because a push to main deploys production. Deploying this code first fails with `no such column: version_label` on the owner request page for any request with an offer, the owner Agreements page, the client signing page after email verification and template publishing. Do not edit previously applied migrations.  
Verification at release: `npm run owner:health -- --remote` after applying 0026, with row counts, audit hash and schema definitions read before and after, as in the 0025 record.
