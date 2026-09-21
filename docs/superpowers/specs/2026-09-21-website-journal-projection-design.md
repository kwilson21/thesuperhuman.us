# Personal Website Journal Projection Design

## Goal

Make verified Personal Website work discoverable in one private journal and on the existing public Development journal, with optional real before/after visual proof for meaningful UI repairs.

## Confirmed starting point

- Private checkpoints are stored beneath the checkout that ran the journal command. Managed worktrees therefore create separate private journals.
- The Personal Website page already renders the shared `personal-website` public feed through `ProjectUpdates`.
- The connected publisher currently rejects `personal-website` with `forbidden`; no updates can appear publicly until the owner renews the project-scoped publication consent.
- The publication contract supports public prose and delivery/basis metadata, not media attachments. Visual proof remains curated, versioned website content.

## Architecture

### Canonical private journal

`development_journal.py` will resolve a shared journal home from the repository's primary local checkout when invoked inside a managed Git worktree. It will continue to use the current checkout when no primary checkout can be identified. The checkpoint source path remains the invoking checkout so artifact snapshots capture the source actually reviewed.

The reconciliation is append-only. It creates one source-backed checkpoint per meaningful outcome, with verified PRs and known Codex thread IDs, rather than copying chat transcripts or raw commit feeds.

### Public projection

The public surface remains the existing `ProjectUpdates` component on `/building/personal-website`. The implementation does not add a second feed. A reviewed, idempotent backfill is delivered through `publication:personal-website` only after `get_project_progress` succeeds. Until that consent gate is restored, the public surface correctly falls back to the repository-owned milestones.

### Visual proof

Add an optional `visualProof` field to curated website milestones. A proof consists of an actual before capture, an actual after capture, and alt text. The page presents them as a compact accessible comparison; an animated GIF is optional derived media, never the sole proof. This preserves readable still images, honors reduced-motion preferences, and avoids implying that a local capture is live production.

The recent mobile A/B-player and owner-tooltip repairs are the first candidates. They are eligible only after matching before and after captures are made at the same viewport and reviewed under the existing asset QA procedure.

## Privacy and delivery rules

- Do not publish raw conversation content, private file paths, credentials, owner-dashboard data, or unverified claims.
- Describe outcomes in plain language and label them `repository-verified` and `tested` unless production rendering is independently read back.
- Publication receipts prove ingestion, not page rendering. Verify the public page only after a receipt is returned.
- Keep GIFs and screenshots out of the publication transport; add them to tracked website assets only after image review.

## Verification

- Unit-test shared journal-root resolution and preservation of the invoking checkout as the artifact source.
- Run the journal status/checkpoint flow from a managed worktree and confirm it updates the canonical index.
- Add component-level coverage for a milestone with and without visual proof.
- Run Astro check, the relevant browser layout checks, full tests, and production build.
- Read public progress before delivery; after owner consent and receipt, verify `/building/personal-website` in a browser.

## Out of scope

- Automatic scraping or public mirroring of all conversations.
- Automatic GIF generation for every change.
- Bypassing the missing `publication:personal-website` consent.
