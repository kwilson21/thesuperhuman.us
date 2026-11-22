# Studio sign-in behaviour fixes: release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#367](https://github.com/kwilson21/thesuperhuman.us/pull/367), merged at 20:39:16 UTC as `f9480f78`
(head `9ed3c1f5`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The 2026-11-14 decision (an unexpected database or store failure answers 500 with the route's
fixed sentence; 503 only for a missing binding or a known unavailable dependency) gives S1 and S2; S3 rests on the
shape the converted routes already have (`Background.defer`, `src/server/services.ts`). Section 5 of
`docs/plans/2026-11-studio-signin-conversion.md` (#357) defines the three fixes, made before the conversion so that the
conversion changes no behaviour. The work was done with Claude Code; Codex reviewed `8d47e542`.
Rollback revision: `84d20dda`, the revision of `main` before the merge; or `git revert -m 1 f9480f78`. No migration.

## Scope

- **S1, `POST /api/studio/code` and `/api/studio/session`.** A database failure, a hash failure or any other fault of
  the site answers 500, not 503, with the same body and sentence ("Studio sign-in is temporarily unavailable."), logged
  once through `logUnexpected`. A code key under 32 characters still answers 503 before any statement, at the point
  where it failed before (the code route after the body, shape and address checks; the session route after the
  no-cookie 401), checked there with `codeKeyUsable` (`src/lib/client-portal.ts`), the test `keyedHash` makes.
- **S2, `POST /api/studio/sign-out`.** A failed revoke answers 500 with the same `{ok:false, localSignedOut:true}` body
  and the cleared cookie, logged through `logUnexpected` instead of the fixed line. The missing-binding 503 stays.
- **S3, a code request with no execution context** (never in production). The delivery is awaited before the answer,
  as `Background.defer` does: the email is sent and the answer is the generic 200 with its cookie. It was a 503 with
  the code stored and no email sent. With a context nothing changes, and the delivery's log line is kept.
- No sentence a visitor sees changes. The page scripts read `response.ok` and the body, not the status
  (`src/scripts/studio-sign-in.ts`, `src/scripts/studio-sign-out.ts`).
- **The 10 changed golden cases** (of 241 in the three corpora), re-recorded in their own commit, `8d47e542`:
  `studio-code` 4 (the first allowance, second allowance and issue batch failures, 503 to 500 with one log line; the
  no-ctx case, renamed "no ctx: the email is sent before the visitor gets the generic 200", 503 to 200 with the Resend
  request in the request phase and the same stored code row), `studio-session` 4 (three batch failures, and a session
  that collides, whose one log line has an empty message because `logUnexpected` drops a message that names
  `token_hash`), `studio-sign-out` 2 (the failed revoke over https and over http on localhost). Every other case of
  every fixture is byte for byte unchanged; the "code key under 32 characters" cases among them.
- Outside the corpora, the "unmigrated database" case of the binding and non-interference tests (a missing table, a D1
  failure under S1) answers 500 with one log line.
- Docs: the README's migration note and the database outage row of `docs/verification.md` say a database fault answers
  500.
- `docs/prelaunch-qa-2026-11-22-signin-model.md`: the release record of #360.

## Evidence and limits

- `pnpm run golden:neutral --all origin/main HEAD` (PR description) compared 80 fixtures and 9,364 cases and reported
  NOT NEUTRAL in exactly the three studio fixtures: `studio-code` 114 identical, 3 not neutral, 1 added and 1 removed
  (the renamed no-ctx case; with `--allow-renames` it compares as one case, 503 to 200); `studio-session` 85 identical,
  4 not neutral; `studio-sign-out` 32 identical, 2 not neutral.
- Tests (PR description): `pnpm test` 387 files, 15,022 passed, 3 skipped; `pnpm run check` 0 errors; lint and format
  clean; the golden corpora pass with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1`. The new cases in
  `tests/api/studio-access.test.ts` cover each fix; five of them fail against the old routes, and the short-key cases
  pass on both, since they pin behaviour that does not change.
- Reviews: Codex's code and security reviews of `8d47e542` found nothing. An independent review found two stale
  documents (the README's migration note and `docs/verification.md`, which still said a database fault answers 503) and
  a count, fixed in `9ed3c1f5`.
- CI on `9ed3c1f5` before merge: all 20 check runs succeeded, the `neutrality` check and the Workers preview build
  (20:39:02 UTC) among them.
- After merge, on `f9480f78`: the Workers build succeeded (20:40:43 UTC) and `validate` succeeded (20:42:26 UTC).

## 1 to 4. Content, search, accessibility, performance

- **N/A.** No page changed.

## 5. Forms

- **PASS · The sign-in and sign-out answers.** The same sentences and bodies; only the status of a fault moves from
  503 to 500, and the page scripts do not read the status.

## 6. Privacy

- **PASS · Logs.** A fault is logged once through `logUnexpected`, which drops a message that names a token (the
  colliding session's line has an empty message). The non-interference test's comparisons across the target address's
  states are unchanged; only its unmigrated-database case moved to 500, with one log line.

## 7. Release and final QA

- **PASS · Checks, reviews, rollback.** See above.
- **PASS · Production revision and live check.** Deployed `f9480f78`. At 20:42:29 UTC `https://thesuperhuman.us/` and
  `https://thesuperhuman.us/studio/sign-in` answered 200, and a same-origin `POST /api/studio/code` with an empty JSON
  object answered 400 "Enter your email and complete the security check." (the portal is on and the route answers).
- **UNVERIFIED · The 500 answers live.** No sign-in was attempted and no database fault was induced live; the 500
  answers are held by the tests and the golden corpora.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
