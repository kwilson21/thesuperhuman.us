# Deposit guard on new offer terms (discount plan PR 2): release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/friendly-fermat-fk9ado`, from `origin/main` at `82e61315`
Commits: `41913883` (reproduction, recorded from the old code), `4246c592` (fix and re-recorded fixtures), `a288ba73` (review round 1 and this record), then review round 2
Pull request: [#285](https://github.com/kwilson21/thesuperhuman.us/pull/285)
Target: production `https://thesuperhuman.us` after merge (the owner API and the owner runbook only)
Decisions: Kazon Wilson (decision 9 of `docs/plans/2026-11-discount-flow.md`, 2026-11-13: reproduce against the real code and fix if real). Implementation and two independent review passes were done with Claude Code. Merge authorization: not given by this record.
Rollback revision: `82e61315`, the revision of `main` this branch was cut from. After merge, revert the merge commit to undo only this change.

## Scope

- `depositOfferBlock` and `depositOfferGuard` (`src/lib/software-invoices.ts`) count the first-milestone deposit invoice of every offer version of a request, not only the sent offer's. Sending a new draft is refused while one is creating, open, payment_failed, uncollectible or paid (and not refunded). A paid deposit on an earlier offer answers the new sentence "A deposit is paid on an earlier offer. Refund it in Stripe before sending new terms."; the other two sentences are unchanged.
- A decline and a withdraw are still stopped only by an open deposit. Reissuing the sent offer's link is not affected.
- Tests, all in `tests/golden/`: a cross-route case (deposit paid, decline, reopen, draft, send); four single-route cases (a paid deposit of a withdrawn offer and of a superseded offer, a refunded deposit of a withdrawn offer, and a deposit of a withdrawn offer paid between the read and the batch); one renamed case; five re-recorded fixtures; two trigger patterns that follow the new SELECT.
- Docs: the plan, `docs/verification.md`, the comments of `verification/discount-offers.qnt`, and the owner runbook (`docs/owner-operations.md`: which deposits block new terms, and the refund reconciliation command, which now carries `--remote` and says where to find the invoice id).
- No migration, no binding, no page or copy change outside the one new refusal sentence. No client-facing change.

## Evidence and limits

- **Reproduction:** recorded from the old code at `41913883`, the send step of the cross-route case answered 200 and wrote a new offer link over a deposit paid on the withdrawn offer. At the fix it answers 409 with the new sentence and writes nothing.
- `pnpm run golden:neutral --all` from `41913883` to `4246c592` (with a map for the renamed case): every case neutral (only the SQL text of the two deposit statements changed) except the two intended cases, both explained in the PR description. From `4246c592` to `a288ba73`: neutral, two cases added.
- `golden:diff` from `82e61315` for the five re-recorded fixtures: every existing case that changed differs only in that SQL text, except the renamed case. With the old `o.status='sent'` filter put back in the batch guard alone, the race case answers 200, so it catches that regression.
- Apalache (`quint verify verification/discount-offers.qnt --main <module> --init init --step stepOrEnd --invariant allProperties --max-steps N`), as the plan requires before a modelled rule changes: the `discount` module (the code with this guard) has no violation at 3 steps (21 s), 5 (17 s), 7 (61 s) and 10 (679 s). The old-guard mutant `discountTodayDepositGuard` violates state invariant 3 at step 11 of a 12-step run (1,145 s), so the search reaches the bug's depth and finds it. A 12-step run of `discount` was still running when this record was written (limit 50 minutes); no result is claimed for it until one is recorded here.
- `pnpm run verify:quint:all` (random simulation, 20 steps): every model keeps every property; every mutant fails its property, including `discountTodayDepositGuard` breaking `oneVersionInvoiced`.
- Local checks at the final head (Linux, Node 26.13.1): see section 7.

Independent review, round 1 (Claude Code, head `4246c592`): the code change is correct; every caller of the two functions behaves as described (decline and withdraw see only SQL text changes; reissue never calls the guard; a send is refused anyway once a project exists); the read and the batch guard use the same predicate. Fixed: the runbook still said only the current offer's deposit blocks; a stale comment on the cross-route case; no case exercised the batch guard on an earlier offer's deposit, and none had a paid deposit on a superseded offer; the plan's status line; this record was uncommitted.

Independent review, round 2 (Claude Code, head `a288ba73`): no code finding. Fixed: the runbook's refund reconciliation command had no `--remote`, so as written it changed only the local preview database and would not release the block in production; round 1's note claimed the local invoice id is only in D1, but every software invoice carries it in Stripe metadata as `software_invoice_id`; this record's evidence did not match the final head and lacked the rollback, receipt and remaining-work items; the plan still said Apalache had been run only to 3 steps and that every existing golden case is kept; the send corpus header did not list the new batch-guard failure.

## Owner decision needed

- After a decline and a reopen, the owner page lists no invoices of the withdrawn offer (the panel shows the project's or the sent offer's invoices only), so the paid deposit that now blocks a send is visible only in Stripe. The new sentence says "Refund it in Stripe" and does not mention the reconciliation command that records the refund (the existing "already paid" sentence has the same gap). The runbook now describes the command and where the id is. Options: show earlier offers' first deposits in the panel, name the reconciliation step in the sentence, or leave both since this path is rare.

## Remaining work

- Merge, production build and the live check, after the owner authorizes the merge.
- The owner decision above.
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
- **Receipt.** Implemented: yes. Verified locally: yes (above). Deployed: no. Verified live: no.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments state.
