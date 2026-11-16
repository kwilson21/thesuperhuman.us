# Pricing D1 persistence release gate

Date: 2026-11-16, America/New_York. Scope: PR #308 pricing persistence correction.
Target: existing MUSIC_DB binding, not a new paid service. No production changes performed.

## Why

KV cannot atomically guard a save against another tab. Store the singleton in D1 and require the expected
version in the write itself. Two first saves race on the primary key; only one inserts. Existing saves update
only a matching version; a loser gets 409 and must reload. The pricing rule still decides all values.

## Migration and data preservation

Migration `0028_owner_pricing.sql` only creates the new table. The idempotent local schema matches it.
Before merge/deploy, reconcile the actual production migration ledger and schema, back up MUSIC_DB,
and check privately whether `RESUME_STORE` contains `owner:pricing` (preview tests may have created it).
If present, preserve a private backup, validate its reference/version and import it into the singleton without
overwriting an existing row. Verify the imported record by readback, without printing private figures into
public artifacts. Do not delete the legacy KV record. The application deliberately has no automatic KV fallback:
a missing table fails the save closed and the pricing page shows a read failure, not an empty editable reference.

Use the existing repository migration procedure after these checks, with authorization for the target
environment. No remote migration or data import has been attempted. A missing table must not be ignored.

Rollback: revert the code commit and leave the additive table/backup in place. If rolling back to a KV-writing
version after D1 saves, reconcile the newest D1 reference into the old store first; otherwise the old page can
show stale values. Prefer rolling back to the pre-offer-board code, which reads neither pricing store.

## Evidence and blockers

- PASS: targeted route tests use real SQLite and cover first-save and update races, stale versions, corrupt
  records, a missing table and store failures; 38 pricing/offer-board tests passed locally before formatting.
- PASS: no new dependency, binding, service or public API authentication change. Existing owner-only gates remain.
- UNVERIFIED: refreshed full checks, browser screenshots, independent final-head review and model rerun.
- UNVERIFIED, blocking: new empty table changes golden digests. Existing fixtures are untouched. They must be
  re-recorded individually in a separate commit with proof that only the empty-table digest was added;
  do not suppress the table or call the change neutral under the unchanged strict comparison.
- UNVERIFIED, blocking: production ledger, backup, legacy KV state/import and migration application.
- UNVERIFIED: live Workers AI behavior remains outside the local mock tests.

Implemented locally: yes. Verified locally: targeted tests only. Deployed: no. Verified live: no.
Hold merge until the blocking migration and regression evidence is complete. This record is not approval
for a remote schema change and does not claim the rest of the feature has passed final review.
