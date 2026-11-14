# Effect stack, pull request 270 and the public music area (pilot): release gate

Three things are gated: pull request #270 (test tooling for the conversion proof), branch A (behavior fixes to the public music routes) and branch B (the conversion of those routes to rules, flows and services). Branch B is the pilot every later route area copies.

Date: November 14, 2026
Repository: the personal website repository
Branches: A is `claude/effect-10-music-fixes`, cut from `origin/main` at `f4c96c4c` (the merge of #270); B is `claude/effect-10-music`, cut from A and merged with A's tip `e252a871` (review round 1 added one commit to A). Neither has a pull request number yet.
Pull requests: #270 is merged as `f4c96c4c`.
Target: production
Reviewer: both branches were written by a Claude Sonnet 5.5 builder subagent working from a brief (tests first, per the owner's 2026-10-12 exception). One independent Claude review round ran (round 1, below); Greptile and Codex have not run and are not recorded here.
Rollback revision: for #270, the parent of `f4c96c4c`; for A, `f4c96c4c`; for B, A's tip `e252a871`. Re-check `origin/main` with `git fetch` before merge. No deployed revision was observed by the builder.

## Scope

1. Pull request #270, merged to main as `f4c96c4c`: test tooling only. This record gates its release evidence; it does not review its diff.
2. Branch A, behavior fixes (no `conversion` label), in the routes `POST /api/music-event` and `POST /api/music-interest`:
   - An unexpected database or rate limit store failure answered 503 through a catch-all. It now answers 500 with the route's fixed sentence ("Your request could not be saved. Please try again shortly.") and never the error's own text (owner decision, 2026-11-14). A missing binding (`MUSIC_DB`, `RATE_LIMIT`, the captcha secret) stays a deliberate 503; a missing `RATE_LIMIT` reached 503 only through the catch-all and is now an explicit check.
   - A playback event whose insert lost a race (another request stored the same event id, or the same place in the playthrough, between the read and the insert) answered 503. It is now read again: the same event is a duplicate and answers 200, any other event is out of sequence and answers 409.
   - When the visitor's allowance could not be given back after a failed write, the urgent owner alert was never sent. It is now sent either way.
   - A playthrough with no sequence 1 row was accepted without the server clock check (`new Date(null)` is the epoch). It is now refused with 409. Found by reading, not recorded before.
3. Branch B, the conversion: the two routes are `runRoute(services, program)` with an error type of `never`; input is read with Effect Schema (`src/server/music-input.ts`; the Zod schemas are gone from the area); the decisions are pure rules in the new `src/server/rules/` (`playback.ts`, `campaign-tag.ts`, `visitor.ts`, `music-interest.ts`); the sequences are flows (`src/server/flows/music-event.ts`, `music-interest.ts`, `rate-limit.ts`); storage is `src/server/music-store.ts`; the owner alert is a new service (`OwnerAlert` in `src/server/services.ts`). Review round 1 added: `runRoute` takes an optional `{ route, answer }`, so a defect in a converted route is logged once through `logUnexpected` and answered with the route's fixed sentence (500; the contact and resume routes pass none and keep their bare 500, shown by `tests/server/run.test.ts`); `alwaysWrites` in `src/server/terms.ts` replaces every `Option.getOrThrow` and the `throw` in the campaign tag rule (a rule that refuses nothing now cannot fail); the `OwnerAlert` service fails with the named `OwnerAlertFailed` and the interest flow ignores it, so an alert failure never replaces or hides the store failure answer. `Effect.promise` remains only for `liveTurnstile` and the existing contact services, because `verifyTurnstile` catches every failure itself and changing it would change the contact route's answer; a defect there is now covered in the music routes by the same fixed answer. It adds the Quint model `verification/music-playback.qnt` and the Back-end rules text in CLAUDE.md and AGENTS.md. No response changes (shown by `golden:neutral`).

The studio, audio intake, owner audio tools, the media route (`src/pages/music/file/[id]/[version].ts`, R2 only, no corpus) and the content catalog (`src/lib/music-catalog.ts`, Astro collections, Zod required) are other areas and are untouched, except that `music-catalog.ts` now exports the id pattern the new reader shares.

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behavior change in a conversion.
- Owner, 2026-11-14 (relayed in the task): fix every recorded finding without asking for triage, choosing the cautious behavior; an unexpected database error answers 500 with the route's fixed generic sentence; a real lost race or stale version stays 409; a deliberate 503 for a missing binding or a known unavailable dependency stays.
- Judgment calls made by the builder under that instruction, for the owner to confirm: a rate limit store (KV) failure is treated like a database failure (500 with the fixed sentence); a Turnstile outage still answers 403 because the shared captcha helper (`src/lib/turnstile.ts`, used by five areas) cannot tell an outage from a refusal, so that is left for the area that converts it.

## Review round 1 (independent Claude round on the pilot; no behavior bug found)

- A1, fixed on A: nothing proved a non-UNIQUE insert error is not retried; a test now counts insert attempts and asserts exactly one, and fails when the retry is widened to every error (checked).
- B1, fixed: the Back-end rules text named `nothingToDo` for the rule key; the real key is `nothingToDoIf` (`src/server/terms.ts`). Every identifier in the text was re-read against the code; the text now also names `alwaysWrites`, the answers module and the `runRoute` defect argument, and says what `tests/architecture/legacy-validators.test.ts` asserts (the directory's exact file list, the frozen-copy marker, and that nothing under `src/` or `scripts/` imports them).
- B2, fixed: the model's ghost `conflictedSame` was set only when the mutant `no-retry` was on, so `sameEventNeverConflicts` held vacuously. It is now set from the real outcome (the delivery ends as a conflict while the same event is stored). The real design still passes at the driver's 20,000 samples and in an extra ad hoc run of 100,000 (not part of the driver), the mutant still fails, and no other flag or update mentions a mutant (the mutant name appears only in the design switches of the rule and the guards).
- B3, fixed: see Scope, item 3.
- B4, fixed: `src/server/music-input.ts` no longer points at the deleted `src/lib/music-demand.ts`; comments that named deleted files or described Zod now say what the reader does; the golden test headers name the playback rule instead of `saveEvent`.
- B5, fixed: `musicUnavailable` and `musicFailed` moved back next to `musicRequest` in `src/lib/music-request.ts`. Chosen because they need nothing from `src/server/` (`lib` cannot import it), `musicRequest` is already imported by 25 routes, and the later areas need the same two answers. No other route was touched.
- B6, a check, not a change: `chainMatches` in `src/server/guarded-save.ts` follows the cause chain six levels deep (depth 0 to 5); the old music code followed five. The conversion therefore recognises a unique violation one cause level deeper than the old code did. D1 errors are one level deep in practice, and no case in the corpus has a deeper chain, so the neutrality claim holds for every recorded case; it is not shown for a chain of exactly six.

## Review round 2 (independent Claude round; no behavior finding)

- R2.1, fixed: with the alert failing, nothing proved it was attempted exactly once; the interest flow test now counts attempts and asserts one.
- R2.2, fixed: no test drove `liveOwnerAlert`; `tests/server/live-services.test.ts` now covers a sent alert, `sendUrgentOwnerAlert` answering false (a 500 from Resend, and no key, where nothing is sent) and a rejection, each ending as `OwnerAlertFailed`, which carries only its tag (no error text). Resend is doubled by stubbing `fetch`, as the other live services are.
- R2.3, fixed: the route defect test's assertion that the address is not logged could not fail. `logUnexpected` (`src/server/failure.ts`) now also redacts IPv4 addresses (four dotted groups, not inside a longer number or word, so `4.1.4` is left alone; a four-part version such as `1.2.3.4` is redacted) and IPv6 addresses (eight full groups, or a form with `::`, so a time such as `12:30:45` and `std::vector` are left alone). Tests first in `tests/security/failure.test.ts`; both route defect tests now throw a message holding an email and the caller's address and assert neither reaches the log or the response. The helper's other callers and tests pass unchanged.
- R2.4, fixed: item B2 above claimed 100,000 samples for the real design; the driver runs 20,000, and the larger run was an extra ad hoc check. Corrected.
- R2.5, fixed: AGENTS.md carries the same points as CLAUDE.md (facts may fail with a named error, `alwaysWrites` with `refusals: []` cannot fail, the contact guards keep their defect, what the legacy-validators test checks); the publicist block is untouched.

A defect in the two routes now writes one redacted log line through `logUnexpected`, where the old outer catch logged nothing. The response is unchanged (the same fixed 500 sentence).

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in the pilot worktree. No logs retained. Results for #270 below are as reported to the builder by the owner's task; the builder did not re-observe them.

Pull request #270 (as reported, not re-observed here):

- Workers Builds: build succeeded.
- Live pages answered 200.
- UNVERIFIED: to be confirmed by the operator.

Branch A at `e252a871` (on `origin/main` at `f4c96c4c`):

- `pnpm exec biome format .`: no fixes applied (742 files).
- `pnpm run build`: completed.
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`, run twice: 288 test files, 12,579 tests passed, 1 skipped, both runs; `git status` unchanged by the runs.
- `QUINT_JOBS=4 pnpm run verify:quint:all`: every line `ok`; wall time 43.2 s (43.1 s on `origin/main`).
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 53 problems, the same as `origin/main` (`no-module-mocking`: 18).
- `pnpm run check`: `Result (768 files): 0 errors, 0 warnings, 17 hints`.
- `pnpm run golden:neutral --all origin/main claude/effect-10-music-fixes`: NOT NEUTRAL, on purpose: `music-event` 108 identical, 8 not neutral, 1 added; `music-interest` 62 identical, 13 not neutral. Every one of the 21 cases is explained in the table below.

Changed cases (from `pnpm run golden:diff`; status is the HTTP status; the body of an outage is `{"ok":false,"error":"Your request could not be saved. Please try again shortly."}` before and after):

| Route and case | Before | After | Why |
| --- | --- | --- | --- |
| music-event: the rate limit read throws; the rate limit write throws | 503 | 500 | A store failure is not a known unavailable dependency. |
| music-event: the duplicate lookup, the last-event lookup, the insert and the campaign lookup throw | 503 | 500 | Same. |
| music-event: another request stores the same event id just before the insert | 503, nothing stored | 200 `{"ok":true}`, nothing more stored (one extra duplicate lookup) | The loser reads again, finds its own event and answers duplicate, as a delivery that arrives later does. |
| music-event: a progress when the playthrough has no sequence 1 row (was "skips the clock check") | 200, event stored | 409 `{"ok":false}`, nothing stored | Evidence that cannot be timed is refused. |
| music-event: another request takes the same place just before the insert (added) | none | 409 `{"ok":false}` | A different event holds the place; on a fresh read the new event is out of sequence. |
| music-interest: the rate limit read throws; the rate limit write throws | 503 | 500 | A store failure. |
| music-interest: the interest write fails and the alert is sent; the batch fails on the request insert; the batch fails on the audit insert; a failed write and Resend answers 400, answers 500, is unreachable, has no key, has no sender, has no owner address; a storage failure then a retry | 503 | 500 | A store failure; the alert, the allowance given back and every other effect are unchanged. |
| music-interest: a failed write and the counter delete throws first | 503, no alert | 500, alert sent | A failed cleanup no longer hides the failure from the owner. |

Branch B at `22b8f9cd` (A's tip `e252a871` merged in, plus the conversion and review round 1; this record is committed after it):

- `pnpm exec biome format .`: no fixes applied (756 files).
- `pnpm run build`: completed.
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed; the bundle manifest is unchanged (no browser-reachable module changed; `music-catalog.ts` is server-only and `ReleaseInterest.astro` reads `MERCHANDISE` in its frontmatter).
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`, run twice: 292 test files, 12,671 tests passed, 1 skipped, both runs; `git status` unchanged by the runs.
- `QUINT_JOBS=4 pnpm run verify:quint:all`: every line `ok`, with the new model; wall time 44.5 s (43.2 s on A).
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 51 problems (53 on A); `no-module-mocking` 16 (18 on A): the two `vi.mock` calls of `tests/api/music-demand.test.ts` are gone with the file, and no new finding is in the area.
- `pnpm run check`: `Result (782 files): 0 errors, 0 warnings, 17 hints`.
- `pnpm run golden:neutral --all e252a871 HEAD` (exit 0): `music-event` 111 identical, 6 neutral with D1 changes, 0 not neutral, 0 not comparable, 0 added, 0 removed, 0 renamed; `music-interest` 46 identical, 29 neutral with D1 changes, 0 not neutral, 0 added, 0 removed, 0 renamed; compared 77 fixtures and 9,015 cases; `golden:neutral: NEUTRAL`. The fixtures are re-recorded in their own commit, and no case was added, removed or renamed in it.
- Differential tests against the frozen Zod 3 schemas (`tests/fixtures/legacy-validators/music-demand.ts`, a sixth reference copy): the interest body and the event body, thousands of seeded inputs each, zero differences (values, error keys in order, every sentence).

Limits: a defect answer is shown by forcing a throw in the clock and the id source (the services cannot be swapped from outside a route); no browser run of the release page form or player; the player's retry on a 5xx treats 500 as it treated 503 (read in `src/scripts/music-playback.ts`, not run); the interest form shows `result.error` for any non-400 status (read in `src/scripts/form-submission.ts`, not run). The Quint model is checked by random simulation, not by Apalache. The rate limit store has a small read-then-write window that this area does not change (see `src/lib/rate-limit.ts`).

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branches, local changes, scope and rollback confirmed: the website repository; #270 is merged; A fixes two API routes; B converts them. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or navigation changed. The only visitor-visible change is a status code on an outage (503 to 500, same sentence).

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no markup or style changed (`ReleaseInterest.astro` changes one import path). `hallmark audit` not run because no page design changed.

### 4. Performance and resilience

- PASS, 4.2 Client code against the built site: the bundle test passes on both branches with the manifest unchanged.
- PASS, 4.4 Async UI recovery, as far as read: an outage answers the same sentence as before, and the player retries a 5xx twice (read, not run). UNVERIFIED in a browser.
- N/A, 4.1, 4.3, 4.5 and 4.6: no image changed; no page measured; no media route changed.

### 5. Forms and sensitive flows

- PASS, 5.1 Server input validation and bounds on branch B: the readers refuse and accept exactly what the Zod schemas did (zero differences over the seeded inputs) and the golden corpus passes neutral.
- PASS, 5.2 Failure paths on branch A: 500 with the fixed sentence for every store failure, 503 for a missing binding, 429 for the limits, 409 for a lost race or an out-of-sequence event; shown by `tests/api/music-outages.test.ts` and the re-recorded corpus.
- UNVERIFIED, 5.4 Delivery of the urgent owner alert in the intended environment: the corpus shows the Resend call with its exact body; no real email was sent.
- N/A, 5.3 and 5.5: no new form, and no approval-gated flow touched.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no cookie, analytics, legal text or processor changed. The alert still carries no visitor details (the corpus holds its body).

### 7. Release and final QA

- PASS, 7.1 Required checks: the local gates above for each branch.
- UNVERIFIED, 7.2 Exact diff review on each pull request head and independent code and security review: not run.
- UNVERIFIED, 7.3 Production bindings, secrets and migrations: none changed. The trigger `music_events_archive_before_delete` is on `music_events`, a table neither route reads or writes, so the converted code relies on no trigger (issue #242 still tracks moving the five that write).
- PASS, 7.4 Rollback is the previous revision (A: `f4c96c4c`; B: A's tip `e252a871`).
- UNVERIFIED, 7.5 Live verification: nothing is deployed. For #270 the operator reported "build succeeded, pages 200"; to be confirmed by the operator.
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section: the owner center, Access, migrations and payment settings are untouched.

## Delivery status and remaining gates

- UNVERIFIED: CI (`validate`, `Golden neutrality` with the `conversion` label on B), Greptile, Codex and Workers Builds on either head.
- UNVERIFIED: an independent correctness and security review of each branch.
- UNVERIFIED: live checks after merge: a playback start and a listen on a release page, an interest submission, and the owner alert.

No deployment is authorized by this record.

Branch A: implemented yes, deployed no, verified live no. Branch B: implemented yes, deployed no, verified live no. #270: implemented and deployed (as reported); verified live as reported.

Both branches were built by a Claude Sonnet 5.5 subagent. This record does not certify the checks listed as UNVERIFIED.
