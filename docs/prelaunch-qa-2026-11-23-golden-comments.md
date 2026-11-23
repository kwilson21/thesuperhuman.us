# Owner agreements golden header comments: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: to be filled in when it is opened. Merge facts are recorded after the merge, in the next pull request.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The step 3 design (`docs/plans/2026-11-signing-conversion.md`, #376), section 8, lists this
pull request: the golden header comments that still say 409 where the fixtures hold the 500 that `f78896099` brought.
The work was done with Claude Code.
Rollback revision: the revision of `main` before the merge, or a revert of the merge. Comments and docs only.

## Scope

The header comments of six golden corpora, corrected to what their fixtures hold:

- `tests/golden/owner-agreements-access.test.ts`: the failed cleanup batch and the failed setting update answer 500
  "The agreement could not be saved." (a form, the same sentence as a page).
- `tests/golden/owner-agreements-config.test.ts`: a stale or racing version answers 409 with that sentence, a failed
  batch 500; "huge" moves from the 400 line to the 409 line, where its case is.
- `tests/golden/owner-agreements-preview.test.ts`: a failed read of the current version answers 500.
- `tests/golden/owner-agreements-publish.test.ts`: a stale or racing version answers 409 with the generic sentence;
  a failed batch or read answers 500.
- `tests/golden/owner-agreements-template-version.test.ts`: a failed read answers 500.
- `tests/golden/owner-agreements-retention-preview.test.ts`: any throw answers 500.

Each line was checked against its fixture's recorded statuses and bodies. Nothing under `src/` and no fixture changed;
nothing deployed behaves differently.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** Test comments and docs only.

## 7. Release and final QA

- **PASS · Checks.** `pnpm run lint` and `pnpm run format` clean.
- **UNVERIFIED · Reviews, CI, production revision.** Recorded after the merge, in the next pull request.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
