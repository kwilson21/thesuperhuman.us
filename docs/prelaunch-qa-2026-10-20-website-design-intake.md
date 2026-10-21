# Project brief paths release gate

Date: October 20, 2026 (UTC; first answers the evening of October 19 in America/New_York, copy fixes and template approval on October 20; headers fix and its checks on October 21 UTC, the evening of October 20 in America/New_York)  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#188](https://github.com/kwilson21/thesuperhuman.us/pull/188)  
Branch: `claude/website-design-intake-dd111d`  
Verified revision: `5683ec6`, the reviewed head `cb872a0` with `main` at `b429889` merged in (`09fe9c7`) and the first draft of this record. This revision of the record is committed on top of it.  
Merged revision: `f778ae42`, squash-merged to `main` on October 20, 2026 at 17:42 UTC. Workers Builds succeeded at 17:44 UTC. Live checks are in section 7.  
Headers fix: [#199](https://github.com/kwilson21/thesuperhuman.us/pull/199), squash-merged as `c05ec3ae` on October 21, 2026 at 01:24 UTC (the evening of October 20 in America/New_York). Workers Builds succeeded at 01:25 UTC. See the security headers item in section 7.  
Target: production `https://thesuperhuman.us`:
- `/software/start`, with `?path=website`, `webapp`, `workflow` and the legacy `idea`
- `/services`, Home and `/privacy`
- `POST /api/software-inquiry` and `POST /api/software/brief/suggest`
- the owner request pages and client emails for software briefs

On `audio.thesuperhuman.us`, page paths are rewritten under `/audio` (`src/lib/host-routing.ts`), so the changed pages do not render there. The APIs are shared.  
Reviewer: Claude Code agent, collecting evidence for owner Kazon Wilson. Claude subagents wrote the code, and independent Claude reviewers and Codex reviewed it. This record is evidence collection, not owner certification.  
Scope:
- the project brief with three named paths (Website design, Web app, Workflow automation)
- the website brief's three questions
- owner center support for website briefs
- the `/services` rows, the website door and Home's button
- the recaptured website door picture
- the privacy notice

Every path stays request kind `software` and uses the existing offer, agreement and invoice pipeline.  
Rollback revision: `b429889`, the `main` revision before this PR merged. Its Workers Builds deploy succeeded on October 20, 2026 at 00:00 UTC, and it was in production until the deploy of `f778ae42` finished. This PR changes no migration, binding, secret, dependency or header. Caveat: once a website or web app brief has been stored, code at `b429889` would show it in the owner center as a workflow brief without its answers. The rows stay intact in `MUSIC_DB`. After such a brief exists, roll forward with a fix rather than back, or read the request from D1.

Copy commit: `10400d7`, the final head of the PR, comes after the verified revision `5683ec6`. It changes two website examples in the owner offer editor and updates this record. CI on `10400d7` passed before merge: Validate, Screenshots capture and Workers Builds.

Agreements: see the owner-noted gap below.

## Owner decisions and authorization

Owner, in conversation, October 19, 2026 (America/New_York):

- Approved the design study (`docs/design-concepts/2026-10-19/website-intake/`) and asked for it to be built, reviewed and shown from CI screenshots. The PR merges only after the owner approves the look, following this gate.
- On the open choices:
  - "2. Sounds good": website clients still see "Software · Website design" on the offer page.
  - "3. Sure why not add a play link?"
  - "4. yes, use that": the website "Ask a question" example.
  - "5. Let's fix this": Home's button.
  - "1. a, recapture it.": the website door picture.

Owner, in conversation, October 20, 2026 (UTC):

- On the recaptured door picture, its row alternative text, and a note under Kaillera Next: "1. Yes 2. Okay 3. Keep as is".
- "“I organize what you want to say” is odd wording for website design". The owner then chose "Design and build": "I design and build your website, from the page plan to a site that works on phones and computers."
- Look approval and agreements: "I approve, the msa and sow does not cover website design so we may want to update everything after all of these changes".
- Answers on the website offer examples:
  - Launch: "I say make launch its own step after payment"
  - Devices: "They should check on all approved devices"
- On the updated MSA and SOW templates: "Keep 6 as is, approved, go ahead".
- On the two website offer example fixes: "Update PR #188 with those two copy fixes."

**Owner-noted gap: agreements.**
- Status: published; website signing is off.
  - The owner approved the updated MSA and SOW templates covering website design on October 20, 2026, and chose to publish both (owner decision).
  - Published in the production owner center at `/owner/agreements`, each as version 1 with label `v2026-10-20`: the MSA at 18:22 UTC (2:22 PM EDT) and the SOW at 18:25 UTC (2:25 PM EDT).
  - Source: observed in the owner center by the coordinating Claude session at the owner's direction, which read each version and time back from the page. The published text matched the approved source.
  - Website signing is off and no contractor details are saved. The owner's remaining steps are saving contractor details and turning on website signing. The gates in the signing release record (`docs/prelaunch-qa-2026-09-30-software-signing.md`) also apply before signing is enabled, including counsel review of the final templates and electronic consent, and owner verification of the registered-agent address and contractor configuration.
- Impact: after this release, a website brief can reach the owner center, and nothing in the code stops an offer from being sent on it.
- Condition met on October 20, 2026, when the templates were published (see Status). Original text, kept for history: Proposed until the templates are published (owner to confirm): answer website briefs with a question or a decline, and send the first website offer only under templates that cover website design.

## Evidence and limits

- **Copy commit, after `5683ec6`:** the two website examples in the owner offer editor now say that the site launch is a handoff step after final payment, and that the client checks the homepage design on each approved device. Tests assert the new text and that the old text is gone.
- **Checks:** run locally at `5683ec6`:
  - `npm run check`: 0 errors, 0 warnings. The 17 hints are in files this PR does not change.
  - `npm test`: 130 files, 1,532 passed, 1 skipped.
  - `npm run build`: passed, with the asset and copy gates. Locally, the publicist gate skips its private note lookup because there is no token. CI's Workers Builds ran it and passed.
- **Checks at the copy commit:** `npm run check`, `npm test`, `npm run copy:check` and `tests/pages/software-offer.test.ts`, run after the copy and record edits:
  - `npm run check`: 0 errors, 0 warnings, 17 hints.
  - `npm test`: 130 files, 1,532 passed, 1 skipped. The skip is the agreement PDF test that renders the real private templates. It runs only when the private file exists locally.
  - `npm run copy:check`: passed.
  - `tests/pages/software-offer.test.ts`: 98 passed.
- **CI:** Validate, Screenshots and Workers Builds passed at `0fcccd8`. At `cb872a0`, Validate, Screenshots capture and Workers Builds passed. At `5683ec6`, Validate and Workers Builds passed, and the Screenshots run was cancelled, superseded by the next push. At `10400d7` (the final head), Validate, Screenshots capture and Workers Builds passed.
- **Reviews:**
  - Independent Claude reviewers checked each round and each owner follow-up: one for correctness and security, one for UI, copy and the CLAUDE.md/AGENTS.md rules.
  - At `cb872a0` the last passes found no blocking or should-fix issues.
  - Codex code review and Codex security review of `cb872a0` found no issues.
  - A Claude pass at `5683ec6` reviewed the merge of `main` and the first draft of this record. The merge is clean: the net change equals `main`'s #189 diff, and no keys collide in `scripts/screenshots/config.mjs`. That pass found no blocking issues, and its corrections to this record are applied here.
  - Greptile did not review this PR.
- **Screenshots:**
  - CI captures for the final head are under `pr-188/10400d7/` on the `screenshots` branch; 181 of them are embedded in the PR description.
  - Screenshots runs on every push to this PR, because the PR's diff already includes UI files.
  - `scripts/screenshots/config.mjs` maps `SoftwareMilestone.astro` to the `software-offer` and `website-brief` scenarios. The `owner-brief` capture shows the empty offer editor's first milestone. By source, of the two changed examples only the acceptance one is expected to appear there. The captures at `0fcccd8` show the old text.
  - The later-milestone handoff example appears only after Add milestone. No capture is expected to show it; the unit tests cover it.
  - Under `pr-188/10400d7/`, the scenario captions describe `website-brief-owner-brief-desktop.png` (1280 px) and `website-brief-owner-brief-phone.png` (390 px) as the seeded fictional website brief as the owner reads it, with the fit review and the empty offer editor's website prompts. None of the `website-brief-*` captures are among the 181 embedded.
  - The captures include: every page at 1280 × 800 and 390 × 844; the `website-brief` scenario (each website screen, the receipt, the owner's view of a seeded fictional website brief, and the request list); and the `software-brief` scenario on the Web app path.
  - Viewed by the agent, at an earlier head and not `10400d7`: Home's Work with me strip, the `/services` rows and the owner's website brief.
  - Delivery in the scenarios is mocked, so it is not evidence of real email.
- **Local preview:** `astro dev` with the screenshot preview config, in Chromium, at `09fe9c7`. Since then, the only page code change is the copy commit's placeholder text in the owner offer editor.
  - Widths: 320, 640 and 768 px on `/`, `/services` and every website brief screen.
  - Keyboard: a pass through the first screen.
  - No JavaScript: the view of `/software/start?path=website`.
  - Metadata: titles, descriptions and canonicals.
  - A missing path under `/software/start`.
  - Computed text contrast and target sizes at 390 px.
- **Preview access:** the branch preview URL returns 302 to Cloudflare Access.

PASS means the evidence named here was observed. Production checks after the merge are listed in section 7.

## 1. Purpose and content

- **PASS · Scope and authorization.** Repository, branch, revision, scope and the owner's approval are recorded above. Deployment is authorized once CI is green and this gate is complete.
- **PASS · Approved design and claims.**
  - The build follows the approved study, plus the owner's follow-ups quoted above.
  - Prices are fixed and no rates appear. "Updates after launch are quoted separately, at a fixed price."
  - There are no clearance, exclusivity or hourly claims. The pass at `5683ec6` found no em dashes in the PR's added lines; `copy:check` covers `src/`, `public/` and `README.md`.
  - The door picture is a crop of this PR's own Home, recorded in `docs/asset-reviews/work-with-me-doors.md`.
  - The Tally picture is demo data with its banner.
  - The Kaillera Next play link goes to the public demo.
- **PASS · Explain who does what.**
  - The path lines and the website line say who acts ("I design and build your website…").
  - The receipt says what happens next ("I'll look at what you have and reply with a fixed-price first milestone, or a question or two.").
  - No professional claims or resume facts change.
- **PASS · First screen and CTA, locally and in CI.**
  - The brief's first screen names the three paths, each with one line, and adds a footnote for visitors who are unsure.
  - Home's "Start a project" opens it, and the website doors open it on the website path.
  - Checked at 320, 390, 640, 768 and 1280 px.
- **PASS · Navigation and links, by tests and source.**
  - "Back to Work with me" goes to `/services#software`. The anchor exists.
  - The phone menu links `/services#website`.
  - "Service →" on owner pages opens the request's own `/services` row.
  - No address is shown beyond the existing registered-agent footer.
  - The external links are the Tally and Kaillera Next public demos; both returned 200 during the pass at `5683ec6`. Live link checks follow in section 7.

## 2. Search and sharing

- **PASS · Titles and descriptions.**
  - `/software/start` has the title "Start a project · Kazon Wilson" and the description "Share a short project brief for Kazon Wilson to review."
  - `/services` and Home are unchanged and distinct.
- **PASS · Canonicals.** `/software/start?path=website` and `/software/start` both declare `https://thesuperhuman.us/software/start`, which matches the sitemap. The `path` parameter only preselects a choice and is not indexable content.
- **PASS · Open Graph.** `og:title` and `og:description` follow `/software/start`'s new title and description (`BaseLayout`). `og:url` follows the canonical. The card image is unchanged.
- **N/A · Icons.** No icon changes.
- **PASS · Robots and sitemap, built.**
  - The built sitemap includes `/software/start`, `/services` and `/privacy`.
  - No route is added, and owner routes stay excluded.
  - Live check follows in section 7.
- **PASS · Preview indexing.** The branch preview URL redirects to Cloudflare Access (302) before any page renders.
- **N/A · Structured data.** No structured data changes.

## 3. Accessibility and responsive behavior

- **PASS · Structure.**
  - The page language is `en`, and the landmarks are unchanged.
  - The brief keeps one visible `h1` per screen. Other screens' headings sit in `hidden` sections, as before this PR.
  - On Next, focus moves to the new screen's heading.
- **PASS · Image alternatives.**
  - The `/services` Website design row reads "This site’s Home page, with the introduction and the Start a project button" (owner-approved).
  - The doors keep empty alternative text beside their captions.
  - The Tally picture keeps its alternative text.
- **PASS · Keyboard, locally and by tests.**
  - Tab reaches the path radios.
  - Arrow keys move through all three choices without leaving the screen.
  - Tab reaches Next, which shows a 2 px solid focus outline. Enter moves to the first question.
  - A pointer choice still moves on automatically. Only a pointer does this (WCAG 2.1.1 and 3.2.2).
  - The current-site link on owner pages says it opens in a new tab, to screen readers too.
- **PASS · Labels and errors, by tests.**
  - The website answers have labels and optional markers.
  - The link check gives a specific message ("Add https:// to the start of the link.", "Use https:// or http:// at the start of the link." or "Check the link, or leave it empty.").
  - Error ids are linked through `aria-describedby` after a path change.
  - The updates choice uses "Choose one."
- **PASS · Contrast, targets, zoom and motion, locally.**
  - Contrast: computed for every visible text on each website brief screen at 390 px, on the `/services` Website design row and on Home's website door. Nothing is under 4.5:1; the lowest is 4.78:1, for button text. No new colors, fonts, radii or shadows.
  - Targets: the smallest are the review screen's Edit buttons at 29 × 44 px, and Skip at 35 × 44 px. The 18 px radios sit inside full-width label cards that also check them.
  - Zoom: the 640 px layout is what a 1280 px window shows at 200% zoom, and it has no overflow.
  - Motion: this PR adds no motion.
  - Limit: no automated accessibility tool is installed, so this is targeted measurement, not a full audit.
- **PASS · Widths.**
  - No horizontal overflow at 320, 640 and 768 px on `/`, `/services` and each website brief screen through review (`scrollWidth` equals the viewport). The only boxes outside the viewport are the off-screen skip link and the closed menu panel.
  - CI captures at 390 and 1280 px.
- **UNVERIFIED · Browsers and devices.** Only Chromium is installed here, and no real-device check has been done.

## 4. Performance and resilience

- **PASS · Images.** The door picture is a 900 × 600 WebP of 40,058 bytes, in the same size class as before. It has intrinsic dimensions and loads lazily. No hero image changes.
- **PASS · Client code.**
  - No dependency is added. The brief script grows only by its path plans and link messages.
  - The site-link pattern runs in linear time.
  - Values over 2,048 characters skip the link checks.
- **UNVERIFIED · Performance measures.** No lab or field measurement has been made for this change.
- **PASS, with gaps · Async recovery, by tests.**
  - `tests/scripts/brief-flow.test.ts` ("locks editing during delivery and restores controls after …") covers a 503 and a network failure. Both keep the draft and restore the controls.
  - Drafts keep website answers across a refresh and a path switch. Old `idea` drafts open Web app, and a stale saved step is ignored.
  - Suggestion failures never block writing.
  - UNVERIFIED: a timeout and a malformed response.
- **N/A · Media.** No audio or video changes.
- **PASS · Errors, locally.** A missing path under `/software/start` returns HTTP 404. Live check follows in section 7.

## 5. Forms and sensitive flows

- **PASS · Server boundaries, by tests.**
  - The schema is discriminated by path, and every length is bounded (the link at 2,048 characters).
  - The link must be http or https, with no whitespace and no sign-in details.
  - The updates answer must be one of its listed choices.
  - The legacy `idea` path is still accepted.
  - Turnstile, origin and rate checks are unchanged.
  - Suggestions are never requested for the link or the "What you have" notes.
- **UNVERIFIED · Full failure matrix in a browser.** API and flow tests cover invalid input, link errors, 503, network failure, retry and duplicate prevention. A 429, a timeout and the pending state were not exercised in a browser on the website path.
- **PASS · Without JavaScript, locally.** The page shows the first screen with "Please enable JavaScript to use this form, or email kazon.wilson@thesuperhuman.us."
- **UNVERIFIED · Delivery and receipt.** `tests/api/software-inquiry.test.ts` ("stores a website brief under its own path and questions, and names it in the owner notice") stores the request and builds an owner notice whose subject names Website design, with Resend mocked. No real website brief has been sent. Sending one in production creates a real owner request and notification email, so it is left to the owner.
- **PASS · Approval-gated flow.** Briefs still land as owner requests, and only the owner sends offers, agreements and invoices. See the agreements gap above for website offers.
- **PASS · Inline confirmation.** The existing inline receipt, with the website line.

## 6. Privacy, legal and measurement

- **PASS · Data inventory, by source.**
  - A website brief adds a purpose, an optional current-site link, notes on what the visitor already has, and who keeps the site up to date. These sit in the existing request details in `MUSIC_DB`.
  - The link and notes are never sent for suggestions.
  - No new cookies, storage, processors or scripts.
- **PASS · Privacy notice.** `/privacy` ("Updated October 19, 2026") covers website briefs and the optional link, and says which boxes send text for suggestions. It is linked from the footer.
- **N/A · Consent.** No new cookies or optional processing.
- **N/A · Commerce disclosures.** No commerce, address or terms changes. The agreements are the owner-noted gap above.
- **N/A · Analytics.** No analytics changes.
- **UNVERIFIED · Monitoring.** The owner notice for a website brief names the path (test above). Real delivery to the owner's inbox is not verified (see section 5).

## 7. Release and final QA

- **PASS · Required checks.** Check, test and build pass at `5683ec6`, as recorded above. Check, test and copy check pass at the copy commit, as recorded under Evidence.
- **PASS · Diff and review.**
  - The diff is 39 files: 38 feature files and this record, plus the merge of `main`.
  - No dependencies, generated files, secrets or private data. The only image change is the reviewed door picture.
  - Every review finding was verified, and the real ones were fixed.
- **PASS · Production configuration, by source.**
  - `wrangler.jsonc`, bindings, secrets, migrations, `public/_headers`, `astro.config.mjs`, `package.json` and the lockfile are unchanged by #188.
  - Production served HTTPS with `strict-transport-security` before the merge.
  - Response headers on HTML pages: see the security headers item below (fixed by #199).
- **PASS, with gaps · Security headers on HTML responses (fixed by #199).**
  - Checklist item 7.3: response headers on dynamic as well as static responses.
  - `public/_headers` sets `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options` and `X-Frame-Options` for `/*`.
  - Before the fix (FAIL):
    - HTML pages returned none of those four headers and only `strict-transport-security`: `/` at 17:43 UTC (while the Workers Builds check run for `f778ae42` was still in progress; which revision answered is not known) and `/`, `/services` and `/software/start` again after the Workers Builds run for `30ff3214` passed at 18:26 UTC (the serving revision was not observed; every commit on `main` since `f778ae42` contains #188).
    - The static files `/robots.txt` and `/favicon.ico` returned all four.
  - #188 changed no headers, so this was not caused by this PR.
  - Fix: [#199](https://github.com/kwilson21/thesuperhuman.us/pull/199), squash-merged as `c05ec3ae` on October 21, 2026 at 01:24:14 UTC, after CI passed on its head `08e9b22d` (Workers Builds, validate, capture). Codex's code and security reviews of `a3d3b9f6` found nothing. Codex did not re-review `08e9b22d`; independent Claude reviewers reviewed it (round 5, no findings). Greptile did not review #199.
  - Owner decisions, given in conversation on October 20, 2026 (America/New_York) and relayed: "Merge when clean"; "Remove it in #199" (drop `interest-cohort=()` from `Permissions-Policy` in both `public/_headers` and `src/lib/security-headers.ts`). Done in `08e9b22d`.
  - What it does: `src/middleware.ts` now adds the four `/*` headers from `public/_headers` (listed in `src/lib/security-headers.ts`) to every response that passes through the middleware, keeping any value a route or the studio/agreement rules already set.
  - What it does not cover: Astro's redirect for repeated trailing slashes and its bare 500 after a thrown error skip the middleware and carry none of the four. At 01:44:32 UTC, GET `/work//` and `/services//` each returned 301 with only `strict-transport-security` and none of the four headers. A reviewer's HEAD request to `/work//` at about 01:43 UTC returned 308, also with only `strict-transport-security`. The bare 500 was not requested.
  - Deploy: the Workers Builds check run for `c05ec3ae` concluded with success at 01:25:37 UTC, and `c05ec3ae` was the newest commit on `main` during the checks below. A background `curl` loop first saw `x-frame-options` on `/` at 01:25:42 UTC. The site shows no revision marker, so the serving revision was not observed directly. The new headers (with `interest-cohort` removed) prove that a deploy containing #199 was serving.
  - Post-deploy header check (read-only, against `https://thesuperhuman.us`, from 01:26:28 to 01:26:33 UTC, with HEAD (`curl -sI`) and GET (`curl -s -o /dev/null -D -`)):
    - Paths and status, identical for HEAD and GET: `/` 200 text/html; `/services` 200 text/html; `/software/start` 200 text/html; `/privacy` 200 text/html; `/api/work-feed?project=personal-website` 200 application/json; `/robots.txt` 200 text/plain (static file); `/this-page-does-not-exist-qa` 404 text/html.
    - All 14 responses carried these five header lines:
      - `permissions-policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()`
      - `referrer-policy: strict-origin-when-cross-origin`
      - `x-content-type-options: nosniff`
      - `x-frame-options: DENY`
      - `strict-transport-security: max-age=15552000`
    - `strict-transport-security` was also served before the fix.
    - 01:26:41 UTC, GET `/offer/qa-nonexistent-token` (an unavailable offer link): 404 with `referrer-policy: no-referrer` (the offer rule's own value, kept), `cache-control: private, no-store`, `x-robots-tag: noindex, nofollow`, and the other three of the four `/*` headers (`permissions-policy`, `x-content-type-options`, `x-frame-options`).
    - Baseline before #199 merged (taken before the PR opened): GET `/api/work-feed?project=personal-website` returned 200 `application/json` with none of the four headers.
    - Raw output is kept privately and not committed.
  - Music page console check (the Claude desktop app's built-in browser, Chromium 152, about 01:27 to 01:30 UTC):
    - The lyric video on `/music/old-news` is self-hosted (`/music/file/old-news-recording/video`, a native video element). The page has no YouTube embed, so the concern raised in #199 (a YouTube embed asking for `accelerometer` and `gyroscope`, which the policy denies) does not apply to the current release.
    - "Watch lyric video" was pressed once, and was paused a few seconds later. Pressing play likely recorded one listening "start" event for Old News in the site's music analytics at about 01:27 UTC.
    - The console showed no Permissions-Policy messages, before or after playback.
- **UNVERIFIED · Turnstile after the headers fix.**
  - `/`: observed with "Send a message" opened (the form sits in a collapsed disclosure): the widget rendered at 0 px height, issued no token after about 12 seconds, and the console logged more than 100 `Uncaught TurnstileError: [Cloudflare Turnstile] Error: 600010.` messages.
  - `/music/old-news`: a compact widget with no hidden or collapsed parent also rendered at 0 px height, issued no token, and logged about 100 of the same error. Nothing was submitted on either page.
  - A/B test on a public third-party Turnstile test page (peet.ws), using that page's own live site keys, not this site's key and not Cloudflare's dummy test keys, in the built-in browser: in non-interactive mode, a token was issued both in an unrestricted frame and in a frame denying the same eight features as the site's Permissions-Policy (accelerometer, camera, geolocation, gyroscope, magnetometer, microphone, payment, usb). In managed mode, both frames showed the same "Verify you are human" checkbox (not clicked).
  - So the Permissions-Policy denial list did not change Turnstile's behavior there. `X-Content-Type-Options` and `X-Frame-Options` apply to this page's own response, not to a third-party iframe or script inside it, and the `Referrer-Policy` value is Chrome's default (`strict-origin-when-cross-origin`), so it changes nothing Turnstile receives.
  - Not established: whether Turnstile works for real visitors on this site now, and whether it also failed in this browser before #199 (not tested then). A visible widget that stays at 0 px and errors is what an invisible-mode site key would show if it rejected an automated, embedded browser, but the widget mode was not checked.
  - Owner check: in the Cloudflare dashboard, check this site key's widget mode and its Turnstile analytics for a change around 01:25 UTC on October 21. In your own browser, open "Send a message" on `/` without sending: a visible widget should show a success check mark; if no widget shows, open the developer console and confirm no `TurnstileError` appears.
- **PASS, with gaps · Rollback.** Revision `b429889`, in production until `f778ae42` deployed, with the stored-brief caveat in the header. Whether a website or web app brief has been stored since the deploy was not checked (the owner center and D1 were not inspected), so check before any rollback. If such a brief exists, roll forward with a fix or read the request from D1. A rollback to `b429889` would also undo later commits on `main`, so check what has merged since.
- **PASS, with gaps · Post-deployment QA.** These were read-only checks run against production on October 20, 2026, after the deploy, except one header request at 17:43 UTC, while the Workers Builds run for `f778ae42` was still in progress (see the security headers item above). No brief was sent, no one signed in and the owner center was not opened.
  - Method: status codes, headers, redirects, page metadata, `robots.txt`, the sitemaps, and the status and type of the pictures came from `curl`, without following the owner redirects.
  - Method: the brief walk-through used the Claude desktop app's built-in browser (Chromium-based) at emulated 390 and 1280 px widths.
  - Method: text, links and alt text on `/`, `/services`, `/privacy` and the 404 page were read from the served HTML.
  - **UNVERIFIED · Production revision.**
    - Checklist item 7.5: verify the actual production revision.
    - The exact revision was not observed: no revision marker was found in the response headers or meta tags.
    - When the content checks started, `f778ae42` was the newest commit on `main`.
    - The two check runs present at that time, Workers Builds (the deploy) and `validate`, had passed by 17:44:32 UTC. The content checks ran after that.
    - The next commit on `main` landed at 18:22 UTC, after the other checks had finished (the picture check and the header re-check came later).
    - Two pieces of content that first appeared in #188 were served: the `/services` Website design line "I design and build your website, from the page plan to a site that works on phones and computers." and the `/software/start` title "Start a project · Kazon Wilson" (before #188 the title was "Start a software project · Kazon Wilson").
    - That shows a deploy containing #188's public changes was live. It does not show which revision.
  - **PASS, with gaps · Project brief on the website path.**
    - First screen at 390 × 844 px: `/software/start` opened on "What are you working on?", with the three paths (Website design, Web app, Workflow automation).
    - `?path=website` at 390 px: opened on question 2 of 8, "What's the website for?", with Website design preselected and the label "Website brief" above the heading.
    - Suggestions were turned off with "Turn off" before anything was typed.
    - No request to `/api/` appeared in the browser's network log in the 390 px and 1280 px passes (the log did show the pages' own script and font requests).
    - After each pass, the saved draft and suggestions setting (`software-brief-draft`, `software-suggestions`) were cleared from the browser.
    - Answers: a QA placeholder answer was typed for "What's the website for?", "What do you have today?" was skipped, and the budget was skipped.
    - Choices: "Not sure yet" was chosen for "Who will keep it up to date?" (the screen showed the note "Updates after launch are quoted separately, at a fixed price."), and "Flexible" (the default) was the timing selected.
    - Contact details: a placeholder name and email were typed.
    - Review screen: "Ready to send?" listed the answers with Edit buttons, plus Back and "Send brief". "Send brief" was never pressed.
    - Overflow: `scrollWidth` equaled the viewport width on the first and review screens at 390 px, and on every screen at 1280 px except "What do you have today?", which was not measured.
    - 1280 × 800 pass: the 390 px pass had cleared the saved suggestions setting, so "Turn off" was clicked again before anything was typed ("Suggestions are off." showed). The same walk-through reached every question screen in order through to "Ready to send?".
    - At 1280 px, the "Edit" button for Project on the review screen (accessible name "Edit Project") opened "What are you working on?", which showed Website design selected.
  - **PASS, with gaps · Services rows and Home doors.**
    - `/services` had three doors (Mixing & mastering, Website design, Software engineering) and three rows (website, web app and workflow).
    - Website design row picture: alt text "This site’s Home page, with the introduction and the Start a project button".
    - Pictures: four returned 200 as `image/webp`: the website door picture (`/_astro/work-with-me-website.dVyRwGan.webp`, 40,058 bytes, also used by the Website design row), the mixing door picture, the software door picture and the Tally row picture. The website picture's size matches section 4. They were fetched, not viewed, after `30ff3214` landed on `main` at 18:22 UTC (later than the other checks). That commit does not touch these pictures.
    - Website design row: the line "I design and build your website, from the page plan to a site that works on phones and computers."
    - The row's work block (heading "This site", text "September 2026 redesign") had an "Explore the project" link to `/building/personal-website`. "Tell me about your website" linked to `/software/start?path=website`.
    - Web app row demo links: Tally ("Try the demo", `https://tally-demo.thesuperhuman.us`) and Kaillera Next ("Play the demo", `https://kaillera-next.thesuperhuman.us`), both opening in a new tab. "Tell me about your app" linked to `/software/start?path=webapp`.
    - Workflow automation row: "Skupos · Internal tools" with a "Read the work story" link to `/work#skupos`, and "Tell me about your workflow" linked to `/software/start?path=workflow`.
    - The `/services` phone menu linked to `/services#website`.
    - Home doors: Mixing & mastering ("Start your song", `/audio/start`), Website design ("Plan your website", `/software/start?path=website`) and Software engineering ("Discuss your project", `/software/start`).
    - Home's hero button read "Start a project" and linked to `/software/start`.
  - **PASS, with gaps · Search and sharing.**
    - Status: `/`, `/software/start` and its `path` variants (`website`, `webapp`, `workflow`, `idea`), `/services` and `/privacy` returned 200.
    - `/software/start` and `/software/start?path=website`: title "Start a project · Kazon Wilson", description "Share a short project brief for Kazon Wilson to review.", and canonical `https://thesuperhuman.us/software/start`.
    - `/services`: title "Work with me · Kazon Wilson", description "Three ways to work with Kazon Wilson: mixing and mastering, website design, and software engineering. Fixed-price projects, agreed in writing before work begins.", and canonical `https://thesuperhuman.us/services`.
    - `/privacy`: title "Privacy · Kazon Wilson", description "How this website handles contact messages, audio and software inquiries, resume requests, and information used to keep the site working.", and canonical `https://thesuperhuman.us/privacy`.
    - Home (`/`): title "Kazon Wilson · Software, sound, and things worth exploring" and description "I build software, design websites, and mix and master music. Explore my projects, engineering work and writing." Its canonical was `https://thesuperhuman.us/`.
    - On all five URLs, `og:url`, `og:title` and `og:description` matched the canonical, title and description.
    - `/software/start?path=nope` returned 200 and showed the first screen with all three paths at 390 px in the browser, which matches the record's note that `path` only preselects a choice.
    - Gap: the OG card image and the icons were not requested.
  - **PASS · Privacy page.** `/privacy` showed "Updated October 19, 2026". The project briefs paragraph covered website briefs and the optional link to the current website. The next paragraph said the link and notes boxes are never sent for suggestions, and named Cloudflare's Workers AI.
  - **PASS · Demo links.** `https://tally-demo.thesuperhuman.us` and `https://kaillera-next.thesuperhuman.us` each returned 200 with no redirect.
  - **PASS · Owner routes.** `/owner`, `/owner/agreements`, `/owner/requests`, `/owner/software` and `/owner/anything` each returned 302 to the Cloudflare Access login.
  - **PASS · Sitemap and robots.**
    - `robots.txt` returned `User-agent: *`, `Allow: /` and `Sitemap: https://thesuperhuman.us/sitemap-index.xml`.
    - `/sitemap-index.xml` listed `/sitemap-0.xml`, which had 26 URLs.
    - Those 26 URLs included `/software/start`, `/services` and `/privacy`, and no `/owner`, `/api` or `/offer` URLs.
    - `/sitemap.xml` returned 404, and `robots.txt` pointed to `/sitemap-index.xml` instead.
  - **PASS · Missing page.** `/this-page-does-not-exist-qa` and `/software/start/nope` both returned 404 with the "Page not found" page (title "Page not found · Kazon Wilson", heading "This page isn’t here.").
  - **UNVERIFIED · Still not covered.**
    - A real device and a second browser (Safari or Firefox).
    - Sending a brief and real email delivery.
    - The owner center and the offer editor's two changed examples (owner only, behind Access).
    - `npm run owner:health -- --remote --post-deploy`.
    - `audio.thesuperhuman.us`: not checked. The changed pages do not render there, and the APIs are shared.
    - The live suggestion API: not called, because suggestions were turned off.
    - The OG card image and the icons: not requested (unchanged by this PR).
    - The Web app, Workflow automation and legacy idea paths: fetched only (200), not walked in a browser.
    - Typing into "What do you have today?" (the current-site link check) and the budget screen: both were skipped.
    - Other widths (320 px and tablet) on any page.
    - The overflow measurement on the other question screens at 390 px.
    - The overflow measurement on "What do you have today?" at 1280 px.
    - `/`, `/services`, `/privacy` and the 404 page rendered in a browser on production: not viewed.
- **UNVERIFIED · Review of the final commit's owner-brief captures before merge.** The record as merged (`f778ae42`) listed this review as a step before merge. Nothing in the record shows it was done, and none of the `10400d7` captures were viewed for this record. Judging by the source and the scenario captions, only the acceptance one of the offer editor's two changed examples is expected to appear in the `owner-brief` captures, and the later-milestone handoff example is expected in none. Owner decision: look at them now, or accept the gap as an exception with its impact and follow-up.
- **PASS, with gaps · Receipt.** Implemented: yes. Verified locally: yes. Deployed: yes, per the passing Workers Builds check run for `f778ae42` (17:44 UTC); the live site does not show its revision. Verified live: partly. The checks above passed, except the production revision (UNVERIFIED) and Turnstile after the headers fix (UNVERIFIED, see section 7). Security headers on HTML responses failed on October 20, 2026 UTC; #199 fixed them, and the fix was verified live on October 21, 2026 UTC, except Astro's repeated-trailing-slash redirect and bare 500, which carry none of the four headers (see section 7). The items under Still not covered did not run. Owner steps and the agreements gap remain (see Remaining work).

## 8. Private owner center

- **N/A · Access, headers and schema.** Owner routes, Access, response headers and the schema are unchanged by #188 (#199 later added the four `/*` headers to owner responses; not checked live).
- **PASS · Persistence before success, by tests.**
  - `tests/api/software-inquiry.test.ts` covers this: "preserves input and clears success limit after a storage failure" returns 503 without success, and the website brief test stores the request under `website` before success.
  - Real storage failure is not exercised.
- **PASS · Owner pages for website briefs, in CI.**
  - The seeded fictional website brief shows its current site as a link (`rel="noopener noreferrer"`, with the normalized address).
  - It also shows the website fit-review reminder, the website offer prompts and the website "Ask a question" example.
  - By tests, web app, workflow and earlier idea requests render as before.
- **UNVERIFIED · Target health.** No remote `owner:health` run. This PR changes no schema or binding that health checks. Per the checklist (item 8.15, and the rule that unknowns are resolved or accepted before claiming launch-ready), this stays an open launch-blocking UNVERIFIED item until the post-deploy run is recorded.
- **N/A · Traffic, playback, retention, studio, payments, Stripe, webhooks and recovery.** None of these are touched.

## Software agreement signing

- **PASS · Template coverage for website design.** See above. The updated MSA and SOW templates the owner approved for website design were published in `/owner/agreements` on October 20, 2026 (both version 1, label `v2026-10-20`), observed as described under Status. Website signing is off and no contractor details are saved; saving them, meeting the signing release gates and turning on signing are owner steps (see Remaining work).
- **N/A · The other signing checks.** These cover counsel review, contractor config, seeded template previews, the signing setting, email authentication, PDF rendering, certificates, failures, downloads, restore, retention and screenshots. The signing flow, templates and PDFs are unchanged by this PR.

## Known unknowns

These shipped unmeasured and stay UNVERIFIED unless the owner records an exception with its impact and follow-up in this record:

- a second browser and a real device
- lab and field performance
- a timeout, a malformed response and a 429 in a browser
- real email delivery of a website brief and its owner notice
- a remote `owner:health` run
- the exact revisions production served during these checks (the site shows no revision marker)
- the owner center, live, including the offer editor's two changed examples (owner only)
- the Web app, Workflow automation and legacy idea paths, walked in a browser (live)
- `audio.thesuperhuman.us` (not checked live)
- the live suggestion API (not called)
- the final commit's owner-brief captures (not viewed)
- Turnstile for real visitors after #199 (it issued no token in the built-in browser)
- the redirect for repeated trailing slashes and Astro's bare 500 after a thrown error, which carry none of the four security headers (the redirect was observed live; the 500 was not requested)
- the other gaps listed under Still not covered in section 7

The owner can cover the device check and email delivery now that the site is deployed, by opening the brief on a phone and sending one test brief.

## Remaining work

- Owner: look at the final commit's captures under `pr-188/10400d7/` on the `screenshots` branch, including `website-brief-owner-brief-desktop.png` (1280 px) and `website-brief-owner-brief-phone.png` (390 px), or accept the gap as an exception with its impact and follow-up in this record (see the UNVERIFIED item in section 7).
- Owner: run `npm run owner:health -- --remote --post-deploy`. Until it is recorded, target health stays a launch-blocking UNVERIFIED item (checklist item 8.15), unless the owner accepts it as an exception with its impact and follow-up in this record.
- Owner: in the Cloudflare dashboard, check this site key's widget mode and its Turnstile analytics for a change around 01:25 UTC on October 21. In your own browser, open "Send a message" on `/` without sending: a visible widget should show a success check mark; if no widget shows, open the developer console and confirm no `TurnstileError` appears (see the UNVERIFIED Turnstile item in section 7).
- Owner: accept, as an exception with its impact and follow-up in this record, that Astro's repeated-trailing-slash redirect and its bare 500 carry none of the four headers, or ask for a fix (see the security headers item in section 7).
- Owner: confirm which revisions production served during these checks (see the UNVERIFIED item in section 7, checklist item 7.5), for example from Cloudflare's deployment history, or accept the gap as an exception with its impact and follow-up in this record.
- Owner: save contractor details.
- Owner: before turning on website signing, meet the gates in the signing release record (`docs/prelaunch-qa-2026-09-30-software-signing.md`), including counsel review of the final templates and electronic consent, and owner verification of the registered-agent address and the saved contractor configuration.
- Owner: turn on website signing after those gates are met, and before a website offer is sent for signing.
- Owner: open the offer editor and check the two changed website examples (owner only, behind Access).
- Owner: check the brief on a phone and send one test brief (see Known unknowns).
