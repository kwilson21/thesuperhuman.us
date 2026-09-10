# Redesign delivery and launch gates

September 10, 2026. The owner approved eight PRs for the accumulated redesign. This replaces the earlier fourteen-slice proposal. Branches are prepared in an isolated worktree; the original checkout and preview remain intact.

## Review order

| Slice | Branch | PR base | Scope |
|---|---|---|---|
| 1 | `codex/redesign-direction` | `main` | Direction, content responsibilities and original audit |
| 2 | `codex/redesign-journal` | `main` | Private checkpoints, artifact preservation and verified recovery archives |
| 3 | `codex/redesign-home` | `codex/redesign-direction` | Shared navigation, design foundations, Home and image QA |
| 4 | `codex/redesign-contact-resume` | `codex/redesign-home` | Shared form states, short contact form and general resume |
| 5 | `codex/redesign-work-about` | `codex/redesign-contact-resume` | Work evidence, corrected Lyft team attribution and personal About |
| 6 | `codex/redesign-building-writing` | `codex/redesign-work-about` | Building, project details, Writing index and essay |
| 7 | `codex/redesign-audio-services` | `codex/redesign-building-writing` | Personal-site Audio, both services sheets and print behavior |
| 8 | `codex/redesign-visual-history` | `codex/redesign-audio-services` | Website history, curated studies, page comparisons and final evidence links |

The journal PR is independent. The visual changes form a review stack so each diff shows only its slice. Navigation links are introduced with their destinations. The old headshot stays until the Audio replacement removes its final consumer. After a prerequisite merges, dependent PR bases must be updated and their diffs rechecked.

## Evidence and recovery

The original tracked/untracked work was frozen and hash-verified before extraction, with Git history preserved separately. A private journal archive was uploaded to the dedicated D1 backup database, read back in full, verified by SHA-256 and restored locally. Backup verification also checks that checkpoint artifact references are present and match their recorded bytes and hashes. New checkpoints after that backup require a subsequent backup; this is not automatic synchronization.

The PRs contain selected studies, optimized production assets and concise QA records. Raw generation prompts, uncurated screenshots, private journals, backup payloads and rendered PDFs remain outside Git. The public website history is curated content and does not read the private journal or backup database.

## Validation

Every application slice receives Astro checks, unit tests, the production build/asset gate and affected desktop/mobile route checks. Contact, resume and Audio checks use fixtures and no-JavaScript email fallbacks without sending messages. Both service sheets are checked for one-page Letter output, hidden action buttons, retained contact details and the legacy services redirect. The completed stack receives an integration check with the independent journal changes before release preparation.

No real email or resume was sent, no PDF was uploaded, and no public journal feed was written during extraction. Unit and local browser results do not establish live delivery or visitor outcomes. Full logs and captures are retained privately.

## Before launch

- Review and approve the eight diffs and the complete site preview. Preserve existing publication data and pending resume approvals.
- Coordinate the merge/release order: pushes to main can trigger the production Cloudflare deployment. A dependent PR must not be treated as an independently approved partial launch.
- Confirm final production configuration, route compatibility and approved assets against the integrated commit.
- Obtain the owner's go-live decision before merging to the deployment branch or deploying. Complete real contact, Audio inquiry and resume-delivery smoke tests only with authorized destinations and explicit authorization to send.
- Refresh dated website-history captures if later changes make them misleading; keep comparisons labelled as local previews until launch.

## After launch

Enrich older Threadline journal entries using the live Inspect before sending entry as the reference. Preserve IDs, dates, correction/withdrawal behavior and before-state evidence. Choose a useful screenshot, diagram or demonstration for each point; do not invent historical product evidence. This follow-up remains outside the redesign PRs.
