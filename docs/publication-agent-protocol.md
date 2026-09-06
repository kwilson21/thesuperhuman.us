# Shared agent publication protocol

Protocol version: 1. Owner: Kazon Wilson. Canonical home: this repository.
This implements ADR 0001. Projects reference an immutable commit of this document;
they do not copy its rules or create another daily ritual.

## Project setup

Keep a small project-local mapping alongside the existing agent instructions:

- public project ID and MCP connection URL;
- protocol version and immutable document URL;
- canonical roadmap, execution record, and daily-summary locations;
- audience policy and explicitly approved public links;
- existing startup/work/shutdown insertion points;
- private location for source-to-event identities and receipts.

The MCP connection stores credentials privately. Never put credential values in
this mapping. Private source references stay in the source project. They are not
part of the public website envelope, even when a technical-detail field exists.

## Startup

Follow the project's existing orientation protocol first. Read canonical GitHub
state and reconcile it with conversation context. Then read project progress and
pending publications through MCP. Inspect current audience permission before
retrying anything. Resume normal work if the connection is unavailable; record
that publication is pending without claiming an automatic background retry.
Opening a chat is not a reason to publish.

## During work

1. Reconcile meaningful outcomes and decisions into canonical project records.
   Place new ideas in Now, Next, or Parked with a trigger; preserve reasons for
   significant plan changes. Exploration alone creates no client commitment.
2. Compare with the existing public story. Skip routine saves, test runs, PR-review
   chatter, repeated facts, and unchanged state.
3. Draft a short public outcome: what is being built, what changed for its intended
   user, and what comes next. Say agents implemented code when that matters.
   The owner supplies direction; do not imply they personally wrote the changes.
4. Review every field for audience safety and factual support. Remove private
   paths, issue/PR identifiers and links, prompts, credentials, customer identity,
   and confidential design details unless explicitly cleared for this audience.
   `technicalDetail` is public too. Use accurate delivery and evidence labels.
5. Preserve the reviewed envelope and its source identity in the source project's
   private handoff before the first tool call. The server outbox cannot recover a
   request that never reached it. Read the current revision, then send one envelope
   through `publish_project_update` and retain its receipt.
6. Verify the public feed and website after the first delivery or a surface change.
   A receipt proves ingestion. It does not prove user acceptance, completion, or
   that the browser displayed the intended story.

Use a stable event ID for each reviewed source outcome. Live work and historical
backfill must consult the same identity mapping. Never generate a new ID merely
because a response was lost. If content changes, reconcile and create a distinct
correction event; do not overwrite an existing event identity.

## Shutdown

Complete normal reconciliation, evidence-guided reflection, and day naming first.
Publish a closing summary only if it adds a meaningful public outcome. Preserve
receipts or pending envelopes with the normal durable handoff, then produce the
usual Day Complete response. Publication never replaces reflection or blocks the
user from ending the day.

## History and revisions

Backfill only from verified dated source records. Preserve the original work day
in `occurredOn`; the receiver assigns the separate publication timestamp. Use
`origin=backfill` so historical work cannot replace current focus. Do not invent
historical intent, time spent, acceptance, or deployment from a merged PR alone.

For `pending`, retry the exact envelope at the next work boundary. For `conflict`,
read actual public state and canonical sources before deciding whether a new
correction is needed. Never advance revisions blindly. Withdrawn entries cannot
be restored by retry or backfill. Corrections preserve original history dates.

## Readable stories and milestones

Keep the headline understandable without engineering vocabulary. The summary
connects progress to the product goal. Put useful implementation detail behind an
optional expansion. Avoid percentages unsupported by a defined measurement.
Distinguish proposed, implemented, tested, and available. A milestone is complete
only when its stated acceptance condition is evidenced.

Roadmap and goal changes belong in canonical project records first. If they alter
the public project overview, update that reviewed website projection as well;
the version-1 event envelope does not mutate roadmap definitions. Concept visuals
must say they are concepts. Current-product visuals require actual captured
artifacts and must not imply a mockup is already working software.

## Transfer to another project

Add the small mapping to that project's agent instructions, pin this document's
commit, allowlist the public project ID, and explicitly consent to its OAuth
scope. Then use the same existing daily protocol and tools. Private repositories
need no public source link and no new publication service. This protocol runs
when a working agent reaches a boundary, not while all chats are idle.
