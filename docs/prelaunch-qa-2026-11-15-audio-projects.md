# Effect stack, audio projects: the owner and studio project routes (release gate)

The area is delivered as a stack: a bottom layer that changes how the golden corpus counts a database counter, and three conversion layers, each converting whole routes, standing alone and neutral against the layer below. This record covers the whole stack. The design is `docs/plans/2026-11-audio-projects-conversion.md` (merged first, with its three Quint models), and the behaviour fixes F1 to F5 of its section 7 merged before the conversion. The conversion copies the pilot's shape (`docs/prelaunch-qa-2026-11-14-music-area.md`).

Date: November 15, 2026 (the last layer finished November 22, 2026)
Repository: the personal website repository
Routes: the owner's project routes `messages`, `uploads` (POST and PUT), `files/[fileId]`, `access`, `invitation` and `updates`, and the studio's project routes `messages` and `files/[fileId]` (GET and HEAD).
Branches, each cut from the one before (heads at the last review round; the record's own commit follows the top head):

- bottom layer `claude/golden-sqlite-sequence`: PR 343, merged to `main` on 2026-11-16 at head `6e02b72f` (merge commit `51cbc017`). A counter row at 0 is no state in the golden digests, every golden fixture was re-recorded under that rule, and a proof script shows the re-record changed only digests. It is merged, so the open stack starts on `main`.
- layer 1 `claude/effect-15-audio-projects-messages`: PR 344, now targeting `main`, head `52242c3b`. The two messages routes, and the area's store, answers and input readers.
- layer 2 `claude/effect-15-audio-projects-files`: PR 364, head `b7acdb2d`. The uploads route, the owner file route and the studio file route, and the project and file machines.
- layer 3 `claude/effect-15-audio-projects`: PR 365, head `81b784be`. The access, invitation and updates routes, the notices, and the studio sign-in store's three statements.

AI assistance: the code on every branch was written with AI assistance, tests first. The owner reviews the pull requests.

## Design note

The design was reviewed before any conversion code, as the plan asks: three XState diagrams (the project's stage, a file's status, a notice's delivery) and three Quint models (`verification/audio-project-messages.qnt`, `audio-project-files.qnt`, `audio-project-notices.qnt`) whose mutants each break one property. The machines are written in `src/server/machines/`: `audio-project.ts` and `project-file.ts` in layer 2, `project-notice.ts` in layer 3 (and the note and date moves of the project machine). Every `IN (...)` list of a statement's compare-and-set guard comes from a machine through `sourcesOf`, and a test holds each list to its machine.

## Scope

Layer 1: `src/pages/api/owner/projects/[id]/messages.ts` and `src/pages/api/studio/projects/[id]/messages.ts`, `src/server/audio-project-store.ts` (created), `src/lib/audio-project-answers.ts` (created), `src/server/audio-project-input.ts` (created), `src/server/rules/audio-project-messages.ts` and `flows/audio-project-messages.ts`.

Layer 2: `uploads.ts`, `files/[fileId].ts` (owner) and `files/[fileId].ts` (studio). Rules: `audio-project-files.ts`, `audio-project-uploads.ts`, `studio-project-file.ts`. Flows: `audio-project-files.ts` (publish and revoke), `audio-project-uploads.ts` (start, put, complete, recover, abort), `studio-project-file.ts`. The store gains the file, upload and R2 object functions. A file's publish and revoke start the client's notice through `src/server/flows/audio-project-notices.ts` (layer 3).

Layer 3: `access.ts`, `invitation.ts` and `updates.ts`. Rules: `audio-project-access.ts`, `audio-project-notices.ts`, `audio-project-updates.ts`. Flows: `audio-project-access.ts`, `audio-project-notices.ts`, `audio-project-updates.ts`. `src/server/studio-signin-store.ts` holds the three statements that close a client's sign-in (`endClientSessions`, `deleteClientSigninCodes`, `deleteRetiredClientCodes`); the studio sign-in area's conversion has not reached `main`, so this layer created the file with only those three functions, as the design says. One new service, `StudioNoticeMail`, wraps the studio notice email; the public intake's `ProjectInvitation.deliver` is now the invitation delivery flow and still fails with `ProjectInvitationFailed`.

What stays outside, because code outside the area calls it: `listProjectMessages`, `revisionRoundsLeft`, `latestReviewDecision` and `REVISION_ROUNDS`, `clientProjectFiles`, `listProjectUpdates`, `defaultFirstUpdate`, `validateProjectMessage`, `readBodyWithin`, `privateProjectObjectKey`, the part size constants and `expectedPartLength`, `ProjectInvitation` and `ProjectUpdate` as types, `deleteRetiredCodes` (the owner's request status routes call it), `studioSessionFromRequest`, and `audio-project-next-step.ts`.

Deleted: the writers the routes called in `audio-project-messages.ts`, `audio-project-publishing.ts`, `audio-project-revocation.ts`, the uploads, file read and stream code of `audio-project-uploads.ts` and `audio-project-files.ts`, the invitation's delivery and queue, and the update saving, delivery and queue of `audio-project-updates.ts`, with the tests that only covered them (replaced by flow stories against the real schema).

## Input

Effect Schema readers in `src/server/audio-project-input.ts` for every body: the two message commands, the four uploads commands, the part's query, the two file commands, the access command, the invitation command and the seven update commands. Frozen Zod 4 copies are under `tests/fixtures/legacy-validators/` (`audio-project-messages.ts`, `audio-project-files.ts`, `audio-project-updates.ts`), and `tests/server/audio-project-input-differential.test.ts` holds each reader to its copy with seeded random inputs and the fixed inputs the design names: `11111111-1111-1111-1111-111111111111` and `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF` as upload ids are refused, an empty or missing `part` reads as 0. The upload id check is Zod 4's own pattern, written out. No converted route imports Zod.

## Statement classes

After the conversion no statement of the area decides an outcome. Every read is a plain read of columns (a join by key at most); every write is guarded by a key or is a compare-and-set that keeps today's conditions (the project open, the stage the machine lists, the `updated_at` that was read, the request's status, the payments, the count under the cap, a published review or final where a corpus race needs it). Three guards raise and are decided again on fresh facts: the live review files a publish replaces, the stage and other published files a file revoke resets from, and (in each) a unique violation a rule's facts depend on; every other lost guard is its named refusal and is not retried. The statements of the design's section 4 map one to one onto store functions.

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behaviour change in a conversion.
- Owner, 2026-11-14: an unexpected store failure answers 500 with the route's fixed sentence, a lost race is 409, 503 is for a missing binding or a known unavailable dependency.
- Owner, 2026-11-15 (recorded in the plan): no Zod in our code at the end.
- Owner, 2026-11-15: asked who may write the code of this conversion in this repository, the owner delegated the choice ("You decide"), and the conversion was written under that delegation.
- Owner decision, 2026-11-22: a failed file revoke has its own sentence, "The file could not be revoked. Please try again." (status 500). A failed publish keeps its sentence.

## Differences from today's answers

- A client's message and a client's answer read the rate count with the action's facts before the write, where today only a refused write reaches that read. A failing count statement therefore answers 500 with the route's sentence, logged once, for a request that today would have been saved. The design names this change (sections 2 and 7), the stories and `tests/api/audio-project-outages.test.ts` pin it, and the order of the reads is not changed.
- When the retries of a publish or a file revoke run out (three reads each moved the facts), the answer is 409 with the route's existing sentence; today's code never retries.

What the conversion keeps equal to today's on purpose: the project's stage a client's message or answer is decided from is read in the batch just before the decision (so an owner's move between the client's lookup and the decision is seen, as the write's guard sees it today), a publish judges the project from facts read after the object's head (as the write's own conditions were evaluated then), the read mark reads the clock once after the lookup, and a client's send or answer reads it once for its facts and its write, so the rule's count and the guard's count use one window (the recount after a refused write reads it afresh).

## Judgment calls (mine, for the owner to confirm)

- The claim of a notice is the first call of its delivery, with no read and no rule ahead of it. The design's section 3 has a read and a rule before the claim; a read ahead of it adds a turn, and the public intake's background then sends the owner's notice before the invitation's claim is written, which the intake corpus records (the state at the first Resend call differed). The claim keeps today's conditions as its compare-and-set guard. The design's section 3 row is changed to say so.
- A failure of the best-effort cleanup of the retired sign-in codes is logged once through `logUnexpected`, with a label naming the cleanup, instead of today's fixed line; the design's section 4 says the log text changes there. No answer changes, and no corpus case records the line.
- The note and date moves of the project machine (PROGRESS, REVISE_DATE) are written as the code reads them: a note in every stage but files_under_review and complete, a date move in every stage but complete. That a project has a due date to move is a fact the rule reads, so the machine lists files_under_review for a date move although no due date exists there yet.
- The time is read as the old code read it: once at the start of a publish, a revoke, an upload step and an update, again at the file access record, and for a notice at the claim and again at the outcome. A message write reads it again for each write and recount (layer 1).
- The clock-dependent wait of a busy completion (R2 error 10058) uses Effect's sleep for the 100 and 200 millisecond waits.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0. Each open branch took `origin/main` (at `f9480f78`, the latest at the final round, which contains the merged bottom layer and the sign-in model and fixes) up the stack with merge commits, never a rebase. Figures are from the layer 3 head `81b784be`, before this record's own commit:

- `format:check`: "Checked 1039 files in 114ms. No fixes applied". `lint`: no findings. `build`: complete. Client bundle test: 27 passed.
- Full `pnpm test` with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1`: 394 files passed; 15100 tests passed, 1 skipped (15101), tree clean afterwards.
- `golden:neutral --all claude/effect-15-audio-projects-files HEAD`: "compared 80 fixtures and 9369 cases; 7 of 80 fixtures differ" and "golden:neutral: NEUTRAL"; layer 2 against layer 1 (3 of 80 fixtures differ) and layer 1 against `origin/main` (2 of 80) are also NEUTRAL.
- `verify:quint:all`: exit 0. `tests/scripts/quint-run.test.ts`: 52 passed. `publicist:gate`: "publicist-gate passed: 84 entries checked." `check`: 0 errors, 0 warnings, 16 hints.
- `git diff origin/main HEAD -- docs/verification.md` shows no dropped line of `main`.

The test database refuses a statement with more than 100 bound parameters, as D1 does, and the file guards and the replacement of live reviews bind the file ids as one JSON value, so a version with more than a hundred published files still publishes and revokes (stories with 120 files in `tests/flows/audio-project-files-stories.test.ts`).

### Cases each re-record changed

The two conversion re-records are commits of fixture files only and have no body, so their changed cases are listed here from `golden:diff` against each commit's parent. Every change is in D1 statements only (`golden:neutral` against the layer below reports each case neutral with D1 changes, never "NOT neutral"). Cases are grouped by the topic before the colon in their names.

Layer 2, `d1b18805` (the file routes against the messages layer):

- `owner-project-file`: 105 of 145 cases. revoke 30, publish 42, race 10, outage 7, email 7, rolled back 2, twice 2, schema 1, revoke then publish 1, life 1, outage then repeat 1, one case with no topic.
- `owner-project-uploads`: 124 of 200 cases. start 32, complete 31, put 31, abort 12, flow 13, recover 5.
- `studio-project-file`: 107 of 121 cases (the file read now reads the session, then one batch, then the access record), including "download=1 twice, then 0" and "two reads".

Layer 3, `8c13a94b` (the top layer against the files layer):

- `audio-intake`: 43 of 130 cases (every case that delivers the invitation: its claim, recipient read and outcome write).
- `owner-project-access`: 32 of 58 cases. revoke 21, race 2, after 2, outage 1, rolled back 1, twice 1, outage then repeat 1, and 3 more at the top of the corpus (unavailable, content type, one with no topic).
- `owner-project-file`: 56 of 145 cases. revoke 22, publish 21, email 6, twice 2, outage 1, revoke then publish 1, life 1, outage then repeat 1, and 1 with no topic (the notice delivery inside a publish or revoke).
- `owner-project-invitation`: 80 of 110 cases. send 37, email 20, notice 10, queue 4, twice 2, and one each of after a refusal, after an uncertain send, revoked between sends, withdrawn between sends, outage then repeat, content type and one with no topic.
- `owner-project-update-notices`: 52 of 53 cases. email 28, retry 22, after an uncertain send 1, after a refusal 1.
- `owner-project-updates`: 130 of 189 cases. race 15, request 14, date 11, payment 9, text 8, outage 7, project 6, files 5, twice 5, actor 3, rolled back 2, life 1, outage then repeat 1, content type 1, and 42 with no topic (the action and stage matrix).
- `owner-project-uploads`: 1 of 200 cases, "flow: start, put the part, complete, then publish the file" (the notice delivery).

Final review rounds, fixture-only commits on layer 2 and on layer 3: `owner-project-file` 74 of 145 cases (every publish and revoke case that reaches the batch) and `owner-project-uploads` 1 of 200 cases ("flow: start, put the part, complete, then publish the file"), for the batch guards of that round (a count and a membership check of each file a guard names, no reliance on an order, and a revoke that decided no reset no longer compares the stage).

The last round, for the review threads on the messages pull request, re-recorded `studio-projects-messages` on the messages layer (114 of 215 cases: 110 of the send, read and respond matrix, "a message with a mailto", the two "two reviews published ..." cases and "respond with 12 messages while the project is complete") and `owner-project-file` and `owner-project-uploads` on layers 2 and 3 for a publish's second read of the project (50 of 145 cases, and 1 of 200: "flow: start, put the part, complete, then publish the file"). No commit of the messages layer mixes source and fixture files: the two commits that touch its fixtures (`1664ccfb`, `e6863102`) contain fixture files only.

The review rounds re-recorded `owner-project-file` for the ids bound as one value: 5 of 145 cases ("publish: a second review replaces the first", "revoke: the other published review keeps the stage at review_ready", "revoke: the other published final keeps a completed project complete", "life: publish a review, publish a second that replaces it, revoke the second, publish a final" and "publish: a final revokes the live review").

UNVERIFIED: none of the routes was run against a real D1, R2 bucket, Resend account or the deployed worker; the corpus uses an in-memory SQLite database with the real schema, an in-memory bucket and a scripted fetch. R2's error codes are read from the end of their messages as R2 writes them, which the tests feed in the same words. The exhaustive ordering run of the sign-in non-interference test (`SIGNIN_EXHAUSTIVE=1`) was not run; the sampled run passes with the revoke now a flow. The Quint models were not changed by this conversion.

## Checklist

- Answers: every corpus case of the nine corpora is neutral against the layer below it.
- Errors: every unexpected failure of D1 or R2 is 500 with the route's fixed sentence, logged once without what was sent; R2 error 10043 is 503 with that sentence and is not logged.
- Rules: every decision is a rule with tagged refusals and a sentence; routes map each tag with `catchTags`.
- Services: R2, the mail provider and the background work are services or store functions with named failures; no module is mocked in the area's tests.
- Copy: no new user-facing sentence.

## Follow-up

- The studio sign-in area's conversion extends `src/server/studio-signin-store.ts` and drops `deleteRetiredClientCodes` when migration 0028 drops the retired table (issue 271).
- The owner's request status routes still call `deleteRetiredCodes` in `audio-client-access.ts`.
