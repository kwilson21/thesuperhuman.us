# Publication storage implementation

The first storage implementation uses D1 and one accepted-event table. The
receiver must validate authorization and project allowlisting before calling it.
This module does not provision a database or enable public ingestion.

Acceptance uses a conditional insert inside a D1 batch transaction. Revision
comparison, identity checks, withdrawal redaction and receipt reads share that
transaction. Two writers expecting the same project revision cannot both win.
Different projects have independent revision sequences. SQL assigns receipt time.
See [Cloudflare's transaction guarantee](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

An event ID identifies one immutable payload. Exact retries return the original
receipt; altered retries conflict. Publish creates an entry, correct requires an
existing entry, and withdraw may tombstone an unseen entry to block later backfill.
Withdrawal clears all stored payloads for that entry, including its own envelope.
Only opaque identity, ordering, operation, origin, hash and receipt metadata remain.
Replay cannot restore withdrawn content. Provider backups are subject to the
provider's retention policy; withdrawal is not a claim of immediate backup erasure.

Public read integration must select history by event date, exclude withdrawn
content, and derive current focus only from non-backfill publish events. Corrections
revise an entry without changing focus. Withdrawing current focus yields an empty
current view, not an older claim of active work. Those read routes are the next slice.

Apply migrations to a dedicated publication D1 database before binding the receiver.
No production binding or credential is introduced here. Event metadata and
tombstones have no automatic expiry: pruning requires preserving replay protection.
No private-client audience or asset storage is enabled by this version.
