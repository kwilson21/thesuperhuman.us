# ADR 0001: Publish from existing project records

Status: accepted; public description narrowed on 2026-09-06.
Transport and storage behavior are unchanged. Internal project workflow remains
private and is not specified by this public architecture record.

## Decision

Publish audience-reviewed progress from existing authoritative project records.
Reuse the Astro/Cloudflare website and transactional publication journal. MCP
calls the journal directly; source records retain pending envelopes and receipts.
Do not introduce another tracker, summarization service, queue, or scheduler.

The website does not own product intent, project execution, or acceptance.
It presents useful outcomes, meaningful milestones, and verified history.
Project-local instructions define when to prepare updates.

## Guarantees and limits

Stable identities and expected revisions prevent duplicate delivery and blind
overwrites. Corrections revise public wording; withdrawals remove served content
and block replay. Historical backfill preserves original dates without changing
current focus. A receipt proves ingestion; first-publication acceptance also
requires checking website rendering.

The publisher applies the [shared publication policy](../publication-agent-protocol.md)
before transmission. General philosophy and high-level attribution may be public;
internal operational recipes and private source records are not publication inputs.
Private-client access is separate from public portfolio permission.

## Current implementation

The transactional D1 journal, HTTP receiver, basic homepage and /building views,
and authenticated MCP implementation are merged. OAuth configuration, owner sign-in,
and a verified first real publication are still required for activation.

The full project-story surface and multi-project reuse remain governed by the
[story requirements](../project-story-requirements.md). Do not claim those milestones
are complete merely because the receiver exists.

## Maintenance

Prefer reuse and deletion over new infrastructure. Keep changes independently
reviewable, preserve the required latest-head review gate, and verify changes to
ordering, duplicate detection, withdrawal, and authorization at their boundaries.
Older versions of this record remain in Git history; editing the current document
does not retract material that was previously public.
