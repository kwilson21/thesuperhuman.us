# Sign-in noninterference harness, the clock race: release gate

Date: November 16, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#333](https://github.com/kwilson21/thesuperhuman.us/pull/333), merged at 00:08:52 UTC as `b6046837`
(head `d390266a`).
Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson, in conversation on 2026-11-15 ("yes you can merge", for this work's
pull requests once reviews pass and CI is green). The fix and the independent review were done with Claude Code; Codex
reviewed the head.
Rollback revision: `d04fcfef`, the revision of `main` before the merge; or `git revert -m 1 b6046837`.

## Scope

- `tests/api/studio-signin-noninterference.test.ts` only. The harness held back only a request's three database
  batches, so the work before the first batch (the allowance batches, Turnstile and the clock read that stamps the
  code) ran unscheduled, and whether it saw the 11-minute clock step depended on timing. A held-back request now starts
  at its first scheduled step. No route, library or fixture changed; nothing deployed changes behaviour.

## Evidence and limits

- The case "a request racing the passing of time, client" failed between about 1 run in 8 and 1 in 3 on `main` and
  failed CI on PR #331; with the fix it passed 50 of 50 runs alone, and the file 5 of 5 (the reviewer: 33 of 33 and 6
  of 6 under parallel load). A new case fails on the old harness and passes on the new.
- The reviewer planted three cross-address leaks in the sign-in code (the replace-delete ignoring the address, an extra
  allowance on issue, a clock-only delete of every expired code); each fails the file, and the old harness missed the
  clock-only one. Across 3,620 runs, every other case's observations are byte-identical before and after.
- Codex's code and security reviews found nothing. CI before merge: `validate`, `neutrality` and the Workers preview
  build succeeded.
- After merge, on `b6046837`: the Workers build succeeded (00:13:20 UTC) and `validate` succeeded (00:22:16 UTC). Live
  check at 00:22 UTC: `https://thesuperhuman.us/` answered 200.

Known and not changed: the harness now reads the clock right before a request's first batch, so the interleaving where
the route reads the clock before the clock step and its first batch runs after it is no longer explored; it does not
bear on noninterference here (the read batch binds no time). `verification/signin-codes.qnt` stamps a new code with the
write step's time while the code stamps it with the time read before the read batch; to be checked in the studio
sign-in conversion's design.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** A test file only.

## 7. Release and final QA

- **PASS · Checks, diff review, rollback.** See above.
- **N/A · Bindings, migrations.** None.
- **PASS · Production revision and live check.** Deployed `b6046837`; the site answered 200.

## 8. Private owner center

- **N/A.** No change.
