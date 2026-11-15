# Deposit guard on new offer terms (discount plan PR 2): release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/friendly-fermat-fk9ado`, from `origin/main` at `82e61315`
Commits: `41913883` (reproduction, recorded from the old code), `4246c592` (fix and re-recorded fixtures), then the review round and this record
Pull request: [#285](https://github.com/kwilson21/thesuperhuman.us/pull/285)
Target: production `https://thesuperhuman.us` after merge (owner pages and the owner API only)
Decisions: Kazon Wilson (decision 9 of `docs/plans/2026-11-discount-flow.md`, 2026-11-13: reproduce against the real code and fix if real). Implementation and an independent review pass were done with Claude Code. Merge authorization: not given by this record.
Rollback revision: `82e61315`, the revision of `main` this branch was cut from. After merge, revert the merge commit to undo only this change.

## Scope

- `depositOfferBlock` and `depositOfferGuard` (`src/lib/software-invoices.ts`) count the first-milestone deposit invoice of every offer version of a request, not only the sent offer's. Sending a new draft is refused while one is creating, open, payment_failed, uncollectible or paid (and not refunded). A paid deposit on an earlier offer answers the new sentence "A deposit is paid on an earlier offer. Refund it in Stripe before sending new terms."; the other two sentences are unchanged.
- A decline and a withdraw are still stopped only by an open deposit. Reissuing the sent offer's link is not affected.
- Tests: a cross-route golden case (deposit paid, decline, reopen, draft, send), two added cases, one renamed case, five re-recorded fixtures. Docs: the plan, `docs/verification.md` and the comments of `verification/discount-offers.qnt`.
- No migration, no binding, no page or copy change outside the one new refusal sentence. No client-facing change.

## Evidence and limits

Local runs on Linux, Node 26.13.1, on head `4246c592`:

- **Reproduction:** recorded from the old code, the send step of the new case answered 200 and wrote a new offer link over a deposit paid on the withdrawn offer. After the fix it answers 409 with the new sentence and writes nothing.
- `pnpm run golden:neutral --all` from `41913883` to the fix: every case neutral (only the deposit statements' SQL text changed) except the two intended cases, both explained in the PR description.
- `pnpm test`: 298 files, 12,752 passed, 3 skipped.
- `pnpm run lint`: no findings. `pnpm run format:check`: no fixes. `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm run verify:quint:all`: every model keeps every property; every mutant fails its property, including `discountTodayDepositGuard` (the old guard).
- Apalache (`quint verify verification/discount-offers.qnt --main discount --init init --step stepOrEnd --invariant allProperties --max-steps N`), as the plan requires before a modelled rule changes: no violation at 3 steps (21 s), 5 (17 s), 7 (61 s) and 10 (679 s). Limit: the shortest run that shows the old guard's bug (deposit paid, decline, reopen, a second version sent and its deposit invoiced) is about 11 steps, so 10 does not reach it. A 12-step run of the design and of the old-guard mutant `discountTodayDepositGuard` was started; its result is recorded below when it finishes. The random simulation (`verify:quint:all`) does reach that depth and finds the mutant's violation.
- `golden:diff` from `82e61315` for the five re-recorded fixtures: every existing case that changed differs only in the SQL text of the two deposit statements, except the renamed case. Added cases: the cross-route reproduction, a paid deposit of a withdrawn offer and of a superseded offer (both refused with the new sentence), a refunded one (not refused), and a deposit of a withdrawn offer paid between the read and the batch (refused by the batch guard; with the old `o.status='sent'` filter put back in the guard alone it answers 200, so the case catches that regression).

Independent review (Claude Code, head `4246c592`): the code change is correct; every caller of the two functions behaves as described (decline and withdraw only see SQL text changes; reissue never calls the guard; a project start or reopen is refused anyway once a project exists); the read and the batch guard use the same predicate. Findings fixed in the review round: the owner runbook (`docs/owner-operations.md`) still said only the current offer's deposit blocks; a stale comment on the new golden case; no case exercised the batch guard on an earlier offer's deposit, and none had a paid deposit on a superseded offer; the plan's status line; this record was uncommitted. One finding needs an owner decision and is not changed here (see "Owner decision needed").

## Owner decision needed

- After a decline and a reopen, the owner page shows no invoices of the withdrawn offer (the panel lists the project's or the sent offer's invoices only), so the paid deposit that now blocks a send is not visible there. Releasing it needs a Stripe refund and then `pnpm run owner:stripe:reconcile --software-deposit-refunded LOCAL_INVOICE_ID Confirmed`, and the local invoice id is only in D1. The new sentence says "Refund it in Stripe" and does not mention the reconciliation step (the existing "already paid" sentence has the same gap). Options: show the earlier offers' first deposits in the panel, name the reconciliation step in the sentence, or leave both as they are since this path is rare. The runbook now describes the step.

UNVERIFIED until checked:

- The new sentence as the owner sees it on the offer page in production (it is shown in the existing error area of the send form; no layout change).
- A production request that already has a paid deposit on a withdrawn offer. None is known; if one exists, its next send is now refused until the deposit is refunded.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `origin/main`; owner-only behaviour.
- **PASS · Approved design and truthful claims.** The refusal sentence is the one in the approved plan.
- **N/A · Explanatory copy, first screen, navigation.** Not changed.

## 2. Search and sharing

- **N/A · Metadata, sitemap, structured data.** No route or head change.

## 3. Accessibility and responsive behavior

- **N/A · Layout, images, forms, focus, widths.** No markup change; the sentence uses the send form's existing error output.

## 4. Performance and resilience

- **PASS · Queries.** The pre-check and the batch guard read the same invoices as before without the offer status filter; one extra column in the read. No new statement.

## 5. Forms and sensitive flows

- **PASS · Server validation and approval gating.** The guard runs in the owner API behind Cloudflare Access; the batch guard re-checks at write time, so a deposit that becomes paid between the read and the batch rolls the send back.

## 6. Privacy, legal and measurement

- **N/A · Data, cookies, analytics.** No new data collected or stored.

## 7. Release and final QA

- **PASS · Checks.** See Evidence.
- **PASS · Diff review.** No secrets, no generated public artifacts, no unrelated changes.
- **N/A · Bindings, migrations.** None.
- **UNVERIFIED · Production revision and live check.** To be recorded after an authorized merge.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments state.
