# Effect stack, agreement access: the archive link and the signed-copy downloads (release gate)

Two branches are gated: branch A (behavior fixes to the three routes, merged into B) and branch B (the conversion of the three routes to rules, stores, flows and services). Branch B copies the pilot's shape (`docs/prelaunch-qa-2026-11-14-music-area.md`).

Date: November 15, 2026
Repository: the personal website repository
Routes: `POST /api/agreements/link` (a client asks for a link to their signed agreements by email), `GET /api/agreements/[id]/file` (download of a signed copy by a verified visitor), `GET /api/agreements/attachments/[id]` (download of an attachment of the offer a signing session is signing).
Branches: A is `claude/effect-13-agreement-access-fixes`; B is `claude/effect-13-agreement-access`, cut from A and merged with A's tip (the merge commit is on B). Both have taken `origin/main` (the merge commits are on A and on B). Nothing is pushed.
AI assistance: the code on both branches was written with AI assistance (Claude Code), tests first. The owner reviews the pull request.
Rollback revision: A's parent on `origin/main` before this merge was `3561a541`; for A, the `origin/main` revision it merged; for B, A's tip.

## Review findings fixed on B

An independent review of the first version of B found no authorization or non-disclosure bug and no difference in behavior, and found the conversion incomplete against the rules. Each finding is fixed on B:

- Decisions still in SQL: the executed status, the greeting pick (`ORDER BY ... LIMIT 1`), the older-link filter, the session expiry and revocation, the executed-and-open filter, the ready status, the attachment pin (`json_each`), and the shared session read. They are rules now.
- The cooldown and the link batch's guard were not judged from a read; they now run through `decideAndSave` with the guard as the write-time re-check.
- Allowance limits, the 30 second window and the one hour lifetime sat in the flow; they are constants and rules in `src/server/rules/agreement-link.ts`.
- Store failures were `orDie` defects and four calls used `Effect.promise`; they are named failures mapped by each route.
- Non-null assertions in the routes and the flows are removed.
- Unreachable branches (the archive branch of `issueAgreementLink`, the visitor branch of `agreementDownload`, the old archive mail wording) and the guard module that only they needed are deleted; `isCanonicalRequest` duplicated `canonicalAgreementRequest`.
- A studio session with an empty email answered 401 where branch A went on; the rule now treats the session as present.
- The Quint model took the redeem as one step and let no agreement change between the lookup and the batch; it now models both as reads followed by guarded writes.

## Further findings fixed on branch B

Independent reviews found no authorization or non-disclosure regression and no decision left in SQL in the converted code. Each finding is fixed on B. First review:

- The Quint model's flags were set from the same condition as the guards they checked, so the properties held by construction; they are now invariants over the stored links and the redeem record.
- The model shared one try counter between the cooldown and link loops and let a cooldown retry take a new instant; each loop has its own counter and a retry keeps its first instant.
- The attachment route's comparison test compared two identical worlds; it now compares an unknown id with another client's pinned attachment, and the studio pair includes a project for the other client's request. Each fails under a temporary mutation that reads by the looked-up row.
- A retry of the link batch read the clock again and could issue a link where branch A answered 429; the first instant is kept across retries, with a flow test on the real schema.
- The attachment pin reader parsed stored details differently from SQLite in inputs no writer produces; it now serves only the exact stored shape (see Scope).
- The offer link route did not answer a tokenless or empty-token request as branch A did; it does now.
- Seven failures carried a field the pilot's has none of; the rule in the Back-end rules is that a failure carries its cause only when the route logs it once (all seven do now; see the last finding).
- The two download routes copied their fixed answers; the plain text answer is `agreementText` next to `agreementJson` in `src/lib/agreement-access.ts`, and the logged failure answer is `loggedAnswer` in `src/server/agreement-answers.ts`, used by all three routes.
- This record: the branch A recogniser move, the head the figures belong to, the `issuedStillExecuted` reasoning, the allowance prune's class, and process wording.

Second review:

- The Back-end rules said a store failure has no fields and, in the next sentence, that a failure carries its cause in a field; the rule now reads: no fields unless the route must log the cause.
- The link flow's header comment said the clock is read once per attempt; it reads it once and keeps it.
- Replacing the cooldown's compare-and-set check, or either kept instant, with a fresh one left every model property passing; three properties (`oneCooldownPerWindow`, `lostCooldownNeverTakes`, `lostGuardNeverStores`) and three mutants now observe them.
- The executed-agreement property copied the lookup's own flag; it now reads the real state (only an address that started with an executed agreement has a link).
- The pin reader's comment said a JSON5 spelling is refused as unpinned; it gets the fixed 500 as text that is not JSON, and SQLite 3.42 and later read JSON5 (see Scope).
- `agreementText` is a plain response factory and moved next to `agreementJson`; the record said the answers file was shared by the two download routes only.

Third review:

- An earlier commit deleted about sixty lines of `docs/verification.md` (the discount model's text, the whole music-playback section and the agreement-link heading); the file is restored from `origin/main` and differs from it only by the agreement-link section.
- Two model properties (`cooldownInstantKept`, `linkInstantKept`) held by construction, since the value and its record were written by the same expression; they are replaced by behavior checks (a request that lost its compare-and-set or guard never takes a cooldown or stores a link) that the real model passes and `RetryNewCool` and `RetryNewAt` each break alone.
- The driver listed `agreementLink` for the exhaustive run but the model had no `stepOrEnd`; it has one now, and the run's result is in `docs/verification.md`.
- The record named the wrong file for the routes' fixed answers and did not say that the `RetryNewAt` search leaves out redeems and the agreement ending.
- The executed-agreement property's description said "has an executed agreement"; it means "started with one".
- The pin reader's comment did not say that SQLite 3.42 and later read JSON5, so branch A may have served where B answers 500 for an input no writer produces.
- A test was titled "four models" and checked five, and another asserted at least four properties for seven; the title and the exact count are fixed.

Pull request review:

- A throwing bucket read on a visitor's signed-copy download answered the fixed 500 before anything logged it, so a storage outage left no diagnostic. Branch A now lets it reach the route, which logs it once through `logUnexpected` and answers the same 500 (one added console line in one corpus case); B's `CopyReadFailed` carries the failure again and the route logs it the same way.

## Scope

Branch A, behavior fixes (each with its failing corpus case or test, then a fixture-only re-record):

1. A verified visitor's download of a signed copy: the reads run in one fixed order, whatever the id. Before, a studio session's project lookup ran only when the agreement existed, and the reuse check ran only for a signing session of another offer, so an unknown id and someone else's agreement differed in the statements they ran. Now the same statements run. Statements and answers are otherwise unchanged; the recorded effects show the extra reads.
2. A missing stored object answers 404 "Not found" (it answered 503 "Unavailable"). This is the not-found answer an unknown id gets, so a verified visitor cannot tell the two apart. It is a change of answer; see Judgment calls.
3. A failed bucket read (it threw) and a failed database read answer 500 with the route's existing sentence (file: "Signed copy unavailable. Contact Kazon."; attachment: "Unavailable"), logged once through `logUnexpected`. They used to be uncaught, so Astro answered a bare 500.
4. Attachment: a missing bucket binding and a missing database binding answer 503 with the agreement headers before any read. The 404 answers carry the agreement headers.
5. Archive link: an unexpected failure (a database, allowance or mail call that threw) answers 500 with the route's sentence "Agreement sign-in is temporarily unavailable.", logged through `logUnexpected` without the error's text. It answered 503.
6. Archive link: a failed link batch answers 429 "Wait at least 30 seconds before requesting another link." only when the guard itself raised. Any other batch failure answers 500. Branch A moved the guard recogniser into `src/lib/guard-error.ts` (`586cb09b`) because the archive branch of `issueAgreementLink` needed it; branch B deletes that branch and moves the recogniser back into `src/server/guarded-save.ts`, so `guard-error.ts` is gone on B. The signing path (the offer route) is unchanged.
7. Archive link: a code key under 32 characters answers the same 503 as a missing key, before any read. This applies to the archive path only. Applying it to the signing path would change the offer link corpus (cases "a code key under 32 characters (json)" and "(form)" in `tests/golden/offer-link.test.ts`: the signing settings read and the offer read would no longer run), so it is left for the offer area to decide.
8. `agreementJson` takes a typed body (`{ ok: boolean }`) in place of `unknown`. Type only; it clears the Oxlint finding at `src/lib/agreement-access.ts`.

Branch B, the conversion:

- The archive link's body is read by an Effect Schema reader (`src/server/agreement-input.ts`). The frozen Zod copy is `tests/fixtures/legacy-validators/agreement-link.ts`; `tests/server/agreement-link-input.test.ts` runs 2000 seeded bodies (plus non-object bodies) through both and holds them to the same accept and refuse, and to the same values when accepted. The architecture test that counts the frozen copies now counts seven.
- Rules (pure, each built with `rule` or `alwaysWrites`, each branch tested in `tests/rules/`): `src/server/rules/agreement-link.ts` (the allowances, the cooldown, "nothing to do or issue" with the 30 second guard, the greeting name, the older links to consume, what follows the mail, the mail words, the settings), `agreement-session.ts` (which sessions count), `agreement-download.ts` (who may download a signed copy, which copy is ready and intact), `agreement-attachment.ts` (which attachment a signing session may download, from the offer's stored details read by an Effect Schema reader in `src/server/agreement-input.ts`).
- The attachment pin is stricter than the SQL it replaces, on purpose and only for inputs no writer produces. The reader serves only the exact shape the two writers store (`JSON.stringify` of details whose `attachments` the parser checked): a plain object with a list of attachment objects, written compactly. A duplicate key (SQLite reads the first, JavaScript the last), another spelling, odd spacing, an entry that is not an object, a non-text key or digest, attachments that are not a list, and details written as text all pin nothing and answer the 404 of an unpinned attachment. Text that is not JSON (a JSON5 spelling included) answers the fixed 500. SQLite 3.42 and later read JSON5, so branch A may have served an attachment from such details where B answers 500; the SQLite version D1 runs was not checked, and no writer produces such text, so B is stricter only for an unreachable input. Otherwise B never serves an attachment where A refused.
- The offer link route answers a request with no token or an empty one as the archive path did before it was removed: 404 for another host, 503 for a missing binding or a code key under 32 characters, then the 400 for the missing recipient (`tests/server/offer-link-no-token.test.ts`).
- Stores: `src/server/agreement-store.ts` (plain reads, read through Effect Schema readers; compare-and-set writes). Flows: `src/server/flows/agreement-link.ts`, `agreement-session.ts`, `agreement-download.ts`, `agreement-attachment.ts`. Routes are thin, on `runRoute(services, program, { route, answer })`, with every typed failure mapped by `catchTags`.
- Services: `src/server/agreement-services.ts` (`AgreementMail`, `AgreementAllowance`), added to `src/server/services.ts`'s `Turnstile` and `MusicDb`/`AudioBucket` as before. Outside calls that reject are named failures (`AgreementStoreFailed`, `AgreementAllowanceFailed`, `AgreementMailFailed`, `HashFailed`); each route maps them with `catchTags`, logs the failure through `logUnexpected` and answers its fixed sentence. Seven failures carry their cause in a field named `failure` (`AgreementStoreFailed`, `AgreementAllowanceFailed`, `AgreementMailFailed`, `HashFailed`, `CopyReadFailed`, `CopyBytesFailed`, `AttachmentReadFailed`), unlike the pilot's field-less store failure, because branch A logged each of those failures and the corpus records the log line, which the conversion must not change; the route logs each once through `logUnexpected`. Branch A first let a throwing bucket read on the file route answer 500 with no log line, then logged it (see the last finding); B logs it the same way. The Back-end rules in `CLAUDE.md` and `AGENTS.md` say it in one sentence: a failure carries its cause only when the route must log it. The plain answers are `agreementJson` and `agreementText` in `src/lib/agreement-access.ts`; `src/server/agreement-answers.ts` holds only `loggedAnswer`, the answer to a failure the route logs.
- The route-level non-interference test is `tests/server/agreement-download-routes.test.ts`. It checks the status, headers, body and the sequence of statements (query and arguments, with clock readings normalised) and bucket calls for an unknown id and for another client's agreement, a signing session's other offer, and a studio project's agreement; and for the attachment route, an unknown attachment and another request's.
- The Quint model is `verification/agreement-link.qnt` (issue: the cooldown and the link batch as reads followed by guarded writes with a bounded retry; redeem: a read, then a guarded batch). Eight mutants; each breaks the property named for it (`scripts/lib/quint-mutants.mjs`). `docs/verification.md` has its section, including the finding below.
- `src/lib/agreement-download.ts` keeps only the owner's download (the owner area's); `issueAgreementLink` in `src/lib/agreement-access.ts` keeps only the signing path (the offer area's). The shared `agreementSession` stays for the offer routes; the three routes use a plain-read variant (`visitorSession`) decided by rules. The studio list `clientSoftwareProjectsForSession` is no longer read by these routes: the file route reads the studio visitor's projects as plain columns and the rule filters them.
- Real-SQLite cases in `tests/lib/software-agreements.test.ts` and `tests/security/rate-order.test.ts` that drove the deleted archive branches now drive the archive link and download flows against the real schema.

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behavior change in a conversion.
- Owner, 2026-11-14: an unexpected database error answers 500 with the route's fixed sentence; a real lost race or stale version stays 409; a deliberate 503 for a missing binding or a known unavailable dependency stays.
- Judgment calls made in this work, for the owner to confirm: (a) a missing stored object answers 404, as for an unknown id (before it was 503); (b) the 500 answers reuse each route's existing sentence, so no new copy was written; (c) the archive link's code-key check is archive-only, for the reason in item 7; (d) the attachment's 404s now carry the agreement headers; (e) a bucket read that throws is logged once through `logUnexpected` on both download routes; (f) the seven named failures that branch A logs carry their failure so the log line is unchanged; (g) a stored offer whose details are not JSON (a JSON5 spelling included, which A's SQLite may have read; D1's version not checked, and no writer produces it) answers the attachment route's fixed 500, and only for an attachment of the offer's own request, as the SQL it replaces did for text it could not parse; (h) the greeting takes the first of two equally recent signatures.

## Stop items for the owner (not fixed)

- The link request does not yet answer identically for every address; a fix needs an owner decision about a new email.
- A terminated agreement stays downloadable.
- After the mail is sent, a failed update answers 500 although the mail arrived; the link in the mail still works.
- A link can be issued for an agreement that stopped being executed after the lookup (the model's `issuedStillExecuted`, not in `allProperties`). Retention can delete an executed agreement (`src/lib/agreement-retention.ts`), and the lookup does not look at `archive_closed_at`. The effect is harmless and identical to branch A: the link is mailed, and the session it opens finds no agreement to show.
- `src/lib/audio-client-access.ts` `normalizeClientEmail` still reads with Zod. It is shared with the studio routes and the archive link calls it, so Zod stays in that one function until the studio area converts.
- `src/lib/agreement-request.ts` and `agreementJson` stay shared with the offer and owner routes; `agreementSession` and `issueAgreementLink` stay for the offer routes.

## Statement classes (the SQL of the three routes)

Classes: (a) plain read, (b) write guarded by a key or a constraint, (c) compare-and-set write, (d) decides an outcome. No statement of the three routes is class (d). The statements of the shared helpers the routes call are listed with their owner.

| Statement | Where | Class |
|---|---|---|
| allowance prune `DELETE FROM audio_client_allowances WHERE window_start<=?` | `reserveStudioAllowance` (`src/lib/audio-client-access.ts`, shared studio code) | (d): the time condition chooses which rows go; left for the studio area |
| allowance counter upsert `ON CONFLICT ... uses=uses+1 RETURNING` | `reserveStudioAllowance` (the limit is judged in TypeScript) | (b), left for the studio area |
| cooldown row read `SELECT window_start FROM audio_client_allowances WHERE key=?` | `readCooldown` | (a) |
| cooldown upsert `... ON CONFLICT(key) DO UPDATE ... WHERE window_start<=? RETURNING key` | `saveCooldown` (the rule judged the same condition from the read) | (c) |
| the address's agreement statuses and its archive links, one batch | `readLinkFacts` | (a) |
| link batch guard `SELECT CASE WHEN NOT EXISTS(...) ... json_extract(...)` | `storeArchiveLink` (write-time re-check of the rule's 30 second judgment) | (c) |
| link insert, issue event | `storeArchiveLink`, inside the guarded batch | (b) |
| the address's signatures with their agreement status | `readSignatures` | (a) |
| `UPDATE software_agreement_links SET used_at=? WHERE id=?` | `markLinkUsed` | (b) keyed |
| the address's archive links, read again after the mail | `readArchiveLinks` | (a) |
| `UPDATE ... SET used_at=? WHERE id IN (SELECT value FROM json_each(?)) AND used_at IS NULL` (the ids the rule chose) | `consumeLinks` | (c) |
| session by token hash and purpose | `readSession` | (a) |
| the offer, its link and its brief for a signing session | `readSigningOffer` | (a) |
| studio session by token hash | `readStudioSession` | (a) |
| the agreement with this id (any status), the offer's reused master agreement, and for a studio session its projects with their briefs and linked master agreements, one batch | `readDownloadFacts` | (a) |
| the signed copy row of an agreement | `readSignedCopy` | (a) |
| the attachment with this id and the offer's request and stored details, one batch | `readAttachmentFacts` | (a) |
| the same session read, with `expires_at>?` and `revoked_at IS NULL`, and the live-offer check | `agreementSession` (`src/lib/agreement-access.ts`), reached by none of the three routes now; the offer routes still use it | (d), left for the offer area |
| executed agreement for the owner's download `status='executed' AND archive_closed_at IS NULL`, and `status='ready'` | `agreementDownload` (owner route) | (d), left for the owner area |

## Verification

Oxlint reports no findings on either branch (`oxlint --deny-warnings`, zero). Results are recorded under Evidence.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in the agreement worktree. Logs are not retained.

Branch A tip `d40036e5` (it merges `origin/main` at `8b5b4efd`, golden format 5; the three area fixtures were re-recorded in a fixture-only commit):

- `pnpm run format:check`: "Checked 783 files ... No fixes applied". `pnpm run build`: complete. Client bundle test: 27 passed.
- Full `pnpm test` with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1`: 308 files passed; 13074 tests passed, 1 skipped (13075); the tree is clean afterwards.
- `golden:neutral --all origin/main HEAD`: "compared 77 fixtures and 9038 cases; 3 of 77 fixtures differ" (the file, attachment and link corpora) and "NOT NEUTRAL", as expected.
- `verify:quint:all`: exit 0, no failed check. `publicist:gate`: "publicist-gate passed: 84 entries checked."
- `pnpm run lint`: no findings. `pnpm run check`: "Result (809 files)", 0 errors, 0 warnings, 17 hints.

Branch B head `3fa3a25d` (the figures below were measured on it; this record is the commit after it; it merges A's tip `d40036e5`):

- `pnpm run format:check`: "Checked 802 files ... No fixes applied". `pnpm run build`: complete. Client bundle test: 27 passed.
- Full `pnpm test` with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1`: 315 files passed; 13188 tests passed, 1 skipped (13189); the tree is clean afterwards.
- `golden:neutral --all refs/heads/claude/effect-13-agreement-access-fixes HEAD`: "compared 77 fixtures and 9038 cases; 3 of 77 fixtures differ" and "golden:neutral: NEUTRAL". Statements changed; answers, stored rows and every other effect did not.
- `verify:quint:all`: exit 0, 73 checks ok and none failed, including `agreementLink` (6.6 s) and its eight mutants, each found at 20,000 random runs on seeds 0x1 to 0x7 (the search for `RetryNewAt` leaves out the redeems and the agreement ending, which cannot take part in it; the unmutated model's check is never narrowed). `verify:quint:exhaustive`: the five exhaustive modules (from four model files; `signin` has none) keep every property in every order up to 7 steps, `agreementLink` included (about twelve seconds for it); 7 steps reaches only the `NoLookup` and `NoCas` mutants, and the other cases are covered by the random runs. `publicist:gate`: "publicist-gate passed: 84 entries checked." `publicist:sync --check`: "AGENTS.md publicist block already in sync."
- `pnpm run lint`: no findings. `pnpm run check`: "Result (828 files)", 0 errors, 0 warnings, 16 hints.

The one skipped test is "renders the real v1 agreements and embeds exact signing evidence" in `tests/lib/agreement-pdf.test.ts`. It is gated on the private file `.private/signing/templates.json`, which is absent here. UNVERIFIED for the private templates. The template test in `tests/lib/software-agreements.test.ts` returns without checking when `AGREEMENT_PRIVATE_TEMPLATES` is unset, so it passes without checking anything. UNVERIFIED.

The corpus cases that name statements (the injected failures and one interleave) were pointed at the new statements in a separate commit before the fixtures were re-recorded in a fixture-only commit. The case "no token in the params takes the archive path and has no email" in the offer link corpus keeps its name, and its fixture is unchanged: the route now answers that request itself (see Scope). UNVERIFIED in production: nothing was deployed.

## Checklist

- Visitor downloads: the reads do not depend on the id (`tests/server/agreement-download-routes.test.ts`, now with studio projects and the attachment's arguments and headers).
- Link: the cooldown, the lookup and the guarded batch run in the same order as before (the corpus is neutral); the clock is read where it was.
- Errors: every unexpected failure is 500 with a fixed sentence, logged without its text; the only 503s are missing bindings and the signed copy's integrity failure.
- Input: the archive link body is read by Effect Schema, and the differential test holds it to the Zod copy.
- Rules: every decision of the three routes is a rule with a test per branch; no statement of the routes decides an outcome.

## Follow-up

- The offer routes' `agreementSession` and the owner download's statements (class (d) above) move into rules when those areas convert.
