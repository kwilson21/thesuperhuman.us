# Link previews release gate

Date: October 22, 2026. All local checks ran on October 22 (UTC). The type, test, asset and copy checks first ran between about 07:25 and 07:35 UTC. A second pass reran them between about 07:40 and 07:50 UTC, with the same results. The owner answered in conversation on October 22 (America/New_York).  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#203](https://github.com/kwilson21/thesuperhuman.us/pull/203), "Link previews that play a video (og:video), one scene per page"  
Branch: `og-video-preview`  
Verified revision: `8e6e9cc` (`8e6e9ccdf7269f49b862f9c2c60ed52b4f6b8773`), the PR head. It is 12 commits on top of `main` at `26e764a`, which is also the merge base. This record is committed on top of it.  
Target: production `https://thesuperhuman.us` and `audio.thesuperhuman.us`:
- the link-preview tags in every page's `<head>` (`src/layouts/BaseLayout.astro`)
- the posters at `/og/<scene>-<hash>.png` or `.jpg`, and the static videos at `/og/raw/<scene>-<hash>.mp4`
- the new route `/og/<scene>-<hash>.mp4` (`src/pages/og/[name].mp4.ts`), which serves the videos with Range support
- `/og-image.png`, the retired card

On `audio.thesuperhuman.us`, page paths other than `/api`, `/music` and `/audio` are rewritten under `/audio` (`src/lib/host-routing.ts`). The tags there always name `https://thesuperhuman.us`, so previews load from the main host.  
Reviewer: Claude Code agent, collecting evidence for owner Kazon Wilson. Claude Code wrote the change, and every commit carries its co-author trailer. This record is evidence collection, not owner certification.  
Scope:
- Each page's link preview becomes a short, silent, looping video (`og:video`) plus a poster image (`og:image`), both 1200 × 630, with one scene per page.
  - There are 22 scenes.
  - `OG_SCENES` and `ogSceneFor` in `src/lib/og-media.ts`, applied by BaseLayout, pick a page's scene in this order: exact route, then the page's own `ogImage`, then a `/*` family, then the home scene.
  - An `ogScene` prop overrides all of these. Only the 404 page sets one.
- Every page with a scene gains `og:image:width`, `og:image:height` and `og:image:alt`. Today that is every page that uses BaseLayout. The only `ogImage` page, `/music/old-news`, has an exact-route scene.
- New files:
  - the renderer and its scenes (`scripts/og-video/`)
  - the manifest `src/data/og-media.json`
  - 22 posters and 22 MP4s in `public/og/`
- The video route answers 200, 206 or 416, and 404 for unknown names. A new `/og/*` block in `public/_headers` sets an immutable cache rule.
- Tests, the README section "Link previews", and the review record `docs/asset-reviews/link-previews.md`.
- Retired: `public/og-image.png`, `scripts/og.html` and `scripts/build-og.sh`. Together they made the old single card, which carried the superseded line "Building with AI".
- Small related changes:
  - `.gitignore`
  - `scripts/check-asset-qa.mjs`
  - `scripts/check-copy.mjs` (the scenes are now in copy-check scope)
  - `docs/asset-reviews/studio-v1.md` (retirement note)
  - `tests/browser/personal-name.cjs`
  - `src/pages/404.astro` (adds `ogScene="not-found"`)
  - `src/pages/building/the-engineers-daily.astro` (drops its `ogImage` prop, because its exact-route scene now applies)

Rollback revision: `26e764a`, "Record the Turnstile result and the owner's header decisions (#202)".
- It is `origin/main` (confirmed with `git ls-remote`) and the merge base of this PR.
- Its Workers Builds production build succeeded at 14:05:49 UTC on October 21, 2026 (10:05 America/New_York), with Worker Version ID `f480f1b0-603e-4987-8b21-06bff291a328`.
- Whether that version is serving now was not observed: no live request was sent, and the site shows no revision marker.
- No backup is needed, because this PR changes no migration, binding, secret or dependency.
- `26e764a` has no `public/og/` (checked with `git ls-tree`). A rollback restores `/og-image.png` and the old single card. A preview that a platform scraped after the deploy would then point at poster and video paths that return 404 until the platform scrapes the page again.
- A rollback would also undo anything merged to `main` after #203, so check what has merged since.

Remaining work:
- an explicit owner go-ahead to merge, because merging deploys production (1.1)
- a fix or an owner-recorded exception for the sitemap FAIL, which existed before this PR (2.5)
- an independent review pass on this record's commit (7.4)
- the live checks after deploy

See Remaining work at the end.

## Owner decisions and authorization

The owner answered in conversation on October 22, 2026 (America/New_York). The coordinating Claude session asked four questions and relayed the answers.

1. Should `/building/personal-website/story` keep its preview of the four generated design studies, or fall back to the personal-website clip? Answer: "Whichever looks better here".
   - The agent kept the story scene. It previews that page's own content: each study's outcome is labelled, and each is marked "Generated design study".
   - The personal-website clip shows the URL `thesuperhuman.us/building/personal-website` in frame. That would not match a shared `/story` link.
2. The Codex review thread suggested that the renderer's seam check compare the last encoded frame instead. Answer: "Same here, whichever looks better".
   - The agent measured all 22 committed videos:
     - Every scene rests on its poster state at the end.
     - The step from frame N-2 to frame N-1 is at most 0.06 grey levels.
     - The encoded step from the last frame back to frame 0 is 0.16 to 1.14 grey levels of codec noise. It is largest on Old News, and only at edges.
   - The agent kept the check, replied on the thread and resolved it.
3. Recording this checklist before merging. Answer: "Ok".
4. Running the live checks after deploy. Answer: "Ok".

Authorization:
- The answers settle the two design calls and agree to this record and to the post-deploy live checks.
- None of them is an explicit instruction to merge or deploy, and merging to `main` deploys production (AGENTS.md). Deployment authorization stays UNVERIFIED until the owner gives that go-ahead (see 1.1).
- The PR's reviews by `kwilson21` are all COMMENTED. There is no APPROVED review.
- This record accepts no exception. The sitemap FAIL in 2.5 existed before this PR and needs a fix or an owner-recorded exception with its impact and follow-up.

## Evidence and limits

- **Local server.** The built Worker of `8e6e9cc` ran under `wrangler dev` on `dist/`, with local bindings only, at a local address.
  - Requests were made with `curl`, bypassing the proxy.
  - A Host header stood in for `audio.thesuperhuman.us`, `www.thesuperhuman.us` and `*.workers.dev` preview hosts.
  - `dist/` was built at 07:14:30 UTC from a clean tree, after the head commit (04:17:25 UTC). It was not rebuilt during the checks.
  - The sha256 of every file in `dist/og` matches `public/og`, and `dist/_worker.js` holds an og-media chunk.
- **Checks at `8e6e9cc`**, run twice on a clean tree:
  - `npm run check`: 0 errors, 0 warnings, 17 hints. No hint is on a line this PR changes.
  - `npm test`: 135 files, 1,695 passed, 1 skipped.
  - The PR's four test files: 116 passed.
  - `npm run assets:check`: passed (80 production files).
  - `npm run copy:check`: passed.
  - `npm run build` was not rerun locally. CI's Validate ran it.
- **CI at `8e6e9cc`:**
  - Validate succeeded at 04:19:02 UTC. It runs `npm ci`, check, test and build. The build's prebuild step runs the asset, copy and publicist gates.
  - Workers Builds succeeded at 04:18:54 UTC (build `7a75db40`). It uploaded only a branch preview version, `4d55f91a`.
  - Screenshots capture succeeded at 04:30:35 UTC.
  - GitHub reports `mergeable_state` clean.
- **Reviews:**
  - Both GitHub review threads, on `render.mjs` and the README, are resolved.
  - Codex reviewed only the first commit, `1e97193`. Greptile has not reviewed the PR.
  - As CLAUDE.md requires without a Greptile review, the coordinating session ran independent review agents on each new head, with skeptics checking every finding: 13 confirmed findings fixed in `c376c19`, 6 in `03b4d48`, 1 in `4de8fb9`, 1 wording fix in `8e6e9cc`, and a fifth pass on `8e6e9cc` that found nothing. The coordinating session observed those results; their transcripts stay in the session, not in the repository.
- **Screenshots:**
  - The PR description's table names 14 captures under `pr-203/8e6e9cc/` on the `screenshots` branch.
  - Seven were fetched: home, not-found and building-the-engineers-daily, each at desktop and phone, plus services-phone.
  - Three were read: not-found-desktop, not-found-phone and building-the-engineers-daily-phone. All show normal pages with no visible change, as expected from a PR whose page changes are head tags only.
- **Media inspection:**
  - All 22 posters were viewed at full size and on a 600 × 315 contact sheet. Home, services and audio-services were also viewed singly at 600 × 315.
  - `identify`, `ffprobe` and ffmpeg (PSNR and `signalstats`) ran on every file.
- **Not done:**
  - No request was sent to production or to the branch preview.
  - No real device or preview app was tested (Messages, Discord, X, Slack, LinkedIn, Facebook).
  - No automated accessibility tool was run (none is installed). Performance was measured in the lab only (4.3).

PASS means the evidence named here was observed. Production checks are listed under "Live checks still to run after deploy".

## 1. Purpose and content

- **UNVERIFIED · 1.1 Project, branch, changes, instructions and deployment authorization.**
  - `git rev-parse HEAD` is `8e6e9ccdf7269f49b862f9c2c60ed52b4f6b8773` on `og-video-preview`, and `git status --short` shows a clean tracked tree.
  - `origin/main` and the merge base are both `26e764a`.
  - `git diff --stat 26e764a..8e6e9cc` lists 90 files. They match the scope above, including the small related files and the new `/og/*` block in `public/_headers` (`Cache-Control: public, max-age=31536000, immutable`).
  - Read: CLAUDE.md, the README section "Link previews" and the PR description.
  - The PR is open and not a draft, with head `8e6e9cc` and base `main`.
  - Missing: an explicit owner go-ahead to merge or deploy. Merging to `main` deploys production. See Owner decisions and authorization.
- **PASS · 1.2 Approved design, truthful claims, no placeholders, media rights.**
  - Copy:
    - Every visible line on the 22 posters matches the site, and each poster matches its alt text.
    - `tests/scripts/og-video-copy.test.ts` passed. It checks three things:
      - Every line of two or more words in each scene appears verbatim in `src/`. The exception is a listed set of composed lines and labels, each with its source named in the test: section kickers such as "Audio / Services", breadcrumbs, player readouts, and the legend lines of the reviewed Tally capture `src/assets/projects/tally/home-annotated.webp`.
      - Every price is a current `audioOffers` price (150, 75 and 200 in `src/lib/audio-intake.ts`).
      - The only other amount it allows is the Tally demo figure $283.
    - `npm run copy:check` passed with the scenes now in scope.
  - Forbidden content: a grep of the scenes, the kit, `src/lib/og-media.ts` and `src/data/og-media.json` found none of these:
    - clearance or hourly terms, and no pay-rate terms. The only "rate" matches are code comments and the privacy scene's "Form rate-limit records".
    - street, suite, Wyoming or Roanoke
    - the banned buzzwords
    - "Building with AI"
    - em dashes
  - Dollar amounts:
    - In scene text and alt text, the only amounts are the approved audio prices $150, $75 and $200, and Tally's demo figure $283.
    - The Tally captures inside the project-tally and services posters also show demo figures, for example "$36 over", "$412 of $700" and "$286 of $250".
    - All of these sit on the capture that shows its "Demo data. Nothing here is real." banner.
  - Placeholders: none. A grep for lorem, TODO, TBD and FIXME found nothing.
  - Media rights:
    - Every image a scene loads is an existing site asset that a page already uses: files in `src/assets/site/` and `src/assets/projects/`, and the Old News release artwork.
    - The Kaillera Next capture is the landing page. It has no game footage or ROM imagery.
    - The generated studies are labelled "Generated design study".
    - The owner's portrait already appears on `/building/personal-website`.
    - `ffprobe` shows 0 audio streams in all 22 videos.
  - The PR retires the old card, which carried the superseded line "Building with AI".
  - `docs/asset-reviews/link-previews.md` says "ready for production". It names Claude Code agents as the reviewers ("Not human production approval") and marks the device check unverified. `docs/generated-image-qa.md` does not require a new owner approval for ordinary QA.
- **PASS · 1.3 Explain who does what; professional claims.**
  - The PR changes no page copy.
  - The scenes repeat existing explanatory lines word for word, and the copy test passed. Examples:
    - "I’ll review your files before you book."
    - "Every project is fixed price and agreed in writing before work begins."
    - "Not sure which? Pick the closest. I’ll suggest the right fit when I reply."
  - The Work poster repeats existing `/work` facts (`src/pages/work.astro:14` and `:21`, `src/data/profile.ts:4`):
    - "7+ years in production engineering"
    - "5,000 → 100,000+ rows per batch", with its "Owner-reported batch capacity" label
  - The Tally legend line "Written by code from the numbers, not by AI." comes from the reviewed annotated capture and fits the AI stance.
  - No professional claim or resume fact changes, so the private website/resume comparison is N/A.
- **N/A · 1.4 First screen and CTA.** The diff changes no visible page content:
  - BaseLayout's hunks touch only the frontmatter and the `<head>` meta tags.
  - `src/pages/404.astro` only adds `ogScene="not-found"`.
  - `src/pages/building/the-engineers-daily.astro` only drops its `ogImage` prop.
  - The new route serves video bytes.
- **PASS · 1.5 Navigation, links and addresses.**
  - The diff does not touch SiteNav, Footer, the contact routes or any page body.
  - It adds no external links. The Google Fonts URL in `scripts/og-video/kit.css` is used only while rendering.
  - The scenes show 21 distinct URL labels:
    - `thesuperhuman.us`, `/about`, `/work` and `/services`
    - `/software/start`
    - `/building` and its project pages
    - `/writing` and `/writing/ai-gives-you-speed`
    - `/audio` and its subpages
    - `/music/old-news` and `/privacy`
  - Each label returned 200 from `curl -L` against the local Worker.
  - All 22 `og:image` and all 22 `og:video` URLs were served at their paths with 200.
  - No address appears on the 22 posters. A grep of the scenes, alt text and manifest for street, suite, Wyoming and Roanoke found nothing.
  - Navigation and the footer were not retested, because the diff does not change them.

## 2. Search and sharing

- **PASS · 2.1 Titles and descriptions.**
  - All 21 `OG_SCENES` routes, fetched from the local Worker, have a non-empty `<title>` and meta description.
  - All 21 titles are distinct, and so are the 21 descriptions (for example "Work with me · Kazon Wilson" and "Audio services · Kazon").
  - On every route, on the 404 pages and on the audio host, `og:title` equals the title and `og:description` equals the description.
  - The PR does not change these lines. Grepping BaseLayout at `26e764a` and `8e6e9cc` for title, description, canonical and robots gives the same lines, with only the line numbers shifted.
- **PASS · 2.2 Canonicals.**
  - The canonical and `og:url` lines in BaseLayout are identical at both revisions.
  - `src/lib/canonical.ts`, `src/lib/host-routing.ts`, `astro.config.mjs` and `scripts/sitemap-pages.mjs` are unchanged.
  - Locally, every route's canonical is `https://thesuperhuman.us<path>` and equals its `og:url`. All 21 `OG_SCENES` canonicals appear in `sitemap-0.xml`.
  - Variants normalize:

    | Request | Canonical |
    | --- | --- |
    | `/about/` | `/about` |
    | `/services?utm_source=x&ref=y` | `/services` |
    | `/software/start?path=website` | `/software/start` |
    | Host `www.thesuperhuman.us` on `/work` | `https://thesuperhuman.us/work` |
    | Host `audio.thesuperhuman.us` on `/` | `https://thesuperhuman.us/audio` |

  - Unchanged from before this PR: the canonical URLs of `/building/tally` and `/building/kaillera-next` answer 307 to their trailing-slash forms (see 2.5).
- **PASS · 2.3 Open Graph, card type and image description.**
  - A script fetched and parsed these pages:
    - the 21 `OG_SCENES` routes
    - `/no-such-page`, `/writing/no-such-essay`, `/building/no-such-project`, `/music/old-news` and `/building/personal-website/archive`
    - on Host `audio.thesuperhuman.us`: `/`, `/services`, `/portfolio`, `/releases`, `/start`, `/music/old-news` and `/no-such-page`
  - Every page has:
    - exactly one `og:image`, `https://thesuperhuman.us/og/<scene>-<hash>.png` or `.jpg`, for the expected scene
    - `og:image:width` 1200 and `og:image:height` 630
    - `og:image:alt` equal to the `OG_SCENES` alt text (162 to 312 characters)
    - `og:video` and `og:video:secure_url`, both the same scene's `https://thesuperhuman.us/og/<scene>-<hash>.mp4`
    - `og:video:type` `video/mp4`, with video width 1200 and height 630
    - `twitter:card` `summary_large_image`
    - the documented tag order: `og:type`, `og:url`, `og:title`, `og:description`, `og:image`, `:width`, `:height`, `:alt`, `og:video`, `:secure_url`, `:type`, `:width`, `:height`, `twitter:card`
  - Scene selection:
    - The 404s answer HTTP 404, with `og:url` equal to the requested URL, robots "noindex, follow" and the not-found scene.
    - The audio host home gets the audio scene.
    - On `/music/old-news`, the exact route wins over the release artwork.
    - `/writing/ai-gives-you-speed` is the only real page under `/writing/*`, and it has its own scene. Unknown `/writing` paths give 404 with the not-found scene.
    - The family fallback was seen on `/building/personal-website/archive` (personal-website scene) and is unit-tested.
  - Posters:
    - All 22 exist in `public/og`. Each is served at the same path with 200, as `image/png` (19) or `image/jpeg` (3).
    - Their bytes match the repository files and `imageBytes` in `og-media.json`, and they carry the immutable cache header.
  - Videos, from the route:
    - HEAD gives 200, `video/mp4`, `accept-ranges: bytes` and the manifest length.
    - GET gives 200, with bytes identical to `public/og/raw`.
    - `Range: bytes=0-1` gives 206 with `content-range` 0-1/size.
    - An out-of-range request gives 416 with `bytes */642380` (home).
    - An unknown hash gives 404.
    - `ffprobe` shows H.264 High, 1200 × 630, yuv420p, 30 fps and no audio, with `moov` before `mdat`.
  - Each poster differs from its video's frame 0 by a mean absolute RGB difference of 1.4 to 2.1 out of 255, which is consistent with encoding.
  - All 22 posters were inspected at full size and three at 600 × 315. All are legible and unclipped.
  - `/og-image.png` now returns 404. `src`, `public`, `scripts`, README and tests no longer reference it.
  - How real apps show these previews needs the deployed site (see Live checks).
- **N/A · 2.4 Icons.**
  - The diff does not touch `public/favicon.ico`, `public/favicon.svg`, `public/apple-touch-icon.png` or the icon `<link>` tags; `git diff --stat` on those paths is empty.
  - `<link rel="icon" href="/favicon.ico">` appears only as unchanged context in the BaseLayout hunk.
- **FAIL (existed before this PR) · 2.5 Robots and sitemap.**
  - What this PR touches passes:
    - `/robots.txt` returns 200 with `User-agent: *`, `Allow: /` and `Sitemap: https://thesuperhuman.us/sitemap-index.xml`.
    - `/sitemap.xml` returns 404, and robots.txt points to `/sitemap-index.xml` instead, as in the October 20 live record.
    - `/sitemap-index.xml` returns 200 `application/xml` and lists `/sitemap-0.xml` (200). That file has 26 `https://thesuperhuman.us` URLs, including all 21 `OG_SCENES` routes.
    - The sitemap has no `/og/` paths, because the new route is dynamic (`prerender = false`).
    - The PR does not change `public/robots.txt`, `astro.config.mjs` or `scripts/sitemap-pages.mjs`.
  - The failure existed before PR #203. The same 26-URL sitemap lists routes that redirect, are private or noindex, or return an error:
    - `/studio`: 302 to `/studio/sign-in`
    - `/studio/sign-in`: `x-robots-tag: noindex, nofollow`
    - `/agreements`: noindex, nofollow
    - `/agreements/verify`: 404 "This link has expired" without a key, noindex, nofollow
    - `/building/tally` and `/building/kaillera-next`: 307 to `/building/tally/` and `/building/kaillera-next/`. Their canonical and `og:url` name the slashless URL that redirects.
  - This needs a fix or an owner-recorded exception with its impact and follow-up. Merging #203 does not change the sitemap.
- **UNVERIFIED · 2.6 Preview indexing and access control.**
  - The PR head's Workers Builds summary lists two preview URLs. Both are shaped `<prefix>-thesuperhuman-us.<account>.workers.dev`, with two labels before `workers.dev`.
  - With a Host header of that shape, every response tested locally carried `x-robots-tag: noindex, nofollow`:
    - the new route `/og/home-85175dfd8c.mp4`, `/` and `/about`, from `src/middleware.ts:73`
    - the static `/og/home-feaa0743d2.png`, `/og/raw/home-85175dfd8c.mp4`, `/favicon.svg` and `/robots.txt`. This header comes from the `https://:version.:subdomain.workers.dev/*` rule in `public/_headers`, which local `wrangler dev` applied to these HTTP requests.
  - The static poster also kept the immutable Cache-Control from the new `/og/*` block, so the two rules combine.
  - With a host the rule's pattern does not match (`a.b.c.workers.dev`), static files carried no X-Robots-Tag. Dynamic pages still did, from the middleware.
  - The PR description says the branch preview sits behind a sign-in. That was not observed.
  - Still needed: the deployed preview's headers and its gate.
  - The posters and scene text contain no secrets or private data: the posters were inspected and the scene text was grepped.
- **N/A · 2.7 Structured data.**
  - The diff touches no structured data. The `jsonLd` prop and its script output in BaseLayout are unchanged.
  - `src/data/profile.ts` is unchanged, and the diff has no `ld+json` lines.

## 3. Accessibility and responsive behavior

- **PASS · 3.1 Landmarks, language and headings.**
  - BaseLayout wraps every page and gained only `<meta>` tags in `<head>`.
  - All 26 sitemap URLs were fetched from the local Worker. Every page that returned 200 has `<html lang="en">` and one `<main>`.
  - Each has one `<h1>`, except `/audio/start` (4) and `/software/start` (10). Those are multi-step forms whose other screens sit in hidden sections, as the October 20 record already describes.
  - The diff has no body markup.
- **PASS · 3.2 Image alternatives.**
  - Every scene page now writes `og:image:alt` (21 of 21 fetched pages with `og:image`). Before this PR, previews had no alt text.
  - The home, audio-services, work and project-threadline posters were compared with their alt text in `src/lib/og-media.ts`, and all four match:
    - home names the tagline, the line and the desk objects
    - work names the twenty terracotta cells and the "Owner-reported batch capacity" label
    - audio-services names the three approved prices
  - No on-page images or controls changed.
  - Limit: `twitter:image:alt` is not set. Whether X falls back to `og:image:alt` has not been checked.
- **N/A · 3.3 Keyboard and focus.**
  - The diff adds no focusable or interactive element.
  - In the fetched HTML, `/og/` appears only in meta `content` attributes: 63 references across 21 pages. No `<video>`, `<img>` or `<a>` points at the new files.
- **N/A · 3.4 Labels and errors.** No form, input or client script is in the diff.
- **UNVERIFIED · 3.5 Contrast, targets, zoom and motion.**
  - Pages: no CSS or visible markup changed, so page contrast, targets and zoom are unaffected.
  - Poster contrast was estimated from the darkest pixel against the most common background on work, audio-services, threadline and home:
    - terracotta kickers: 6.6 to 6.8:1
    - grey and ink text: 12.3 to 15.2:1

    This is a pixel estimate, not a tool audit.
  - Motion: the site never plays these videos (no `<video>` references them).
  - Flashing:
    - An ffmpeg `signalstats` pass over the whole-frame luminance of all 22 videos found large swings only on home.
    - Home has two light/dark transitions in 7 s, at 0.93 s and 4.1 s, well under three per second.
    - Every other video swings 12.5 or less (on a 0 to 255 scale) within any 1/3 s.
    - No PEAT or localized flash analysis was run.
  - Still missing: how Apple Messages handles these looping previews with Reduce Motion or Auto-Play Video Previews turned off. That needs a real iPhone or Mac and the deployed site.
  - No automated accessibility tool is installed.
- **N/A · 3.6 Widths.**
  - The diff changes no layout, CSS or body markup.
  - Spot check: the CI captures at `8e6e9cc` for the two pages whose source changed all render normally with no visible overflow:
    - not-found-desktop (1280 × 1079)
    - not-found-phone (390 × 994)
    - building-the-engineers-daily-phone (390 × 4179)
- **UNVERIFIED · 3.7 Browsers and devices.**
  - For this PR, the clients that matter are the apps that show link previews: Messages on iPhone and Mac, Discord, Slack, X, LinkedIn and Facebook.
  - None can be tested locally. According to the PR description (not observed), the branch preview sits behind a sign-in.
  - Range handling was checked only with `curl`. Safari and AVFoundation never fetched a video.

## 4. Performance and resilience

- **PASS · 4.1 Images and media.**
  - Posters:
    - All 22 are 1200 × 630 (19 PNG, 3 JPEG), matching `og:image:width` and `og:image:height`.
    - Sizes run from 69,381 bytes (threadline JPEG) to 439,902 bytes (home PNG), 4,783,661 bytes in total.
  - Videos:
    - All 22 are H.264 High, yuv420p, 1200 × 630, 30 fps and 5 to 8 s long, with a single video stream and no audio.
    - The atom order is `ftyp`, `moov`, `free`, `mdat`, which means faststart.
    - Sizes run from 147,052 bytes (writing) to 1,041,510 bytes (about), 9,179,497 bytes in total.
  - All files are under the renderer limits of 2.5 MB per video and 600 KB per poster.
  - Hero priority and lazy loading do not apply, because pages do not load these files.
  - Unverified risk: 7 posters exceed 300 KB, a limit some apps are commonly reported to enforce (WhatsApp). The retired `og-image.png` was already 325,477 bytes.
- **PASS · 4.2 Client code, compression and caching.**
  - `package.json` and the lockfile are unchanged.
  - og-media appears only in the Worker chunk (`dist/_worker.js/chunks/og-media_05AO7KnY.mjs`, 20,846 bytes), not in any `dist/_astro` client file.
  - Each page gains 641 to 813 bytes of new head meta (about 760 on home), depending on its alt text, and loads none of the media.
  - Caching:
    - Locally, posters and `/og/raw/*.mp4` carry `Cache-Control: public, max-age=31536000, immutable` from the new `/og/*` rule.
    - The video route sets the same header itself.
    - 404s under `/og/` (`nope.png`, `nope.mp4`, `raw/nope.mp4`, `/og/`) carry no immutable header.
  - With `Accept-Encoding: gzip, br`, posters and videos come back without `content-encoding`. That is correct for media that is already compressed.
  - Limits:
    - Production edge caching of the Worker route is not verified.
    - The route reads the whole file from ASSETS on every request, including HEAD and 2-byte ranges (at most 1.04 MB).
- **PASS (lab only) · 4.3 Page measurements.**
  - Each page gains under 1 KB of `<meta>` and loads no new resource.
  - Lab run against the local Worker: Playwright Chromium, 390 × 844 phone viewport at 3× scale, CPU slowed 4×, network limited to 150 ms latency and 1.6 Mbit/s down, observers for `largest-contentful-paint` and `layout-shift`:
    - `/`: LCP 1.62 s, CLS 0.030
    - `/work`: LCP 0.65 s, CLS 0.052
    - `/audio`: LCP 1.04 s, CLS 0.063
    - `/building/tally`: LCP 0.88 s, CLS 0.050
  - All are under 2.5 s and 0.1. These are lab results from a local server, not field evidence; INP needs field data and was not measured.
- **N/A · 4.4 Async UI recovery.** The diff adds no client-side async UI or fetch. `og-media.ts` runs only on the server and in the Worker.
- **PASS · 4.5 Missing media and autoplay.**
  - No site page autoplays these videos. None of the 26 fetched pages has a `<video>` pointing at `/og/`.
  - The only `<video>` on any page is the existing Old News lyric video. It is hidden, has controls and `preload="none"`, and does not autoplay.
  - The previews are silent: `ffprobe` shows no audio stream.
  - Missing video:
    - Unknown names return 404 from the local Worker.
    - A scratch test outside the repository, run against `serveOgVideo`, covered three cases. A name listed in the manifest whose raw file is missing returns 404. An ASSETS 500 returns 404. An ASSETS throw makes the request reject, which Astro turns into a 500.
  - Fallback: each poster matches its video's first frame, so an app that shows only the image shows the same picture.
    - ffmpeg PSNR, with both converted by ffmpeg's default path to YUV 4:2:0: 47.3 dB home, 47.7 dB not-found, 40.6 dB threadline JPEG.
    - The same comparison in RGB gives 41.5 dB on home.
  - Limit: how Messages behaves when the video fails is untested. That needs the deployed site and a device.
- **PASS · 4.6 Branded 404, redirects and errors.**
  - On the local Worker, all of these return HTTP 404 with "Page not found · Kazon Wilson" and the not-found scene's `og:image` and `og:video`:
    - `/this-does-not-exist`, `/building/nope`, `/writing/nope` and `/audio/nope`
    - `/og/nope.png`, `/og/raw/nope.mp4`, `/og` and `/og/`
    - `/og-image.png`, `/x/y/z.html` and `/a%20b?q=1`
  - The audio host's `/nope-here` gives 404 (robots noindex, follow), and HEAD `/nope-zzz` gives 404.
  - The CI captures not-found-desktop and not-found-phone show the branded page.
  - An unknown `/og/<name>.mp4` returns a plain-text 404, "Not found" (9 bytes), matching the existing music media route.
  - Redirects:
    - `/og/raw%2F<file>` gives 307 to `/og/raw/<file>`.
    - `/building/tally` and `/building/kaillera-next` give 307 to their trailing-slash forms. This is existing directory handling, not in this diff.
    - The retired `/og-image.png` returns 404, with no redirect.
  - `ogMedia()` throws for a scene that has not been rendered. The test "has exactly one rendered entry and one scene file per scene" guards against that.

## 5. Forms and sensitive flows

- **N/A · 5.1 Server validation, origin and abuse checks.**
  - The diff changes no form, API route (`src/pages/api`), validation, Turnstile, rate-limit or middleware file.
  - The new route only reads (GET and HEAD) and stores nothing.
  - It serves a name only if the manifest lists it (an unknown hash returned 404).
  - Range goes through the existing `mediaRange` parser (invalid ranges return 416).
  - POST returned 403 from the existing cross-site form guard.
- **N/A · 5.2 Failure matrix.** No form or client script changed. The diff adds no `<script>`, and no file under `src/components`, `src/scripts` or `src/pages/api` changed.
- **N/A · 5.3 No-JS and verification fallback.** No form markup or Turnstile code changed. The existing `challenges.cloudflare.com` origin on `/` is unchanged.
- **N/A · 5.4 Delivery and receipt.** No email, Resend or notification code changed.
- **N/A · 5.5 Approval-gated flows and sensitive files.**
  - The resume, KV, approval, offer and agreement code is untouched.
  - The only new file access is public link-preview media, read from ASSETS through a manifest allowlist. `/og/raw` is already public static content.
- **N/A · 5.6 Inline confirmation.** No confirmation UI changed.

## 6. Privacy, legal and measurement

- **PASS · 6.1 Data inventory.**
  - By source and locally, the PR adds no cookies, storage, scripts, embeds, processors or logging. `og-media.ts` has no console calls.
  - Visitors' browsers: the diff adds only `<meta>` tags, which browsers do not fetch. The external origins in the served HTML of `/`, `/services`, `/privacy` and the 404 page are the existing ones:
    - `challenges.cloudflare.com`
    - Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`)
    - the GitHub, Ko-fi and LinkedIn links
    - the demo subdomains
    - on `/privacy`, the links to Cloudflare, Google, Resend and Stripe pages
  - Worker: its only new request is a fetch to its own ASSETS binding for `/og/raw/<name>.mp4`.
  - Preview apps (Messages, Discord and others) fetch posters and videos from `thesuperhuman.us` itself when someone shares a link.
  - Render time: `kit.css` imports Inter and JetBrains Mono from Google Fonts inside the developer's Chromium. Visitors never load it.
  - Host-injected scripts on the live site were not checked. This diff does not change them.
- **N/A · 6.2 Privacy notice.**
  - No personal data processing is added, and `src/pages/privacy.astro` is unchanged.
  - The privacy scene quotes the page, which the passing copy test enforces. The page's statement that its code includes no advertising trackers still holds.
- **N/A · 6.3 Consent.** No cookies or nonessential processing are added.
- **N/A · 6.4 Terms, address and legal disclosures.** No commerce, address or legal text changed. The scenes show only the approved audio starting prices and the site's existing fixed-price line, and no address.
- **N/A · 6.5 Analytics.**
  - No analytics code changed.
  - Note: `src/lib/cloudflare-analytics.ts` counts every eyeball request on `thesuperhuman.us`. The owner's "requests" figure will now include preview apps fetching posters and videos, which can mean several Range requests per video.
- **N/A · 6.6 Monitoring.**
  - No logging or monitoring code changed, and Workers observability was already enabled.
  - If the ASSETS fetch fails, the new route returns a 404 without logging anything. The post-deploy `curl` checks are what would catch that.

## 7. Release and final QA

- **PASS · 7.1 Required checks.**
  - These ran on October 22, 2026, between about 07:25 and 07:35 UTC, on a clean tree at `8e6e9cc`. A second pass reran them between about 07:40 and 07:50 UTC, with the same results.
  - `npm run check` exited 0: "Result (459 files): 0 errors, 0 warnings, 17 hints".
    - None of the hints are on lines this PR changes.
    - BaseLayout has 3 hints, on lines that were already there: line 74 (the font stylesheet `onload`, 2 hints) and line 84 (the JSON-LD script).
    - The other hints:
      - 7 in `scripts/studio-retention.mjs`
      - 2 in SoftwareOffer
      - 1 each in owner/SoftwareAgreementDetails, api/agreements/link, api/owner/agreements, audio/about and brief-autocomplete

      This PR changes none of these files.
  - `npm test` exited 0: 135 files, 1,695 passed, 1 skipped.
    - The skip is the existing `it.runIf(existsSync(privateTemplateFile))` in `tests/lib/agreement-pdf.test.ts`.
    - The only other output is Node's existing "SQLite is an experimental feature" warning.
  - The PR's four test files, run verbose: 116 passed.
  - `npm run assets:check`: "Asset QA passed: 80 production files match their visual review records."
  - `npm run copy:check`: "copy-check passed: no banned copy patterns found."
  - The build was not rerun locally, so the `dist/` that `wrangler dev` serves stayed as it was. It was built at 07:14:30 UTC from a clean tree, after the head commit.
  - CI Validate succeeded on `8e6e9cc` (npm ci, check, test and build, with the prebuild asset, copy and publicist gates).
  - Screenshots capture succeeded. It runs `tests/browser/personal-name.cjs`, which this PR changes.
- **PASS · 7.2 Diff, generated files and public artifacts.**
  - `git diff 26e764a..8e6e9cc`: 90 files, +4,272/-74, 12 commits.
  - Unchanged: `package.json`, `package-lock.json`, `wrangler.jsonc`, `astro.config.mjs`, `migrations/`, `.github/` and `src/middleware.ts`.
  - Generated files:
    - 22 posters, 4,783,661 bytes in total
    - 22 MP4s in `public/og/raw`, 9,179,497 bytes in total
    - the manifest `src/data/og-media.json`

    Each file has a review record with a matching hash (`assets:check`).
  - Retired files: `public/og-image.png`, `scripts/og.html` and `scripts/build-og.sh`. The only remaining references are in `docs/asset-reviews/studio-v1.md`, which records the retirement, and in the frozen historical plan and spec under `docs/superpowers/`.
  - All 4,272 added lines were scanned:
    - No temporary or home-directory paths, `localhost`, `workers.dev`, internal hostnames, tokens or keys. The `/home/` matches are repository paths such as `src/components/home/StudioLife.astro`.
    - The only hosts are `thesuperhuman.us`, `fonts.googleapis.com` (an `@import` in `scripts/og-video/kit.css`, used only while rendering) and the `www.w3.org` SVG namespace.
  - Commit messages have no private paths and no em dashes.
  - Media metadata holds only the `Lavf60.16.100` and `libx264` encoder strings. There are no EXIF or text chunks.
  - No em dash was added in `src`, `public`, README or the scenes. The only added em dash is in a test regex that checks that alt text contains none.
  - "Clearance" and "exclusivity" appear only in `docs/asset-reviews/link-previews.md`, where they state that no such claim is made. No hourly rates or buzzwords appear.
  - Claims:
    - The copy test holds scene copy word for word to `src/`, apart from its listed composed labels and the Tally capture's legend lines, and it passed.
    - `src/assets/projects/tally/home-annotated.webp` was opened. Its legend reads "Written by code from the numbers, not by AI." and the demo banner is visible.
    - On the 600 × 315 contact sheet of all 22 posters, there are no address bars, terminals or private data.
  - No unrelated changes. The two page edits are explained under Scope.
- **PASS · 7.3 Bindings, HTTPS, host routing, caching and headers (locally and by source).**
  - Bindings: the new route reads from the existing ASSETS binding (`wrangler.jsonc`: `assets.binding` "ASSETS", directory `./dist`, unchanged). No secrets, migrations or backups are involved.
  - Dynamic pages:
    - `/`, with GET and HEAD, returns 200 `text/html` with `permissions-policy`, `referrer-policy: strict-origin-when-cross-origin`, `x-content-type-options: nosniff` and `x-frame-options: DENY`. It has no Cache-Control, same as before.
    - `/services` and `/privacy` (HEAD) return the same.
    - The `/building` journal pages keep their existing `no-store`.
  - Video route, `/og/home-85175dfd8c.mp4`:
    - HEAD and GET return 200, Content-Length 642,380, `video/mp4`, `accept-ranges: bytes`, `Cache-Control: public, max-age=31536000, immutable` and all four security headers.
    - `bytes=0-1` returns 206 with `content-range: bytes 0-1/642380`. `bytes=642370-` and `bytes=-5` also return 206 with the correct ranges.
    - An out-of-range request returns 416 with `bytes */642380`. An unknown hash returns 404 `text/plain`. POST returns 403.
    - The sha256 of the full body and of the 1000-1999 slice match the committed file.
  - Static `/og/*.png` and `/og/raw/*.mp4` return 200 with the immutable header from `public/_headers` plus the four security headers. A Range request to the raw static file returns 200 for the whole file, which confirms why the Worker route exists.
  - Twenty-three sitemap URLs render a page with OG tags. The exceptions are `/studio`, which redirects, and `/agreements` and `/agreements/verify`, which use AgreementLayout and carry no OG tags. Those 23, the audio routes and two missing paths all name a poster and a video that each return 200 locally.
  - With Host `audio.thesuperhuman.us`:
    - `/`, `/services`, `/start`, `/portfolio` and `/releases` return 200.
    - Their `og:image`, `og:video`, `og:url` and canonical all point to `https://thesuperhuman.us/...`, because `canonical.ts` always uses the main host.
    - Every og URL is absolute HTTPS.
  - Detailed video route checks on the local Worker at `8e6e9cc`, against `/og/about-b4419b2ca3.mp4` (1,041,510 bytes) unless noted:
    - **PASS · GET.**
      - 200, `video/mp4`, `Accept-Ranges: bytes`, `Cache-Control: public, max-age=31536000, immutable`, Content-Length 1,041,510, and the four security headers.
      - The body is byte-identical to `public/og/raw/about-b4419b2ca3.mp4` (`cmp`).
    - **PASS · Range.**
      - `bytes=0-1` gives 206, `Content-Range: bytes 0-1/1041510`, Content-Length 2. The bytes match the file's first two.
      - `bytes=100-199` gives 206, `bytes 100-199/1041510`, and matches `dd` of the file.
    - **PASS · Suffix and open ranges.**

      | Range | Result |
      | --- | --- |
      | `bytes=-500` | 206, `bytes 1041010-1041509/1041510`, matches `tail -c500` |
      | `bytes=1041000-` | 206, `bytes 1041000-1041509/1041510`, 510 bytes, matches |
      | `bytes=1041500-9999999` | clamped to 1041500-1041509 |
      | `bytes=-9999999` | 206 for the whole file, 0-1041509 |

    - **PASS · Unsatisfiable range.** `bytes=1041510-`, `bytes=2000000-2000100`, `bytes=500-100` and `bytes=-0` each give 416 with `Content-Range: bytes */1041510` and Content-Length 0.
    - **PASS · Malformed Range.**
      - There was no crash and no 5xx. These all give 416 with `bytes */1041510`: `bytes=-`, `bytes=abc`, `bytes=0-1x`, `bytes = 0-1`, `items=0-1`, `bytes=0-1,5-6` and `bytes=99999999999999999999-`.
      - An empty Range header gives 200 for the full file.
      - Note: RFC 9110 says to ignore a Range with an unknown unit. Answering 416 to an unknown unit (`items=`) or to a valid multi-range departs from that. See Remaining work.
    - **PASS · HEAD.**
      - `curl -I` gives 200 with Content-Length 1,041,510, `video/mp4`, `Accept-Ranges: bytes`, the immutable Cache-Control and no body.
      - HEAD with `Range: bytes=0-1` gives 200 for the full length. Range is ignored on HEAD, as the README says.
      - POST gives 403 from the existing cross-site form guard.
    - **PASS · Unknown names.**
      - `/og/nope.mp4`, `/og/about-0000000000.mp4` (wrong hash) and `/og/about.mp4` each give 404 `text/plain` "Not found".
      - `/og/about-b4419b2ca3.MP4` and `/og/sub/<file>.mp4` give the branded HTML 404.
    - **PASS · Path traversal.** Run with `--path-as-is`:
      - `/og/..%2Fraw%2Fabout-b4419b2ca3.mp4`, `/og/..%2f..%2fwrangler.mp4` and `/og/about-b4419b2ca3.mp4%00` each give 404.
      - URL parsing normalizes `/og/%2e%2e/og/raw/<file>` and `/og/../og/<file>` to public paths inside `/og`, and they give 200.
      - `/og/raw%2F<file>` gives 307 to the public `/og/raw/<file>`.
      - `serveOgVideo` serves a name only if `/og/<name>.mp4` equals a manifest entry, so nothing outside the 22 public files is reachable. The unit test covers `../raw/x` returning 404.
    - **PASS · Audio host routing.**
      - With Host `audio.thesuperhuman.us`, `/` is 200. Its canonical and `og:url` are `https://thesuperhuman.us/audio`, its `og:image` is `https://thesuperhuman.us/og/audio-974d88de7f.png`, and its `og:video` is `https://thesuperhuman.us/og/audio-b01c9e59c6.mp4`.
      - On the audio host itself, `/og/audio-974d88de7f.png` and `/og/raw/<file>` give 200.
      - `/og/audio-b01c9e59c6.mp4` gives 404 there, because it is rewritten to `/audio/og/...`. This is harmless because the tags always name the main host.
    - **PASS · `public/_headers` `/og/*` rule.**
      - The header was observed on static posters (home PNG and threadline JPEG, with ETag) and on `/og/raw/*.mp4`.
      - It does not appear on Worker 404s under `/og/`.
      - Static `/og/raw/<file>` ignores Range (200 for `bytes=0-1`).
    - **PASS · File sizes in `public/og`.**
      - Videos: the largest is `raw/about-b4419b2ca3.mp4` at 1,041,510 bytes, then services at 767,628 and music-old-news at 736,236. The smallest is writing at 147,052.
      - Posters: the largest is `home-feaa0743d2.png` at 439,902 bytes, then personal-website-story at 379,423 and services at 343,603. The smallest is the project-threadline JPEG at 69,381.
      - All are under the README's 2.5 MB and 600 KB limits, and the sizes match `imageBytes` and `videoBytes` in `src/data/og-media.json`.
- **UNVERIFIED · 7.3 (live) HTTPS, the Worker's ASSETS fetch, Range and headers on the deployed production Worker.**
  - This needs the deployed site. No request was sent to production in this run.
  - The PR head's Workers Builds check uploaded only a branch preview version (`4d55f91a`). According to the PR description, that preview sits behind a sign-in.
- **UNVERIFIED · 7.4 Rollback version and backup; review and authorization rules.**
  - Rollback revision: `main` at `26e764a`. `git ls-remote` shows `origin/main` still at `26e764a`, and it is the PR's merge base.
    - It was committed on October 21, 2026 at 13:52:24 UTC (09:52 America/New_York).
    - Its Validate run succeeded at 14:05:46 UTC.
    - "Workers Builds: thesuperhuman-us" succeeded at 14:05:49 UTC (10:05 America/New_York). This was a production build: Build ID `90cf578e-d398-4c1f-a28f-424acec88709`, Worker Version ID `f480f1b0-603e-4987-8b21-06bff291a328`. Unlike the PR head's preview build, it has no preview URL.
  - Not observed: whether `f480f1b0` is serving now. No live request was sent, and the site shows no revision marker.
  - No backup is needed: there are no D1, KV, R2, migration or secret changes.
  - The rollback caveat about scraped previews is in the header.
  - Review and authorization rules, which are not yet confirmed:
    - Both GitHub review threads are resolved.
    - Codex reviewed only `1e97193`, and Greptile has not reviewed. CLAUDE.md therefore requires independent review agents on the current head until a pass finds nothing.
    - The coordinating session ran independent review agents on each new head until a pass found nothing; the fifth pass, on `8e6e9cc`, found nothing (see Evidence and limits).
    - `mergeable_state` is clean, and Validate, capture and Workers Builds are green on `8e6e9cc`.
    - The owner's answers contain no explicit merge or deploy instruction, so deployment authorization is tracked as UNVERIFIED under 1.1. Nothing has been merged or deployed.
  - Missing: the owner's go-ahead. This record's own commit also gets a review pass before merge.
- **UNVERIFIED · 7.5 Post-deployment verification.** Not deployed: PR #203 is open and unmerged. The owner agreed to the live checks ("Ok"). They are listed under "Live checks still to run after deploy".
- **UNVERIFIED · 7.6 Receipt.** This record is the receipt for the local evidence. Status as of October 22, 2026, about 07:55 UTC:
  - Implemented: yes (`8e6e9cc`).
  - Verified locally: yes, against `wrangler dev` serving the `dist/` of `8e6e9cc`.
  - Deployed: no. Only a branch preview version, `4d55f91a`, exists.
  - Verified live: no.

## 8. Private owner center

- **N/A · 8.1 Access and JWT verification.** No owner page, owner API, middleware or Access code is in the diff. Locally (no Access), `/owner` returned 403.
- **N/A · 8.2 Owner response headers and sitemap.**
  - Owner code is unchanged.
  - Locally, `/owner` returned 403 with `Cache-Control: private, no-store` and `x-robots-tag: noindex, nofollow`.
  - The local `sitemap-0.xml` lists 26 URLs, none under `/owner` or `/api`.
- **N/A · 8.3 MUSIC_DB schema and migration ledger.** No migrations or schema changes are in the diff.
- **N/A · 8.4 Persistence before success.** No request storage or email code changed.
- **N/A · 8.5 Traffic summary.** `src/lib/cloudflare-analytics.ts` is unchanged. The requests count will include link-preview media fetches (see 6.5).
- **N/A · 8.6 Playback exclusion, campaign tags and city rows.** Music analytics code is unchanged. The new video route is separate from the music-media streaming and listening events.
- **N/A · 8.7 Retention preview and manifest.** No retention code or data changed.
- **N/A · 8.8 Studio migrations and studio exercise.**
  - No studio code or migrations changed.
  - `/studio/sign-in`, which uses BaseLayout, now carries the home scene's tags in place of `/og-image.png`. `/studio` redirects to it and renders no page of its own.
  - The sign-in page's title and description are unchanged, and the tags hold no private data.
- **N/A · 8.9 Launch scope with payments off.** No payments or booking code changed.
- **N/A · 8.10 Studio retention against non-production.** No studio retention or R2 code changed.
- **N/A · 8.11 `STRIPE_PAYMENTS_ENABLED=false`.** `wrangler.jsonc` and the payment configuration are unchanged.
- **N/A · 8.12 Stripe signatures, webhooks and invoices.** No Stripe or webhook code changed.
- **N/A · 8.13 Owner Payment section.** No owner Payment code changed.
- **N/A · 8.14 Rollback and recovery rehearsals.** None of these procedures or their code are touched. The website rollback for this PR is covered in 7.4.
- **N/A · 8.15 `owner:health`.**
  - `scripts/owner-health.mjs` checks D1 tables, configuration and the signing route, none of which this diff touches.
  - Separately, the remote `owner:health` run that the #188 record left UNVERIFIED is still open.

## Software agreement signing

- **N/A · S.1 to S.11.**
  - These cover counsel review, contractor configuration, template previews, the signing setting, email authentication, PDF rendering, certificates and hashes, failure and retry, downloads, restore and retention.
  - No agreement page, API, template, PDF, signing setting or AgreementLayout file is in the diff.
  - `/agreements` and `/agreements/verify` use AgreementLayout (unchanged) and serve no OG tags at either revision. Locally, `/agreements` returned 200 and `/agreements/verify` returned 404, both with no `og:image`.
- **N/A · S.12 CI screenshots, keyboard, no-JS and overflow for signing pages.** The signing pages are unchanged. The PR's CI screenshots at `8e6e9cc` cover the changed pages, not signing.

## Live checks still to run after deploy

The owner agreed to these on October 22, 2026 ("Ok"). Record each result here after the merge.

1. Workers Builds on the merge commit succeeds. Record its build ID and Worker Version ID.
2. Run the README's "Link previews" checks against a live video:
   - `curl -sI https://thesuperhuman.us/og/<file>.mp4` gives 200, `video/mp4` and `accept-ranges: bytes`.
   - `curl -s -o /dev/null -D - -H 'Range: bytes=0-1' https://thesuperhuman.us/og/<file>.mp4` gives 206 with `content-range: bytes 0-1/<size>`. HEAD ignores Range, so this check needs GET.
3. Messages on an iPhone and a Mac (needs the owner's devices):
   - Send a link and confirm the video plays.
   - Note how the preview behaves with Reduce Motion on and with Auto-Play Video Previews off (3.5).
   - Optionally, send a missing-page link. The PR description notes that Apple Messages is untested on 404 previews.
4. Run a link through Discord's embed debugger, the Facebook Sharing Debugger and the LinkedIn Post Inspector.
   - Note whether Discord shows the poster or an inline player for the `og:video` MP4.
   - Where possible, note what X and Slack show, and whether X uses `og:image:alt` (no `twitter:image:alt` is set).
5. On the live site:
   - `og:image` and `og:video` on every sitemap URL that renders OG tags resolve.
   - Posters return 200 with the immutable cache header.
   - `/og-image.png` returns 404.
   - Pages on `audio.thesuperhuman.us` point their tags at `thesuperhuman.us`.
   - The 404 page keeps a 404 status and the not-found scene.
   - The four security headers are on the video route.
   - HTTPS, robots and the sitemap are unchanged.
   - `/owner*` still redirects to Access.
6. Optional:
   - static-asset Range behavior in production
   - whether repeated video route requests are served from Cloudflare's cache (not verified locally)
   - a WhatsApp share of one of the posters over 300 KB
7. On the deployed branch preview (behind a sign-in, according to the PR description):
   - confirm the sign-in gate
   - confirm that static `/og/*` files there carry `X-Robots-Tag` from the `workers.dev` rule, as they did locally (2.6)

## Known unknowns

These stay UNVERIFIED unless the owner records an exception with its impact and follow-up in this record:

- deployment authorization (1.1)
- the deployed preview's headers and sign-in gate (2.6)
- Messages behavior, including Reduce Motion and Auto-Play Video Previews off (3.5, 3.7)
- how each preview app shows the poster or video (3.7)
- field performance (4.3)
- production edge caching of the video route (4.2)
- the live Worker's ASSETS fetch, Range handling and headers (7.3)
- the production revision and the post-deploy checks (7.5)
- a PEAT or localized flash analysis, and an automated accessibility audit (3.5)

## Remaining work

- **Owner:** give an explicit go-ahead to merge #203. Merging to `main` deploys production (1.1).
- **Owner:** decide the sitemap FAIL (2.5). The options are a fix in a separate PR, or an exception with its impact and follow-up. Two things need deciding:
  - `/studio`, `/studio/sign-in`, `/agreements` and `/agreements/verify` are listed in the sitemap.
  - `/building/tally` and `/building/kaillera-next` are listed under URLs that redirect.

  This failure existed before PR #203 and is not caused by it.
- **Review:** this record's commit gets its own independent review pass before merge (7.4).
- **After deploy:** run the live checks above and record the results in this file. The Messages checks need the owner's iPhone and Mac.
- **Low-severity findings from this pass, for the owner to decide.** This record does not fix them.
  - `mediaRange` (`src/lib/music-media.ts`, shared with the music route) answers 416 to an unknown unit (`items=0-1`), a valid multi-range (`bytes=0-1,5-6`) and whitespace variants (`bytes = 0-1`). RFC 9110 section 14.2 says to ignore an unknown unit and serve 200. Safari sends single byte ranges, so the impact is small.
  - `serveOgVideo` reads the whole file from ASSETS (up to 1,041,510 bytes) before slicing, even for HEAD and 2-byte ranges.
  - If the ASSETS fetch throws, rather than returning a non-OK response, the route answers 500 instead of 404.
  - If the ASSETS fetch fails, the route returns 404 without logging, so only the post-deploy `curl` would catch it.
  - No `twitter:image:alt` is written.
  - 7 posters exceed 300 KB: home 439,902; personal-website-story 379,423; services 343,603; about 341,264; audio 336,091; personal-website 332,958; not-found 327,295. The retired card was 325,477.
  - On `audio.thesuperhuman.us`, `/og/<name>.mp4` returns 404 because the middleware rewrites it to `/audio/og/...`. No tag points there.
  - The owner traffic summary's requests count will include preview apps fetching posters and videos.
  - The retired `/og-image.png` returns 404 with no redirect. A platform that re-fetches an old cached card image loses it until it scrapes the page again. The PR intends this retirement.
