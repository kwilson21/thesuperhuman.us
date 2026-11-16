# Offers model and behaviour fixes F1 to F9: release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull requests, merged in this order on 2026-11-15:
- [#317](https://github.com/kwilson21/thesuperhuman.us/pull/317) at 21:26:24 UTC as `f23d6d01` (head `caed2d78`): the
  discount model extended with send and decline around their emails, the link and the sending window; F10 reproduced;
  the release record of #306 and #305. Model, driver and docs only.
- [#313](https://github.com/kwilson21/thesuperhuman.us/pull/313) at 21:38:06 UTC as `d0b51e78` (head `285c6acc`): F1,
  F2 (with F5's stored-details case), F3 and F4.
- [#314](https://github.com/kwilson21/thesuperhuman.us/pull/314) at 21:38:33 UTC as `6f90e87e` (head `1eff12c2`): F6, F8
  and F9.
- [#316](https://github.com/kwilson21/thesuperhuman.us/pull/316) at 21:38:54 UTC as `6e276e5b` (head `6700d78e`): F7.

Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson, in conversation on 2026-11-15: "Do the fixes and yes you can merge",
to the recommendations of `docs/plans/2026-11-offers-conversion.md`, section 5. Implementation, the model and the
independent review passes were done with Claude Code. Codex could not review these pull requests (its review quota was
used up), so the reviews were Claude Code passes, as CLAUDE.md allows without a Greptile review.
Rollback revision: `7beca022`, the revision of `main` before #317. To undo the fixes only, revert the merge commits
`6e276e5b`, `6f90e87e` and `d0b51e78` in that order (`git revert -m 1`); #317 changes no code.

## Scope

- #317: `verification/discount-offers.qnt` models send and decline as their real steps, the offer link, revoke and
  reissue, and the 20-second sending window on a 10-second clock. `discount` is today's code; `discountF10Fix` is the
  fix the plan recommends. Properties `declinedHasNoOffer` and `acceptedSendLinkLive` with four new mutants; the
  driver gains a per-model step count (the discount model runs 50 steps). F10 is reproduced: a draft saved during a
  decline's email survives the decline (4 steps). The sent-offer form of F10 is reachable only in the model's coarse
  clock.
- #313, #314, #316 change only the owner route `POST /api/owner/requests/[id]/software` (and the agreement preflight's
  read handling). Owner pages only; no client-facing page, no migration, no binding:
  - A failed read, batch or R2 call answers 500 with a fixed sentence instead of 409 "changed", 400 "details" or a bare
    500, and is logged once. After the client email or a saved draft, the sentence says what already happened.
  - A send that needs R2 with no binding answers 503 "File storage isn’t configured. Check the AUDIO binding. Nothing
    was sent." Question and decline with no mail settings answer 503 "Email isn’t configured. Check RESEND_API_KEY,
    CONTACT_FROM_EMAIL and OWNER_EMAIL. Nothing was sent or saved." before any write.
  - A missing or empty request id answers 404 as an unknown id does.
  - A send whose link was closed while a failed email was being sent answers 409, without saying the email went out.
  - Revoke reads its link before the batch and refuses there; a draft that lost its version to another writer is read
    and decided again (three tries).

## Evidence and limits

- Golden corpus: every changed case is listed in its commit message (fixture, case, before and after), and an
  independent pass matched each list against `pnpm run golden:neutral` for every commit range. Against `main` before
  the fixes, the seven `owner-request-software-*` corpora changed: F1 to F4's answers, F6, F8 and F9's cases, F7's two
  cases, eleven added cases (refused batches whose lookup fails, preflight reads, a reused MSA with no binding, the
  revoke link read) and one `console.error` line in each case that now logs. Every other fixture is identical.
- Tests: `tests/api/software-offers-outages.test.ts` (new) pins each answer's status, body, private header, writes,
  email count and log line; each behaviour test failed before its fix. A lib test shows countersigning still gets the
  original rejection.
- Reviews: on the fixes, two independent passes (correctness and security; cases, copy and rules) found no security
  issue and three medium points (a "saving failed" sentence where nothing failed to save, preflight reads still
  answering 400, lost golden coverage of lookups after a refused batch) plus smaller ones (unlogged failures, vague 503
  sentences, test strength); all fixed. A re-review of the fixed heads found three small points (a comment, the "File
  storage" wording, stale plan names), fixed and checked with the offers tests and `golden:neutral`, not given another
  pass. On #317, an independent pass found two medium points (the sent-offer F10 claim and the 30-step runs no longer
  reaching the deepest states) and six small ones; all fixed, and a re-review found only doc wording, fixed.
- Local checks: on the fix stack's top branch before the last two rounds, the full `pnpm test` passed (13,497); on the
  final heads, lint, `pnpm run check`, the offers unit and golden tests, countersign and agreement-pdf tests,
  `tests/architecture` and `tests/scripts`. The full suite on the top branch's final review round had 4 timeouts under
  load (load average 8) that passed alone. On #317: `pnpm run verify:quint:all` (99 checks), Apalache on `discount` to
  9 steps and `discountF10Fix` to 7 after the review fixes.
- CI before merge: `validate`, `neutrality` and the Workers preview build succeeded on each merged head (#317
  `caed2d78`, #313 `285c6acc`, #314 `1eff12c2`, #316 `6700d78e`).
- After merge: on `f23d6d01`, `validate` and the Workers build succeeded. The `validate` runs on `d0b51e78`,
  `6f90e87e` and `6e276e5b` were cancelled by the next push to `main`, as the workflow does (the last by another
  session's #303 at `59573d70`); the Workers build of `6e276e5b` succeeded at 21:44:11 UTC. `validate` on `59573d70`,
  which holds all four, succeeded at 22:03:48 UTC.
- Live check, 2026-11-15 at 21:46 UTC: `https://thesuperhuman.us/` answered 200, and a POST to
  `https://thesuperhuman.us/api/owner/requests/r1/software` without an Access login answered 302 (to the Access login),
  so the owner API still fails closed.

UNVERIFIED until checked:

- The new answers as the owner sees them on the request page in production. They need the owner's Access login and a
  failure to happen; none was induced.
- The `logUnexpected` line in production logs.

Known and not fixed here:

- `tests/api/studio-signin-noninterference.test.ts`, "a request racing the passing of time, client", fails about 1 run
  in 3 on `main` (recorded in the previous release record).
- F10 (a draft saved during a decline's email survives it) is fixed in its own pull request, next.
- Owner question open: after a question or decline email went out and saving failed, the approved sentence says
  "Reload before you try again"; trying again emails the client a second time.

## 1. Purpose and content

- **PASS · Changes, instructions and audience.** Owner-only answers, a model and docs.
- **PASS · Approved decisions.** The owner's 2026-11-14 and 2026-11-15 decisions are quoted above and in the plan.
  Four sentences are new wording not in the design (the two storage and mail 503s, the two live-link check answers);
  each is true where given and is listed in the PR descriptions for the owner.
- **N/A · Public copy, first screen, navigation.** No public page changes.

## 2. Search and sharing

- **N/A.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **N/A.** No markup change; the answers use the owner page's existing message output.

## 4. Performance and resilience

- **PASS · Failures.** Store and R2 failures answer with a fixed sentence and are logged once; nothing new is written
  on failure. The draft retry is bounded at three tries.

## 5. Forms and sensitive flows

- **PASS · Server validation and approval gating.** Every guard is unchanged or reads first and keeps its guard as the
  re-check; the owner API stays behind Access (live check above). No error text reaches a response.

## 6. Privacy, legal and measurement

- **PASS · Logs.** The new log line carries the route name and the original error; it is a server log, not shown to
  anyone. No new data collected.

## 7. Release and final QA

- **PASS · Checks, diff review, rollback.** See above.
- **N/A · Bindings, migrations.** None.
- **PASS, with limits · Production revision and live check.** Deployed `6e276e5b` (then `59573d70` with another
  session's change); the site and the Access gate checked live; the new answers UNVERIFIED live.
- **PASS, with limits · Receipt.** Implemented, verified locally and in CI, deployed. Verified live: the site and the
  Access gate only.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments
  state.
