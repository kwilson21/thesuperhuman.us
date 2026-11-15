# Effect stack, the public intake area (audio request, software brief, brief pass, brief suggestions): release gate

Two branches are gated: branch A (behavior fixes to the four public form routes) and branch B (the conversion of those routes to rules, flows and services). Branch B follows the pattern of the music pilot (`docs/prelaunch-qa-2026-11-14-music-area.md`).

Date: November 15, 2026
Repository: the personal website repository
Branches: A is `claude/effect-11-intake-fixes`, B is `claude/effect-11-intake`, cut from A. Both were merged with `origin/main` at `8b5b4efd` (the merge of #283), the revision this record was written against. Re-check `origin/main` with `git fetch` before merge.
Tips: A is `7f335426` (`c2049762`, then the merge with `origin/main` at `e23b7357`, then the two fixes listed under "Findings of the review bot" and their corpus case and fixtures). B's code is at `199f90ce`; this record is committed after it, in a commit that changes documentation only.
Pull requests: A is #300 and B is #301.
Decisions: Kazon Wilson. Implementation and independent review were done with Claude Code.
Target: production
Reviews: independent reviews of branch A, before its head `5905c1e4`, are listed below. An independent review of B at `ad2cdfd9` (2026-11-15) found no email sent twice, no duplicate request and no leak, and made the findings fixed in the commits after it (see "Review of branch B"). A second review of B at `63ef8802` (2026-11-15) found no duplicate email, no duplicate request and no leak, and confirmed that the moved inserts match A byte for byte; its findings are fixed below. A review bot then left findings on both pull requests (see "Findings of the review bot"); the heads after those fixes have not been reviewed again: UNVERIFIED.
Rollback revision: for A, `8b5b4efd`; for B, A's tip `7f335426`. No deployed revision was observed.

## Scope

The four public form routes: `POST /api/audio-intake`, `POST /api/software-inquiry`, `POST /api/software/brief/pass` and `POST /api/software/brief/suggest`. The golden fixtures are `audio-intake`, `software-inquiry`, `software-brief-pass` and `software-brief-suggest`.

1. Branch A, behavior fixes (no `conversion` label), each reproduced by a failing test or a corpus case first; see "Fixes on branch A".
2. Branch B, the conversion. `audio-intake` and `software-inquiry` are `runRoute(services, program)` with an error type of `never`; their fields already use the shared Effect Schema readers (`src/lib/fields.ts`), so no frozen copy of old validators is added for them. `pass` and `suggest` read their bodies with `src/server/brief-input.ts`, with frozen copies of their old Zod schemas under `tests/fixtures/legacy-validators/` and a differential test (`tests/server/brief-input-differential.test.ts`). Zod is gone from the four routes and from every module only they used. The decisions are pure rules (`src/server/rules/`: `intake-limits.ts`, `captcha.ts`, `software-inquiry.ts`, `brief-pass.ts`, `brief-suggest.ts`); the sequences are flows (`src/server/flows/`: `audio-intake.ts`, `software-inquiry.ts`, `brief-pass.ts`, `brief-suggest.ts`); storage is `src/server/intake-store.ts` and `src/server/brief-suggest-store.ts`; the outside calls are services in `src/server/services.ts` (the three-outcome captcha check, the owner alert, the owner notice, the studio invitation, the software notice, the client copy, the suggestion limiters, the model, and the background).
3. Two Quint models, `verification/software-inquiry.qnt` and `verification/suggestion-budget.qnt`, and their sections in `docs/verification.md`.

The responses do not change in B (shown by `golden:neutral`): the corpus of `audio-intake`, `software-brief-pass` and `software-brief-suggest` passes against A's recording unchanged, and `software-inquiry` is neutral with changed D1 statements.

Outside this area and untouched: the owner routes that share `deliverProjectInvitation` (`src/lib/audio-project-invitations.ts`) and `deliverSoftwareBriefCopy` (`src/lib/software-brief-copy.ts`); the wrapped functions stay in `src/lib/`, each behind a service with a named failure.

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behavior change in a conversion.
- Owner, 2026-11-14: fix every recorded finding without asking for triage, choosing the cautious behavior; an unexpected database or KV failure answers 500 with the route's fixed sentence; a real lost race stays 409; a deliberate 503 for a missing binding or a known unavailable dependency stays.
- Judgment calls made under that instruction, for the owner to confirm: a captcha service that cannot answer is a known unavailable dependency and answers 503 (it answered 403 and asked the visitor to complete the check again); a captcha secret that is missing or wrong, or an internal error code from the captcha service, is our fault and is also reported as unavailable; a model failure on the suggestion route answers 503 (it answered 200 with nothing) and logs a fixed line, never the model's own text.

## Fixes on branch A

The visitor-facing sentences are unchanged in every case; only the status and what the server does changed.

| Route and case | Before | After |
| --- | --- | --- |
| Audio and software: the captcha service cannot be reached, answers an error status or unreadable text | 403, "Please complete the security check again." (the visitor is told to redo a check that was fine) | 503 with "Sending is temporarily unavailable. Your details are still here. Please try again later." The attempt stays counted (see STOP item 4). |
| Audio and software: the captcha reports a missing or wrong secret, or an internal error | 403 | 503, as above |
| Audio and software: the rate limit store fails to read or write | 503 | 500 with the same sentence |
| Audio: the insert fails (also with no Resend key, no sender or no owner address, Resend refusing, or the counter delete failing) | 503 with the delivery sentence | 500 with the same sentence; the owner alert still goes out when giving the allowance back fails |
| Software: the look-up of the submission id fails | 503 with the delivery sentence | 500, and the owner alert carries its own code `d1-read-failed` |
| Software: the insert fails (the same variants as audio) | 503 | 500 |
| Audio and software: the captcha service reports a malformed verification request (`bad-request`) | 403 (the visitor told to redo the check) | 503, as for the other faults on our side |
| Audio and software: the request is read back after the insert | a failing read made a stored request look unsaved, and a retry stored it twice | the stored request is built from the row the batch wrote; nothing is read back |
| Pass: the captcha service cannot answer | 200 `{"ok":false}` | 503 `{"ok":false}` |
| Pass: signing fails | not separate | 500 `{"ok":false}` |
| Suggest: the budget store, a limiter or any other unexpected step fails | 200 with an empty suggestion | 500 with the same empty body, logged through `logUnexpected` |
| Suggest: the model fails | 200 with an empty suggestion | 503 with the same empty body; a fixed line is logged, never the model's error |
| Suggest: the model answers with a bare string | 200 with an empty suggestion, the log quoting the string | 500, with a fixed log line (found while converting, fixed on A at `b1075890`, one corpus case) |
| Suggest: the cleanup of old budget rows fails | silent | logged through `logUnexpected` |

Changed corpus cases, from `golden:neutral --all e23b7357 claude/effect-11-intake-fixes` (the suggest array case is one more added case): `audio-intake` 13 changed, 2 removed (the two read-back cases) and 2 added (the stored request answered without a read-back, and the captcha malformed-request case); `software-inquiry` 17 changed, 1 removed (the read-back case) and 2 added; `software-brief-pass` 4 changed (200 to 503); `software-brief-suggest` 7 changed (the cleanup failure is now logged; reading or reserving the budget throws, and an unscripted rate limit throws: 200 to 500; the model throws: 200 to 503; a bare string: 200 to 500). Every changed case differs in the status and the logged lines.

## Review of branch A (before head `5905c1e4`)

One line each, as recorded in the history of A:

- A captcha service fault code (a wrong or missing secret, an internal error) was reported as a refused token: fixed.
- A read after the insert could make a stored request look unsaved: removed.
- The loser of a duplicate submission race kept its allowance: a later finding showed that giving it back also deleted the address-wide count of the winner, so the loser keeps the allowance it spent (see "Findings of the review bot").
- A failed look-up alerted the owner under the write code: it has its own code.
- A model failure was answered quietly and logged the model's error text: 503 and a fixed line.
- A look-up failing while checking for a rival was not logged: logged.
- The corpus did not show the logged lines of a failing save and look-up: asserted.

## What a visitor sees for each changed status

The audio and software forms show the server's own sentence in the status line and keep what the visitor typed, for every status except 400 (`src/scripts/form-submission.ts`, read, not run in a browser). So after a captcha outage (503) the visitor sees "Sending is temporarily unavailable. Your details are still here. Please try again later." where they saw "Please complete the security check again."; after a storage failure (500) they see the route's existing sentence ("We couldn’t confirm delivery. Your details are still here. Try again later or email ..." for a lost brief or request, the temporary sentence for a rate limit store failure). No other sentence changed. The pass script counts any answer that is not a 200 with `ok: true` as not passed (`src/scripts/brief-suggestion-pass.ts`), so a 503 or 500 reads as before and stays quiet; the suggestion script's handling of a 500 or 503 was not read or run: UNVERIFIED.

## Conversion on branch B

- Input: `audio-intake` and `software-inquiry` use `validateIntake` and `validateSoftwareInquiry` (Effect Schema readers). `pass` and `suggest` read with `src/server/brief-input.ts`; the frozen copies and the differential test hold them to the old messages and order.
- Rules: the attempt limit, the captcha check and the request limit are shared by the audio and software flows (`intake-limits.ts`, `captcha.ts`); the software rules are "store a brief" (nothing to do when one is stored under the id) and "answer a stored brief to the visitor who sent it" (`software-inquiry.ts`).
- The duplicate submission path: the look-up and the insert are the facts and the save of `decideAndSave`. The request limit is counted once, on the first pass that finds nothing stored, and the count is kept for the passes that follow. A unique violation on the submission id is a `SubmissionIdClash` (a `ChangedSinceRead`), so the loser reads again, finds the other brief and answers as a duplicate, keeping the allowance it spent, exactly as A does. Any other insert failure is followed by a look-up (the insert may have stored the brief before its answer was lost), then the allowance is given back, the failure is logged and the owner is alerted.
- Background work is handed over with `Background.defer` at the point the old code called `ctx.waitUntil`; the corpus records the same phases.
- Services added: `Background.defer`, `OwnerNotice`, `ProjectInvitation`, `SoftwareNotice` and `BriefCopy`, each failing with a named error; a failure that is logged carries one field named `failure` (not `cause`, which `tests/architecture/tagged-errors.test.ts` keeps free).
- Deleted: the route's own look-up helper, the read-back after the insert (on A), the Zod schemas of the four routes, and the inline Turnstile, alert and give-back code. Nothing in `src/lib/` became unused.

One path the corpus cannot reach: when the insert meets the unique index and the look-up that follows then fails, the old route logged the look-up failure and then the insert failure; B logs them in the same order (the flow keeps the insert failure for that), and an existing route test asserts the two lines.

## Commits that do not build alone

Two commits on B do not build on their own, and history is not rewritten: `d56399f7` holds only the rename of the shared rule file and its test (the files that import them were updated in the next code commit), and `dc8d1119` re-records the `software-inquiry` fixture before the code commit `c6cf19c2` that produces it. Build, test and neutrality are stated for the heads listed here, not for every commit.

## Review of branch B

Fixed after the review of `ad2cdfd9`, each with a test or corpus case first where it changes behavior: an array model reply answers an empty 200 with no log, as on A (a corpus case on A, and `isObjectOrArray`); an insert refused by the unique index with no other brief found is made once and takes the lost-brief path (it was retried up to three times); the inquiry model keeps the key's read and write as separate steps, states `keptForStored` and adds two mutants; the suggest and pass routes have no route-level catch and the cleanup task has no try and catch; a failure that is logged carries one field named `failure`; the comments on the live services say why they cannot reject and why `Background` has two forms; the two intake store functions are one (`insertRequest`), the two inserts moved into the store as one function per statement, and `saveOwnerRequest` and its error class are deleted (the owner tests create requests through a helper built on the store).

Second review, of `63ef8802`, one line each, all fixed:

- No test asserted the too-large answer or that its log names no personal data: tested at the flow (the answer, the allowance given back, no alert, and a log free of the visitor's name, address and words); the largest brief the form allows is also shown to store, so the answer is not reachable from a valid body.
- The body of the pass and suggest requests was read before the program, so a failing stream was answered by the platform instead of the route's fixed body: the read is inside the program, logged once and answered as before (tests with a stream that errors).
- The inquiry model's race was wider than written: it also occurs with different submission ids; the exception of `keptForStored` is tightened to a delivery that lost an insert, and the comment, `docs/verification.md` and a STOP item said so (the race and the item are gone since the loser keeps its allowance).
- The record said five properties and five mutants and that the read-then-write window was not modelled: corrected.
- The unique-violation mapping sat in the flow and read the raw database error: it is in the intake store, which answers a `SubmissionIdClash` or an `IntakeStoreFailed`.
- A too large brief was logged without a message on the audio route: the line is the old route's.

## Findings of the review bot

A review bot left findings on both pull requests; each was checked against the code. One line each.

On branch A (fixed there, with a failing test first, the corpus case and the fixtures re-recorded in commits of their own):

- A captcha answer of `bad-request` means our verification request was malformed, not that the visitor refused: it is now reported as unavailable, like the other faults on our side (a unit test and a corpus case in the audio and software routes).
- The loser of a duplicate submission race gave its allowance back by deleting the address-wide key, which also erased the count of the request that won when both came from one address: the loser now keeps the allowance it spent, as before the first fix on A. The Quint model states `keptForStored` without an exception and checks that the loser keeps the key (`loserKeepsAllowance`); the owner item about two simultaneous submissions from one address is removed.

On branch B (no answer or side effect changed; `golden:neutral` against A's tip is NEUTRAL):

- The new refusals of the intake rule files were plain classes with hand-written tags: all are `Data.TaggedError` classes carrying a `say` sentence (the suggestion refusals carry an empty one, as they say nothing to the visitor).
- The four flows wrapped rule decisions and service calls in `Effect.result` and returned outcome objects: named refusals and failures now go to the routes, the side effects of a failure (the allowance given back, the owner alert, the log line) happen in the flow before the failure continues, and each route maps every tag with `catchTags`, so an unmapped tag no longer type checks. Only a stored brief or a sent request is a returned value.
- The fixed sentences sat as constants in two routes: they are beside `musicRequest` in `src/lib/music-request.ts`, and the refusals use them.
- The submission look-up statement sat in `src/lib/owner-requests.ts`, and the intake store only wrapped it: the statement is in `src/server/intake-store.ts`, and the lib helper is deleted.
- A fixture re-record said to sit inside a conversion commit: every commit on B that touches the fixtures holds only fixtures, and every commit this record cites is in B's history; nothing changed.

## Models

- `verification/software-inquiry.qnt` (module `inquiry`): one stored brief and one client copy per submission id, a lost race answered with the other brief while the loser keeps the key it set, a stored brief shown only to the email that sent it. The allowance is the set of addresses whose counter key is set. Six properties, seven mutants. The key is read and written in two steps, as the code does; `keptForStored` holds with no exception, because a delivery that finds a brief stored never deletes the key.
- `verification/suggestion-budget.qnt` (module `budget`): a count never passes its cap under concurrent reservations; each count is exactly the reservations made; the model is called only for a request that holds both reservations. Four properties, four mutants. Writing it showed that the early read of the site's count does not protect the cap; the guard on the write does.
- Both are checked by random simulation in the pooled driver, not by Apalache.

## SQL statements and their classes

(a) plain read, (b) write guarded by a key or constraint, (c) compare-and-set write, (d) decides an outcome.

| Statement | Where | Class |
| --- | --- | --- |
| `SELECT ... FROM owner_requests WHERE submission_id=?` (one statement; one before the insert and one after a failed or lost insert, so at most two per request) | `findStoredBrief` (`src/server/intake-store.ts`) | (a) |
| `INSERT INTO owner_requests ...` and `INSERT INTO owner_request_audit ...` in one batch | `insertRequest` (`src/server/intake-store.ts`), for audio and software | (b): a new random primary key; for software the unique index on the submission id is the guard |
| the trigger `audio_project_after_service_request` (inserts `audio_projects` and its audit row for a `service` request) | `db/music.sql` | trigger; see STOP item 2 |
| `SELECT count FROM brief_suggestion_budget WHERE day = ? AND scope = ?` | `readSiteCount` | (a) |
| `INSERT INTO brief_suggestion_budget ... ON CONFLICT ... DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count` (visitor, then site) | `reserve` | (c): the cap is the compare-and-set guard |
| `DELETE FROM brief_suggestion_budget WHERE rowid IN (SELECT rowid ... WHERE day < ? LIMIT 1000)` | `clearOldDays` | A bounded mechanical cleanup that decides no answer: the cutoff (`previousDay`, yesterday) is computed in TypeScript and bound as `day < ?`, and SQL only applies it with a fixed `LIMIT 1000`; it runs in the background after the response. Not classed (d). Reading the days and deleting the ones a rule names was tried and is not neutral under the corpus (it adds a read before the delete and moves the delete across the response snapshot: three cases, "the first suggestion of the day clears old days", the same with no context, and "the cleanup of old days throws"), so the statement is kept. |
| the invitation claim `UPDATE audio_projects SET invitation_status='sending' ... WHERE ... invitation_status='pending' AND revoked_at IS NULL AND EXISTS(... status<>'withdrawn' ...)`, the recipient read with the same filters, and two guarded updates | `deliverProjectInvitation` (shared with the owner invitation route), only when the client portal is on | (d) for the claim and the read; (c) for the two later updates. Outside this area. |
| `UPDATE owner_requests SET details_json=json_set(... 'uncertain' ...) WHERE id=? AND kind='software' AND status NOT IN ('resolved','withdrawn') AND email<>'' AND clientCopyStatus IS NULL RETURNING id`, and the final `UPDATE ... WHERE ... clientCopyAttemptedAt=?` | `deliverSoftwareBriefCopy` (shared with the owner brief copy route) | (d) for the claim's status filters; (c) for the final update. Outside this area. |

The counters of the audio and software routes are in KV, not SQL; the pass route has no SQL.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in one worktree. No logs retained.

Branch A at `7f335426`:

- `pnpm run format:check`: `Checked 786 files in 149ms. No fixes applied.`
- `pnpm run build`: completed.
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`, run once: `Test Files  310 passed (310)`, `Tests  13187 passed | 1 skipped (13188)`; `git status` clean apart from untracked local files.
- `pnpm run golden:neutral --all e23b7357 HEAD` (the merge base with `origin/main`): NOT NEUTRAL, on purpose, in four fixtures only: `audio-intake` 72 identical, 43 neutral with D1 changes, 13 NOT neutral, 2 added, 2 removed; `software-brief-pass` 39 identical, 4 NOT neutral; `software-brief-suggest` 117 identical, 7 NOT neutral, 1 added; `software-inquiry` 121 identical, 67 neutral with D1 changes, 17 NOT neutral, 2 added, 1 removed; `compared 77 fixtures and 9066 cases; 4 of 77 fixtures differ`. Against A's earlier head `064f0ab9`, only the added captcha case and the two duplicate-race cases (the kept allowance changes their KV digest) differ.
- `pnpm run verify:quint:all`: not run on A (its models are on B).
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm run lint`: no findings (exit 0).
- `pnpm run check`: `0 errors`, `0 warnings`, `17 hints`.

Branch B at `199f90ce` (A's tip `7f335426` merged in, then the conversion and the fixes after review; the checks that read documentation are repeated on the commit that holds this record):

- `pnpm run format:check`: `Checked 808 files in 98ms. No fixes applied.`; `pnpm run build`: completed; the client bundle test: 27 passed.
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`: `Test Files  317 passed (317)`, `Tests  13241 passed | 1 skipped (13242)`; `git status` clean. (An earlier head, `dc8ca827`, had one failing architecture test, the tagged-error field name, fixed there.)
- `pnpm run golden:neutral --all refs/heads/claude/effect-11-intake-fixes HEAD` (exit 0): `audio-intake: 78 identical, 52 neutral with D1 changes, 0 NOT neutral`; `software-inquiry: 114 identical, 93 neutral with D1 changes, 0 NOT neutral`; `compared 77 fixtures and 9071 cases; 2 of 77 fixtures differ`; `golden:neutral: NEUTRAL`. `software-brief-pass` and `software-brief-suggest` are byte-identical to A's. The two fixtures are re-recorded in commits that hold only fixtures (`dc8d1119`, `29dd6530` for the intake store's statements, and `199f90ce` after the last merge of A).
- `pnpm run verify:quint:all`: 77 lines, every one `ok`, including every mutant of the inquiry model (the one for the earlier loser give-back is `LoserGivesBack`).
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- Lint and `check` are re-run on the commit that holds this record: see "Final lines".

2026-11-15, merge with `origin/main` at `e23b7357` (#288, #289, #287, #293): taken on A with no conflict (`064f0ab9`), then into B with no conflict (`1f8ee043`); all 87 golden test files passed on A without a re-record; `golden:neutral --all origin/main HEAD` on A still differs only in the four fixtures of this area (`compared 77 fixtures and 9066 cases; 4 of 77 fixtures differ`); on B, `Test Files  317 passed (317)`, `Tests  13239 passed | 1 skipped (13240)`, `golden:neutral --all refs/heads/claude/effect-11-intake-fixes HEAD`: `golden:neutral: NEUTRAL` (9069 cases, 2 of 77 fixtures differ), `verify:quint:all` 77 lines, every one `ok`; `docs/verification.md` differs from `origin/main` by additions only.

The `pass` signing-failure path has a unit test but no corpus case: `tests/api/brief-suggestion-pass.test.ts` ("answers 500 without a pass when the pass cannot be signed") makes the signature fail, and the golden harness cannot make signing fail.

Limits: no browser run of any form; no real email was sent, so the client copy, the owner notice, the studio invitation and the owner alert are UNVERIFIED in the intended environment. The rate limit store has a read-then-write window (`src/lib/rate-limit.ts`) that this area does not change; the inquiry model keeps the read and the write as two steps.

## STOP items for the owner (not changed; each needs a decision, or a migration)

1. The forms send email to addresses that have not been verified: the client copy of a software brief and the studio invitation of an audio request go to the address typed in the form, as before. Whether to ask for a confirmation first is a product decision.
2. Project creation for an audio request depends on the database trigger `audio_project_after_service_request` (it inserts the project and its audit row when a `service` request is inserted). The converted code relies on it, as the old code did. Moving that to code needs a migration and is not done.
3. The `pass` route has no bound on captcha attempts: an address may ask for a pass as often as it likes (the audio and software routes count attempts; this one never has). A bound is a product decision.
4. Whether the attempt counter is given back when the captcha service is down. Now it is not: the attempt is counted before the captcha is asked and stays counted, so ten outage answers lock an address out for the window. Giving it back is a choice for the owner.

Also: the cleanup of old suggestion budget rows binds its cutoff from TypeScript and decides no answer (see the statement table).

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branches, local changes, scope and rollback confirmed: the website repository; A fixes four API routes; B converts them. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or navigation changed. The visitor-visible change is a status code and, for a captcha outage, the sentence the form shows (the route's existing temporary sentence).

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no markup or style changed. `hallmark audit` not run because no page design changed.

### 4. Performance and resilience

- PASS, 4.2 Client code against the built site: the bundle test passes on both branches.
- UNVERIFIED, 4.4 Async UI recovery: a failure answers with a sentence the form shows while it keeps the input (read, not run in a browser).
- N/A, 4.1, 4.3, 4.5 and 4.6: no image changed; no page measured; no media route changed.

### 5. Forms and sensitive flows

- PASS, 5.1 Server input validation and bounds on branch B: the readers accept and refuse what the earlier validators did (the differential test for `pass` and `suggest`; the corpus for all four).
- PASS, 5.2 Failure paths on branch A: 500 with the fixed sentence for a store or look-up failure, 503 for a captcha outage or a missing binding, 429 for the limits, 409 for a submission id taken by another address; shown by the route tests and the re-recorded corpus.
- UNVERIFIED, 5.4 Delivery of the urgent owner alert and of the notices in the intended environment: the corpus shows each Resend call with its exact body; no real email was sent.
- N/A, 5.3 and 5.5: no new form, and no approval-gated flow touched.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no cookie, analytics, legal text or processor changed. No response or log line carries an error's own text, an email address or an IP address (`logUnexpected` redacts them).

### 7. Release and final QA

- PASS, 7.1 Required checks: the local gates above for each branch.
- UNVERIFIED, 7.2 Review of each pull request head: no pull request exists yet.
- UNVERIFIED, 7.3 Production bindings, secrets and migrations: none changed. The conversion relies on the trigger in STOP item 2, as before.
- PASS, 7.4 Rollback is the previous revision (A: `8b5b4efd`; B: A's tip `7f335426`).
- UNVERIFIED, 7.5 Live verification: nothing is deployed.
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section: the owner center, Access, migrations and payment settings are untouched.

## Delivery status and remaining gates

- Branch A: implemented yes, deployed no, verified live no. Branch B: implemented yes, deployed no, verified live no.
- Independent review of B: made at `ad2cdfd9` (see "Review of branch B"); not repeated on the later heads (UNVERIFIED). The four STOP items need a product decision or a migration and go to the owner.
- UNVERIFIED: live checks after merge: a software brief and an audio request from the live forms (the client copy, the owner notice, the invitation when the portal is on), a captcha outage, a brief suggestion and a pass.

Deployment: the owner's standing instruction is that a complete pull request (CI green, review bots clean, every comment addressed, no new visual or product decision) is merged by the operator, and merging to `main` deploys production. This record authorizes nothing beyond that. It does not certify the checks listed as UNVERIFIED (live verification, the browser check and the delivery of the emails).

## Final lines

On the commit that holds this record: `pnpm run format:check`: `Checked 808 files in 162ms. No fixes applied.`; `pnpm run lint`: no findings (exit 0); `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`; `pnpm run check` (last): `Result (834 files):  - 0 errors - 0 warnings - 17 hints`.
