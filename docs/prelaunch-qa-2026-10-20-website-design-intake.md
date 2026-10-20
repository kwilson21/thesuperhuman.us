# Project brief paths release gate

Date: October 20, 2026 (UTC; the evening of October 19 in America/New_York)  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#188](https://github.com/kwilson21/thesuperhuman.us/pull/188)  
Branch: `claude/website-design-intake-dd111d`  
Verified revision: `09fe9c7`, which merges `main` at `b429889` into the reviewed head `cb872a0` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us`: `/software/start` (with `?path=website`, `webapp`, `workflow` and the legacy `idea`), `/services`, Home, `/privacy`, `POST /api/software-inquiry`, `POST /api/software/brief/suggest`, the owner request pages and client emails for software briefs. On `audio.thesuperhuman.us`, page paths are rewritten under `/audio` (`src/lib/host-routing.ts`), so the changed pages do not render there; the APIs are shared.  
Reviewer: Claude Code agent, collecting evidence for owner Kazon Wilson. Code was written by Claude subagents and reviewed by independent Claude reviewers and Codex; this record is evidence collection, not owner certification.  
Scope: the project brief with three named paths (Website design, Web app, Workflow automation), the website brief's three questions, owner center support for website briefs, the `/services` rows, the website door and Home button, the recaptured website door picture, and the privacy notice. Every path stays request kind `software` and uses the existing offer, agreement and invoice pipeline.  
Rollback revision: `b429889` (`origin/main` before this merge). No migration, binding, secret, dependency or header change, so a code rollback restores the previous behavior. Stored requests are not migrated; earlier `idea` requests keep their label and questions.

## Owner decisions and authorization

Owner, in conversation, October 19, 2026 (America/New_York):

- Approved the design study (`docs/design-concepts/2026-10-19/website-intake/`), and asked for it to be built, reviewed, shown from CI screenshots, and merged only after the owner approved the look, following this gate.
- On the open choices: "2. Sounds good" (website clients still see "Software · Website design" on the offer page), "3. Sure why not add a play link?", "4. yes, use that" (the website "Ask a question" example), "5. Let's fix this" (Home's button), and "1. a, recapture it." (the website door picture).

Owner, in conversation, October 20, 2026 (UTC):

- On the recaptured door picture, its row alternative text, and a note under Kaillera Next: "1. Yes 2. Okay 3. Keep as is".
- "“I organize what you want to say” is odd wording for website design", then chose "Design and build": "I design and build your website, from the page plan to a site that works on phones and computers."
- Look approval and agreements: "I approve, the msa and sow does not cover website design so we may want to update everything after all of these changes".

**Owner-stated exception: agreements.** The private MSA and SOW templates do not cover website design. Impact: after this release a website brief can reach the owner center, and nothing in the code stops an offer from being sent on it. Follow-up: the owner updates the agreement templates (or publishes new template versions) to cover website design before the first website offer is sent. Until then, a website brief can be answered with a question or a decline, not an offer.

## Evidence and limits

- **Checks:** at `09fe9c7`, run locally:
  - `npm run check`: 0 errors, 0 warnings. The 17 hints are in files this PR does not change.
  - `npm test`: 130 files, 1,532 passed, 1 skipped.
  - `npm run build`: passed, including the asset, copy and publicist gates.
- **CI at `cb872a0`:** Validate, Screenshots capture and Workers Builds all passed. CI on the record commit must also pass before merge.
- **Reviews:**
  - Independent Claude reviewers (correctness and security; UI, copy and the CLAUDE.md/AGENTS.md rules) reviewed each round and each owner follow-up. The last passes at `cb872a0` found no blocking or should-fix issues, and their wording nits are folded into this commit.
  - Codex code review and Codex security review of `cb872a0` found no issues.
  - Greptile did not review this PR.
- **Screenshots:**
  - CI captures at `pr-188/cb872a0` on the `screenshots` branch (181 images in the PR description): every page at 1280 × 800 and 390 × 844, the `website-brief` scenario (each website screen, the receipt, the owner's view of a seeded fictional website brief, the request list) and the `software-brief` scenario on the Web app path.
  - Viewed by the agent: Home's Work with me strip, the `/services` rows and the owner's website brief.
  - Delivery in the scenarios is mocked, so it is not evidence of real email.
- **Local preview** (`astro dev` with the screenshot preview config, Chromium):
  - Widths: 320, 640 and 768 px on `/`, `/services` and every website brief screen.
  - Keyboard path through the first screen.
  - No-JavaScript view of `/software/start?path=website`.
  - Titles, descriptions and canonicals; a missing path under `/software/start`.
- **Preview access:** the branch preview URL returns 302 to Cloudflare Access.

PASS means observed evidence named here. Production checks after the merge are listed under section 7.

## 1. Purpose and content

- **PASS · Scope and authorization.** Repository, branch, revision, scope and the owner's approval are recorded above. The deployment authorization is conditional on green CI and this gate.
- **PASS · Approved design and claims.**
  - The build follows the approved study, plus the owner's follow-ups quoted above.
  - Fixed price only, with no rates. "Updates after launch are quoted separately, at a fixed price."
  - There are no clearance, exclusivity or hourly claims and no em dashes (`copy:check` passes).
  - The door picture is a crop of this PR's own Home, recorded in `docs/asset-reviews/work-with-me-doors.md`.
  - The Tally picture is demo data with its banner. The Kaillera Next play link goes to the public demo already linked from the project page.
- **PASS · Explain who does what.**
  - The path lines and the website line say who acts ("I design and build your website…").
  - The receipt says what happens next ("I'll look at what you have and reply with a fixed-price first milestone, or a question or two.").
  - No professional claims or resume facts change.
- **PASS · First screen and CTA, locally and in CI.**
  - The brief's first screen names the three paths, each with one line, and a footnote for visitors who are unsure.
  - Home's "Start a project" opens it.
  - The website doors open it on the website path.
  - Checked at 320, 390, 640, 768 and 1280 px.
- **PASS · Navigation and links, by tests and source.**
  - "Back to Work with me" goes to `/services#software`.
  - The phone menu links `/services#website`.
  - "Service →" on owner pages opens the request's own `/services` row.
  - The external links are the Tally and Kaillera Next public demos.
  - No address is shown beyond the existing registered-agent footer.
  - Live link checks follow in section 7.

## 2. Search and sharing

- **PASS · Titles and descriptions.**
  - `/software/start`: "Start a project · Kazon Wilson", with "Share a short project brief for Kazon Wilson to review."
  - `/services` and Home: unchanged and distinct.
- **PASS · Canonicals.** `/software/start?path=website` and `/software/start` both declare `https://thesuperhuman.us/software/start`, which matches the sitemap entry. The `path` parameter only preselects a choice and is not indexable content.
- **N/A · Open Graph.** No sharing metadata or Open Graph image changes.
- **N/A · Icons.** No icon changes.
- **PASS · Robots and sitemap, built.** The built sitemap includes `/software/start`, `/services` and `/privacy`. No route is added and owner routes stay excluded. Live check follows in section 7.
- **PASS · Preview indexing.** The branch preview URL redirects to Cloudflare Access (302) before any page renders.
- **N/A · Structured data.** No structured data changes.

## 3. Accessibility and responsive behavior

- **PASS · Structure.**
  - The page language is `en` and the landmarks are unchanged.
  - The brief keeps one visible `h1` per screen. Other screens' headings are in `hidden` sections, as before this PR.
  - Focus moves to the new screen's heading on Next.
- **PASS · Image alternatives.**
  - The `/services` Website design row: "This site’s Home page, with the introduction and the Start a project button" (owner-approved).
  - The doors keep empty alternative text beside their captions.
  - Tally keeps its alternative text.
- **PASS · Keyboard, locally and by tests.**
  - Tab reaches the path radios.
  - Arrow keys move through all three without leaving the screen.
  - Tab reaches Next, which shows a 2 px solid focus outline, and Enter moves to the first question.
  - A pointer choice still moves on automatically (pointer only, WCAG 2.1.1 and 3.2.2).
  - The current-site link on owner pages says it opens in a new tab, to screen readers too.
- **PASS · Labels and errors, by tests.**
  - The website answers have labels and optional markers.
  - The link check gives a specific message ("Add https:// to the start of the link.", "Use https:// or http:// at the start of the link.", "Check the link, or leave it empty.").
  - Error ids are linked through `aria-describedby` after a path change.
  - The updates choice uses "Choose one."
- **UNVERIFIED · Contrast, zoom and motion.**
  - No new colors, fonts, radii or shadows: only existing tokens.
  - Reduced motion was used for all captures.
  - A 640 px layout check stands in for 200% zoom at 1280 px; no browser zoom test was run.
  - No automated accessibility tool is installed, so there is no automated contrast audit.
- **PASS · Widths.**
  - No horizontal overflow (`scrollWidth` equals the viewport) at 320, 640 and 768 px on `/`, `/services` and each website brief screen through review.
  - CI captures at 390 and 1280 px.
  - The only boxes outside the viewport are the off-screen skip link and the closed menu panel.
- **UNVERIFIED · Browsers and devices.** Only Chromium is installed here, and no real-device check was run.

## 4. Performance and resilience

- **PASS · Images.** The door picture is a 900 × 600 WebP of 40,058 bytes, the same size class as before, with intrinsic dimensions and lazy loading. No hero image changes.
- **PASS · Client code.** No dependency added. The brief script grows by its path plans and the link messages. The site-link pattern runs in linear time, and values over 2,048 characters skip the link checks.
- **UNVERIFIED · Performance measures.** No lab or field measurement for this change.
- **PASS · Async recovery, by tests.**
  - Drafts keep website answers across a refresh and a path switch.
  - Old `idea` drafts open Web app.
  - A stale saved step is ignored.
  - Suggestion failures never block writing.
  - The "sending" screenshot no longer reaches the server.
- **N/A · Media.** No audio or video changes.
- **PASS · Errors, locally.** A missing path under `/software/start` returns HTTP 404. Live check follows in section 7.

## 5. Forms and sensitive flows

- **PASS · Server boundaries, by tests.**
  - A discriminated schema per path.
  - Bounded lengths, including a 2,048 character limit on the link.
  - The link is accepted only as http or https, with no whitespace or sign-in details.
  - The enum for the updates question.
  - The legacy `idea` is still accepted.
  - Turnstile, origin and rate checks are unchanged.
  - Suggestions are never requested for the link or the "What you have" notes.
- **UNVERIFIED · Full failure matrix in a browser.** API and flow tests cover invalid input, link errors, retry and duplicate prevention. Network failure, 429 and 500 were not exercised in a browser for the website path.
- **PASS · Without JavaScript, locally.** The page shows the first screen with "Please enable JavaScript to use this form, or email kazon.wilson@thesuperhuman.us."
- **UNVERIFIED · Delivery and receipt.** No real website brief has been sent. Sending one in production creates a real owner request and notification email, so it is left to the owner.
- **PASS · Approval-gated flow.** Briefs still land as owner requests. Offers, agreements and invoices are sent only by the owner. See the owner-stated exception above for website offers.
- **PASS · Inline confirmation.** The existing inline receipt, with the website line.

## 6. Privacy, legal and measurement

- **PASS · Data inventory, by source.** A website brief adds three fields: purpose, an optional current-site link with notes on what the visitor already has, and who will keep the site up to date. They are stored in the existing request details in `MUSIC_DB`. The link and notes are never sent for suggestions. No new cookies, storage, processors or scripts.
- **PASS · Privacy notice.** `/privacy` (updated October 19, 2026) covers website briefs and the optional link, and says which boxes send text for suggestions. It is linked from the footer.
- **N/A · Consent.** No new cookies or optional processing.
- **N/A · Commerce disclosures.** No commerce, address or terms changes. The agreements are the owner-stated exception above.
- **N/A · Analytics.** No analytics changes.
- **N/A · Monitoring.** Existing request notices and owner health are unchanged.

## 7. Release and final QA

- **PASS · Required checks.** Check, test and build pass at `09fe9c7`, as recorded above. Green CI on this commit is required before merge.
- **PASS · Diff and review.**
  - 38 feature files plus the merge of `main`.
  - No dependencies, generated files, secrets or private data.
  - The only image change is the reviewed door picture.
  - Every review finding was verified, and the real ones were fixed.
- **PASS · Production configuration, by source.** No change to `wrangler.jsonc`, bindings, secrets, migrations, `public/_headers` or `astro.config.mjs`. Production served HTTPS with `strict-transport-security` before the merge.
- **PASS · Rollback.** The rollback revision is `b429889`. No data or schema change.
- **UNVERIFIED · Post-deployment QA.** After the merge, the following will be added below:
  - the production revision
  - `/software/start?path=website` through the review screen, without sending
  - `/services` and Home doors
  - the sitemap and robots
  - a missing page
- **PASS · Receipt.** This record keeps implemented, verified locally, deployed and verified live separate.

## 8. Private owner center

- **N/A · Access, headers and schema.** Owner routes, Access, response headers and the schema are unchanged.
- **PASS · Owner pages for website briefs, in CI.** The seeded fictional website brief shows its current site as a link (`rel="noopener noreferrer"`, the normalized address), the website fit-review reminder, the website offer prompts and the website "Ask a question" example. Web app, workflow and earlier idea requests render as before (tests).
- **N/A · Payments, Stripe, retention, studio and recovery items.** Not touched.

## Software agreement signing

- **FAIL, owner-stated exception · Template coverage.** The owner says the MSA and SOW do not cover website design. No website offer until the templates are updated (see above). The signing flow itself is unchanged.

## Remaining work

- Green CI on the record commit, then merge (deploys production), then the live checks in section 7.
- Owner: update the MSA and SOW templates for website design before the first website offer.
- Owner, optional: send one real website brief to confirm delivery.
