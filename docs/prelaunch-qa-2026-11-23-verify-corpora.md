# Verify-page golden corpora: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#380](https://github.com/kwilson21/thesuperhuman.us/pull/380), merged at 03:22:43 UTC as `585619c1`
(head `4d72c050`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The order of `docs/plans/2026-11-effect-conversion.md` ("Go", 2026-11-15) and the step 3
design (`docs/plans/2026-11-signing-conversion.md`, #376), whose section 8 makes this PR 2: the verify pages recorded on
today's code before any fix. The corpora and the page handler were built with Claude Code.
Rollback revision: `9deca488`, the revision of `main` before the merge; or `git revert -m 1 585619c1`. Tests and docs
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
- Rendering: pages are rendered streamed and compact, as production renders them (`new App(manifest)` streams by
  default; `compressHTML` is Astro's default and is not set in `astro.config.mjs`), so a streamed page has no
  `Content-Length`. Production takes the same streaming path as the container (Astro's async-iterable renderer, chosen
  by `isNode`): `Object.prototype.toString.call(process)` is `[object process]` on the installed workerd 1.20261110.1
  (the version wrangler ships) at the site's compatibility date, 2026-05-14, with `nodejs_compat`. A throw in the
  frontmatter is recorded as `rejected` (a bare 500 in production). A throw while the template renders keeps the status
  and headers and ends the recorded body with the harness's marker. In production what a visitor gets depends on
  timing, which the recording does not model: workerd sends the status and headers once the turn that returned the
  Response ends, so a body that fails within that turn gets no response at all (a client sees an empty reply), and one
  that fails later is a 200 that breaks partway. The one case of that kind, "terms that are not JSON: the body fails
  before its first byte", fails within that turn (the page does no I/O between the offer read and the parse), so
  production sends nothing. Checked with that workerd, locally; through Cloudflare's network a visitor may see an error
  page instead of an empty reply.
- Cookies set with `Astro.cookies` are appended as `Set-Cookie` headers, as the adapter does; today's pages set none
  that way.
- Limits: the container runs no middleware (as no corpus does), so two cases record the page alone. In production the
  middleware answers the cross-site POST 403 first (`src/middleware.ts:139-144`), and the PUT with no Origin and no
  content type ("a PUT with a good key in the query") 403 first (`src/middleware.ts:124-144`). The HEAD case records a
  body that production never sends (an answer to a HEAD has none). The page's own stylesheet links (`/_astro/*.css`)
  are missing from the recorded HTML: the styles are stubbed when the page is compiled for the container.
- Reviews: Codex's security and code reviews of `2e36efa8` found nothing. The first independent Claude Code pass found
  two blocking points (a throw while the template renders was recorded as a bare rejection, because the container did
  not stream as production does; cookies set with `Astro.cookies` were not recorded), fixed in `c485ee45`; the second
  found that the docs said a body failing at once gives a 200, fixed in `79efdf90`; the third found that what workerd
  sends depends on timing, not on bytes sent, fixed in `4d72c050`. Under the severity bar in CLAUDE.md (a large pull
  request whose last three passes each found something), that last point was not blocking: it corrected a harness
  comment and this record, and changed no recording.
- CI on the head `4d72c050` before merge: all 20 check runs succeeded, the Workers preview build among them.
- After merge, on `585619c1`: the Workers build succeeded (03:24:29 UTC) and `validate` succeeded (03:25:37 UTC). Live
  check at 03:25:58 UTC: `https://thesuperhuman.us/` answered 200, and `/agreements/verify?key=x` answered 401 with the
  expired page, as before.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** Tests and docs only.

## 7. Release and final QA

- **PASS · Checks, reviews, rollback.** See above.
- **PASS · Production revision and live check.** Deployed `585619c1`; the site answered 200.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
