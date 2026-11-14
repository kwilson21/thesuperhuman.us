# Screenshots workflow speed release gate

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/screenshot-ci-speed-db66c3`
Pull request: #243
Target: production `https://thesuperhuman.us`
Reviewer: built by Claude Haiku subagents, tests first; reviewed by independent Claude Opus and Sonnet subagents over four rounds (the last two clean). This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `e22d01f1d6a72022ca6d478663a88336dcdcdde2` (local `origin/main` when this record was written; re-check with `git fetch` before merge)

## Scope

CI and screenshot tooling only: files under `scripts/screenshots/`, `tests/scripts/` and `.github/workflows/screenshots.yml`. No page, copy, asset, route, binding, secret or migration change. The pull request history contains a temporary one-word probe in `src/pages/privacy.astro` (commit `6383df03`) and its revert (`ded8ef44`), used to measure reuse. The net diff has no change under `src/` (`git diff --stat origin/main...HEAD -- src` prints nothing).

What changed:

- Timing and settle lines in the capture log.
- A settle wait that ignores Turnstile's never-ending requests and waits for drawn widgets to hold a token.
- A pinned clock (12 November 2026, 12:00 UTC, frozen, one second per scenario step) in the capture process, the preview dev server and preview-origin pages. It replaces the rule that a scenario was reused only on the same day.
- A saved throwaway Access signing key for the local preview, kept in the gitignored `.screenshots/`.
- The workflow lets a capture in progress finish instead of cancelling it, runs every three days on `main` and can be started by hand.
- Cache version 2.

`screenshots-publish.yml` is unchanged.

## Owner decisions

- Owner, in conversation, 2026-11-13: approved five fixes: stop waiting on Turnstile, write SQL seeds straight to the local database file, pin the clock and drop the day rule, let a run finish instead of cancelling it, run on `main` every three days.
- Owner, in conversation, 2026-11-13: pinned date 12 November 2026 ("Nov 12 is fine"), replacing the first proposal of 22 September 2026, which cannot work because scenarios hard-code dates up to 2026-10-20 as past.

Not delivered: the direct SQL write was built, failed in CI (run 43442737861: `POST /api/owner/requests/screenshot-offer/software returned 404` right after a seed), could not be reproduced locally and was reverted. Seeds still go through `wrangler d1 execute`, about 60 to 85 seconds of a full run.

## Evidence and limits

Local runs: macOS arm64, Node 26.13.1, on head `ded8ef44`, in the pull request worktree.

- `pnpm run format:check`: `Checked 535 files ... No fixes applied.`
- `pnpm run lint`: 66 findings, the deferred set that is on `main`: 25 `no-module-mocking`, 21 `no-unknown-parameters`, 10 `no-unsafe-dictionary-type`, 7 `require-safety-comment-for-type-assertion` and 3 `no-known-value-widening` (tests, request-body validators under `src/lib`, and `src/components/owner/SoftwareFitReview.astro`). None is in a file this pull request touches (checked against `git diff --name-only origin/main...HEAD`). The command exits 1 because of them; lint is not enforced in the build or CI yet.
- `pnpm run check`: 561 files, 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 160 test files passed; 2,053 tests passed, 1 skipped (2,054).
- `pnpm run build`: `Complete!`
- `node scripts/publicist/gate.mjs`: `publicist-gate passed: 84 entries checked.` The private note lookup was skipped (no token; local build), so the private-note part of the gate is UNVERIFIED here.
- `git diff --stat origin/main...HEAD`: 18 files changed, 2,970 insertions, 171 deletions.

### Measurements

Before (25 successful runs, 2026-10-26 to 2026-11-13, from run logs): 21 took 11:20 to 13:21; 4 took 1:15 to 1:45, each a second push on the same day as its reference. Stated reasons for the 21 slow runs: day rule 7; capture code, dependencies or config changed 6; no saved reference (the Actions cache is removed after 7 days unused) 3; a source file every scenario loads changed 5. Example of the day rule alone: run 43337270994, same commit as its reference, 54 of 54 pages reused, all nine scenarios rerun, 12:20.

Job time is the capture job's start to end. "Capture" is the time inside `pnpm run screenshots`.

| Run | Case | Job time | Capture | Pages reused | Scenarios run |
|---|---|---|---|---|---|
| 43348213733 | Before: full capture, old wait and day rule (timing lines only) | 12:46 | 678.0s | 0 of 54 | 9 |
| 43472701695 | After: full capture (capture code changed) | 8:16 | 406.0s | 0 of 54 | 9 |
| 43470151487 | After: full capture, earlier head `153d1476` | 7:35 | 375.8s | 0 of 54 | 9 |
| 43473197780 | After: follow-up push that changes no image input | 1:13 | 3.7s | 54 of 54 | 0 |
| 43476004766 | After: one page changed (privacy) | 1:54 | 5.3s | 52 of 54 | 0 |
| 43474544761 | After: one page changed, and `main` moved under the PR | 6:53 | 348.6s | 52 of 54 | 8 |

Notes:

- In run 43474544761, PR #252 merged to `main` at 17:35 UTC between runs and changed `src/components/owner/SoftwareAgreementDetails.astro` and `src/components/SoftwareAgreedTerms.astro`, which eight scenarios load. The workflow tests the merge of the pull request with `main`, so those eight reran correctly and journal-pagination was reused.
- Where the full capture's time went: before, 488.7s of 678.0s was the settle wait (each Turnstile page waited the full 5 seconds). After, 198.8s of 406.0s (about 0.75s per capture, the 500 ms quiet window).
- `sql` (71 wrangler starts) was 84.1s before and 79.7s after.
- The remaining `Settle` cap lines: two captures in software-project wait on `/api/owner/requests/screenshot-software-project/messages`.

### Image evidence

- Pages with Turnstile widgets were byte-identical to the before run in run 43448590377.
- Two full runs of the old code on the same day (43342063113 and 43348213733) differed in 100 of 325 capture images by pixel comparison: times of day shown to the minute, plus rendering races.
- Two full runs with the frozen clock (43449812056 and 43470151487) differed in 29 images, none of them a date or time: the 404 page's height, a Turnstile widget captured mid-resize (software-project-signin), a template text box captured empty (software-signing-templates), an audio duration not loaded (studio-project), software-signing-guided-full, other-contacts, prefilled and brief-prefill (10 named images, counting desktop and phone separately), and 19 images with 1 to 70 pixels of difference.
- These rendering races exist on `main` and are not fixed here.

### Crossing midnight

The unit tests in `tests/scripts/screenshot-cache.test.ts` compute scenario inputs with the system clock faked on both sides of UTC midnight and New York midnight and assert no difference (injected clock evidence). A real rerun of the same head after 00:00 UTC had not happened when this record was written: UNVERIFIED.

### Reviews

Four rounds by independent Claude subagents.

- Round 1 (Opus correctness, Sonnet rules and docs): not clean. It found that the pinned clock still ran at the real rate, that a second local run broke owner pages, and that the settle cap skipped the widget check. All fixed.
- Round 2: Opus clean with hardening suggestions (applied); Sonnet asked for README corrections (applied).
- Round 3 (Opus): clean, small test and wording items (applied).
- Round 4 (Opus): clean, nothing to change; two wording notes applied in `5642ec53`.
- Greptile and Codex had not reviewed the final head when this section was first written (the pull request was a draft). On the final head `851de05c`, the coordinating session observed on GitHub before the merge (2026-11-13): the Greptile check succeeded with no actionable findings (confidence 5/5), and Codex's code review and security review of that head found no issues.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: repository `kwilson21/thesuperhuman.us`, branch `claude/screenshot-ci-speed-db66c3`, CI and screenshot tooling only. Untracked `.jolli/` and `docs/handoffs/` are not part of the change. No deployment is authorized by this record.
- N/A, 1.2 Approved design and truthful claims: no page, copy or asset changed.
- N/A, 1.3 Explanatory copy and resume comparison: no explanatory copy, professional claim or stored resume changed.
- N/A, 1.4 First screen and CTA: no markup or style changed.
- N/A, 1.5 Navigation, footer, contact route and external links: no page, link or route changed.

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed; the net diff has no change under `src/`.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no page, copy, markup, style, route, binding, secret or migration changed.
- N/A, `hallmark audit`: not run because no page design changed.

### 4. Performance and resilience

- N/A, every item in this section: no page, copy, markup, style, route, binding, secret or migration changed. The speed measurements above concern the CI capture job, not the site.

### 5. Forms and sensitive flows

- N/A, every item in this section: no form, email, route, binding, secret or migration changed.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no stored data, cookie, analytics, legal text, external embed or processor changed. The capture tooling runs in CI against a local preview with demo data and a throwaway signing key, and does not run on the site.

### 7. Release and final QA

- PASS, 7.1 Required type, test and build checks: see Evidence and limits (`pnpm run check` 561 files, 0 errors; `pnpm test` 2,053 passed, 1 skipped; `pnpm run build` complete; format check clean; lint shows only the 66 deferred findings, none in a touched file; publicist gate 84 entries with the private note lookup skipped).
- PASS, 7.2 Exact diff review: 18 files changed, 2,970 insertions, 171 deletions, all under `scripts/screenshots/`, `tests/scripts/` or `.github/workflows/screenshots.yml`; no change under `src/`. Four rounds of independent Claude review. On the final head `851de05c`, Greptile succeeded with no actionable findings and Codex's code and security reviews found no issues (see Reviews).
- N/A, 7.3 Production bindings, secrets, migrations, HTTPS, host routing, cache behavior and response headers: no binding, secret or migration changed, and nothing about the deployed site changed.
- PASS, 7.4 Rollback version preserved: revision `e22d01f1d6a72022ca6d478663a88336dcdcdde2` is local `origin/main` when this record was written; re-check with `git fetch` before merge.
- UNVERIFIED, 7.5 After authorized deployment, production revision, journeys, sitemap, robots, metadata, missing page, forms and monitoring: merged to `main` on 2026-11-13 20:28:03 UTC as `fad7694e`, and the coordinating session observed that the Cloudflare production build for that commit succeeded. No live check of the served site was made for this record; the change is CI tooling and nothing about the served site changed.
- PASS, 7.6 Receipt and QA evidence, with the four states reported separately. Implemented: yes. Verified locally: yes (unit tests and local checks). Verified in CI: yes (the runs in the table above, and the first run on `main`, 43501821328, below). Deployed: yes (merged 2026-11-13 20:28:03 UTC as `fad7694e`; production build succeeded; no site change). Verified live: no (not checked; CI tooling only).

First run on `main` with the new tooling, observed by the coordinating session on 2026-11-13: run 43501821328 on `fad7694e` succeeded. The job took 7 min 48 s, with 375.6 s inside `pnpm run screenshots`. It was a full capture (the capture code changed): 0 of 54 pages reused, nine scenarios run. It waited in the queue behind the run for the previous merge commit instead of cancelling it, which is the new concurrency behaviour.

### 8. Private owner center

- N/A, every item in this section: no Access setting, binding, route, migration, payment setting or owner page changed. The throwaway Access signing key is for the local capture preview only.

## Remaining work and follow-ups

Done since this record was first written (observed by the coordinating session, 2026-11-13):

- Greptile and Codex reviews of the final head `851de05c`: clean (see Reviews).
- Merged on 2026-11-13 20:28:03 UTC as `fad7694e`. The first run on `main`, 43501821328, was a full capture and queued behind the previous run (see section 7.6).

Still UNVERIFIED:

- A rerun of an unchanged head after 00:00 UTC showing unchanged scenarios reused on a later day. The injected-clock unit test remains the evidence.
- The first scheduled run (cron `17 6 */3 * *`).

Follow-ups not in this pull request:

- A later pull request, #263, added a second browser check step, "Check large text reflow", to the same workflow and added `tests/browser/**` to its path lists.
- The rendering races listed above.
- Seed speed (about 80 seconds per full run).
- The 500 ms quiet window (about 200 seconds per full run) is now the largest cost.

## Delivery status

- Before merge, on the final head `851de05c` (observed by the coordinating session, 2026-11-13): `validate` and `capture` succeeded, the Greptile check succeeded with no actionable findings (confidence 5/5), and Codex's code and security reviews found no issues.
- The owner authorized merging in conversation on 2026-11-13 ("Yes"). Merged 2026-11-13 20:28:03 UTC as `fad7694e`. The Cloudflare production build for that commit succeeded.
- UNVERIFIED: post-deployment live verification. Nothing about the served site changed and no live check was made.

This record does not by itself authorize deployment; the owner authorized the merge in conversation on 2026-11-13.

Implemented: yes. Verified locally: yes. Verified in CI: yes. Deployed: yes (merged and built 2026-11-13). Verified live: no.

Built by Claude Haiku subagents, tests first; reviewed by independent Claude Opus and Sonnet subagents over four rounds (the last two clean). This record does not certify the checks listed as UNVERIFIED.
