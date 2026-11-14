# Effect stack: module mocks, security corrections, discount design and the conversion proof: release gate

Four merges are gated here, three already on main and one in review: pull request #264 (module mocks replaced by injected collaborators), #266 (six security corrections), #265 (the discount design) and the conversion proof pull request (this branch).

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch for the conversion proof: `claude/effect-9-conversion-proof`, cut from `origin/main` at `0a296a0a`
Pull requests: #264 merged as `7f28f299`; #266 merged as `416eb8d1`; #265 merged as `0a296a0a`; the conversion proof is not yet a pull request number known to the builder.
Target: production `https://thesuperhuman.us`
Reviewer: the conversion proof was written by a Claude Sonnet 5.5 builder subagent working from a brief. No independent review round, Greptile or Codex review has run on it yet. For #264, #266 and #265, the results below are as reported to the builder by the owner's task; the builder did not re-observe them. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: for #264 the parent of `7f28f299`, for #266 the parent of `416eb8d1`, for #265 the parent of `0a296a0a` (`git log --first-parent`); for the conversion proof, re-check `origin/main` with `git fetch` before merge. Nothing in the conversion proof changes `src/`, so it has no deployed behaviour to roll back.

## Scope

1. Pull request #264, merged to main as `7f28f299`: the server code and its tests stopped using module mocks and take their collaborators as injected parameters instead. This record gates its release evidence only; it does not review its diff.
2. Pull request #266, merged to main as `416eb8d1`: six security corrections. This record gates its release evidence only; it does not review its diff, and it does not list the six corrections.
3. Pull request #265, merged to main as `0a296a0a`: the discount design. It adds a plan, a Quint model and a LemmaScript contract, and no file under `src/`.
4. The conversion proof (this branch): tests, tooling and documentation only. It adds:
   - `pnpm run golden:neutral` (`scripts/golden-neutral.mjs`, tested in `tests/scripts/golden-neutral.test.ts`), which decides from two revisions of a golden fixture whether a conversion left behaviour alone. The rule is in `tests/golden/README.md` ("A conversion is neutral when") and in the Back-end rules of `CLAUDE.md` and `AGENTS.md`.
   - A harness check that a failure, outage or race a golden case declares actually fires (`tests/golden/harness/triggers.ts`, tested in `tests/golden/harness/triggers.test.ts`), for D1 failures and interleaves, R2 and KV `fails`, fetch answers that throw and AI answers that throw or never answer, and for KV failures in the older recorder. Four existing cases declared a trigger that stays quiet by design; each is now listed with a reason in its test file (`owner-request-project-start.test.ts`, `work-feed.test.ts` twice, `harness/gaps.test.ts`). No fixture changed.
   - A 60 second time limit per generated golden case, set once in `defineCorpus` (`CASE_TIMEOUT_MS`).
   - This record.

   `git diff origin/main --stat -- src tests/golden/fixtures` is empty (checked locally). No golden fixture's recorded content changed.

## Owner decisions

- Owner, in conversation, 2026-11-12: use Effect for rules, Effect Schema for input and XState with the bridge, matching Tally; convert one area at a time; no behavior change.
- Owner, 2026-10-12 (global instructions): Claude subagents may write code in this repository, tests first, with independent Claude review each round and Greptile and Codex review on the pull request.
- The rule that a conversion may re-record a golden fixture when `golden:neutral` passes is the task the owner gave this branch. It is not a recorded owner decision in a document yet; it becomes the written rule when this branch merges.

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

Conversion proof, local, macOS arm64, Node 26, pnpm 12.20.0, in this worktree. No logs retained.

- `pnpm exec biome format .`: `Checked 730 files in 187ms. No fixes applied.`
- `pnpm run build`: `Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `pnpm test`, run twice: 282 test files passed each time; 12,373 tests passed, 1 skipped; wall time 58.9 s and 69.7 s (vitest `Duration`); no case timed out; `git status` showed no change under `tests/golden/fixtures` or `src`.
- `pnpm run verify:quint:all`: every model passed and every mutant failed as it must.
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.` (private note lookup skipped, no token, local build).
- `pnpm exec oxlint`: 53 findings.
- The five slowest golden cases, measured in one full run of `tests/golden` with the suites in parallel, are all in `owner-request-software-offer-signing.test.ts` (PDF rendering): "two attachments" 1.89 s, "one attachment" 1.84 s, "a standard offer with valid details" 1.74 s, a request email seeded in capitals with spaces 1.68 s, "three milestones with two checkpoints" 1.58 s.
- `golden:neutral` on real history, run between `05b669ce^1` and `05b669ce` (pull request #251, a behaviour fix plus bind-only changes): of 77 fixtures, 3 differ. `owner-request-invoices` (177 identical, 3 D1-only) and `owner-request-payment` (218 identical, 3 D1-only) are neutral. `stripe-webhook` (157 identical, 103 D1-only) reports exactly the cases whose outcome changed as NOT neutral: one case by name, and two cases the fix renamed (reported as removed, or as NOT neutral pairs when a rename file maps them). That is the intended answer for a fix.

Limits: nothing is deployed from this branch; no independent review, Greptile, Codex or CI result on the final head is recorded here; the trigger check does not see a fetch outage written as a hand-made responder function (only `byHost` answers declare one), and does not check rate-limit refusals; `golden:neutral` recognises a write from the SQL text, so an unusual statement form is not seen as one; whether a case's inputs changed is the reviewer's check, not the tool's.

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
- UNVERIFIED, 7.2 Exact diff review and independent code and security review: #266 had three independent review rounds (as reported). The reviews of #264 and #265 are not recorded here. The conversion proof has had no independent review yet.
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

The conversion proof was built by a Claude subagent. This record does not certify the checks listed as UNVERIFIED.
