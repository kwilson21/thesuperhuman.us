# Studio sign-in conversion design: release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#357](https://github.com/kwilson21/thesuperhuman.us/pull/357), merged at 18:55:48 UTC as `0097b63f`
(head `f88e206e`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The order of `docs/plans/2026-11-effect-conversion.md` ("Go", 2026-11-15), in which this is
step 2, and "Proceed" (2026-11-22). The one decision this design asked for: a lost race on the code and session routes
keeps answering like a refusal, an exception to the 409 rule (owner, 2026-11-22: "Yes, record the exception"). The
design and its review passes were done with Claude Code; Codex reviewed the first head.
Rollback revision: `2f93a646`, the revision of `main` before the merge; or `git revert -m 1 0097b63f`. Docs only.

## Scope

- `docs/plans/2026-11-studio-signin-conversion.md` (new): the design for converting `POST /api/studio/code`, `session`
  and `sign-out`: one machine for the sign-in code, the rules moved into `rule()`, flows that keep every round trip and
  clock read, a store that keeps today's SQL text, the behaviour fixes S1 to S3, the Quint extension and the PR order.
- `docs/plans/2026-11-effect-conversion.md`: step 2 links the design. No code changed; nothing deployed behaves
  differently.

## Evidence and limits

- Reviews: Codex's review of the first head (`77a407b2`) raised five points, each fixed or answered on the PR. Five
  independent Claude Code passes followed, each checking the design's claims and citations against the code; the
  last found one point (the discard must catch only its raised guard, so a store failure is still logged), fixed in
  `88398fd7`. A sixth pass on the last two commits (`88398fd7`, and `f88e206e`, which records the owner's decision)
  found nothing.
- CI on the head `f88e206e` before merge: all 20 check runs succeeded, `validate`, `neutrality` and the Workers preview
  build among them; the preview build reported before the merge.
- After merge, on `0097b63f`: the Workers build succeeded (18:57:27 UTC) and `validate` succeeded (18:59:55 UTC). Live
  check at 19:00 UTC: `https://thesuperhuman.us/` answered 200, and a POST to `/api/studio/sign-out` with no Origin
  answered 403 from the middleware's cross-site check ("Cross-site studio actions are forbidden"), as before.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** Docs only.

## 7. Release and final QA

- **PASS · Checks, reviews, rollback.** See above.
- **N/A · Bindings, migrations.** None.
- **PASS · Production revision and live check.** Deployed `0097b63f`; the site answered 200.

## 8. Private owner center

- **N/A.** No change.
