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
   - Fixture format 4: a digest of every table of both databases, and of R2 and KV with each key's expiry and metadata, after every step; and, for both databases, the digest plus the set of tables that committed row-changing writes had touched in the step, at the moment the response had been read and at every outside effect (so the state an email went out in is compared); at the end the per-table digests; and the real change count of every D1 statement, taken as the statement runs. All 74 database fixtures were re-recorded in their own commit on unchanged `src/`; `scripts/golden-format-proof.mjs` shows what differs from format 3. The three older recorder fixtures are unchanged and carry no digests.
   - A harness check that a failure, outage or race a golden case declares actually fires, with `optionalTriggers` (one case) and `mustNotFire` (three control cases) for the exceptions, and a `trigger-hit` log entry naming the operation and table each injected failure or interleave hit.
   - One 20 second time limit per generated golden case, set once in `defineCorpus`, replacing eleven per-file 60 second limits.
   - A `Golden neutrality` workflow (`.github/workflows/golden-neutrality.yml`) that runs on every pull request and again when a label is added or removed, runs the base branch's copy of the comparison tool (the pull request's own copy only when the base has none), writes `golden:neutral --all` to the job summary, and fails a pull request carrying the `conversion` label unless every case is neutral (and any pull request on a usage or read error). `validate.yml` only gains two environment variables on the test step, `GOLDEN_VERIFY_DIGESTS` and `GOLDEN_VERIFY_COUNTS`, which make the harness check its cached digests and every recorded change count against SQLite.
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

Review rounds on the conversion proof (as reported to the builder; not re-observed): round 1 (independent Claude review, Greptile and Codex on head `484a1685`) found that D1 writes to undumped tables were invisible, that the position rule missed the moves it exists to catch, that a misspelled fixture name or flag passed, that allowances went stale silently, that renames could hide a dropped case, and that trigger hits could silently move to another statement. Round 2 (head `3f5e3980`) found that two writes to one table swapping places around an email passed as neutral, that a write run through `first()` or `all()` recorded no change count, and several digest precision gaps; this series closes them. Round 3 (head `054e52c8`, with two Greptile comments) found that D1 change counts were wrong when calls ran in parallel (one committed fixture case recorded a SELECT with `changes: 1`), that dropping the position rule lost a same-value UPDATE and a transient lock row moved across an effect, that recordings from before the state at each effect could be called NEUTRAL when an email moved across a write, that a pull request ran its own copy of the tool, and that the harness's self-checks did not run in CI; this series closes them. Review of the commits after round 3: not yet.

Conversion proof, local, macOS arm64, Node 26, pnpm 12.20.0, in this worktree. No logs retained.

- `pnpm exec biome format .`: no fixes applied.
- `pnpm run build`: `Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `pnpm test`, run twice with `GOLDEN_VERIFY_DIGESTS=1` and `GOLDEN_VERIFY_COUNTS=1` (as CI now runs it): 286 test files and 12,463 tests passed, 1 skipped, both times; vitest `Duration` 63.6 s and 62.1 s (the format 3 head without the checks: 65.6 s and 64.7 s); no case timed out; `git status` clean and the fixtures byte-identical between the two runs.
- Change counts: the count is now taken as the statement runs. `GOLDEN_VERIFY_COUNTS=1` compares every recorded count with the difference in SQLite's `total_changes()` around the statement (0 for a read; the exact count for a write on a table with no trigger, foreign key action or REPLACE; on one that has them `total_changes()` also counts their writes, so the check is that a row changed exactly when SQLite says rows changed). It passed over all 9,091 cases. Recorded counts that changed in the re-record: 1, in `owner-request-agreement-retry-artifact` (case "the record lacks the contractor": a SELECT that ran beside an UPDATE had been recorded with the UPDATE's `changes: 1`, now 0). No other fixture's counts changed.
- Format proof from `054e52c8` to this head: 77 fixtures, 9,014 cases; stored size 4,691,264 bytes before and 4,783,263 after (102%); as JSON text 77.7 MB before and 78.6 MB after (101%); the only differences are the format number, the added `touched` sets and that one count. The proof now compares trigger-hit entries and the older digests exactly and accepts a changed count only for a read that now says 0.
- `golden:neutral --all 05b669ce^1 05b669ce` (pull request 251, a behaviour fix plus bind-only changes, format 1 on both sides): exits 1. 3 of 77 fixtures differ. The 109 cases whose D1 statements differ (3 in `owner-request-invoices`, 3 in `owner-request-payment`, 103 in `stripe-webhook`) are now reported NOT COMPARABLE, because a format 1 recording holds no database state at each outside effect and so cannot show that no email moved across a write; they were NEUTRAL before this round, which overstated what the recording can show. One case is NOT neutral (`delivery out of order: the older paid arrives after a newer sent`), and two cases the fix renamed are reported removed, which also fails. So the tool can no longer certify a change between two old recordings; it can still flag what changed.
- `golden:neutral --all origin/main HEAD` and `--all 054e52c8 HEAD`: every database fixture NOT COMPARABLE, `NOT NEUTRAL`, exit 1, as designed.
- The `Golden neutrality` workflow has run on this pull request without the `conversion` label (as reported to the builder, not re-observed): the unlabelled, report-only path is exercised. The labelled path, which fails a pull request unless every case is neutral, is untested until the first conversion pull request. I ran the workflow's shell step locally against the repository's own history to check the base-copy extraction.
- `pnpm run verify:quint:all`, `pnpm run publicist:gate`, `pnpm exec oxlint` (53 findings) and `pnpm run check`: results in the hand-off report.

What each mechanism catches, and what is not seen, is listed in `tests/golden/README.md`. The write-order rule of the first two versions was removed because the digests at every effect and at the response caught what it caught, but that did not hold for a same-value UPDATE or a row inserted and deleted again; the set of tables written so far, recorded at every effect and at the response, restores that coverage without failing legitimate rewrites (one UPDATE as a DELETE and an INSERT, INSERT OR REPLACE, an upsert as an UPDATE), which the harness tests build as pairs with the verdict each must have.

Limits, after this round:

- Not seen, by design: a write that changed no row moved across an effect; an effect moved past a read only; where in time a write happened between two effects or after the last one; a write undone before the next digest whose table was already in the set; the order of two writes to the same table between the same two effects.
- A recording from before format 4 cannot show that an effect did not move across a write, so a change in its D1 statements is NOT COMPARABLE; the old fixtures only become provable again once they are re-recorded in format 4, in a commit that is itself not provable as neutral.
- A conversion that changes the state or the tables written at an outside effect for a reason that is not a behaviour change is reported NOT neutral and has no allowance: it has to be restructured, or landed first as an explained fix in its own pull request.
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
