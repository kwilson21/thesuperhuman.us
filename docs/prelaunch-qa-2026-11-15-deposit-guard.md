# Deposit guard on new offer terms (discount plan PR 2): release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/friendly-fermat-fk9ado`, from `origin/main` at `82e61315`
Commits: `41913883` (reproduction, recorded from the old code), `4246c592` (fix and re-recorded fixtures), `a288ba73` (review round 1 and this record), `79461783` (review round 2), `61d3d795` (review round 3), `c25ba5ce` (review round 4), `4147583e` (review round 5, the merged head)
Pull request: [#285](https://github.com/kwilson21/thesuperhuman.us/pull/285)
Target: production `https://thesuperhuman.us` after merge (the owner API and the owner runbook only)
Decisions: Kazon Wilson (decision 9 of `docs/plans/2026-11-discount-flow.md`, 2026-11-13: reproduce against the real code and fix if real). Implementation and five independent review passes were done with Claude Code. Merge authorization: the owner, in conversation on 2026-11-15 ("Yes").
Rollback revision: `82e61315`, the revision of `main` this branch was cut from. After merge, revert the merge commit to undo only this change.

## Scope

- `depositOfferBlock` and `depositOfferGuard` (`src/lib/software-invoices.ts`) count the first-milestone deposit invoice of every offer version of a request, not only the sent offer's. Sending a new draft is refused while one is creating, open, payment_failed, uncollectible or paid (and not refunded). A paid deposit on an earlier offer answers the new sentence "A deposit is paid on an earlier offer. Refund it in Stripe before sending new terms."; the other two sentences are unchanged.
- A decline and a withdraw are still stopped only by an open deposit. Reissuing the sent offer's link is not affected.
- Tests, all in `tests/golden/`: a cross-route case (deposit paid, decline, reopen, draft, send); four single-route cases (a paid deposit of a withdrawn offer and of a superseded offer, a refunded deposit of a withdrawn offer, and a deposit of a withdrawn offer paid between the read and the batch); one renamed case; five re-recorded fixtures; two trigger patterns that follow the new SELECT.
- Docs: the plan, `docs/verification.md`, the comments of `verification/discount-offers.qnt`, the owner runbook (`docs/owner-operations.md`: which deposits block new terms; the software reconciliation commands now carry `--remote`, and the runbook says where to find the invoice id) and `docs/stripe-invoicing-readiness.md` (its audio reconciliation commands also carry `--remote`).
- Script: `scripts/stripe-reconciliation.mjs` dropped its first argument whenever `--config` was not given, so every documented reconciliation command lost its action (for example `--software-deposit-refunded`) and was refused with a usage error, writing nothing. The argument handling is now `reconciliationArgs`, which drops only `--remote` and `--config` with its path, with a test (`tests/scripts/stripe-reconciliation.test.ts`). This matters here because recording a refund is the only way to release the new block.
- No migration, no binding, no page or copy change outside the one new refusal sentence. No client-facing change.

## Evidence and limits

- **Reproduction:** recorded from the old code at `41913883`, the send step of the cross-route case answered 200 and wrote a new offer link over a deposit paid on the withdrawn offer. At the fix it answers 409 with the new sentence and writes nothing.
- `pnpm run golden:neutral --all` from `41913883` to `4246c592` (with a map for the renamed case): every case neutral (only the SQL text of the two deposit statements changed) except the two intended cases, both explained in the PR description. From `4246c592` to `a288ba73`: neutral, two cases added.
- `golden:diff` from `82e61315` for the five re-recorded fixtures: every existing case that changed differs only in that SQL text, except the renamed case. With the old `o.status='sent'` filter put back in the batch guard alone, the race case answers 200, so it catches that regression.
- Apalache (`quint verify verification/discount-offers.qnt --main <module> --init init --step stepOrEnd --invariant allProperties --max-steps N`), as the plan requires before a modelled rule changes: the `discount` module (the code with this guard) has no violation at 3 steps (21 s), 5 (17 s), 7 (61 s), 10 (679 s) and 12 (2,137 s). The old-guard mutant `discountTodayDepositGuard` violates state invariant 3 at step 11 of a 12-step run (1,145 s), so the search reaches the bug's depth and finds it. So at 12 steps, one past the step where the old guard fails, the code's guard has no violation.
- `pnpm run verify:quint:all` (random simulation, 20 steps): every model keeps every property; every mutant fails its property, including `discountTodayDepositGuard` breaking `oneVersionInvoiced`.
- Local checks at the final head (Linux, Node 26.13.1): see section 7.

Independent review, round 1 (Claude Code, head `4246c592`): the code change is correct; every caller of the two functions behaves as described (decline and withdraw see only SQL text changes; reissue never calls the guard; a send is refused anyway once a project exists); the read and the batch guard use the same predicate. Fixed: the runbook still said only the current offer's deposit blocks; a stale comment on the cross-route case; no case exercised the batch guard on an earlier offer's deposit, and none had a paid deposit on a superseded offer; the plan's status line; this record was uncommitted.

Independent review, round 2 (Claude Code, head `a288ba73`): no code finding. Fixed: the runbook's refund reconciliation command had no `--remote`, so it could not reach production; round 1's note claimed the local invoice id is only in D1, but every software invoice carries it in Stripe metadata as `software_invoice_id`; this record's evidence did not match the final head and lacked the rollback, receipt and remaining-work items; the plan still said Apalache had been run only to 3 steps and that every existing golden case is kept; the send corpus header did not list the new batch-guard failure.

Independent review, round 3 (Claude Code, head `79461783`): no finding in the guard. Found and fixed: the reconciliation script's argument bug above (reproduced with a stub database: the documented order was refused, and only `--remote` first reached the batch); the paragraph's two other software reconciliation commands had no `--remote`; round 2's note said the old command changed the local database, when it was refused; the receipt line had no status.

Independent review, round 4 (Claude Code, head `61d3d795`): `reconciliationArgs` checked against every argument shape with a stub database (no flags, `--remote` before or after the action, `--remote --config path` before or after, `--config` without `--remote` or without a path, which the script refuses before opening the database); behaviour with `--config` is unchanged. Fixed: the audio reconciliation commands in `docs/stripe-invoicing-readiness.md` had no `--remote` (after the script fix they would have run against the local preview database); the usage error named only the two audio actions; this record's count of review passes.

Independent review, round 5 (Claude Code, head `c25ba5ce`): no code finding. Fixed in `4147583e`: `docs/verification.md` still said the discount model had been run exhaustively only to 3 steps; this record stated the 12-step result twice. The two one-sentence corrections were checked against the run outputs rather than given a sixth pass.

## Owner decision needed (open after merge)

- The follow-up #287 (open, waiting for the owner's answer) proposes the recommendation given to the owner on 2026-11-15: the refusals name the step that records the refund (`owner:stripe:reconcile --software-deposit-refunded`), and the owner page is left as it is. The point as raised:
- After a decline and a reopen, the owner page lists no invoices of the withdrawn offer (the panel shows the project's or the sent offer's invoices only), so the paid deposit that now blocks a send is visible only in Stripe. The new sentence says "Refund it in Stripe" and does not mention the reconciliation command that records the refund (the existing "already paid" sentence has the same gap). The runbook now describes the command and where the id is. Options: show earlier offers' first deposits in the panel, name the reconciliation step in the sentence, or leave both since this path is rare.

## Remaining work

- #287, the refusal sentences.
- Discount PRs 3 to 6, after the offers, signing and payments areas move to Effect.

UNVERIFIED until checked:

- The new sentence as the owner sees it on the offer page in production (it uses the send form's existing error output; no layout change).
- A production request that already has a paid deposit on a withdrawn offer. None is known; if one exists, its next send is now refused until the deposit's refund is recorded.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `origin/main`; owner-only behaviour.
- **PASS · Approved design and truthful claims.** The refusal sentence is the one in the approved plan.
- **N/A · Explanatory copy, first screen, navigation.** No public page changes.

## 2. Search and sharing

- **N/A · Metadata, sitemap, structured data.** No route or head change.

## 3. Accessibility and responsive behavior

- **N/A · Layout, images, forms, focus, widths.** No markup change; the sentence uses the send form's existing error output.

## 4. Performance and resilience

- **PASS · Queries.** The pre-check and the batch guard read the same invoices as before without the offer status filter, plus one column in the read. No new statement.

## 5. Forms and sensitive flows

- **PASS · Server validation and approval gating.** The guard runs in the owner API behind Cloudflare Access; the batch guard re-checks at write time, so a deposit that becomes paid between the read and the batch rolls the send back (golden case "a deposit of a withdrawn offer is paid before the batch").

## 6. Privacy, legal and measurement

- **N/A · Data, cookies, analytics.** No new data collected or stored.

## 7. Release and final QA

- **PASS · Checks at the final head.** Recorded in the PR description for the final head: `pnpm test`, `pnpm run check`, `pnpm run lint`, `pnpm run format:check`.
- **PASS · Diff review.** No secrets, no generated public artifacts, no unrelated changes.
- **N/A · Bindings, migrations, backups.** None.
- **PASS · Rollback version.** `82e61315`; after merge, revert the merge commit.
- **PASS · Merge and production build.** Merged 2026-11-15 11:03:09 UTC as `86773378` (first parent `82e61315`). On the merge commit: `validate` succeeded (Validate run 43707026841), and the check run "Workers Builds: thesuperhuman-us" succeeded at 11:04:49 UTC.
- **PASS, with limits · Live check.** 2026-11-15, minutes after the merge: `https://thesuperhuman.us/` answered 200, and `https://thesuperhuman.us/api/owner/requests/r1/software` without an Access login answered 302 (to the Access login), so the owner API still fails closed. The guard itself was not exercised live: that needs the owner's Access login and a request with a paid deposit, and none was made.
- **PASS, with limits · Receipt.** Implemented, verified locally, deployed (`86773378`). Verified live: the site and the owner API's Access gate only; the new refusal is UNVERIFIED live.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments state.
