# Deposit refusals, conversion plan and offer terms on Effect Schema: release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull requests, merged in this order on 2026-11-15:
- [#288](https://github.com/kwilson21/thesuperhuman.us/pull/288) at 14:12:27 UTC as `a416e34f` (head `da665a32`): the conversion plan, the zero-Zod rule, the #285 release record. Docs only.
- [#287](https://github.com/kwilson21/thesuperhuman.us/pull/287) at 14:12:30 UTC as `fd3c8170` (head `0e0e1263`): three owner-facing deposit refusals name the step that records a refund.
- [#289](https://github.com/kwilson21/thesuperhuman.us/pull/289) at 14:12:33 UTC as `399406ed` (head `d96d73bc`): the offer terms validator moved from Zod to Effect Schema, behaviour unchanged.

Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson, in conversation on 2026-11-15: "Go" to merging all three, to the
discount-first order, and to renaming the offer terms error in the log. Implementation and the independent review
passes were done with Claude Code; Codex reviewed each pull request.
Rollback revision: `8b5b4efd`, the revision of `main` before the first of the three merges. To undo one change only,
revert its merge commit.

## Scope

- #287: the send refusals for a paid deposit (on the sent offer, and on an earlier offer) and the abandon-signing
  refusal for a deposit that is creating, open, payment_failed, uncollectible, or paid and not refunded now say to record a refund with
  `owner:stripe:reconcile --software-deposit-refunded`; the first also says new terms can't be sent while an agreement
  is signed. Owner pages only; no status, guard or write changes. 16 golden cases differ, each only in the response
  sentence.
- #288: `docs/plans/2026-11-effect-conversion.md`, the Zod sentences in CLAUDE.md and AGENTS.md, and the release
  record of #285. No code.
- #289: the offer terms validator (`offerTermsSchema`, now `readOfferTerms` and `parseOfferTerms`) is Effect Schema, held by a differential test to the frozen Zod 3 copy over about 18,500
  inputs. No golden fixture changed; the PR carried the `conversion` label, so the neutrality check enforced it.

## Evidence and limits

- Each head, before merge: `validate`, `neutrality` and the Workers preview build succeeded; #289 also `capture`.
  Locally (Node 26.13.1), on the content of each merged head: #287, the full `pnpm test` (13,070 passed) and
  `pnpm run lint` after the last merge of main; #288 (docs only), `tests/scripts` and `tests/architecture`,
  `pnpm run format:check` and the copy check; #289, the full `pnpm test` (13,075 passed), `pnpm run lint`,
  `pnpm run format:check` and `pnpm run check` (0 errors). `pnpm run check` was run on earlier heads of #287, not
  recorded on its last.
- Reviews: Codex's code and security reviews of each PR's first head found nothing on #287 and #289 and four points on
  #288, all fixed. Independent Claude Code passes reviewed every head but the last of each PR, and each finding was
  fixed. The last changes were tested, not reviewed again: a merge of main into #287 re-recording two fixtures
  (checked by `golden:neutral`, the same 16 cases), two sentences in #288, and a two-line loop in #289 (the full suite).
- After merge: on `399406ed`, which holds all three, `validate` succeeded (14:27:22 UTC) and the check run
  "Workers Builds: thesuperhuman-us" succeeded (14:20:02 UTC). The `validate` runs on `a416e34f` and `fd3c8170` were
  cancelled by the newer push, as the workflow does.
- Live check, 2026-11-15 shortly after the build: `https://thesuperhuman.us/` answered 200, and
  `https://thesuperhuman.us/api/owner/requests/r1/software` without an Access login answered 302 (to the Access
  login), so the owner API still fails closed.

UNVERIFIED until checked:

- The new refusal sentences as the owner sees them on the offer and agreement pages in production. They need the
  owner's Access login and a request with a paid or open deposit.
- Offer terms read in production through the new validator. Every route that reads them is behind Access or a client
  link; no live request was made.

## 1. Purpose and content

- **PASS · Changes, instructions and audience.** Owner-only sentences, docs and a validator with no behaviour change.
- **PASS · Approved decisions.** The owner's 2026-11-15 decisions are quoted in the plan and above.
- **N/A · Public copy, first screen, navigation.** No public page changes.

## 2. Search and sharing

- **N/A.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **N/A.** No markup change; the sentences use the existing error outputs.

## 4. Performance and resilience

- **PASS · Validator.** The Effect Schema reader collects issues in a loop, so a very large refused list answers with
  its issues instead of a stack overflow (unreachable today: the owner route caps bodies at 80 KB).

## 5. Forms and sensitive flows

- **PASS · Server validation.** The offer terms still validate on the server with identical answers (differential
  test); the deposit guards are unchanged.

## 6. Privacy, legal and measurement

- **N/A.** No new data.

## 7. Release and final QA

- **PASS · Checks, diff review, rollback.** See above.
- **N/A · Bindings, migrations.** None.
- **PASS, with limits · Production revision and live check.** Deployed `399406ed`; the site and the owner API's Access
  gate checked live; the changed sentences and the validator UNVERIFIED live.
- **PASS, with limits · Receipt.** Implemented, verified locally, deployed. Verified live: the site and the Access gate
  only.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments
  state.
