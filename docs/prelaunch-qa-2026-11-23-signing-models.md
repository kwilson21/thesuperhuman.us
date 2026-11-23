# Signing models: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: not opened yet; its number goes here when it is. Merge facts are recorded after the merge, in the next
pull request.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The order of `docs/plans/2026-11-effect-conversion.md` ("Go", 2026-11-15) and the step 3
design (`docs/plans/2026-11-signing-conversion.md`, #376), whose section 8 makes this PR 3: the two Quint models
extended before any fix or conversion code. The model work was done with Claude Code.
Rollback revision: the revision of `main` before the merge, or `git revert -m 1` of the merge commit. Models, the Quint
driver's registry, its tests and docs only.

## Scope

- `verification/discount-offers.qnt`: the emailed signing link (a read, then the batch with A4 and A1) and its redeem
  (a read, then the batch with A1 and A5) making the session; the session revoked by the retirement every send,
  reissue, revoke, decline and abandon runs; the signing setting switched off and on; review and sign each as a read
  and a batch; countersign (A10, A11) and abandon (A12, A11; it supersedes the offer, revokes the offer link, the
  offer's sessions and links); a website start that needs an executed agreement and retires nothing. Properties 8 to 12
  (`reviewOfSentOffer`, `noSessionForDeadOffer`, `executedStays`, `executedOnlyWhenSigned`, `abandonedHasNoDeposit`)
  and six mutants (`ReviewNoGuards`, `SignGuardsAtRead`, `RedeemNoLiveGuard`, `AbandonNoStatusGuard`,
  `CountersignNoGuards`, `AbandonDepositAtRead`); `NoSignGuards` restated for the split sign.
- `verification/audio-project-notices.qnt`: the kinds `copy` (A18) and `signing` (A19, A21), reset by A20; properties
  `copyOnlyWhenExecuted` and `noticeOnlyBeforeCountersign` with the mutants `CopyClaimNoState` and
  `NoticeClaimNoState`; two pass runs.
- `scripts/lib/quint-mutants.mjs`, `scripts/lib/quint-shards.mjs`, `tests/scripts/quint-run.test.ts`: the new checks,
  `discountAcceptedOnlyCheck` moved from the equivalent mutants to the mutants, and the scheduling hints.
- `docs/verification.md`: both models' extensions, the measurements and the Apalache runs.
- Nothing under `src/` changed; nothing deployed behaves differently.

## Evidence and limits

- Every guard and step modelled was read in today's code at `585619c1`; where the design summarises, the model follows
  the code (`docs/verification.md`, "Checked against the code" and "The agreements' kinds in the notices model").
- Runs: `pnpm run verify:quint` (23 pass runs) and `pnpm run verify:quint:mutants` (192 checks) passed with three runs at
  a time; every new mutant breaks the property mapped to it; no property is without a mutant. At 50 steps every new
  discount mutant is found within about 955 runs, so `steps` stays 50. `pnpm vitest run tests/scripts`: 1,308 passed;
  lint and format clean.
- Not a finding about today's code: every property holds on the model of the code. Two changes of earlier records:
  `discountAcceptedOnlyCheck` (the live-link check before F9's fix) is no longer an equivalent mutant, because the
  abandon revokes the offer link with no sending window; and the pass run no longer reaches the deepest discount
  witness (`neverStandardPaidAfterSentRevision`) at the CI setting, since a start now needs a signing and a countersign
  (reached by hand at 80 steps).
- Apalache: `discount` keeps every property up to 9 steps (6 minutes), and `RedeemNoLiveGuard` is found at 7; see
  `docs/verification.md`, "Exhaustive, after the signing extension". The full `pnpm run verify:quint:exhaustive` passed
  its first five modules, `discount` among them, and reached `offerBoard` (not changed here), which was still running at
  7 steps after 36 minutes and was stopped; `allowance` (not changed) was stopped by hand after 10 minutes, and
  `pricing`, `publication` and `agreementLink` passed by hand at 7 steps. The notices model's new modules were run by
  hand to 7 steps.
- Reviews and CI: UNVERIFIED until they report; recorded with the merge facts.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** Models, tests and docs only.

## 7. Release and final QA

- **UNVERIFIED · Checks, reviews, production revision and live check.** Recorded after the merge.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
