# Effect stack, the owner brief copy route and the client's copy of a brief: release gate

Two branches are gated: branch A (behavior fixes to the owner's brief copy route) and branch B (the conversion of that route, and of the claim of the client's copy that the public software inquiry also used, to a rule, a store and a flow). Branch B follows the pattern of the public intake record (`docs/prelaunch-qa-2026-11-14-public-intake.md`). This finishes step 8 of `docs/plans/2026-11-effect-conversion.md`.

Date: November 15, 2026
Repository: the personal website repository
Branches: A is `claude/effect-16-brief-copy-fixes`, B is `claude/effect-16-brief-copy`, cut from A and merged with A's later commits (merge commits, no rebase). Cut from `origin/main` at `14cce493`, then merged with `origin/main` at `2f7add57`, and again at `fbfc3e05` (the media conversion, PRs 309 to 311) after the review.
Tips: A is `c342dd8a` (after the review fixes, merged with `origin/main` at `7beca022`). B's code is at `0b2ad2b7` (A merged in, then the conversion of the review items below); the merge conflicts with the media conversion are described under "Merge with the media conversion"; this record is committed after it, in a commit that changes documentation only.
Pull requests: #321 (A) and #322 (B).
Decisions: Kazon Wilson. Implementation was done with Claude Code.
Target: production
Reviews: what independent reviews found, and what was fixed, is under "Review findings".
Rollback revision: for A, `fbfc3e05`; for B, A's tip `c342dd8a`. No deployed revision was observed.

## Scope

One route: `POST /api/owner/requests/[id]/brief-copy` (the owner resends a software brief's copy to the client). The golden fixture is `owner-request-brief-copy`. The public inquiry routes were already converted, but the claim of the client's copy they send when a brief is stored (`deliverSoftwareBriefCopy`, `src/lib/software-brief-copy.ts`) kept its rule in SQL and was shared with this route, so the plan's rule that a converted area calls no unconverted helper that keeps a rule in SQL puts it in this conversion. It is deleted, and both senders use the new flow. The public inquiry's answers are unchanged (see "Public inquiry").

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behavior change in a conversion.
- Owner, 2026-11-14: fix every recorded finding without asking for triage, choosing the cautious behavior; an unexpected database failure answers 500 with the route's fixed sentence; a real lost race stays 409; a deliberate 503 for a missing binding or a known unavailable dependency stays.
- Owner, 2026-11-15: "Effect schema as our only validator no zod use from us" (the route no longer imports Zod; a frozen copy of its schema stays under `tests/fixtures/legacy-validators/` until the last step).
- Judgment calls under those decisions, for the owner to confirm: a refusal by the mail provider, and a provider that does not answer (a 5xx, a timeout, no network), answer 500 with the route's sentence, as the contact route answers a refused email; a deployment with no mail key or address answers 503 (a missing dependency); a request with no id is no such request (404); stored details that are not a JSON object answer 500 and send nothing.

## Fixes on branch A

The sentence of every answer is unchanged; only the status and what the server does changed. The finding that "uncertain" answered `{ok: true}` is among them.

| Case | Before | After |
| --- | --- | --- |
| The provider did not answer (a 5xx, a timeout, no network) | 200 `{ok: true}`, the copy recorded as uncertain | 500 with the route's sentence; the copy is still recorded as uncertain |
| The provider refused the copy | 503 | 500 |
| The request could not be read, the claim could not be written, or a status could not be written | 503, or 200 when the provider had been asked | 500, logged once through `logUnexpected`; the lines the route always logged stay |
| Stored details that are not JSON | 503 | 500 |
| Stored details that are JSON but not an object (`[]`) | the email was sent, and no claim was recorded | 500, nothing sent |
| A request with no id (no param, an empty param) | 503 | 404, as an unknown id |
| No mail key, sender or owner address | 503 | 503 (unchanged) |
| The owner's page after a 500 from this route (`src/scripts/project-invitation.ts`) | the same button stayed on the page and was enabled again; a click answered 409 for 60 seconds, after which the "I checked Resend; retry" button, still on the page, could claim again and send a second copy while the owner had been told the copy was not sent | the page reloads, as after a success, and also when the request gives no readable answer (the fetch fails, or an edge page that is not JSON comes back), so the owner sees the recorded status and only the buttons that status allows; the 500 is unchanged and no wording changed |

Changed corpus cases, from `golden:neutral --all origin/main` against A: `owner-request-brief-copy` has 15 changed cases (the two no-id cases; the provider refusing with 422 and 429; the lookup, the claim and the status writes failing, six cases; stored details not JSON and an array; and three sequences whose first step changed from 503 to 500), 2 removed and 2 added (the two uncertain-provider cases, renamed because they said the route answers ok). Every other fixture of the 77 is identical.

A fix tried and taken back: a guard that refused the claim when the address had changed since the lookup. Nothing changes a request's address except retention, which blanks it, and the claim already refused a blank address, so no state exists that the guard would catch; the two commits that added it and the two that took it back are in the history.

The reload after a 500 is limited to the brief copy buttons. The invitation buttons that share the script were checked and need no change: that route answers 503 when the invitation could not be queued (nothing was sent), 409 for a request it will not queue, and the delivery runs in the background, so no answer of it follows a mail the provider may hold. The plain "Retry brief copy" button shares the brief copy path and reloads too. A request that gives the page no readable answer (the fetch itself fails, or an edge 502 or 504 page that is not JSON comes back) may have reached the server and claimed the copy, so the brief copy buttons reload in that case too; the invitation buttons keep their sentence and no reload. UNVERIFIED in a browser, covered by script tests with a stubbed fetch (`tests/scripts/project-invitation.test.ts`: a reload after 500, after 200, after a failed fetch and after an unreadable answer; none after 409 and 503, and none for the invitation's 500 or failed fetch). The script tests for the reload were written before the change, on A.

## Conversion on branch B

- Input: `src/server/brief-copy-input.ts` reads the body with Effect Schema; a frozen copy of the Zod schema is `tests/fixtures/legacy-validators/brief-copy.ts`, and `tests/server/brief-copy-input.test.ts` holds the reader to it with 3,000 seeded bodies and the bodies that are not objects.
- Rules, `src/server/rules/brief-copy.ts`: `resendCopy` (the owner: the request exists and is a software request, is open, has an address, and has a copy that may be sent again; refusals `NoSuchSoftwareRequest`, `BriefCopyRequestClosed`, `BriefCopyNoAddress`, `BriefCopyNotDue`, the last three with one sentence), `firstCopy` (the public form: only a copy with no status, nothing to do otherwise) and `unclaimedFailure` (a claim that could not be written is recorded only over a copy with no status). Every condition the claim's WHERE clause held is decided here from plain columns.
- Store, `src/server/intake-store.ts`: `readCopyFacts`, `claimCopy`, `recordCopyStatus`, `recordOwnFailure`, `recordUnclaimedFailure`.
- Flow, `src/server/flows/brief-copy.ts`: `resendBriefCopy` (the owner) and `sendFirstBriefCopy` (the public form). The claim is read, judged, and written only while the row is as it was read (status, address and details text); a lost claim reads and is judged again, three tries (`decideAndSave`). The provider is asked only by the sender that won the claim, and the answer is recorded over that sender's own attempt instant. Named failures: `CopyClaimFailed`, `CopyNotRecorded`, `CopyNotBuilt`, with `IntakeReadFailed` and `SaveKeptChanging`.
- Service: `ClientCopyMail` and `liveClientCopyMail` in `src/server/services.ts` wrap `sendAudioMessage`, which is kept (and not `Mail`, whose body serializes its keys in another order, so a changed body would not be neutral). It answers `sent`, `refused`, `uncertain` or `unconfigured` and never fails.
- Route: `runRoute` with `{ route, answer }`; every refusal and failure is mapped with `catchTags`. The public route provides `liveClientCopyMail` instead of `liveBriefCopy`, and the public flow calls `sendFirstBriefCopy`.
- Deleted: `src/lib/software-brief-copy.ts`, the `BriefCopy` service with its error and live function, the route's Zod schema, and the module spy on `softwareBriefEmail` in `tests/api/software-inquiry.test.ts` (replaced by tests of the flow against real SQLite). `briefCopyMessage` (`src/lib/client-emails.ts`) builds the copy.
- Fixed answers: `briefCopyNotSent`, `briefCopyFailed` and `briefCopyUnavailable` in `src/lib/music-request.ts`.
- Model: `verification/brief-copy.qnt`, written before the code (see "Model"). The copy status moves are drawn in `docs/verification.md`.

Shared files changed: `src/server/services.ts` (`BriefCopy`, `BriefCopyFailed` and `liveBriefCopy` removed; `ClientCopyMail` and `liveClientCopyMail` added), `src/server/intake-store.ts` (six functions added), `src/lib/music-request.ts` (three answers), `src/lib/client-emails.ts` (`briefCopyMessage`), `src/lib/owner-model.ts` (a comment edit), `src/server/guarded-save.ts` (`alwaysDecideAndSave` added; `decideAndSave` unchanged and tested as before), `scripts/lib/quint-mutants.mjs` and `tests/scripts/quint-run.test.ts` (a model added), `tests/architecture/legacy-validators.test.ts` (one name). Nothing else in `terms.ts`, `run.ts`, `guarded-save.ts` or `failure.ts` changed.

### SQL statements

| Statement | Class |
| --- | --- |
| `SELECT ... FROM owner_requests WHERE id=?` (`readCopyFacts`; before: the route's lookup) | (a) plain read |
| `UPDATE owner_requests SET details_json=json_set(...'uncertain'...) WHERE id=? AND status=? AND email=? AND details_json=? RETURNING id` (`claimCopy`) | (c) compare-and-set against what was read |
| `UPDATE ... json_set(details_json,'$.clientCopyStatus',?) WHERE id=? AND json_extract(details_json,'$.clientCopyAttemptedAt')=?` (`recordCopyStatus`; unchanged) | (c) compare-and-set on this attempt |
| the same with `'failed'` (`recordOwnFailure`) | (c) |
| `UPDATE ... 'failed' WHERE id=? AND json_extract(details_json,'$.clientCopyStatus') IS NULL` (`recordUnreadFailure`, only for a request that could not be read) | (c) compare-and-set on no status being recorded |
| `UPDATE ... 'failed' WHERE id=? AND details_json=?` (`recordUnclaimedFailure`) | (c) |
| before: `UPDATE ... WHERE id=? AND kind='software' AND status NOT IN (...) AND email<>'' AND (copy status conditions, the hold) RETURNING id` | (d) decided an outcome: now `resendCopy` and `firstCopy` |
| before: `UPDATE ... 'failed' WHERE id=? AND (attemptedAt=? OR status IS NULL)` | (d) in part (`OR status IS NULL`): now `unclaimedFailure` and `recordOwnFailure` |

There is no statement of class (d) left.

### Model

`verification/brief-copy.qnt` applies because the claim became a read followed by a compare-and-set, and two owner clicks, or an owner click and the public form's own copy, can meet at it. Seven properties, eleven mutants (`docs/verification.md`, "The brief-copy model"). It was written before any conversion code; the address and attempt-instant mutants, and the second starting state, were added after review. It runs 100,000 random runs per check (the first version ran 20,000, which no longer finds every mutant once the second starting state and the address step exist). Its checks take at most about 13 seconds each, inside the pooled run's longest check, so the pooled wall time did not change measurably (about 46 seconds against 45).

### Public inquiry

`golden:neutral --all c342dd8a HEAD` (B against A) is NEUTRAL: `owner-request-brief-copy` 24 identical and 41 neutral with D1 changes, `software-inquiry` 138 identical and 69 neutral with D1 changes, every other fixture identical. The public inquiry's answers, effects, console lines and database states are the same; its D1 statements for the copy changed, which is why its fixture was re-recorded in a commit of fixture files only. The corpus test files were edited only in two comment lines of `tests/golden/owner-request-brief-copy.test.ts`, which now name the brief copy flow instead of the deleted helper; no case, step or assertion changed, and the injection patterns of both corpora still match the new statements.

### Differences outside the corpus

- A claim lost to another sender reads and is judged again (three tries), as the plan requires; the old single statement judged the current row at the same moment, so for one request nothing observable differs except that the copy is built from the row as it is then.
- A claim whose write committed but reported an error stays recorded as uncertain; before, the failure record matched that attempt's instant and wrote failed.
- An attempt time that is not text holds an uncertain copy (the old comparison would have let a number through); only this site writes that key, as text.
- A failed read for the public form's copy answers `failed` and records a failure over a copy with no status, as a claim that cannot be written does on A (before, no read happened). The write holds only while no status is recorded.
- A claim that was lost three times in a row to unrelated edits of the details now answers 409 to the owner ("cannot be sent again here"), or nothing sent (null) to the public form; the old single statement judged the current row at the same moment and would have claimed.
- The public route's end-to-end "copy cannot be built" case was dropped; the flow tests (`tests/flows/brief-copy-stories.test.ts`, `tests/flows/software-inquiry-stories.test.ts`) cover it.
- A brief whose copy cannot be built is a named failure after a failure is recorded over the attempt, as before; a test pins it on both branches.

## Merge with the media conversion

After the review, `origin/main` gained the media conversion and its shared `loggedAnswer(route, answer)` in `src/server/answers.ts`. A took it with no conflicts and no corpus change. Merging A into B conflicted in two files:

- `src/pages/api/software-inquiry.ts`: main's route keeps one module-level `failed = loggedAnswer(ROUTE, ...)`; A's side still named a `BriefCopyFailed` tag that B's flow no longer raises. The merge keeps main's helper and its `(failure) => failed(failure.failure)` mapping for `RateLimitStoreFailed`, and drops the `BriefCopyFailed` line.
- `docs/plans/2026-11-effect-conversion.md`: both sides edited the "Converted" and "Not converted" lines. The merge keeps main's media text and this branch's step 8 status in one line, and the counts are main's minus this branch's one route and one Zod file (31 route files, 27 files under `src/` that use Zod, 26 of which import `zod` or `astro/zod`; checked against a fresh count).

The owner brief copy route now uses the shared helper (`const failed = loggedAnswer(ROUTE, briefCopyFailed)`, each failure tag mapped with `(failure) => failed(failure.failure)`) in place of its own local helper. Its answers and logs are the same, so the corpus is unchanged. The sentences of `docs/verification.md` on `origin/main` are all kept.

## Review findings

Independent reviews of the work found the following. Each is fixed; the later heads were checked by the tests and runs under "Evidence".

- After a 500 for an uncertain copy, and after a request that gave the page no readable answer (the fetch failed, or an edge page that is not JSON came back), the page could send a second copy of an already delivered email. Fixed on A: the brief copy buttons reload the page in both cases (see the last row of the fix table), with script tests for each and for the invitation button, which keeps its behaviour.
- A request that is not a software request, with stored details that are JSON but not an object, answered 404 on A and 500 on B, because the store's object check ran before the rule's kind check. Fixed on B: the details check is now a named refusal of the rules, ordered after the kind check, and the test pins 404 on both.
- A failed read for the public form's copy recorded nothing, so the owner's page did not offer "Retry brief copy", where A records a failure over a copy with no status. Fixed on B: the failure is decided by `unclaimedFailure` and written by a guarded store function that holds only while no status is recorded. A corpus case for it cannot be neutral (the injected failure hits an UPDATE on A and a SELECT on B, and the corpus records which), so flow tests pin it, with the existing corpus case "the copy claim throws" pinning A.
- The store decided that details which are not an object are an error. Moved into the rules, as above, and the store read is plain.
- The owner's flow ended in an unreachable refusal ("not due") to satisfy the types. Removed: the owner's claim goes through `alwaysDecideAndSave`, which answers the write the rule made, with no "nothing to do" branch.
- The model did not cover the address or the attempt instant the claim re-checks. Added, each with a mutant that breaks a named property, and the model now also starts from a copy left uncertain by an earlier attempt.
- The record named two different revisions as the one B was compared against, did not name its pull requests, left out a shared comment edit, and described how review was organised; corrected.
- The record said the corpus test files were not edited; two comment lines were changed (stated above). It also left out a claim lost three times to unrelated edits and the dropped public end-to-end case (stated above).

## Evidence

Run on the final tips, after `origin/main` at `7beca022` was merged in.

Branch A at `c342dd8a`:
- `format:check`: `Checked 882 files in 116ms. No fixes applied.`; `lint`: no findings; `build`: `[build] Complete!`; `REQUIRE_CLIENT_BUNDLE=1 ... client-bundle.test.ts`: `Tests  27 passed (27)`.
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`: `Test Files  340 passed (340)`, `Tests  13823 passed | 1 skipped (13824)`; `git status` clean apart from `.jolli/`. One earlier run failed a timing test of another area (`tests/api/studio-signin-noninterference.test.ts`, a request racing the clock) while the machine was busy; it passed alone and in the run above.
- `golden:neutral --all origin/main`: `compared 80 fixtures and 9329 cases; 1 of 80 fixtures differ`, `golden:neutral: NOT NEUTRAL` (the cases above, expected; only `owner-request-brief-copy` differs).
- `verify:quint:all`: exit 0, 94 `ok` lines. `publicist:gate`: `publicist-gate passed: 84 entries checked.` `check`: `0 errors`, `0 warnings`, `16 hints`.

Branch B at `0b2ad2b7`:
- `format:check`: `Checked 889 files`, no fixes applied; `lint`: no findings; `build`: `[build] Complete!`; client bundle test: `Tests  27 passed (27)`.
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`: `Test Files  344 passed (344)`, `Tests  13966 passed | 1 skipped (13967)`; `git status` clean apart from `.jolli/`.
- `golden:neutral --all c342dd8a HEAD`: `compared 80 fixtures and 9331 cases; 2 of 80 fixtures differ`, `golden:neutral: NEUTRAL` (`owner-request-brief-copy` 24 identical and 41 neutral with D1 changes; `software-inquiry` 138 identical and 69 neutral with D1 changes).
- `verify:quint:all`: exit 0, 106 `ok` lines (the eleven mutants of the brief copy model break their properties). `publicist:gate`: `publicist-gate passed: 84 entries checked.` `check`: `0 errors`, `0 warnings`, `16 hints`.

UNVERIFIED: the owner page in a browser (the reload after a 500 was driven only with a stubbed fetch); delivery through the real mail provider (the corpus shows each Resend call with its exact body; no real email was sent); the exhaustive Apalache run (the model has none).
