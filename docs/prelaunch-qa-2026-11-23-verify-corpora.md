# Verify-page golden corpora: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#380](https://github.com/kwilson21/thesuperhuman.us/pull/380). Merge facts are recorded after the merge,
in the next pull request.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The order of `docs/plans/2026-11-effect-conversion.md` ("Go", 2026-11-15) and the step 3
design (`docs/plans/2026-11-signing-conversion.md`, #376), whose section 8 makes this PR 2: the verify pages recorded on
today's code before any fix. The corpora and the page handler were built with Claude Code.
Rollback revision: the revision of `main` before the merge, or `git revert -m 1` of the merge commit. Tests and docs
only.

## Scope

- `tests/golden/harness/page.ts` (new) and its tests: an Astro page rendered by the container as a corpus handler.
- `tests/helpers/render-astro.ts`: `bundleAstro` also returns the compiled component.
- `tests/golden/areas/agreement-access.ts`: page steps added; nothing existing changed.
- `tests/golden/offer-verify-page.test.ts` (61 cases) and `tests/golden/agreements-verify-page.test.ts` (40 cases),
  with their fixtures, recorded on today's code.
- `docs/plans/2026-11-signing-conversion.md`: B5's verify-page count (four cases).
  `docs/prelaunch-qa-2026-11-23-signing-design.md`: #376's merge facts.
- Nothing under `src/` changed; nothing deployed behaves differently.

## Evidence and limits

- Recording: each corpus recorded on its own, re-recorded byte for byte the same, and replayed with the digest and count
  checks on; every declared failure and race fired. `pnpm run golden:neutral --all`: NEUTRAL, 82 fixtures and 9,370
  cases, only the two new fixtures added.
- `pnpm test`, `pnpm run check`, `pnpm run lint` and `pnpm run format` clean before the PR opened.
- Limits: the container runs no middleware (as no corpus does), so the case of a cross-site POST records the page alone;
  in production the middleware answers it 403 first (`src/middleware.ts:139-144`). The container renders without
  streaming.
- Reviews and CI: UNVERIFIED until they report; recorded with the merge facts.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** Tests and docs only.

## 7. Release and final QA

- **UNVERIFIED · Checks, reviews, production revision and live check.** Recorded after the merge.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
