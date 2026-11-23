# Market research refresh: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#378](https://github.com/kwilson21/thesuperhuman.us/pull/378). Merge facts and the live check are in
section 7.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. On 2026-11-23 the owner chose to have the site search the web with their Tavily account on a
schedule and propose new market figures that change nothing until the owner uses them ("In the site, you approve"),
added the Tavily key as the Worker secret `TAVILY_API_KEY`, left the research-date choice to Claude ("You decide"), and
asked for the merge ("so merge"). The work was done with Claude Code. Design: `docs/plans/2026-11-market-refresh.md`.
Rollback revision: the revision of `main` before the merge, or `git revert -m 1` of the merge commit. No migration and
no D1 change. The merge adds a cron trigger and reads one new secret; the KV keys it writes (`pricing:refresh-asked`,
`pricing:refresh-last`, `pricing:proposal:<id>`) are ignored by the code before it.

## Scope

- **A daily scheduled run** (`23 7 * * *`, `src/worker.ts`, a custom Worker entry whose `fetch` is Astro's own
  handler, unchanged). A pure rule (`src/server/rules/market-refresh.ts`) decides whether to search: never without the
  key; when the owner asked; otherwise when the research is 90 days old, no proposal waits and no search was tried in
  the last 7 days. A run clears an ask made before it started, whether it finished or failed.
- **A search** of the nine kind-and-size cells and the senior day rate on Tavily (20 credits a run), read by Workers AI,
  with each figure kept only when both ends appear as dollar amounts in a cited result, per hour exactly when the
  reading says so. Queries use only the repository's own definitions; nothing about a client is sent.
- **On `/owner/pricing`**, the block "New figures from the web": the proposal beside the current research, its
  sources, Use these figures (only the found figures change, laid over the research as it is now, through the existing
  versioned save), Discard, Search for new figures, and the last run's outcome.
- **A new owner route,** `POST /api/owner/pricing-refresh` (ask, use, discard), in the Effect form.
- **The page's two scripts** now share one page-wide lock (`src/scripts/owner-pricing-lock.ts`).

## Judgment calls (the owner may overrule)

- **The research is dated by the search** when a proposal is used (recorded in the plan). Keeping the older date would
  make the daily run search every week while any cell stayed unconfirmed.
- **Use and a discard in another tab at the same moment** are not refused: KV has no compare-and-set
  (`verification/pricing-save.qnt`, `TodayKv`). Either order ends with figures the owner chose.
- **The Hallmark audit's two design choices** are left as they are and put to the owner in the follow-up issue: the
  block's place above the research file box, and the wording of the stale-proposal sentence (#422).

## Evidence and limits

- After merging `main` (`57369bf5`) into the branch: `pnpm test` 420 files, 15,869 passed, 1 skipped; `pnpm run check`
  0 errors; lint, format and the build with the copy check clean; the architecture tests with
  `REQUIRE_CLIENT_BUNDLE=1`, 137 passed.
- New tests: `tests/server/market-refresh.test.ts` (52), `tests/api/pricing-refresh.test.ts` (8),
  `tests/server/market-refresh-job.test.ts` (3), `tests/scripts/owner-pricing-lock.test.ts` (1). Each test added in
  review fails on the code before its fix.
- `verification/market-refresh.qnt`: the design keeps its three properties and each mutant breaks its own; it runs in
  CI's Quint shards.
- No real Tavily search or Workers AI reading has run before merge; every figure in the tests and the screenshot
  scenario is made up.

## 1 to 2. Content, search and sharing

- **PASS · Copy.** The new owner copy passes the copy check (no em dash, no rate per hour, no buzzword) and shows no
  software rate or real figure.
- **N/A · Public pages, search and sharing.** No public page changed; `/owner*` stays out of the sitemap.

## 3. Accessibility and responsive behavior

- **PASS · Structure and states.** The block has its own h3; the proposal table has a caption, column and row headers,
  and sits in a labelled focusable region; status lines use `role="status"`; after Ask, focus moves to the heading.
- **PASS · Widths.** With the scenario's made-up proposal: 320, 390 and 1280 wide show no sideways scroll (measured
  locally), and CI's Screenshots run at `0db4f62` passed, its phone check included. `tests/browser/offer-board.cjs`
  passed all 72 checks locally with the proposal on the page.
- **PASS · Hallmark audit (read-only).** One defect: the block's heading was weight 500 where `design.md` keeps headings
  at 400; fixed. Two small fixes made: the new dates use non-breaking hyphens as the page's other dates do, and "Now"
  uses tabular figures.
- **UNVERIFIED · 200% text zoom, a second browser and a real phone.** Not run for this block.

## 4. Performance and resilience

- **PASS · Async UI.** One request at a time across the page, a 30-second timeout, a lost answer asks for a reload
  before any other request, and a failure shows the route's fixed sentence.
- **N/A · Assets and Web Vitals.** No public page or asset changed.

## 5. Forms

- **PASS · The owner route.** Owner only (Cloudflare Access and the Worker's JWT check in the middleware, then
  `locals.owner`), a 4 KiB body limit, Effect Schema input, 400 for a request the page never sends, 409 for a replaced
  or stale proposal or another tab's save, 500 with a fixed sentence for a store failure, 503 when the store is not
  bound. Held by `tests/api/pricing-refresh.test.ts`.

## 6. Privacy, legal and measurement

- **PASS · Processors.** Tavily, a new processor the owner chose, receives only fixed queries built from the
  repository's definitions; Workers AI receives those and the search results. Neither receives anything about a
  client, the day value, the contingency or past offers. The key is sent only in the Authorization header and never
  logged or shown. No personal data is processed, so the privacy notice is unchanged.
- **PASS · Monitoring.** The run logs one fixed line per outcome; the owner page shows the last run and why it failed.

## 7. Release and final QA

- **PASS · Checks, diff, rollback.** See above; no secret, real figure or rate in the diff.
- **PASS · Reviews.** An independent Claude Code review found two blocking money defects (Use put back an old copy of
  the research; the dollar check read figures from words), fixed. Codex found six; five fixed, one answered (the KV
  race above). The severity bar of CLAUDE.md applied (a large pull request). Non-blocking items, with the audit's two
  design choices, are in issue #422.
- **UNVERIFIED · Production secret.** The owner added `TAVILY_API_KEY`; it is confirmed when `/owner/pricing` offers
  "Search for new figures" after the deploy.
- **UNVERIFIED · CI on the final head, the merge, the production revision and the live check.** Recorded after merge.
- **UNVERIFIED · The cron in production and the first real search.** Cloudflare runs the trigger only once deployed.
- **N/A · Migrations and bindings.** None; the cron trigger is in `wrangler.jsonc`.

## 8. Private owner center

- **PASS · Access and headers.** The new route is under `/api/owner/`, which the middleware holds to Access and the
  signed JWT and answers with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`; the route's own
  answers also carry `private, no-store`.
- **N/A · Database, studio, payments and signing items.** Not touched.
