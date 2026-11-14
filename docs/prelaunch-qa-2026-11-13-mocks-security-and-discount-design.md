# Effect stack: module mocks, security corrections, discount design and the conversion proof: release gate

Four merges are gated here, three already on main and one in review: pull request #264 (module mocks replaced by injected collaborators), #266 (six security corrections), #265 (the discount design) and the conversion proof pull request (this branch).

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch for the conversion proof: `claude/effect-9-conversion-proof`, cut from `origin/main` at `0a296a0a`
Pull requests: #264 merged as `7f28f299`; #266 merged as `416eb8d1`; #265 merged as `0a296a0a`; the conversion proof is pull request 270.
Target: production `https://thesuperhuman.us`
Reviewer: the conversion proof was built by a Claude Sonnet subagent and reviewed by independent Claude subagents; Greptile and Codex also reviewed pull request 270 (as reported to the builder). For #264, #266 and #265, the results below are as reported to the builder by the owner's task; the builder did not re-observe them. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: for #264 the parent of `7f28f299`, for #266 the parent of `416eb8d1`, for #265 the parent of `0a296a0a` (`git log --first-parent`); for the conversion proof, re-check `origin/main` with `git fetch` before merge. Nothing in the conversion proof changes `src/`, so it has no deployed behaviour to roll back.

## Scope

1. Pull request #264, merged to main as `7f28f299`: the server code and its tests stopped using module mocks and take their collaborators as injected parameters instead. This record gates its release evidence only; it does not review its diff.
2. Pull request #266, merged to main as `416eb8d1`: six security corrections. This record gates its release evidence only; it does not review its diff, and it does not list the six corrections.
3. Pull request #265, merged to main as `0a296a0a`: the discount design. It adds a plan, a Quint model and a LemmaScript contract, and no file under `src/`.
4. The conversion proof (this branch, pull request 270): tests, tooling and documentation only. It adds:
   - `pnpm run golden:neutral` (`scripts/golden-neutral.mjs`, `scripts/sql-effects.mjs`; tests in `tests/scripts/golden-neutral.test.ts`), which decides from two revisions of a golden fixture whether a conversion left behaviour alone. The rule is in `tests/golden/README.md` ("A conversion is neutral when") and in the Back-end rules of `CLAUDE.md` and `AGENTS.md`.
   - Fixture format 4: a digest of every table of both databases, and of R2 and KV with each key's expiry and metadata, after every step; and, for both databases, the digest plus the set of tables whose rows had changed in the step (by a committed statement or by a trigger it fired, noted as the statement runs), at the moment the response had been read and at every outside effect (so the state an email went out in is compared); at the end the per-table digests; and the real change count of every D1 statement, taken as the statement runs. The comparison tool knows formats 1 to 4, refuses any other, and checks the whole record of a format 4 case before comparing. All 74 database fixtures were re-recorded in their own commits on unchanged `src/`; `scripts/golden-format-proof.mjs` shows what differs. The three older recorder fixtures are unchanged and carry no digests.
   - A harness check that a failure, outage or race a golden case declares actually fires, with `optionalTriggers` (one case) and `mustNotFire` (three control cases) for the exceptions, and a `trigger-hit` log entry naming the operation and table each injected failure or interleave hit.
   - One 20 second time limit per generated golden case, set once in `defineCorpus`, replacing eleven per-file 60 second limits.
   - A `Golden neutrality` workflow (`.github/workflows/golden-neutrality.yml`) that runs on every pull request and again when a label is added or removed, runs the base branch's copy of the comparison tool and every module it imports (the pull request's own copy only when the base has none), writes `golden:neutral --all` to the job summary, fails a pull request carrying the `conversion` label unless every case is neutral, and fails any pull request on a usage or read error or when the tool did not run to completion (its last non-empty output line is not a verdict line that agrees with its exit code). `validate.yml` only gains two environment variables on the test step, `GOLDEN_VERIFY_DIGESTS` and `GOLDEN_VERIFY_COUNTS`, which make the harness check its cached digests and every recorded change count against SQLite.
   - This record.

   `git diff origin/main --stat -- src` is empty (checked locally). No pre-existing field of any golden fixture changed except one read's change count.

## Owner decisions

- Owner, in conversation, 2026-11-12: use Effect for rules, Effect Schema for input and XState with the bridge, matching Tally; convert one area at a time; no behavior change.
- The rule that a conversion may re-record a golden fixture when `golden:neutral` passes is part of this branch. It becomes the written rule when the branch merges.

## Evidence and limits

Pull request #264 (as reported to the builder by the owner's task; not re-observed here):

- Cloudflare Workers Builds succeeded on `7f28f299`.
- Live `/`, `/software/start` and `/work` answered 200.
- The owner paths redirected an unauthenticated request to the access sign-in before reaching the site.

Pull request #266 (as reported; not re-observed here):

- Three independent review rounds ran.
- Cloudflare Workers Builds succeeded on `416eb8d1`.
- Live pages answered 200.
- An agreement download with no session answered an identical 401 for two different unknown ids.
- The contact form refused a request with no captcha with 400.
- An unsigned Stripe webhook request answered 400.
- NOT verified on production: the owner and client error sentences, the image check and the message link rules. These need a signed-in session.

Pull request #265 (as reported; not re-observed here):

- CI `validate`, including the Dafny contracts and the pooled Quint step, passed.
- Cloudflare Workers Builds succeeded on `0a296a0a`.
- Live pages answered 200.
- No file under `src/` changed.

Review rounds on the conversion proof (as reported to the builder; not re-observed): round 1 (independent Claude review, Greptile and Codex on head `484a1685`) found that D1 writes to undumped tables were invisible, that the position rule missed the moves it exists to catch, that a misspelled fixture name or flag passed, that allowances went stale silently, that renames could hide a dropped case, and that trigger hits could silently move to another statement. Round 2 (head `3f5e3980`) found that two writes to one table swapping places around an email passed as neutral, that a write run through `first()` or `all()` recorded no change count, and several digest precision gaps; this series closes them. Round 3 (head `054e52c8`, with two Greptile comments) found that D1 change counts were wrong when calls ran in parallel (one committed fixture case recorded a SELECT with `changes: 1`), that dropping the position rule lost a same-value UPDATE and a transient lock row moved across an effect, that recordings from before the state at each effect could be called NEUTRAL when an email moved across a write, that a pull request ran its own copy of the tool, and that the harness's self-checks did not run in CI; this series closes them. Round 4 (head `d2ab020a`, with one Greptile comment) found that the comparison tool never checked a record's shape (two records that both stopped recording states, or both said `format: 99`, came out NEUTRAL), that `touched` was noted when a D1 entry was logged and not when the statement ran, that `GOLDEN_VERIFY_COUNTS` checked the meter's count and not the recorded value, that tables a trigger wrote were not in `touched`, and that a crash of the base copy of the tool read as "not neutral"; this series closes them. Round 5 (head `cd74c12c`) found that a statement the SQL reader could not read (`UPDATE"a"SET v = 1`) silently lost its own table from `touched`, that a statement that failed part way kept rows unnoted, that formats below 4 could call an email moved across a write with unchanged D1 entries neutral, four gaps in the record checks (duplicate table names, `threw: null`, a batch with no statements, added cases never validated), that the workflow read any verdict-looking line and not the last one, and two README overstatements; this series closes them. Review of the commits after round 5: not yet.

Conversion proof, local, macOS arm64, Node 26, pnpm 12.20.0, in this worktree. No logs retained.

- `pnpm exec biome format .`: no fixes applied.
- `pnpm run build`: `Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `pnpm test`, run twice with `GOLDEN_VERIFY_DIGESTS=1` and `GOLDEN_VERIFY_COUNTS=1` (as CI now runs it): 287 test files and 12,542 tests passed, 1 skipped, both times; vitest `Duration` 66.9 s and 65.1 s (the head before this round, with the same checks: 63.6 s and 62.1 s); no case timed out; `git status` clean and the fixtures byte-identical between the two runs.
- Record shape: `golden:neutral` knows formats 1 to 4. Any other number on either side is an error (exit 2) naming the fixture and case. A format 4 case is validated in full before it is compared (every outside effect has `state` with two SHA-256 digests and a sorted `touched`, every step has its `digest` and `atResponse`, `finalState` has per-table entries, every D1 change count is a count), whether or not the two sides are identical; each missing or malformed field is a test. `scripts/golden-format-proof.mjs` requires the same fields of the later record. All 8,821 format 4 cases in the fixtures at the previous head passed the validator before this round's re-record.
- Change counts: the recorded value itself is now checked against SQLite's `total_changes()` (`GOLDEN_VERIFY_COUNTS=1`), and a count that was not measured is an error and never recorded as 0. No recorded count changed in this round's re-record.
- Own table: a statement's own table now comes from SQLite itself (the authorizer it calls while compiling the statement), so no spelling can hide it; the SQL reader is hardened for quoted names with no whitespace, comments, `main.` and backticks and brackets, and is used only for the trigger-hit markers (an unreadable write there is an error) and, in verification mode, to decide whether a statement is a write. All 444 distinct SQL strings in the fixtures prepare, and the reader and SQLite agree on every one. A statement that failed part way (`UPDATE OR FAIL`) notes the tables whose rows it changed. No fixture changed in this round (the whole golden suite passes unchanged with both verify flags).
- Tables touched: the set is now derived from the rows that actually changed (the digest of every table compared before and after each committed write, plus the statement's own table when it changed a row, which keeps a same-value UPDATE visible), so a table a trigger wrote counts and a rule moved from a trigger into code looks the same. A harness test drops `music_events_archive_before_delete` in a scratch world and performs its upsert in code: same state, same set, neutral. `sqlite_sequence` is left out of the set, and a schema-qualified statement (`main.t`) names its real table. Noting happens as the statement runs (a batch when it commits, never when it rolls back), tested with the email and the write in parallel in both call orders.
- Digest cache: finding the touched tables forced digests inside batches, which exposed a stale cache after a ROLLBACK (it does not move `total_changes()`); `GOLDEN_VERIFY_DIGESTS=1` caught it over the corpus and a harness test now covers it. The cache is invalidated on a rollback and on a failed statement.
- Re-record: 52 cases in three fixtures gained tables written by triggers in a `touched` set and nothing else: `audio-intake` (46; `audio_project_audit` and `audio_projects`, written by the `audio_project_after_service_request` trigger), `owner-request-status` (4: "resolve a new request", "resolve a reviewed request", "review, then a stale resolve, then a fresh resolve", "the whole life: review, resolve, reopen, withdraw, review again"; `audio_projects` and `audio_project_audit`) and `work-feed` (2: "withdraw: clears the queued text of that entry in the outbox, in that project only" and "sequence: queued text is cleared only by a withdrawal"; `publication_outbox`). Format proof from `d2ab020a` to this head: 77 fixtures, 9,014 cases; stored size 4,783,263 bytes before and 4,785,404 after (100%); the only differences are those sets.
- Slowest checks: the digest of a database is recomputed once per state that exists (it is shared by the effects and by the table detection), so the suite takes about 3 s longer than before this round.
- `golden:neutral --all 05b669ce^1 05b669ce` (pull request 251, a behaviour fix plus bind-only changes, format 1 on both sides): exits 1. 3 of 77 fixtures differ: every case that is not byte-identical and has D1 entries is NOT COMPARABLE (3 in `owner-request-invoices`, 3 in `owner-request-payment`, 104 in `stripe-webhook`, 110 in all, including the one whose outcome the fix changed), none is reported neutral or NOT neutral, and the two cases the fix renamed are reported removed, which also fails. A format 1 recording cannot show whether an effect moved across a write, so the tool can no longer certify or condemn a change between two old recordings; it prints where the first difference is.
- `golden:neutral --all origin/main HEAD`: every database fixture NOT COMPARABLE, `NOT NEUTRAL`, exit 1, as designed.
- The `Golden neutrality` workflow has run on this pull request without the `conversion` label (as reported to the builder, not re-observed): the unlabelled, report-only path is exercised. The labelled path is untested on GitHub until the first conversion pull request; the workflow's shell step, including a base copy that cannot run, a missing base copy, a NOT NEUTRAL result with and without the label, is exercised by a test that runs it in throwaway repositories. That test found that the tool did nothing when run through a symlinked folder (a script was judged "imported", not "run", by comparing unresolved paths); the three scripts now compare real paths.
- `pnpm run verify:quint:all`, `pnpm run publicist:gate`, `pnpm exec oxlint` (53 findings) and `pnpm run check`: results in the hand-off report.

What each mechanism catches, and what is not seen, is listed in `tests/golden/README.md`. The write-order rule of the first two versions was removed because the digests at every effect and at the response caught what it caught, but that did not hold for a same-value UPDATE or a row inserted and deleted again; the set of tables written so far, recorded at every effect and at the response, restores that coverage without failing legitimate rewrites (one UPDATE as a DELETE and an INSERT, INSERT OR REPLACE, an upsert as an UPDATE), which the harness tests build as pairs with the verdict each must have.

Limits, after this round:

- A trigger whose write sets a value to what it already was, or changes a row and back, leaves its table out of `touched`, while the same write in code puts it in: such a pair is reported NOT neutral (a false alarm, the safe direction), and the reverse move too.
- The digest cache relies on the fake D1 to report a ROLLBACK or a failed statement; a harness hook that ran ROLLBACK on the raw handle after a mid-transaction digest would leave it stale (`GOLDEN_VERIFY_DIGESTS`, which CI sets, would catch it).
- Not seen, by design: a write that changed no row moved across an effect; an effect moved past a read only; where in time a write happened between two effects or after the last one; a write undone before the next digest whose table was already in the set; the order of two writes to the same table between the same two effects.
- A recording from before format 4 cannot show that an effect did not move across a write, so every case of it that has D1 entries and is not byte-identical is NOT COMPARABLE, whatever differs; the old fixtures only become provable again once they are re-recorded in format 4, in a commit that is itself not provable as neutral.
- A conversion that changes the state or the tables written at an outside effect for a reason that is not a behaviour change is reported NOT neutral and has no allowance: it has to be restructured, or landed first as an explained fix in its own pull request. A table a trigger writes counts as touched, so moving a trigger's rule into code is neutral when the same tables change.
- The history holds almost no real conversion, so how often the digests and table sets flag a legitimate conversion is untested.
- The five database triggers that still write (issue 242) change rows without the statement saying so; they show in the digests, not in the table sets.
- The trigger check covers D1 failures and interleaves, R2 and KV `fails`, `byHost` fetch answers that throw and AI answers that throw or never answer, and KV failures in the older recorder. A hand-written fetch responder declares nothing, and rate-limit refusals are not checked.
- The `trigger-hit` marker says which operation and table were hit, not whether a write changed a row (the hook fires before the statement runs).
- The three older recorder fixtures (contact, resume-request, resume-approve) are outside the digests; the tool shows only that their responses and every KV operation and fetch are identical.
- The workflow is not a required status check unless the owner makes it one; a pull request can edit the workflow file itself; it compares fixtures only, so a conversion's proof also needs the `validate` job green; a pull request with merge conflicts gets no run; the `conversion` label is applied by a person.
- A fixture format change cannot be shown neutral; the next change of format needs the same proof script and the same separate commit.
- The schema script seeds one row with SQLite's wall clock; the harness fixes it, which is the only change to what a route can read. The publication database defaults `published_at` to the wall clock when an insert leaves it out; no case does today, and a case that did would fail the determinism check.
- Whether a case's inputs changed in a conversion is still the reviewer's check.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: repository `kwilson21/thesuperhuman.us`; #264, #266 and #265 are on main, and the conversion proof is tests, tooling and documentation only. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or navigation changed in the conversion proof or #265. For #264 and #266, no change to public copy is claimed here (not reviewed by the builder).

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed in the conversion proof or #265. For #264 and #266, none is claimed.

### 3. Accessibility and responsive behavior

- N/A, every item in this section for the conversion proof and #265: no markup or style changed. `hallmark audit` not run because no page design changed.
- UNVERIFIED, every item in this section for #264 and #266: not examined by the builder; the owner's task did not report an accessibility check.

### 4. Performance and resilience

- N/A, 4.1 to 4.6 for the conversion proof and #265: no image, client code or async path changed.
- UNVERIFIED, 4.2 for #264 and #266: no client bundle comparison was reported to the builder.
- PASS, 4.6 for #264 (as reported): the owner paths redirected an unauthenticated request to the access sign-in before reaching the site.

### 5. Forms and sensitive flows

- PASS, 5.1 and 5.2 for #266 as far as observed (as reported): the contact form refused a request with no captcha with 400.
- PASS, 5.5 for #266 as far as observed (as reported): an agreement download with no session answered an identical 401 for two different unknown ids, so an unknown id is not told apart from another; an unsigned Stripe webhook request answered 400.
- UNVERIFIED, 5.1 to 5.5 for #266 beyond those: the owner and client error sentences, the image check and the message link rules were not verified on production; they need a signed-in session. To be completed with a signed-in check.
- PASS, 5.1 to 5.5 for the conversion proof locally: no route, validator or message changed (`src/` is untouched), and the golden corpus passes unchanged inside `pnpm test`.
- N/A, 5.1 to 5.6 for #264 and #265 beyond their own pull requests' results: no route behavior is claimed to have changed in #264, and #265 changed no file under `src/`.

### 6. Privacy, legal and measurement

- N/A, every item in this section for the conversion proof, #264 and #265: no cookie, analytics, legal text or processor changed, and no data collected or stored changed.
- UNVERIFIED, 6.1 for #266: whether any of its six corrections changed what is logged or stored was not reviewed by the builder.

### 7. Release and final QA

- PASS, 7.1 Required checks: for #264, #266 and #265, Workers Builds succeeded on each merge commit and, for #265, CI `validate` including the Dafny contracts and the pooled Quint step passed (all as reported). For the conversion proof, the local gates above; CI on its head is UNVERIFIED.
- UNVERIFIED, 7.2 Exact diff review and independent code and security review: #266 had three independent review rounds (as reported). The reviews of #264 and #265 are not recorded here. The conversion proof had two review rounds (independent Claude review, with Greptile and Codex in round 1, as reported), whose findings are closed in later commits; the latest commits have not been reviewed yet.
- UNVERIFIED, 7.3 Production bindings, secrets, HTTPS, host routing and response headers: no binding, secret or migration changed in the conversion proof or #265; the same is not claimed for #264 and #266. Nothing deployed from this branch.
- PASS, 7.4 Rollback is the previous deployed revision: the parents of `7f28f299`, `416eb8d1` and `0a296a0a` (as reported); for the conversion proof, re-check `origin/main` with `git fetch` before merge.
- PASS, 7.5 for #264, #266 and #265 (as reported): the live pages named above answered 200 after deployment, and the #266 refusals answered as listed. UNVERIFIED for the conversion proof: nothing deployed; to be completed after merge (Workers Builds result on the merge commit, and `/`, `/software/start` and `/work` answering 200).
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section for the conversion proof and #265: the owner center, Access, migrations and payment settings are untouched.
- PASS, 8.x for #264 (as reported): owner paths redirect an unauthenticated request to the access sign-in before reaching the site. UNVERIFIED for #266: the owner error sentences need a signed-in session.

## Delivery status and remaining gates

- UNVERIFIED: independent review, Greptile and Codex on the final head of the conversion proof.
- UNVERIFIED: CI (`validate`) and Cloudflare Workers Builds on the conversion proof head.
- UNVERIFIED: live checks of the conversion proof after merge.
- UNVERIFIED: #266's signed-in checks (owner and client error sentences, the image check, the message link rules).

No deployment is authorized by this record.

#264: implemented yes, verified locally yes (as reported), deployed yes (as reported), verified live partly (200 answers and the sign-in redirect, as reported). #266: implemented yes, verified locally yes (as reported), deployed yes (as reported), verified live partly (200 answers and three refusals, as reported; signed-in checks not done). #265: design only, merged yes, no behavior change, live pages 200 (as reported). Conversion proof: implemented yes, verified locally yes, deployed no, verified live no.

The conversion proof was built by a Claude Sonnet subagent and reviewed by independent Claude subagents. This record does not certify the checks listed as UNVERIFIED.
