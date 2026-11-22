# Studio sign-in model extension: release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#360](https://github.com/kwilson21/thesuperhuman.us/pull/360), merged at 20:11:38 UTC as `84d20dda`
(head `eca2b472`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The order of `docs/plans/2026-11-effect-conversion.md` ("Go", 2026-11-15) and "Proceed"
(2026-11-22); section 7 of `docs/plans/2026-11-studio-signin-conversion.md` (#357) defines this model change. The model
work and its review passes were done with Claude Code; Codex reviewed the first head.
Rollback revision: `f33effae`, the revision of `main` before the merge; or `git revert -m 1 84d20dda`. No code.

## Scope

- `verification/signin-codes.qnt`: each later step of a request uses the time the request's read saw, as the code
  does; sessions (made only for the accepted code's token, revoked by sign-out under C9, read by a studio page only
  while active); `MAX_GUESSES` 2; a reachable starting point `signinSpent`; properties 14 to 18 and their mutants.
- `scripts/lib/quint-mutants.mjs`, `scripts/lib/quint-shards.mjs`, `tests/scripts/quint-run.test.ts`: the new
  checks, budgets (30,000 runs per mutant check, 20,000 per pass run) and scheduling hints.
- `docs/verification.md`: the sign-in model's state, actions, properties, mutants, what it leaves out, and the finding.
- `docs/prelaunch-qa-2026-11-22-signin-design.md`: the release record of #357.
- Nothing under `src/` changed; nothing deployed behaves differently.

## Evidence and limits

- The finding: once the model binds the time a request read, as the code does, the earlier statement of
  `deadCodeNeverSignsIn` (expiry judged when the write runs) fails: an entry that read just before its code expired is
  accepted just after, in the gap between its clock reading (made before its two hashes and its read batch) and its
  write batch. The model now states what the code guarantees (expired at the time the entry read); the old statement is
  kept, outside the checked set, as `expiredAtWriteNeverSignsIn`. Written up in `docs/verification.md`, "What the time
  alignment found (for the owner)".
- Reviews: Codex's review of the first head (`fd38cae1`) raised two points (no property read a session's expiry, and
  nothing required an accepted code to make a session), both fixed in `f90b5294` with properties 17 and 18 and four
  mutants. Independent Claude Code passes: the first found five points (a documentation error about the design's
  mutant, the spent start reachable only up to a renaming, session expiry claimed but unchecked, stale scheduling
  hints, two doc nits), fixed in `f90b5294`; the second found three (one half of property 18 had no mutant, two ways
  sessions end were missing from the list of what is not modelled, one hint), fixed in `eca2b472`. The last commit was
  checked against those three points and changes nothing else.
- Runs: both pass runs pass 20,000 runs (and passed 100,000 each once); every one of the 28 mutants breaks the property
  it is mapped to within its budget; the equivalent mutant `signinAcceptNoUsed` keeps every property; no property is
  without a mutant. `pnpm vitest run tests/scripts`: 1,290 passed; lint and format clean.
- CI on `eca2b472` before merge: all 20 check runs succeeded, the Workers preview build among them.
- After merge, on `84d20dda`: `validate` succeeded (20:14:12 UTC) and the Workers build succeeded (20:21:13 UTC). Live
  check at 20:21:26 UTC: `https://thesuperhuman.us/` answered 200.
- Seen during the work and not caused by it: under 4-job local load a Quint run that found its violation was twice
  classified "error" because its output stopped early; every rerun passed and CI has not shown it. Not investigated
  here.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** No code or page changed.

## 7. Release and final QA

- **PASS · Checks, reviews, rollback.** See above.
- **PASS, decided after release · The expiry gap.** Asked of the owner on 2026-11-22; the owner answered "You decide"
  (in conversation, 2026-11-22), and Claude Code decided as recommended: keep the code as it is (the code was valid at
  the entry's clock reading, and the gap, from that reading through two hashes and two round trips to the write, is
  milliseconds after a ten-minute life). The alternative, re-checking expiry at write time, needed a second clock
  reading that the non-interference test's clock guard fails on. The model records today's behaviour, so nothing
  changes.
- **N/A · Bindings, migrations.** None.
- **PASS · Production revision and live check.** Deployed `84d20dda`; the site answered 200.

## 8. Private owner center

- **N/A.** No change.
