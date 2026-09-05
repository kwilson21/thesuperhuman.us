# Publication receiver setup

This receiver supersedes PR #6's KV prototype. It requires the migration and read
model from PRs #12 and #13. It does not accept the prototype's old update shape.

Provision a dedicated D1 database, apply `migrations/0001_publication_journal.sql`,
and configure its `PUBLICATION_DB` binding in Wrangler. Set `PUBLICATION_PROJECTS`
to the comma-separated IDs approved for public display. Set `PUBLICATION_TOKEN`
as a Cloudflare encrypted secret and in the publisher's private credential store.
Never put the token in source, browser code, chat output or project payloads.
Production uses the dedicated `thesuperhuman-publication` database, bound as
`PUBLICATION_DB` in `wrangler.jsonc`, with `threadline` as its only public project.
The initial migration was applied through the Cloudflare API on 2026-09-05,
before enabling the binding. After comparing the production table constraints and
index with the migration, its filename was recorded in Wrangler's `d1_migrations`
ledger using Wrangler's standard ledger schema. The baseline is reconciled;
do not rerun the SQL file directly against production.
`PUBLICATION_TOKEN` is provisioned as an encrypted Worker secret, outside Git.

For future migrations, authenticate Wrangler to the production account, inspect
`npx wrangler d1 migrations list PUBLICATION_DB --remote`, and apply only the
reviewed pending migrations with
`npx wrangler d1 migrations apply PUBLICATION_DB --remote`. The initial migration
must not appear as pending. Stop and compare `sqlite_master` with the checked-in
migration if the ledger is unexpectedly missing; never mark an unverified schema
as migrated. Fresh databases should use `migrations apply` from the start, which
executes the schema and records each filename together.

The working agent prepares audience-safe prose after normal durable reconciliation.
POST the version-1 publication envelope to `/api/work-feed` with Bearer authorization.
Persist the receipt on 200. On 409, reconcile current project state; never blindly
increment and overwrite. On 410, honor withdrawal. On 503, retain the exact envelope
and retry at the next work or shutdown boundary. GET `/api/work-feed?project=ID`
returns the public current view and up to 100 recent historical entries.

All responses disable caching. Public allowlisting governs both writes and reads;
removing an ID immediately prevents API reads, but does not erase stored data.
Withdraw individual entries to remove their payloads. Private client access remains
unsupported. The publisher still owns audience review; validation is not sanitization.

Before enabling a project, test concurrent writes, duplicate retry, correction,
backfill and withdrawal against the provisioned D1 database, then verify the actual
website output. Local tests exercise SQL and routing separately; they do not certify
Cloudflare configuration or production delivery.

The initial remote validation exercised the repository journal and read model
against the provisioned D1 database: concurrent writes, duplicate and altered
retries, correction, backfill, withdrawal, replay rejection and focus clearing.
Fixtures used an unallowlisted private project ID. Their payloads were withdrawn;
only replay-protection metadata remains. No Threadline entries were inserted.

Publisher integration remains separate: transfer the receiver credential into the
publisher's private credential store, configure the version-1 endpoint, and wire
the delivery port to durable pending-envelope and receipt storage at normal work
and shutdown boundaries. Audience review and real progress reconciliation must
precede delivery. The receiver setup alone does not enable automatic publishing.
