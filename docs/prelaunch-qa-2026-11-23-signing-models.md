# Signing models: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#383](https://github.com/kwilson21/thesuperhuman.us/pull/383), merged at 06:10:07 UTC as `31e32124`
(head `a1b96883`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The order of `docs/plans/2026-11-effect-conversion.md` ("Go", 2026-11-15) and the step 3
design (`docs/plans/2026-11-signing-conversion.md`, #376), whose section 8 makes this PR 3: the two Quint models
extended before any fix or conversion code. The model work was done with Claude Code.
Rollback revision: `585619c1`, the revision of `main` before the merge; or `git revert -m 1 31e32124`. Models, the
Quint driver's registry, its tests and docs only.

## Scope

- `verification/discount-offers.qnt`: the emailed signing link (a read, then the batch with A4 and A1) and its redeem
  (a read, then the batch with A1 and A5) making the session; the session revoked by the retirement every send,
  reissue, revoke, decline and abandon runs; the signing setting switched off and on; review and sign each as a read
  and a batch; countersign (A10, A11) and abandon (A12, A11; it supersedes the offer, revokes the offer link, the
  offer's sessions and links); a website start that needs an executed agreement and retires nothing. Properties 8 to 13
  (`reviewOfSentOffer`, `noSessionForDeadOffer`, `executedStays`, `executedOnlyWhenSigned`, `abandonedHasNoDeposit`,
  `signedStaysSigned`) and seven mutants (`ReviewNoGuards`, `SignGuardsAtRead`, `RedeemNoLiveGuard`,
  `AbandonNoStatusGuard`, `CountersignNoGuards`, `AbandonDepositAtRead`, `ReviewNoSignedGuard`); `NoSignGuards` restated
  for the split sign.
- `verification/audio-project-notices.qnt`: the kinds `copy` (A18) and `signing` (A19, A21), reset by A20; properties
  `copyOnlyWhenExecuted`, `noticeOnlyBeforeCountersign` and `noSendingAfterCountersign` with the mutants
  `CopyClaimNoState`, `NoticeClaimNoState` and `NoObsolete`; two pass runs.
- `scripts/lib/quint-mutants.mjs`, `scripts/lib/quint-shards.mjs`, `tests/scripts/quint-run.test.ts`: the new checks,
  `discountAcceptedOnlyCheck` moved from the equivalent mutants to the mutants, and the scheduling hints.
- `docs/verification.md`: both models' extensions, the measurements and the Apalache runs.
- Nothing under `src/` changed; nothing deployed behaves differently.

## Evidence and limits

- Every guard and step modelled was read in today's code at `585619c1`; where the design summarises, the model follows
  the code (`docs/verification.md`, "Checked against the code" and "The agreements' kinds in the notices model").
- Runs: `pnpm run verify:quint` (23 pass runs) and `pnpm run verify:quint:mutants` (192 checks) passed with three runs
  at a time, and again after the review fixes with four (23 pass runs, the discount pass run at 80 steps in 173 s; 194
  checks); every new mutant breaks the property mapped to it; no property is without a mutant. At 50 steps every new
  discount mutant is found within about 955 runs, so `steps` stays 50 for the mutant checks. `pnpm vitest run
  tests/scripts`: 1,308 passed; lint and format clean.
- Not a finding about today's code: every property holds on the model of the code. Two changes of earlier records:
  `discountAcceptedOnlyCheck` (the live-link check before F9's fix) is no longer an equivalent mutant, because the
  abandon revokes the offer link with no sending window; and the deepest discount witness
  (`neverStandardPaidAfterSentRevision`) needs at least 33 steps, since a start now needs a signing and a countersign,
  and is not reached at 50. So a model may now set `passSteps` apart from `steps` (as it already sets `passSamples`):
  the discount model's runs that must pass take 80 steps, where the witness is reached in about 710 runs; at 80 the pass
  run and the equivalent mutant each kept every property in 167 s, against 90 to 96 s for the pass run at 50.
- Apalache: `discount` keeps every property up to 9 steps (6 minutes), and `RedeemNoLiveGuard` is found at 7; see
  `docs/verification.md`, "Exhaustive, after the signing extension". The full `pnpm run verify:quint:exhaustive` passed
  its first five modules, `discount` among them, and reached `offerBoard` (not changed here), which was still running at
  7 steps after 36 minutes and was stopped; `allowance` (not changed) was stopped by hand after 10 minutes, and
  `pricing`, `publication` and `agreementLink` passed by hand at 7 steps. The notices model's new modules were run by
  hand to 7 steps.
- Codex's code review raised three points, all fixed in the PR: the docs said 50 steps for the discount model's runs
  that must pass, which make 80 since `passSteps`; A21 had no property or mutant (now `noSendingAfterCountersign`,
  mutant `NoObsolete`, found in the first run); A3 had no mutant (now `signedStaysSigned`, mutant `ReviewNoSignedGuard`,
  about 27 runs). In code A3 is backed by the one-live-SOW unique index (0023:13), which refuses the same review batch,
  so dropping A3 alone would be equivalent there; the model holds the two as one condition and the mutant removes both.
- An independent review of the head `776f724f` found nothing blocking. Its points, folded in: the model's sign read
  no longer compares the session that reviewed (today's read compares documents; only A9 checks the session); the docs
  say that A2 refuses nothing A1 does not in the model, so the review and sign mutants drop both, that
  `discountAcceptedOnlyCheck` is killed only because the model lets the client use a link only the failed email carried,
  and that the draft batch's own A3 is folded into the review's read and does not protect `signedStaysSigned`.
- Codex's security review found nothing. A second independent pass, on the fix commits, found nothing blocking; its two
  small notes (a stale comment calling `discountAcceptedOnlyCheck` equivalent, two lines' indent) were fixed in
  `a1b96883`.
- CI on the head `a1b96883` before merge: all 20 check runs succeeded, the Quint shards and the Workers preview build
  among them.
- After merge, on `31e32124`: the Workers build succeeded (06:11:21 UTC) and `validate` succeeded (06:14:03 UTC). Live
  check at 06:14:25 UTC: `https://thesuperhuman.us/` answered 200, and `/agreements/verify?key=x` answered 401 with the
  expired page, as before.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** Models, tests and docs only.

## 7. Release and final QA

- **PASS · Checks, reviews, rollback.** See above.
- **PASS · Production revision and live check.** Deployed `31e32124`; the site answered 200.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
