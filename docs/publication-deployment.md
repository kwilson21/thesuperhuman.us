# Publication receiver setup

This receiver supersedes PR #6's KV prototype. It requires the migration and read
model from PRs #12 and #13. It does not accept the prototype's old update shape.

Provision a dedicated D1 database, apply `migrations/0001_publication_journal.sql`,
and configure its `PUBLICATION_DB` binding in Wrangler. Set `PUBLICATION_PROJECTS`
to the comma-separated IDs approved for public display. Set `PUBLICATION_TOKEN`
as a Cloudflare encrypted secret and in the publisher's private credential store.
Never put the token in source, browser code, chat output or project payloads.
No binding, token or project allowlist is supplied by this change.

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
Cloudflare configuration or production delivery. UI and ritual configuration follow.
