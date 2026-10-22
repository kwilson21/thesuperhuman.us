# Sitemap and canonical journal URLs release gate

Date: October 22, 2026 (UTC). Local checks ran between about 10:54 and 11:12 UTC on the same 10:55 build; the audio-host and missing-page observations in 4.6 ran at about 11:11. Live checks on production ran between 14:16 and 14:20 UTC, with an audio-host addition to live check 6 at 14:58.  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#205](https://github.com/kwilson21/thesuperhuman.us/pull/205)  
Branch: `sitemap-public-pages`  
Verified revision: `8944be6`, one commit on top of `main` at `75a88be` (PR #203's squash merge). This record is committed on top of it.  
Merged revision: `0ab273d`, squash-merged to `main` on October 22, 2026 at 14:13:02 UTC from the final head `ba62e84`. Its Workers Builds production build succeeded at 14:15:33 UTC (build `18847ceb-9c2f-46eb-97e5-06b9a717a457`, Worker Version ID `2df7d5f1-385c-46c0-b6b5-a0a1693f21a9`), and a polling `curl` first saw `/building/tally` answer 200 with no `/studio` in the sitemap at 14:15:37 UTC. The site shows no revision marker, so the serving version was read from Cloudflare: at 14:45 UTC, `wrangler deployments status` (read-only) showed Worker Version `2df7d5f1-385c-46c0-b6b5-a0a1693f21a9` serving 100% of traffic, deployed at 14:15:25 UTC.  
Target: production `https://thesuperhuman.us` and `audio.thesuperhuman.us`:
- `/sitemap-0.xml` (through `/sitemap-index.xml`, which `robots.txt` names)
- the static-asset trailing-slash behavior for the two prerendered pages, `/building/tally` and `/building/kaillera-next`. Static assets are served before the Worker's host routing, so the setting applies on both hosts.
- the Tally links on Home and `/work`

Reviewer: Claude Code agent, collecting evidence for owner Kazon Wilson. This record is evidence collection, not owner certification.  
Scope:
- `scripts/sitemap-pages.mjs`: the sitemap filter leaves out the owner, studio, offer and agreement sections. `src/middleware.ts` already marks each of them noindex. Before, only `/owner` was left out, so the sitemap listed `/studio`, `/studio/sign-in`, `/agreements` and `/agreements/verify`.
- `wrangler.jsonc`: static assets use `"html_handling": "drop-trailing-slash"`. `/building/tally` and `/building/kaillera-next` are the only prerendered pages (`dist/building/tally/index.html`). With the default (`auto-trailing-slash`), assets redirected the slashless URL, which their canonical and the sitemap name, to the trailing-slash URL. Now the slashless URL is served and the trailing-slash form redirects to it.
- `src/pages/index.astro` and `src/pages/work.astro`: the Tally links point at `/building/tally` instead of `/building/tally/`.
- `tests/lib/sitemap-pages.test.ts`: a test for the private sections.

Rollback revision: `75a88be`, PR #203's squash merge. Its Workers Builds production build succeeded at 10:53:34 UTC on October 22, 2026 (build `43d38176-4dcf-477b-a5b6-b1264b3c075d`, Worker Version ID `1d40ed4a-ffd7-42a5-9de3-db4a129a4486`), and a polling `curl` of `https://thesuperhuman.us/` first saw #203's home `og:video` tag at 10:53:41 UTC.  
No migration, binding, secret, dependency or copy change. A rollback restores the four private pages to the sitemap and the trailing-slash redirect.

Remaining work: all seven live checks passed (see the end). Two items stay open, carried from the #203 record because the same Worker code is serving (both for the owner): monitoring of the video route (6.6) and the remote `owner:health` run (8.15).

## Owner decisions and authorization

On October 22, 2026, at about 10:36 UTC (06:36 America/New_York), asked "Separate from this PR: the sitemap lists private pages (/studio, /agreements) and two project URLs that redirect. What should I do about it?", the owner answered "Fix it in a separate PR" (in conversation). That answer asks for this PR. It was not, by itself, a go-ahead to merge, which deploys production.

Later on October 22, shortly before the 14:13:02 UTC merge, asked "PR #205 (the sitemap fix) is reviewed: private pages leave the sitemap, and /building/tally and /building/kaillera-next stop redirecting to a trailing-slash URL. It also records #203's live checks, which all passed. Merging deploys it to thesuperhuman.us. Merge it once CI is green?", the owner answered "Merge when CI is green" (in conversation). That is the go-ahead to merge and deploy.

## Evidence and limits

- **Local server.** The build of `8944be6` (built at 10:55 UTC) ran under `wrangler dev` with local bindings only, using the repository's assets settings including `html_handling`. Requests used `curl` against the local address.
- **Checks at `8944be6`:**
  - `npm test`: 135 files, 1,696 passed, 1 skipped (the agreement PDF test that needs a private file).
  - `npm run check`: 0 errors, 0 warnings.
  - `npm run build`: passed. `npm run assets:check` and `npm run copy:check` passed.
- **Not done before the merge:** no request to production or to a branch preview; no real device. After the deploy, production was checked over HTTPS (Live checks after deploy); no branch preview or real device was used.

PASS means the evidence named here was observed.

## 1. Purpose and content

- **PASS · 1.1 Project, branch, changes, instructions and deployment authorization.** Branch `sitemap-public-pages` from `main` at `75a88be`; the diff is the five files in Scope. The owner asked for this fix and gave the go-ahead to merge (Owner decisions and authorization).
- **N/A · 1.2 Approved design, claims, media.** No copy, design or media change. The two link edits change only the `href`.
- **N/A · 1.3 Explain who does what; professional claims.** No copy or professional claim changes.
- **PASS · 1.4 First screen and CTA.** The Home Tally link (`Development journal`) and the `/work` link (`Tally development journal`) now go straight to `/building/tally`, which returned 200 locally. Before, they pointed at `/building/tally/`.
- **N/A · 1.5 Navigation, footer, contact, addresses.** Unchanged.

## 2. Search and sharing

- **N/A · 2.1 Titles and descriptions.** Unchanged.
- **PASS · 2.2 Canonicals.**
  - `/building/tally` and `/building/kaillera-next` returned 200 locally. `/building/tally` declares `<link rel="canonical" href="https://thesuperhuman.us/building/tally">` and the same `og:url`.
  - `/building/tally/` and `/building/kaillera-next/` returned 307 to `/building/tally` and `/building/kaillera-next`. `/building/tally/index.html` returned 307 to `/building/tally`.
  - Server-rendered pages are unaffected: `/about`, `/about/` and `/building/the-engineers-daily` (and with a slash) returned 200, as before.
- **N/A · 2.3 Open Graph.** Tags are unchanged. The two journals keep their preview scenes; their `og:url` is the slashless URL, which now answers 200 instead of redirecting.
- **N/A · 2.4 Icons.** Unchanged; `/favicon.svg` returned 200 locally.
- **PASS · 2.5 Robots and sitemap.**
  - The built `sitemap-0.xml` lists 22 URLs, down from 26. Removed: `/studio`, `/studio/sign-in`, `/agreements`, `/agreements/verify`. Every remaining URL is a public page; `/building/tally` and `/building/kaillera-next` are listed at the URL that now answers 200.
  - `robots.txt` is unchanged and still names `/sitemap-index.xml`.
  - This resolves the FAIL recorded in `docs/prelaunch-qa-2026-10-22-link-previews.md` (2.5), which the owner accepted for that release with this PR as the follow-up.
- **N/A · 2.6 Preview indexing.** No change to the `workers.dev` rule or the middleware.
- **N/A · 2.7 Structured data.** Unchanged.

## 3. Accessibility and responsive behavior

- **N/A · 3.1 to 3.7.** No markup, style or script change beyond two `href` values.

## 4. Performance and resilience

- **PASS · 4.1 and 4.2 Assets and caching.** Unchanged headers observed locally: posters and videos keep `public, max-age=31536000, immutable`; the two journals keep `public, max-age=0, must-revalidate`; `/building/the-engineers-daily` keeps `no-store`.
- **N/A · 4.3 Measurements.** No page content changes. One redirect hop is removed for visitors who follow the canonical URL or the Home and `/work` links.
- **N/A · 4.4 and 4.5.** No async UI or media change.
- **PASS · 4.6 404, redirects and errors.**
  - The trailing-slash forms of the two journals now redirect (307) to the slashless canonical URL, and `/email/signature.html` still redirects to `/email/signature` (200), as before.
  - Missing paths still return the branded 404 locally, on both hosts: `/no-such-page` and `/building/tally/no-such-page` returned 404 with "Page not found · Kazon Wilson", with `Host: thesuperhuman.us` and with `Host: audio.thesuperhuman.us`.
  - With `Host: audio.thesuperhuman.us`, `/building/tally` returned 200 with its canonical on `https://thesuperhuman.us/building/tally`, and `/building/tally/` returned 307 to `/building/tally`, the same as the main host. `/robots.txt` returned 200 on both hosts.

## 5. Forms and sensitive flows

- **N/A · 5.1 to 5.6.** No form, API or flow change. The private studio, offer and agreement pages keep their middleware headers; only their sitemap listing changes.

## 6. Privacy, legal and measurement

- **N/A · 6.1 to 6.5.** No data, cookie, analytics or notice change. Removing private pages from the sitemap reduces what is advertised to crawlers.
- **UNVERIFIED · 6.6 Monitoring.** No logging or monitoring code changed, and monitoring was not re-verified for this deploy; the live checks are one-time checks. The #203 record's open item still applies to the serving Worker: nothing alerts on the video route's failure path (6.6 there).

## 7. Release and final QA

- **PASS · 7.1 Required checks.** See Evidence and limits.
- **PASS · 7.2 Diff review.** Five files; no secrets, private paths, generated files, dependency changes or copy changes.
- **PASS · 7.3 Headers and routing (locally).** See 2.2, 4.1 and 4.6.
- **PASS · 7.4 Rollback, review and authorization.** Rollback revision above; no backup needed. Independent review agents ran on each new head until a pass found nothing; the final head `ba62e84` had a clean pass, and its Validate (11:43:29 UTC), Screenshots capture (11:43:16 UTC) and Workers Builds (11:42:55 UTC) succeeded before the merge, which was pinned to that head. Codex's code review of `8944be6` found nothing. The owner gave the go-ahead.
- **UNVERIFIED · 7.5 Post-deployment verification.**
  - Observed live: all seven live checks below passed. Check 1 reads GitHub; checks 2 to 5 ran on `thesuperhuman.us`, check 6 on `audio.thesuperhuman.us` (including its sitemap) and check 7 on both. The main journeys' tags, a poster, a video, robots and `/owner` were checked for regressions. No form changed.
  - Production revision: Cloudflare's deployment record shows Worker Version `2df7d5f1-385c-46c0-b6b5-a0a1693f21a9` at 100% since 14:15:25 UTC, the version the Workers Builds check on `0ab273d` produced (see Merged revision).
  - Open, carried from the #203 record: monitoring (6.6) and the remote `owner:health` run (8.15).
- **UNVERIFIED · 7.6 Receipt.** This record is the receipt. Status as of October 22, 2026, about 15:00 UTC:
  - Implemented: yes (`8944be6`).
  - Verified locally: yes, against `wrangler dev` serving the build of `8944be6`.
  - Deployed: yes, `0ab273d`, Worker Version ID `2df7d5f1-385c-46c0-b6b5-a0a1693f21a9`, from 14:15 UTC.
  - Verified live: the seven live checks passed; monitoring (6.6) and the remote `owner:health` run (8.15) are open (see 7.5).

## 8. Private owner center

- **N/A · 8.1 to 8.14.** No owner code changes. The owner pages were already left out of the sitemap.
- **UNVERIFIED · 8.15 `owner:health`.** No remote run was made for this deploy. This diff touches nothing `scripts/owner-health.mjs` checks, but the checklist asks for a run against the target environment, and the run the #203 record left open (its 8.15, live check 6) applies to the serving Worker too. It stays a launch-blocking UNVERIFIED item until `npm run owner:health -- --remote --post-deploy` is recorded, unless the owner accepts it as an exception with its impact and follow-up.

## Software agreement signing

- **N/A · S.1 to S.12.** No signing code changes. `/agreements` and `/agreements/verify` leave the sitemap only.

## Live checks after deploy

Claude Code agents ran these on production between 14:16 and 14:18 UTC on October 22, 2026, with plain `curl` over HTTPS, and a separate agent re-ran every one between 14:18 and 14:20 UTC with the same results.

1. Workers Builds on the merge commit succeeds; record its build ID and Worker Version ID.
   - **PASS.** "Workers Builds: thesuperhuman-us" on `0ab273d` succeeded at 14:15:33 UTC: build `18847ceb-9c2f-46eb-97e5-06b9a717a457`, Worker Version ID `2df7d5f1-385c-46c0-b6b5-a0a1693f21a9`. On `0ab273d`, Validate succeeded (completed 14:14:43 UTC). Screenshots capture was still running during both passes; it was read afterward and had succeeded (completed 14:25:57 UTC).
2. `https://thesuperhuman.us/sitemap-0.xml` lists 22 URLs without `/studio`, `/studio/sign-in`, `/agreements` or `/agreements/verify`.
   - **PASS.** 200 `application/xml`, 22 URLs, none under `/studio`, `/agreements`, `/owner` or `/offer`. `/sitemap-index.xml` names only `sitemap-0.xml`.
3. `curl -sI https://thesuperhuman.us/building/tally` and `/building/kaillera-next` give 200; with a trailing slash they redirect to the slashless URL.
   - **PASS.** Both answer 200 with canonical and `og:url` on the slashless URL; `/building/tally/`, `/building/kaillera-next/` and `/building/tally/index.html` answer 307 to the slashless URL.
4. Home and `/work` link to `/building/tally`.
   - **PASS.** Each has one `href="/building/tally"` and none with a trailing slash.
5. A server-rendered page (`/about`) and a poster still answer as before.
   - **PASS.** `/about` and `/about/` answer 200; `/building/the-engineers-daily` keeps `no-store`; the home poster answers 200 `image/png` with the immutable cache header and its manifest size. Regression checks also passed: the image and video tags on `/`, `/work` and `/building/tally` match the manifest; the home and Tally videos answer HEAD 200 and `Range: bytes=0-1` 206; `/email/signature.html` redirects to `/email/signature` (200); `/owner` answers 302 to Cloudflare Access; `robots.txt` matches the repository.
6. On `https://audio.thesuperhuman.us`: `/building/tally` gives 200 with its canonical on the main host, `/building/tally/` redirects to it, and `/robots.txt` gives 200.
   - **PASS.** As described, with canonical `https://thesuperhuman.us/building/tally`. Added at 14:58 UTC by the coordinating Claude Code session, after the re-run and not re-run itself: on the audio host, `/sitemap-index.xml` and `/sitemap-0.xml` answer 200 `application/xml`, and the sitemap lists the same 22 main-host URLs with none under `/studio`, `/agreements`, `/owner` or `/offer`; `/building/kaillera-next` answers 200 with its canonical on the main host, and `/building/kaillera-next/` answers 307 to it.
7. On both hosts, `/no-such-page` and `/building/tally/no-such-page` give 404 with the branded not-found page.
   - **PASS.** All four answer 404 with "Page not found · Kazon Wilson" and `noindex, follow`.
