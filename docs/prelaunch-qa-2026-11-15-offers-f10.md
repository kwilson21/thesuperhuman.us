# F10, a draft saved during a decline's email: release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#331](https://github.com/kwilson21/thesuperhuman.us/pull/331), merged at 23:01:15 UTC as `6471ff2d`
(head `0c5446f2`).
Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson, in conversation on 2026-11-15: "Do the fixes and yes you can merge", to
the recommendation of `docs/plans/2026-11-offers-conversion.md`, section 5 (fix F10 if the model confirms it; #317's
model did). Implementation, the model change and the independent review passes were done with Claude Code; Codex
reviewed the first head.
Rollback revision: `351ce67f`, the revision of `main` before the merge; or `git revert -m 1 6471ff2d`.

## Scope

- `POST /api/owner/requests/[id]/software`, decline only: after the client email, the route reads whether a draft or
  sent offer is left and refuses before the second batch; the batch guards the same condition. A refusal answers
  through the existing lookups (project started, still sending, then 409 "The client email was sent, but the request
  changed before it could be recorded. Reload before taking another action."). A failed read answers the after-email
  500 and is logged once. Owner pages only; no migration, no binding.
- `verification/discount-offers.qnt`: `discount` carries the fix; the weaker property form, `discountF10Fix` and
  `F10_FIX` are removed; the send's live-link check matches F9 (`sendLinkLive`); two equivalent mutants with their
  reasons.
- `docs/prelaunch-qa-2026-11-15-offers-model-and-fixes.md`, the release record of #317, #313, #314 and #316.

## Evidence and limits

- Golden: four F10 cases recorded on the old code first (a draft saved during the email; a draft saved and sent with a
  20-second-old link; the same with a fresh link; a draft saved just before the second batch), then the fix. Three
  change from 200 (resolved with an offer left) to 409 with the request open; the fresh-link case keeps its answer; one
  case added (the read fails). 44 cases neutral with D1 changes only. Checked by `golden:neutral` and by an independent
  pass.
- Tests: eight route tests (real draft and send calls during the email; the read and the guard; a sent offer saved
  after the read; the still-sending answer; a decline with nothing left; the failed read) fail on the old route or
  without the new guard.
- Model: `pnpm run verify:quint:all` passed at the merged head (221 s); Apalache found no violation in `discount` at 7
  steps (65 s, merged head) and 9 steps (326 s, the head before the last review fix); `discountNoLiveCheck` violates at
  7.
- Reviews: Codex's code and security reviews of the first head found nothing. An independent Claude Code pass found no
  defect in the fix and five smaller points (the model's send check still as before F9, stale run counts, a missing
  test, a `return await`, a branch name in docs), all fixed; a re-review of that commit found only three comment and
  wrapping points, carried to the next pull request.
- CI: on the first head `validate` failed on `tests/api/studio-signin-noninterference.test.ts`, a flaky test also
  failing on `main` that this change does not touch (said once on the pull request; its root cause is being fixed
  separately). On the merged head `validate`, `neutrality` and the Workers preview build succeeded.
- After merge: on `6471ff2d`, the Workers build succeeded (23:07:35 UTC) and `validate` succeeded (23:12:45 UTC).
- Live check, 2026-11-15 at 23:13 UTC: `https://thesuperhuman.us/` answered 200, and a POST to
  `https://thesuperhuman.us/api/owner/requests/r1/software` without an Access login answered 302 (to the Access login).

UNVERIFIED until checked:

- The new refusal as the owner sees it in production: it needs the owner's Access login and a draft saved during a
  decline's email; none was made.

## 1. Purpose and content

- **PASS · Changes, instructions and audience.** One owner action's guard and a model.
- **PASS · Approved decisions.** Quoted above; the answer reuses existing sentences.
- **N/A · Public copy, first screen, navigation.** No page changes.

## 2. Search and sharing

- **N/A.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **N/A.** No markup change.

## 4. Performance and resilience

- **PASS · Queries.** One read after the decline's email and one guard in its second batch.

## 5. Forms and sensitive flows

- **PASS · Server validation and approval gating.** The new condition is read first and re-checked at write time; the
  owner API stays behind Access (live check above).

## 6. Privacy, legal and measurement

- **N/A.** No new data.

## 7. Release and final QA

- **PASS · Checks, diff review, rollback.** See above.
- **N/A · Bindings, migrations.** None.
- **PASS, with limits · Production revision and live check.** Deployed `6471ff2d`; the site and the Access gate checked
  live; the new refusal UNVERIFIED live.
- **PASS, with limits · Receipt.** Implemented, verified locally and in CI, deployed. Verified live: the site and the
  Access gate only.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments
  state.
