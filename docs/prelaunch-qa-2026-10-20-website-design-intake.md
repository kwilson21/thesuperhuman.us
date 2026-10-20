# Project brief paths release gate

Date: October 20, 2026 (UTC; the evening of October 19 in America/New_York)  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#188](https://github.com/kwilson21/thesuperhuman.us/pull/188)  
Branch: `claude/website-design-intake-dd111d`  
Verified revision: `5683ec6`, the reviewed head `cb872a0` with `main` at `b429889` merged in (`09fe9c7`) and the first draft of this record. This revision of the record is committed on top of it.  
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
Rollback revision: `b429889`, the current `main`. Its Workers Builds deploy succeeded on October 20, 2026 at 00:00 UTC, so it is the revision in production now. This PR changes no migration, binding, secret, dependency or header. Caveat: once a website or web app brief has been stored, code at `b429889` would show it in the owner center as a workflow brief without its answers. The rows stay intact in `MUSIC_DB`. After such a brief exists, roll forward with a fix rather than back, or read the request from D1.

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

**Owner-noted gap: agreements.**
- The owner says the private MSA and SOW templates do not cover website design. The owner plans to update them after these changes.
- Impact: after this release, a website brief can reach the owner center, and nothing in the code stops an offer from being sent on it.
- Proposed until the update (owner to confirm): answer website briefs with a question or a decline, and send the first website offer only under templates that cover website design.

## Evidence and limits

- **Checks:** run locally at `5683ec6`:
  - `npm run check`: 0 errors, 0 warnings. The 17 hints are in files this PR does not change.
  - `npm test`: 130 files, 1,532 passed, 1 skipped.
  - `npm run build`: passed, with the asset and copy gates. Locally, the publicist gate skips its private note lookup because there is no token. CI's Workers Builds ran it and passed.
- **CI:** Validate, Screenshots capture and Workers Builds passed at `cb872a0`. Validate and Workers Builds passed at `5683ec6`. CI on this record's commit must pass before merge.
- **Reviews:**
  - Independent Claude reviewers checked each round and each owner follow-up: one for correctness and security, one for UI, copy and the CLAUDE.md/AGENTS.md rules.
  - At `cb872a0` the last passes found no blocking or should-fix issues.
  - Codex code review and Codex security review of `cb872a0` found no issues.
  - A final Claude pass reviewed the merge of `main` and the first draft of this record at `5683ec6`. The merge is clean: the net change equals `main`'s #189 diff, and no keys collide in `scripts/screenshots/config.mjs`. That pass found no blocking issues, and its corrections to this record are applied here.
  - Greptile did not review this PR.
- **Screenshots:**
  - CI captures at `pr-188/cb872a0` on the `screenshots` branch (181 images in the PR description).
  - What they cover: every page at 1280 × 800 and 390 × 844; the `website-brief` scenario (each website screen, the receipt, the owner's view of a seeded fictional website brief, and the request list); and the `software-brief` scenario on the Web app path.
  - Viewed by the agent: Home's Work with me strip, the `/services` rows and the owner's website brief.
  - Delivery in the scenarios is mocked, so it is not evidence of real email.
- **Local preview:** `astro dev` with the screenshot preview config, in Chromium, at `09fe9c7`. The changes since then touch no page code.
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
  - There are no clearance, exclusivity or hourly claims. The final pass found no em dashes in the PR's added lines; `copy:check` covers `src/`, `public/` and `README.md`.
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
  - The external links are the Tally and Kaillera Next public demos; both returned 200 during the final pass. Live link checks follow in section 7.

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

- **PASS · Required checks.** Check, test and build pass at `5683ec6`, as recorded above. Green CI on this record's commit is required before merge.
- **PASS · Diff and review.**
  - The diff is 39 files: 38 feature files and this record, plus the merge of `main`.
  - No dependencies, generated files, secrets or private data. The only image change is the reviewed door picture.
  - Every review finding was verified, and the real ones were fixed.
- **PASS · Production configuration, by source.**
  - `wrangler.jsonc`, bindings, secrets, migrations, `public/_headers`, `astro.config.mjs`, `package.json` and the lockfile are unchanged.
  - Production served HTTPS with `strict-transport-security` before the merge.
- **PASS · Rollback.** Revision `b429889`, deployed now, with the stored-brief caveat in the header.
- **UNVERIFIED · Post-deployment QA.** After the merge, these checks will be recorded below:
  - the production revision
  - `/software/start?path=website` through the review screen, without sending
  - the `/services` rows and the Home doors
  - `/privacy`
  - the two demo links
  - the owner routes redirecting to Cloudflare Access
  - the sitemap and robots
  - a missing page
- **PASS · Receipt.** Implemented: yes. Verified locally: yes. Deployed: no, pending merge. Verified live: no, pending deploy.

## 8. Private owner center

- **N/A · Access, headers and schema.** Owner routes, Access, response headers and the schema are unchanged.
- **PASS · Persistence before success, by tests.**
  - `tests/api/software-inquiry.test.ts` covers this: "preserves input and clears success limit after a storage failure" returns 503 without success, and the website brief test stores the request under `website` before success.
  - Real storage failure is not exercised.
- **PASS · Owner pages for website briefs, in CI.**
  - The seeded fictional website brief shows its current site as a link (`rel="noopener noreferrer"`, with the normalized address).
  - It also shows the website fit-review reminder, the website offer prompts and the website "Ask a question" example.
  - By tests, web app, workflow and earlier idea requests render as before.
- **UNVERIFIED · Target health.** No remote `owner:health` run. This PR changes no schema or binding that health checks.
- **N/A · Traffic, playback, retention, studio, payments, Stripe, webhooks and recovery.** None of these are touched.

## Software agreement signing

- **FAIL, owner-noted gap · Template coverage for website design.** See above. The owner plans to update the templates after these changes.
- **N/A · The other signing checks.** These cover counsel review, contractor config, seeded template previews, the signing setting, email authentication, PDF rendering, certificates, failures, downloads, restore, retention and screenshots. The signing flow, templates and PDFs are unchanged by this PR.

## Known unknowns

These ship unmeasured unless the owner decides otherwise:

- a second browser and a real device
- lab and field performance
- a timeout, a malformed response and a 429 in a browser
- real email delivery of a website brief and its owner notice
- a remote `owner:health` run

The owner can cover the device check and email delivery after the deploy, by opening the brief on a phone and sending one test brief.

## Remaining work

- Green CI on this record's commit, the owner's answer on the known unknowns and the agreements proposal, then merge (deploys production) and the live checks in section 7.
- Owner: update the MSA and SOW templates for website design.
