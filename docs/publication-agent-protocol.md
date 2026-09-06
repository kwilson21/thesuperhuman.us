# Shared publication policy and delivery contract

Policy revision: 2, requested 2026-09-06. Transport envelope version: 1, unchanged.
Owner: Kazon Wilson. Canonical home: this repository.
Authenticated MCP is implemented; production configuration, owner sign-in, and
first-publication verification remain separate activation gates.

## Public content

Publish product goals, user-visible outcomes, meaningful milestones, honest
limitations, and what comes next. Write a clear headline and a short explanation
understandable without repository access. Optional technical detail is public too.

General philosophy and truthful high-level AI-assisted attribution are allowed.
They do not authorize publishing a reproducible account of internal operations.
Default to outcomes over implementation mechanics. Keep private operational
instructions, prompts, detailed configurations, and source material in the source
project. Do not publish a combination of details that reconstructs a private
process across multiple otherwise harmless updates.

Review text, identifiers, links, images, captions, recordings, and metadata before
transmission. An allowed field can still leak restricted material. For uncertain
details, omit the detail and publish the supported outcome; hold the whole update
only if its core claim cannot be made safely. Public philosophy is not confidential
by default, and confidentiality must not become a false claim about who did the work.

Project-specific restrictions belong in private project configuration, not in this
public repository. Never paste private source material into a public PR, review
comment, issue, fixture, log, or publication request while performing the review.
Automated field validation and keyword filters cannot guarantee confidentiality.

## Source and audience authority

Project records own intent, roadmap changes, and acceptance. The website is a
presentation, not a second tracker. Reflect a changed public goal or milestone only
after its source record is reconciled. Do not turn exploration into a commitment.

Distinguish proposed, implemented, tested, and available. Keep evidence basis
separate from delivery state. A merge is not human acceptance or proof of launch.
Private evidence may support a claim without a public link. Do not imply that
readers can inspect sources that are not available to them.

## Delivery

Use the existing project workflow; project-local instructions define its private
insertion points. This public contract does not prescribe or describe the owner's
internal operating sequence. Do not add a separate user reporting ritual.

- Preserve the reviewed envelope and its stable source identity privately before sending.
- Read current public state with `get_project_progress`.
- Submit through `publish_project_update`; retain the returned receipt.
- Retry an interrupted delivery with exactly the same envelope and event ID.
- Reconcile conflicts against source records and public state; never advance revisions blindly.
- Honor withdrawals and clear corresponding private pending copies. Do not restore a withdrawn entry.
- Verify website rendering after first delivery or a surface change. Receipts prove ingestion only.

Pending work stays in existing durable source records. No second server queue or
background scheduler is required. An unavailable connection must not block normal
work or be described as active automatic publishing.

## History and transfer

Backfill a few verified, dated outcomes rather than a raw commit feed. Preserve
the original day and label the event as backfill; the receiver records publication
time separately. Backfill cannot replace current focus. Share identity mapping
between historical and live updates so the same outcome is not published twice.
Do not invent old intentions, plans, acceptance, duration, or deployment.

Each project supplies a public ID, the supported envelope version, an immutable
policy reference, and private source/audience/recovery configuration. Add its ID
to the receiver allowlist and consent to its OAuth scope. Existing grants do not
automatically gain access to newly allowlisted projects.

[Connection setup](publication-mcp.md) describes the public transport configuration.
[Story requirements](project-story-requirements.md) describe the reader experience.
Operational publication details previously included here are no longer part of
the current public document. This revision does not erase older Git history.
