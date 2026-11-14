# Lint to zero and enforced: release gate

Date: November 13, 2026, updated November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Branches: a stack of three, bottom to top: `claude/lint-zero-1-source`, `claude/lint-zero-2-tests`, `claude/lint-zero-3-enforce`
Pull requests: #256, #257 and #258, linked as GitHub stack 259 (`https://github.com/kwilson21/thesuperhuman.us/stack/259`)
Target: production `https://thesuperhuman.us`
Reviewer: the code was written by Claude Haiku subagents from briefs and committed by the coordinating Claude session, whose trailer the commits carry; reviewed by independent Claude Opus and Sonnet subagents (one for correctness and security, one for repository rules, each round). Owner review: none yet. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: the production revision at merge time. When this record was last updated that was `origin/main` `07d2613d` (pull request #267), which the stack is built on; re-check with `git fetch` before merge. After merge, the rollback for each layer is its merge commit's first parent; reverting one merge commit undoes only that layer.

## Scope

`origin/main` at `07d2613d` has 51 Oxlint findings and no lint step in CI: 16 `no-module-mocking` in 11 route test files, and 35 in request-body readers, stored-details types and label maps (15 `no-unknown-parameters`, 10 `no-unsafe-dictionary-type`, 7 `require-safety-comment-for-type-assertion`, 3 `no-known-value-widening`). The counts are from the coordinating session's `oxlint` run on `07d2613d` (53 on the earlier bases, before #273 removed two mocks with the music area). This stack fixes all 51 and adds `pnpm run lint` to the Validate workflow. No baseline, ignore list, disable comment or override was added, and `oxlint.config.ts` and `tools/oxlint/` are unchanged.

This stack was first built on an older `main` (64 findings) and reviewed there in four rounds. `main` then moved in four steps: #262 and #264 converted several validators to Effect Schema and removed 7 module mocks another way; then #266; then #265; then, overnight, #270, #273 and #267 (#273 converted the public music routes to rules, flows and services and deleted `tests/api/music-demand.test.ts`). The stack was rebuilt on the new `main`: files `main` had not touched carried over, and the files both sides changed were fixed again against `main`'s code. Where `main` had already solved the same thing (the middleware, the two music scripts, the brief suggestion pass, the publication website reader, and the music demand route test that #273 replaced), `main`'s version stands and this stack's was dropped.

- Layer 1, source (35 findings): a reader of whatever arrived takes `RawValue` from `src/lib/fields.ts`, the form the converted validators already use; a reader whose callers all pass a known type takes that type (`normalizeClientEmail`, `agreementJson`, `paymentDefaults`, `detailValue`); stored request details have a named type (`RequestDetails` in `src/lib/owner-model.ts`) over one JSON value type (`src/lib/json-value.ts`); label maps keep their keys and are read through one own-key lookup (`ownLabel` in `src/lib/type-guards.ts`, which replaces two local copies in the browser scripts).
- Layer 2, tests only (16 findings): every remaining `vi.mock` is replaced by the real modules over an in-memory SQLite D1 with the real schema, and stand-ins for Stripe, Resend, Turnstile and Cloudflare Access that refuse any other host (`tests/helpers/stripe-fetch.ts`, `resend-fetch.ts`, `owner-access.ts`, `publication-d1.ts`, and `supplyEntries` in `tests/helpers/astro-content.ts`).
- Layer 3: the workflow step, one line each in `CLAUDE.md` and `README.md`, and this record.

Pull request #264 said the remaining route-test mocks would be replaced by Effect service layers as each area is converted. This stack removes them now, at the platform boundary, without adding production seams. The owner chose to keep this stack (in conversation, 2026-11-13). The rewritten tests run routes against real modules, so they should keep working when an area moves to Effect services.

`RawValue` is an alias of `unknown` that the lint rule accepts. It names the value honestly; it does not narrow it. Two unchecked casts over stored JSON remain, each with a `SAFETY` line that says what is assumed: `details_json` in `src/lib/owner-model.ts` and `secondary_signals` in `src/lib/owner-reporting.ts` (no application code writes that column and nothing in the schema enforces its shape).

No page copy, markup, style, route, migration, binding, secret or dependency changed.

## Owner decisions

- Owner, in conversation, 2026-11-12: fix every finding before enforcing; no ratchet.
- Owner, 2026-11-13, as relayed in the task brief: fix the deferred findings and make the lint check enforce a clean result.
- Owner, in conversation, 2026-11-13, after `main` moved: rebase the stack rather than close it.
- Delegated, 2026-11-14. The session that coordinates this work reported that the owner, shown the open questions, answered "Can you decide these yourself". These are that coordinating session's decisions under the delegation, not the owner's direct answers: merge the stack once it is complete by the owner's standing rule (CI green, review bots clean, every comment addressed); change the payment route's Stripe error classification in its own pull request, brought to the owner; rewrite the two older `vi.spyOn` tests in a tests-only follow-up; add `format:check` to CI in a one-line follow-up.

## Behaviour

No production behaviour change for any input that can reach the code. What the reviewer subagents reported (their scripts were not committed and no logs were kept):

- TypeScript types were stripped with esbuild from `main`'s and this stack's version of the 25 changed files under `src/lib` and `src/scripts`. The JavaScript differs in 8, in these ways only: `ownLabel` lookups in place of direct indexing on label maps; a `?? ""` on one `textContent` assignment that could be `undefined` (the same empty text); a narrowing in `src/lib/agreement-request.ts` over values that are always text at that point; statement order in the owner request row mapping; a comment; and the new `ownLabel` function.
- Label maps: a lookup by a key that names an inherited property (`constructor`, `toString`, `__proto__`) now gives nothing where it gave a function. Every call site was traced: the keys come from fixed lists, schema field names or a database `CHECK`, so no request can send such a key. Known and unknown keys give the same output as before.
- `src/lib/software-agreements.ts` and `src/lib/owner-model.ts` conflicted with #266. They carry `main`'s code with this stack's type annotations, type imports and comments only.
- The frozen validator copy `tests/fixtures/legacy-validators/agreement-draft-fields.ts` differs from `main` by one widened local binding and a header line; its lookup is unchanged and the differential tests report 0 differences.
- On the older base, old and new `agreementRequest` were run on about 20,000 generated request bodies with no difference. That file carried over unchanged.

## Evidence and limits

All runs are local on macOS arm64, Node 26.13.1, made by the coordinating session; no logs retained.

Top of the stack, on `07d2613d`:

- `pnpm run lint`: exit 0, no findings.
- `pnpm run format:check`: 767 files, no fixes applied.
- `pnpm run check`: 0 errors.
- `pnpm run build`: `Complete!`
- `pnpm test`, after the build: 298 test files passed; 12,747 tests passed, 1 skipped.
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture`: 135 tests passed.
- `tests/golden/fixtures/`: no file changed. `tests/golden/harness/index.ts` now also exports `EffectLog` (its type-only export line became a value export) and `recordingFetch`.

Each lower layer alone, on the same base, without a build: layer 1 (`e56edb30`), 16 lint findings (the module mocks layer 2 removes), `astro check` 0 errors, 294 files and 12,729 tests passed, 3 skipped; layer 2 (`a2260300`), 0 lint findings, 0 errors, 298 files and 12,745 tests passed, 3 skipped.

Test fidelity, as reviewers reported from scratch copies with the production code broken on purpose: verifying a Stripe webhook with the wrong secret fails 172 of 173 webhook tests and skipping verification fails the signature test; bypassing the schema parse in `reviewAgreements` fails the six new refusal cases. On the older base the same method was applied to the files that carried over: an approve that calls Stripe, an unconfirmed invitation retry, a publication refusal that carries a receipt or the storage error text, dropped revoked checks, the studio allowances, a discarded or kept sign-in code, a manual payment that touches Stripe, and a repeat answer to a studio review.

Enforcement: a reviewer's throwaway finding made `oxlint` exit 1; on the older base that was shown for a `.ts` file, an `.astro` frontmatter, an `.mjs` script and a test.

## Reviews

- On the older base: four rounds of independent Claude review; Greptile and Codex raised five P2 findings on the first pushed heads. Four were fixed there and the fixes carried over (manual payment tested with Stripe on, a review seeded in the future, the invitation template not pinned, test databases not closed). The fifth, a symlinked launch of the two music scripts, no longer applies, because `main`'s versions of those scripts stand. Those comment threads are still open on #256 and #257 and point at superseded code.
- On the new base: one round by an Opus and a Sonnet subagent found no blocker; its should-fix items were fixed (use `RawValue`, restore the text check in `currentSiteHref` and its tests, leave the frozen validator copy frozen, port three agreement tests, build the Resend stand-in on the golden harness). A second round by two Sonnet subagents on those fixes and the #266 merge found one should-fix (an inferred type left in a test helper) and nits, all fixed.
- A third round by two Sonnet subagents on the last commit of nits, the clean merge of #265, the pushed layers and this record: the code check was clean; this record was corrected from its findings and that last correction was not reviewed again.
- Greptile's check passed on the previous heads (`963a65e0`, `c26f4a7b`, `d83e658d`) when read. Codex did not review those heads (its last reviews are of the first pushed heads); a fresh Codex review was requested on the heads pushed with this update.

- The catch-up to `07d2613d` was a merge with one conflict, `tests/api/music-demand.test.ts`, which `main` deleted and this stack had rewritten; `main`'s deletion was taken. `src/lib/music-request.ts` merged without conflict. The esbuild comparison above was made before this catch-up.

## Found, not changed here

- `src/pages/api/owner/requests/[id]/payment.ts` answers 502 only when the error message matches `Stripe` or `hosted payment URL`. A realistic Stripe refusal (for example "Invalid email address") reaches the owner page as 409. The old mock hid this. For the owner to decide.
- Two older tests still replace a function on an imported module with `vi.spyOn` (`tests/lib/software-projects.test.ts`, `tests/api/software-inquiry.test.ts`). The lint rule does not flag them.
- `pnpm run format:check` is not run in CI.
- `src/scripts/json-body.ts` has its own `JsonValue` that also admits `File`; the name is shared with `src/lib/json-value.ts`.
- Not covered by any test, before or after: the studio code-email and session-ip allowances.

## Checklist

Item numbers follow `docs/prelaunch-checklist.md`, in its order.

### 1. Purpose and content

- PASS, 1.1 Project, branch and scope: see the header and Scope. Deployment authorization: none yet; no deployment is authorized by this record.
- N/A, 1.2 Approved design and truthful claims: no page, copy or media changed.
- N/A, 1.3 Explanatory copy and resume comparison: no copy or professional claim changed.
- N/A, 1.4 First screen and CTA: no markup or style changed.
- N/A, 1.5 Navigation, footer, contact route and links: no page, link or route changed.

### 2. Search and sharing

- N/A, 2.1 to 2.6 (titles, canonical URLs, Open Graph, icons, robots and sitemap, preview indexing): no page, metadata, asset or route changed.
- UNVERIFIED, 2.7 Structured data: the local JSON-LD type in `BaseLayout.astro` was replaced by the shared `JsonValue` type and the function that writes the JSON-LD is unchanged, but no page output was compared on this base.

### 3. Accessibility and responsive behavior

- N/A, 3.1 Landmarks and headings, 3.2 image alternatives, 3.5 contrast, targets and motion, 3.6 widths: no markup or style changed.
- UNVERIFIED, 3.3 Keyboard, focus and dialogs, and 3.4 inputs, errors and status announcements: the software brief form script (`src/scripts/software-inquiry.ts`) and the offer editor script (`src/scripts/software-offers.ts`) now read labels through the shared lookup. Their unit tests pass; no real browser run was made.
- UNVERIFIED, 3.7 Browsers and a real mobile device: not run. The CI screenshots are the remaining check.
- N/A, `hallmark audit`: no page design changed.

### 4. Performance and resilience

- N/A, 4.1 Images: none changed.
- PASS (local), 4.2 Client code against the built site: the architecture tests pass after a build with `REQUIRE_CLIENT_BUNDLE=1`; `package.json` and the lockfile are unchanged; the one new browser import, `src/lib/type-guards.ts`, has no imports of its own.
- N/A, 4.3 Measurement: no rendered path changed.
- UNVERIFIED, 4.4 Async UI recovery in a real browser: see 3.3.
- N/A, 4.5 Missing media and 4.6 missing page, redirects and server errors: nothing changed.

### 5. Forms and sensitive flows

- PASS (local tests only), 5.1 Server validation and bounds: every reader runs the same schema as on `main`; the test suite, the differential tests and the golden corpus pass with unchanged fixtures. Origin, auth and rate-limit behaviour was not observed outside the test suite.
- UNVERIFIED, 5.2 Invalid token, 429, 500, network failure, retry, pending button and duplicate submit, and 5.3 behaviour without JavaScript or verification: not exercised in a real browser with a live Turnstile key.
- N/A, 5.4 Delivery and receipt: no email content or delivery path changed.
- PASS (local tests only), 5.5 Approval-gated flows intact. Not exercised live.
- N/A, 5.6 Confirmation page: no change.

### 6. Privacy, legal and measurement

- N/A, 6.1 to 6.5: no stored data, log, cookie, analytics, legal text, embed or processor changed.
- UNVERIFIED, 6.6 Existing error logs and monitoring: this stack changes no alerting, and whether monitoring works was not observed.
- Test stand-ins use `example.com` addresses and obviously fake keys.

### 7. Release and final QA

- PASS (local), 7.1 Required type, test and build checks: see Evidence and limits.
- UNVERIFIED, 7.2 Diff review: see Reviews. Codex has not reviewed these heads, and the last correction to this record was not reviewed again.
- UNVERIFIED, 7.3 Production bindings, secrets, migrations, HTTPS, routing, cache and headers: nothing changed; no deployed response observed.
- UNVERIFIED, 7.4 Rollback version: `origin/main` `07d2613d` when last updated; it is fixed only at merge time. `main` moved in four steps during this work.
- UNVERIFIED, 7.5 Post-deployment verification: not deployed.
- PASS, 7.6 Receipt and evidence. Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

### Software agreement signing

- N/A: no signing behaviour changed. `src/lib/agreement-request.ts`, `agreement-draft.ts`, `agreement-draft-fields.ts`, `agreement-access.ts` and `software-agreements.ts` changed in types and one label lookup; the differential tests and the golden corpus pass with unchanged fixtures (local only).

### 8. Private owner center

- N/A, 8.1 Access identity and 8.2 owner response headers: `src/middleware.ts` and the owner routes' responses are identical to `main`.
- N/A, 8.3 schema and migration ledger, 8.5 traffic summary, 8.6 playback and campaign rules, 8.7 and 8.10 retention, 8.8 studio enablement, 8.9 and 8.11 payment launch scope, 8.14 rollback procedures, 8.15 `owner:health`: no migration, binding, retention or payment setting changed.
- PASS (local tests only), 8.4 Valid request persists before success and a storage failure gives an honest retry with an alert that carries no request content: `tests/api/audio-intake.test.ts` and `tests/api/music-demand.test.ts`, now against a real SQLite database and a recorded alert email.
- PASS (local tests only), 8.12 Invalid Stripe signatures change no data and invoice actions do not duplicate: `tests/api/stripe-webhook.test.ts` (real signature verification, 173 cases) and `tests/api/owner-payment.test.ts` (idempotency keys asserted). UNVERIFIED in Stripe test mode.
- UNVERIFIED, 8.13 No Stripe secret or customer identifier in owner HTML or API responses: not re-checked; `src/pages/owner/requests/[id].astro` changed in types only.
- UNVERIFIED, owner and studio journeys end to end in a browser.

## Delivery status and remaining gates

On the previous heads (`963a65e0`, `c26f4a7b`, `d83e658d`, built on `0a296a0a`), read on 2026-11-14: `validate`, Workers Builds and Greptile passed on all three, including the new lint step on #258, and `capture` passed on #256.

- UNVERIFIED: `validate`, Workers Builds, Screenshots, Greptile and Codex on the heads pushed with this update.
- UNVERIFIED: whether `validate` is a required check. A reviewer found no classic branch protection on `main`; rulesets were not checked.
- Merge condition: `main` moved in four steps during this work. Before merge, `git fetch`, and if `main` has moved, re-run `pnpm run lint` and the other gates on the stack merged with it.
- Effect on other work: once #258 merges, `validate` runs `pnpm run lint` on every open pull request for the first time. #268 changes files this stack also changes (`src/lib/audio-client-access.ts`, `client-emails.ts`, `owner-requests.ts`, `tests/api/studio-access.test.ts`), so expect a rebase there, and any pull request that carries a finding will fail.
- UNVERIFIED: post-deployment live verification. Merging deploys production. No runtime behaviour change is expected, but about 30 source files under `src/` changed and nothing was observed live.

Follow-ups after this stack, decided under the delegation above: the payment route's 502 against 409 answer, in its own pull request brought to the owner; the two older `vi.spyOn` tests; `format:check` in CI.

No deployment is authorized by this record. Merging follows the owner's standing rule and the delegation recorded under Owner decisions, once every gate above is observed clean.

Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.
