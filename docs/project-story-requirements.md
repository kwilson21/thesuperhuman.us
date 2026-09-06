# Project stories: shared product requirements

Status: version 1 is accepted and supported when merged into `main`.
Unmerged branch copies are proposals. Acceptance covers these product requirements,
not the architecture choices explicitly left pending below.
Owner: Kazon Wilson. Version: 1. Date: 2026-09-05.

## Purpose and ownership

Give everyday readers, experienced engineers, and authorized clients a clear,
visual account of what is being built, why it matters, what works today, and
what comes next. Routine progress publication should not require manual notes,
copy/paste, or website edits by the project owner.

This website repository owns the shared presentation and publication requirements.
Other projects reference this document rather than copy it. They retain authority
over their own goals, roadmaps, acceptance decisions, code, and private evidence.
The website presents an audience-appropriate projection, not a second execution tracker.

Consumers record the supported contract version and, once merged, an immutable
commit URL for this document. Breaking changes require explicit version migration.
Project-specific configuration and exceptions are data, not forks of this spec.
Do not put client identities, confidential goals, credentials, or private evidence
in this public repository merely to adopt these requirements.

## Reader experience and page structure

| Surface | Required content |
| --- | --- |
| Homepage | Up to three compact project previews: goal, current milestone, latest meaningful result, labeled thumbnail, link to the project story |
| `/building` | Cross-project journal, newest first, grouped by day, with project filters |
| `/building/[project]` | Goal, intended experience, working-today evidence, milestone roadmap, connected progress history, next outcome and relevant blockers |
| Existing `/work` | Preserve the professional portfolio; link to the building journal rather than replace the case studies |

The project story must answer: What are we building? Who benefits? What works
today? How close are we to the goal? What happens next?
Keep the overview short; expand technical details and older history on demand.
Provide responsive layouts, readable text, keyboard access, image descriptions,
and status labels that do not rely on color alone.
New updates must not move content while someone reads history. Offer a quiet
new-updates control instead. Display last publication time, not implied presence
at a keyboard. Empty, stale, offline, and withdrawn states must be truthful.

## Readable updates and attribution

Each update needs a plain-language headline, what changed, why it matters, what
remains, and an honest delivery status. It must stand alone without repository access.
Explain benefits using established project intent; do not invent motivation or value.
Use optional technical detail for mechanisms, tradeoffs, and verification evidence.
Neither reading level may expose restricted material. Avoid raw commit feeds,
file lists, logs, acronyms without explanation, or implementation jargon as headlines.

Distinguish proposed, implemented, tested, and available-to-use outcomes.
Keep the evidence basis separate: agent-reported, repository-verified, or explicitly
human-confirmed. A private source can support a claim without giving readers access;
do not imply that they can independently inspect it. Missing links are acceptable.
Agents perform implementation. Attribute product direction, decisions, review, and
acceptance to a human only where supported. A bot merge is not human acceptance.

Example headline: "Picking up where you left off."
Example explanation: "The project now has a clearer return-to-work summary.
It is still being tested before wider use."
These examples illustrate writing style, not verified current project status.
Public philosophy and high-level AI attribution are permitted. Internal operating
recipes and unnecessary implementation details are excluded by the
[publication policy](publication-agent-protocol.md), including in technical detail.

## Goals, roadmaps, and acceptance

Every project has a tangible user outcome and a short ordered set of milestones.
Describe milestones as useful capabilities, not internal components or PR numbers.
Each milestone records a stable ID, outcome, observable acceptance check, current
state, supporting updates, and the authority responsible for acceptance.
Show planned, in-progress, blocked, and accepted states distinctly. Changes to
scope or milestone order need a dated explanation so the story remains understandable.
Do not infer milestone completion from a merge, passing tests, silence, or elapsed time.
Do not show percentage-complete bars without a defensible measurement basis.
Dates and commitments must be explicitly authorized; do not invent delivery promises.

## Visual evidence

- Concept: label mockups of the intended experience as concepts, not shipped UI.
- Working today: use actual screenshots or recordings, dated and tied to a known build.
- Illustration: label explanations of current nonvisual capabilities as illustrations.
- Show before/after demonstrations where useful; do not manufacture a finished-looking
  interface as evidence of a capability that has no interface yet.
- Review all images, captions, video frames, and metadata for audience suitability.
  Include accessible descriptions. Visuals follow the same withdrawal policy as text.
- Asset capture/publication must not introduce a manual task for every routine update;
  reuse valid evidence and refresh it at meaningful visual milestones.

## History and shared records

Maintain a journal of public-safe updates, not only a latest-status snapshot.
Projects, milestones, threads, updates, and visual assets need stable identities.
An update links to its project, relevant milestone, and related work thread when known.
Do not force an invented relationship when the link is uncertain.
Preserve event time separately from publication time and keep ordering independent
of wall-clock assumptions. Group related work across days and suppress trivial duplicates.
Corrections supersede earlier wording. Withdrawals remove content from all served
surfaces, linked assets, and controlled caches; public history must not expose the
withdrawn text. Do not promise erasure of copies already downloaded by third parties.
Define retention for public history, restricted audit data, assets, and backups before launch.

## Publication, privacy, and automation

One configured publisher owns ordered updates for each project. It publishes on
meaningful workflow transitions, retries safely, and resumes after interruptions.
Repeat delivery must be idempotent; concurrent or late deliveries must not regress
history or the current view. Failures must be observable without blocking coding work.
Project onboarding is one-time configuration, not a custom website integration.

An MCP tool is an optional transport, not proof of an automatic trigger. Document
and test the actual trigger for every supported environment. GitHub events cover
repository milestones, not unpushed work. Agent reports are not continuous observation.
Threadline may later provide richer semantic updates through the same shared contract.
Do not require a new website-side LLM service or a deployment for every update.

Publication is deny-by-default until a project and audience policy is authorized.
Credentials must be project-scoped. Validate content suitability as well as field shape;
an allowed summary field can still leak confidential information. Never send raw chat,
private paths, prompts, secrets, customer data, or unapproved links to public storage.
Hold uncertain material for review rather than silently publishing it.
Client-facing material defaults to private. Client access and public portfolio
publication are separate permissions. Client delivery remains disabled until access
control, audience isolation, assets, and withdrawal behavior are verified end to end.

## Approved workflow and remaining implementation decisions

[ADR 0001](architecture/0001-daily-protocol-publication.md) records the approved
architecture: existing project records feed an audience-reviewed website projection.
Project-local workflow remains private. The D1 journal and authenticated MCP
implementation are merged. Production OAuth activation and first-publication
verification remain open gates. The current homepage and /building views are a
basic surface, not completion of the richer project-story requirements above.

Reuse the current site. Polling remains the initial simplicity preference;
SSE/WebSockets require demonstrated need. Historical backfill follows the same
identity, privacy, correction, and withdrawal rules as live updates.

## Delivery roadmap and release checks

| Milestone | Acceptance evidence |
| --- | --- |
| 1. Agree on the story and contract | Reviewed requirements, architecture decisions, and page wireframes; unresolved choices explicitly listed |
| 2. Demonstrate one complete Threadline story | Goal, labeled concept, actual current-state evidence (or honest absence), outcome roadmap, readable history, next step; understandable without repository access |
| 3. Publish progress automatically | Real supported workflow produces a public-safe update without user copy/paste; demonstrate retries, duplicates, concurrent/late events, corrections, withdrawals, and stale/offline views |
| 4. Prove project reuse | A second project works through configuration and the same publisher, schema, and page templates; cross-project credential isolation is tested |
| 5. Qualify private client delivery | Authorized access works; unauthorized reads, asset access, and cross-audience leaks fail; acceptance and publication authority remain separate |

For each delivery, inspect desktop/mobile rendering and accessibility, confirm the
main explanation with a nontechnical reader and technical depth with an engineer,
and record evidence before claiming acceptance. Use small reviewable PRs.
Videos as progress evidence are supported; generated episodic shorts, 3D exploration,
and a new orchestration platform are not required for the initial release.
