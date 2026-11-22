# Offers conversion design and shared helper split: release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull requests, merged in this order on 2026-11-15:
- [#306](https://github.com/kwilson21/thesuperhuman.us/pull/306) at 17:55:34 UTC as `14cce493` (head `3c9992d5`): the
  design of the software offers conversion (`docs/plans/2026-11-offers-conversion.md`) and two plan updates. Docs only.
- [#305](https://github.com/kwilson21/thesuperhuman.us/pull/305) at 19:12:20 UTC as `2f7add57` (head `5215ecd1`): step 0
  of `docs/plans/2026-11-effect-conversion.md`, helpers split out of mixed modules with no behaviour change.

Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson, in conversation on 2026-11-15: "Go" to the offers-first order and the
prerequisite split, then "Do the fixes and yes you can merge". Implementation and the independent review passes were
done with Claude Code; Codex reviewed an earlier head of each pull request.
Rollback revision: `a6892d0d`, the revision of `main` before #306. To undo #305 only, revert `2f7add57`; #306 changes
no code.

## Scope

- #306: the offers design (guards, machines, rules, flows, services, store, verification, the PR stack and the list of
  behaviour fixes F1 to F10 with the owner's decisions), plus `docs/plans/2026-11-effect-conversion.md` and
  `docs/plans/2026-11-discount-flow.md`. No code.
- #305: `softwareGuard` and `softwareAudit` move to `src/lib/software-guard.ts`; `softwareInvoiceTerms` and
  `SoftwareInvoiceKind` to `software-invoice-terms.ts`; `depositOfferBlock` and `depositOfferGuard` to
  `software-offer-deposit.ts`; `normalizeClientEmail`, `clientPortalEnabled`, `hashValue` and `keyedHash` to
  `client-portal.ts`; `validProjectDate` and `projectToday` to `project-dates.ts`; `canonicalAgreementRequest` and
  `agreementHeaders` to `agreement-host.ts`. Every importer was re-pointed, with no re-exports. The PR was first written
  against an older `main`; other pull requests then converted agreement access (#298), publication (#307) and the public
  intake routes (#301), so `main` was merged in, each conflict resolved by taking `main`'s file and re-applying only the
  import changes. One screenshot mapping and one plan sentence were added after review.

## Evidence and limits

- #305, at the merged head: every moved declaration compared with its `main` text through the TypeScript syntax tree
  (15 declarations, all identical, none left in its old module); `pnpm run golden:neutral --all origin/main HEAD`
  identical over 9,073 cases with no fixture changed; the full `pnpm test` (13,449 passed), `pnpm run lint`,
  `pnpm run format:check`, `pnpm run check` (0 errors), `pnpm run build` and the client bundle test with
  `REQUIRE_CLIENT_BUNDLE=1` (27 passed), all on the merge commit `fcaba282`. The last commit (`5215ecd1`, one plan
  sentence and one screenshot mapping line) was checked with `tests/scripts`, `tests/architecture`, lint and
  format; one architecture test (`effect-imports`, which walks the repository) timed out at 5 s in that run under
  local load from parallel jobs and passed alone and in CI.
- #305 CI at `5215ecd1`: `validate`, `neutrality`, `capture` and the Workers preview build succeeded. An earlier
  `validate` run at `fcaba282` was cancelled by the job's 15-minute limit during `pnpm test`; the same limit cancelled
  a run on `main` (`a6892d0d`) earlier the same day, so the job is near its limit independent of this change. #318
  raised it to 30 minutes.
- Reviews of #305: Codex found nothing on an earlier head. An independent Claude Code pass on the merged head
  (`fcaba282`) tried to disprove the "pure move" claim: declarations byte-identical, old modules identical to `main`
  once imports and the moved code are removed, 107 imports of moved names all from the new modules, no `vi.mock` of a
  moved name, no import cycle, no module newly loaded anywhere, `BROWSER_MODULES` unchanged. Its two small points (the
  plan's step 0 did not name `normalizeClientEmail`; `software-guard.ts` had no screenshot mapping) were fixed in
  `5215ecd1`, which was not given another pass.
- Found during review, not caused by these PRs: `tests/api/studio-signin-noninterference.test.ts`, "a request racing
  the passing of time, client", failed 1 of 3 runs alone on `main`. It fakes only `Date` over real async work. It is
  recorded here so it is not mistaken for a regression; it has not been fixed.
- After merge, on `2f7add57`: `validate` succeeded (19:24:08 UTC) and the check run "Workers Builds: thesuperhuman-us"
  succeeded (19:14:13 UTC). On `14cce493`, both succeeded (18:07:21 and 18:00:53 UTC).
- Live check, 2026-11-15 at 19:24 UTC: `https://thesuperhuman.us/` answered 200, and
  `https://thesuperhuman.us/api/owner/requests/r1/software` without an Access login answered 302 (to the Access login),
  so the owner API still fails closed.

UNVERIFIED until checked:

- The owner and client routes that import the moved helpers, exercised live. They are behind Access or a client link;
  no live request was made. The golden corpus covers each of them locally with identical results.

## 1. Purpose and content

- **PASS · Changes, instructions and audience.** A design document and a refactor with no behaviour change.
- **PASS · Approved decisions.** The owner's 2026-11-15 decisions are quoted above and in the plans.
- **N/A · Public copy, first screen, navigation.** No page changes.

## 2. Search and sharing

- **N/A.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **N/A.** No markup change. The screenshot workflow captured every page at both widths on `5215ecd1`.

## 4. Performance and resilience

- **PASS · What loads what.** The middleware no longer loads `agreement-access.ts` or `audio-client-access.ts`, and the
  offers route no longer loads Stripe; no module is loaded anywhere it was not before.

## 5. Forms and sensitive flows

- **PASS · Server validation and approval gating.** No validator, guard, sentence or write changed (golden corpus
  identical).

## 6. Privacy, legal and measurement

- **N/A.** No new data.

## 7. Release and final QA

- **PASS · Checks, diff review, rollback.** See above.
- **N/A · Bindings, migrations.** None.
- **PASS, with limits · Production revision and live check.** Deployed `2f7add57`; the site and the owner API's Access
  gate checked live; the moved helpers UNVERIFIED live.
- **PASS, with limits · Receipt.** Implemented, verified locally and in CI, deployed. Verified live: the site and the
  Access gate only.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments
  state.
