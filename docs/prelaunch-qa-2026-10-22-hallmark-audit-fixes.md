# Hallmark audit fixes release gate

Date: October 22, 2026 (UTC; this agent's checks ran from about 10:20 to 10:45 UTC, 6:20 to 6:45 AM in America/New_York)  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#204](https://github.com/kwilson21/thesuperhuman.us/pull/204), "Fix the defects found by the Hallmark design audit", squash-merged to `main` as `b4350907` at 15:39:06 UTC on October 22, 2026, pinned to head `f1c2989` (the merged tree equals that head's tree)  
Branch: `claude/hallmark-audit-fixes`  
Verified revision: `f0abd1f` for the browser checks below. Base at that time: `main` at `26e764a`. `main` then moved to `75a88be4` (PR #203, link-preview videos), which this branch merged after `4726df39`, and to `0ab273da` (PR #205, sitemap and canonical journal URLs), merged after the owner's approval. The only conflict was the `/work` evidence line: it keeps this PR's position and takes #205's slashless Tally link. On the code merged with `0ab273da` the coordinating session ran the full suite (138 files, 1707 passed, 1 skipped), `astro check` (0 errors, 0 warnings) and `npm run build` (asset QA 80 files, copy check and publicist gate pass). Later CI results for the merged head are in the PR.  
Target: production `https://thesuperhuman.us`, after merge. The stylesheets are shared, so the audio pages served on `audio.thesuperhuman.us` change too. Pages with visible changes include Home, `/work`, `/services`, `/about`, `/privacy`, `/building` and its project pages, `/writing` and its essay, `/audio`, `/audio/services`, `/audio/releases`, `/music/old-news`, `/software/start`, `/audio/start` and the 404 page. The private studio sign-in, offer signing, studio and owner pages change their field, focus and type styles.  
Reviewer: Claude Code agent, collecting evidence for owner Kazon Wilson. Claude subagents wrote the code; independent Claude reviewers and Codex reviewed it. This record is evidence collection, not owner certification.  
Scope: fixes for the defects a read-only Hallmark design audit of the public pages found (`ab4dae0`), plus review follow-ups (`d0d26dd`, `a3c2f56`, `b771231`, `f0abd1f`):
- Form field edges, the A/B player's unplayed waveform and tracks, and the studio sign-in code boxes reach 3:1 against their background (new `--field-border` token). Studio and agreement fields use the site's 2px focus outline instead of a border swap and halo.
- Invalid inputs in the shared `.site-form` forms show the accent edge. Before, only textareas did. Signing fields keep the field-border edge when invalid, as before; their errors still have text and a linked summary.
- `/audio/releases` no longer scrolls sideways at 701 to 1247px. The studio sign-in fits a 320px screen. Door buttons move under their picture at 370px and below instead of wrapping.
- The `/work` resume and hire links and the 404 "Back to home" link sit in the first screen.
- Running prose stops near 65 characters (`--measure-prose`). Headings balance and prose wraps `pretty` site-wide.
- Type and token cleanup: generic font families unquoted, one mono kicker face (`.eyebrow` moves from Inter to JetBrains Mono), tokens in place of stray hex values, `Inter` literals and easing curves, and a named spacing scale.
- 44px tap areas for the footer, 404 and review-illustration links and controls; hover feedback limited to mouse and trackpad; a crossed-speaker muted icon and a disabled seek style on the release player.
- Copy: a "Software project briefs and pages" heading on `/privacy`; curly apostrophes on `/privacy` and the resume receipt. The offer signing page keeps straight apostrophes: its consent text, which is recorded with each signature (`src/lib/software-agreements.ts:377`), is straight, and changing that wording is the owner's call.
- Removal of the unused `LyftWorkStory` component.

**What changes, checked against "CSS, markup and tests only".** `git diff --stat 26e764a f0abd1f` lists 60 files, 483 insertions and 355 deletions: 56 modified, 3 test files added and 1 component deleted. This agent read the whole diff, comparing the minified stylesheets rule by rule.
- True: no route, API, middleware, migration, binding, secret, dependency or header change. `git diff --name-only 26e764a f0abd1f` is empty for `package.json`, `package-lock.json`, `wrangler.jsonc`, `astro.config.mjs`, `public/` (including `_headers` and `robots.txt`), `migrations/`, `src/lib/`, `src/middleware.ts`, `src/pages/api/` and `.github/`. No page file is added or removed. The built `dist/_headers` is identical to `public/_headers` at `26e764a`.
- Not true that it is only CSS, markup and tests. It also changes:
  - `src/scripts/comparison-player.ts`, a client script (3 lines net): the A/B player's volume slider sets a `--fill` property on setup and on input, so its track fills in the accent like the seek track.
  - `src/pages/music/[slug].astro` frontmatter: computes the title's longest word and passes it as `--masthead-word`, so the masthead never sets a word wider than its column.
  - `src/components/WorkWithMe.astro`: a new `loading` prop (`/services` passes `eager`, and its first door picture gets `fetchpriority="high"`). Door captions now render the name through `personalNameSegments` and `PersonalName style="inherit"` instead of `PersonalNameText`, so the name takes the caption's face.
  - `src/components/ProjectTimeline.astro`: an inline `--position-digits` style that reserves room for the milestone count.
  - `src/components/LyftWorkStory.astro`, deleted (114 lines, including a client script). At `26e764a` nothing in `src/` imported it (`git grep`). `docs/website-system-plan.md` drops it from the reuse list in this PR. `docs/audits/2026-09-09/website-audit.md` line 137, a dated audit, still links to the deleted file.
  - Copy, as listed in Scope. `/work` also moves the Tally paragraph below the two links; its text is unchanged.
  - `src/data/project-stories/personal-website.ts`: unchanged in the end. `f0abd1f` changed the status label from "Live - evolving" to "Live · evolving", but PR #203 (merged to `main` as `75a88be4` while this PR was open) shows "Live - evolving" in two reviewed link-preview videos, and its copy test failed on the merge. The separator went back to "Live - evolving" in the commit that merges `main`; switching both the page and the videos is left to the owner as a follow-up.
  - `scripts/screenshots/scenarios/software-signing.mjs`: its step now waits for the curly-apostrophe text.
  - Private pages: `src/styles/owner.css` (owner filter, request notes and payment field edges), `src/styles/studio.css` (studio and agreement fields and buttons), and the styles of `src/pages/studio/sign-in.astro` and `src/pages/offer/[token]/sign.astro`.

Rollback revision: `0ab273da`, `main` before this PR after PR #205 merged at 14:13 UTC on October 22, 2026. Its `validate` check succeeded at 14:14:43 UTC and its production Workers Builds at 14:15:33 UTC, and production served its trailing-slash redirect for `/building/tally/` when checked at 15:20 UTC. Rolling back further, to `75a88be4`, would also remove #205's sitemap fix. This PR writes no data and changes no schema, so a rollback has no stored-data caveat. Check what has merged since before any rollback.
Evidence: CI captures under `pr-204/f0abd1f/` on the `screenshots` branch (325 files, counted through the GitHub API). Branch preview: `https://claude-hallmark-audit-fixes-thesuperhuman-us.cloudflare-rxi8d.workers.dev`, which returned 302 to the Cloudflare Access login when requested at about 10:41 UTC.

## Owner decisions and authorization

- On October 22, 2026, in conversation, the owner asked to address every issue from the Hallmark audit, and to receive alternatives for the items that are his design choices. This is as relayed to this agent by the coordinating Claude session. No owner wording was passed on, so none is quoted here.
- The commit message of `ab4dae0` says the PR fixes the defects and leaves the owner's design choices as they were, with alternatives for those going to the owner separately. `a3c2f56` reverts visible changes that an independent UI review found the fixes did not need.
- The PR still changes how pages look (see Scope). Merge and deployment wait on the owner's approval of the look, the same process as the previous record (`docs/prelaunch-qa-2026-10-20-website-design-intake.md`: "The PR merges only after the owner approves the look, following this gate."). Merging to `main` deploys production. The owner gave that approval later the same day (next line).
- Owner, in conversation, October 22, 2026, after the coordinating session shared side-by-side before and after captures of every public page: "#204 looks great". Under the process above, that approval of the look clears the merge. The owner did not report a second-browser, real-device, zoom or performance check and has not accepted those gaps as exceptions, so they stay UNVERIFIED and this record does not claim the release launch-ready, as in the previous record, which shipped with the same gaps.

## Evidence and limits

- **Checks at `f0abd1f`, run by this agent from about 10:20 to 10:27 UTC:**
  - `npm run copy:check`: passed.
  - `npm run assets:check`: passed; 36 production files match their visual review records.
  - `npx astro check`: 454 files, 0 errors, 0 warnings, 17 hints. None of the hints are in files this PR changes; they are in `scripts/studio-retention.mjs`, `src/components/SoftwareOffer.astro`, `src/components/owner/SoftwareAgreementDetails.astro`, `src/layouts/BaseLayout.astro`, `src/pages/api/agreements/link.ts`, `src/pages/api/owner/agreements.ts`, `src/pages/audio/about.astro` and `src/scripts/brief-autocomplete.ts`.
  - `npm test`: 135 files, 1,594 passed, 1 skipped.
  - `npm run build`: passed. The prebuild ran the asset, copy and publicist gates. Locally, the publicist gate skipped its private note lookup because there is no token, and checked 84 entries. Build warnings: the glob loader for `src/content/notes` and `src/content/audio-tracks`, comment warnings from `zod` in `node_modules`, and the `@astrojs/cloudflare` notice about a `SESSION` binding. None comes from a file this PR changes.
  - Recorded earlier in this session at `b771231` and `f0abd1f`: the same test count, 0 errors from `astro check`, and a passing build with the asset, copy and publicist gates.
- **CI on `f0abd1f`** (check runs read through the GitHub API): `validate` succeeded at 10:05:45 UTC, the Workers Builds preview at 10:05:18 UTC and Screenshots `capture` at 10:18:10 UTC.
- **Reviews:**
  - Independent Claude reviewers: a code review and a UI, copy and rules review of `ab4dae0`, both addressed in `a3c2f56` and `b771231`; a delta review of `ab4dae0..b771231`, clean apart from three nits, fixed in `f0abd1f`.
  - Codex code and security reviews of `ab4dae0`: no findings (the Codex summary comment on the PR names `ab4dae0` for both). Codex did not review later commits.
  - Greptile: no review on the PR (the PR's review list is empty).
  - Later heads, including `f0abd1f`: see "Review of the final head" in section 7.
- **Overflow sweep, earlier in this session:** 24 public pages at 320, 375, 390, 768, 1024, 1215, 1280 and 1440px, with no horizontal overflow and no console errors after the studio sign-in fix (`d0d26dd`).
- **Browser checks by this agent at `f0abd1f`:** Playwright's Chromium against `astro dev` with the screenshot preview config on port 4361, from about 10:26 to 10:43 UTC. The working tree was clean at `f0abd1f`. Results are in sections 1 to 4.
- **Contrast measurements, earlier in this session:** `--field-border` about 3.39:1 on paper; the waveform's unplayed bars from 1.90:1 to 3.39:1; the code boxes from about 1.6:1 to 3.58:1. This agent's own figures are in section 3.
- **CI captures viewed by this agent**, at reduced display scale: `work-desktop.png`, `work-phone.png`, `services-phone.png` and `privacy-desktop.png` from `pr-204/f0abd1f/`. The other 321 were not viewed.
- **Limits:** Chromium only. The dev server is not the Workers runtime. `axe-core` is not a repo dependency; the automated check in section 3 used a scratch install. Nothing was checked in production.

## 1. Purpose and content

- **PASS · Project, branch and local changes.** At the browser checks the PR head and base matched the API (`f0abd1f` on `claude/hallmark-audit-fixes`, base `main` at `26e764a`); the branch has since merged `main` at `75a88be4` and then `0ab273da`. The working tree was clean. The site instructions (`CLAUDE.md`, `AGENTS.md`) and the audience are unchanged.
- **PASS · Deployment authorization (owner).** This record's process, the same as the previous record's, is that the PR merges after the owner approves the look, and merging deploys production. The owner approved the look on October 22, 2026 (see Owner decisions). That clears the merge; it does not make the release launch-ready while the items listed under Known unknowns stay open.
- **PASS · Approved design: the owner's approval of the look (owner).** After the coordinating session shared side-by-side before and after captures of every public page, the owner wrote, in conversation on October 22, 2026: "#204 looks great".
- **PASS · Claims, placeholders and media.**
  - No professional claim changes. The Tally sentence on `/work` keeps its wording and only moves below the links. The deleted `LyftWorkStory` was not rendered on any page at `26e764a`, so no rendered claim is removed.
  - Added lines contain no placeholder text (searched for TODO, FIXME, lorem, TBD), no rates, clearance, exclusivity or buzzwords, and no em dashes.
  - No image, audio or video file is added, removed or changed; the asset QA gate passed.
- **PASS · Explanatory copy.** The only new wording is the `/privacy` heading "Software project briefs and pages". The rest is punctuation and order. No who-does-what wording changes.
- **N/A · Website and resume comparison.** No professional claims or resume facts change.
- **PASS · First screen and CTA, locally.**
  - `/work` at 1280 × 800: the resume and hire links end 781px from the top. At 390 × 844 (phone emulation) they end at 727px. Both are inside the first screen. The CI captures `work-desktop.png` and `work-phone.png` show the links straight after the lede, with the Tally paragraph after them.
  - The 404 page at 1280 × 800: "Back to home" ends at 681px.
  - Home's first screen keeps its content; `Hero.astro` changes only its easing token.
  - The links' targets are unchanged (`/about#resumes`, `/services#software`, `/`).
- **PASS · Navigation, footer, contact and links.**
  - No `href` changes, by the diff. The footer and phone menu change only tap areas, hover colors and a shadow color.
  - The `#software-briefs` anchor moves from a paragraph to the new heading on `/privacy`. `/software/start` still links to it, and `tests/pages/software-offer.test.ts` asserts the id.
  - The only external link in the added lines is the existing Cloudflare Workers AI terms link on `/privacy`, unchanged apart from its apostrophe.
  - No address is added. The registered-agent footer is unchanged.

## 2. Search and sharing

- **N/A · Titles and descriptions.** No `title` or `description` changes (the diff searched for both).
- **N/A · Canonicals.** No route, `BaseLayout` or `astro.config.mjs` change.
- **N/A · Open Graph.** `BaseLayout` and the card image are unchanged.
- **N/A · Icons.** `public/` is unchanged.
- **PASS · Robots and sitemap, built.**
  - The built `dist/sitemap-0.xml` from the code merged with `0ab273da` has 22 URLs, the count #205's record gives after it removed the private sections. It has no `/owner`, `/api`, `/offer`, `/studio` or `/agreements` URLs.
  - No page is added or removed, and `public/robots.txt` and `astro.config.mjs` are unchanged.
  - Live check follows in section 7.
- **PASS · Preview indexing.** The branch preview returned 302 to the Cloudflare Access login before any page rendered (about 10:41 UTC).
- **N/A · Structured data.** No JSON-LD changes; Home's `jsonLd` block is unchanged.

## 3. Accessibility and responsive behavior

- **PASS · Structure.** The only added heading is the `/privacy` h2, which sits under the page's h1 and before its other h2s. No landmark or language changes. The deleted component's h4 was never rendered.
- **PASS · Image alternatives and icon controls.**
  - Door pictures keep empty alternative text inside `aria-hidden` links, beside their captions.
  - The release player's mute button keeps its `aria-label` and `aria-pressed`. Only its icon changes: a crossed speaker when muted, instead of 45% opacity (`tests/components/audio-player.test.ts`).
- **PASS · Keyboard and focus, locally and by tests.**
  - On `/about` at 1280 × 800, with the resume section open, Tab from its summary reached Name. `:focus-visible` matched, and the outline was solid 2px `rgb(174, 85, 52)` with a 2px offset.
  - Studio and agreement fields and the sign-in code boxes drop `outline: none` with a halo for the 2px accent outline (`tests/components/studio-field-focus.test.ts`, `tests/components/field-border-contrast.test.ts`). Not exercised in a browser.
  - The new hover rules sit behind `(hover: hover) and (pointer: fine)` and replace no focus style.
  - The 44px tap areas are pseudo-elements and do not change focus order. The skip link and menus are unchanged apart from hover and shadow colors.
- **PASS · Labels, errors and status.**
  - Resume form: labels and their `for` values are unchanged. The error paragraphs lose their inline accent color, and `.site-form [data-form-error]` sets the same color. "(optional)" keeps its muted color through `.site-form label > span`.
  - With `aria-invalid="true"` set on Email and on the note, both computed borders were `rgb(174, 85, 52)`. Before `b771231`, invalid inputs kept the hairline edge.
  - Error and status text is unchanged, so failures do not rely on color alone.
  - The submit button's disabled look moves from Tailwind classes to `.site-form button:disabled` in `global.css` (opacity .5, not-allowed cursor), and hover no longer darkens a disabled `.site-button`.
- **PASS · Contrast.**
  - Field edges: on `/about`, Chromium computed the Email field's border as `color(srgb 0.533 0.529 0.521)`, 3.39:1 against the paper background `rgb(251, 248, 242)`. By token arithmetic, `--field-border` is 3.53:1 against `--studio-field` (`#fffdf9`) and 3.30:1 against the owner fields' tinted fill (12% `--rule` on paper). Before: `--rule` on paper was 1.21:1, and `--studio-line` on `--studio-field` 1.65:1.
  - The waveform and code boxes, as measured earlier in this session (see Evidence). For the code boxes, token arithmetic here gives 3.53:1 against the box fill and 3.39:1 against paper; both clear 3:1.
  - `tests/components/field-border-contrast.test.ts` and `tests/components/comparison-player.test.ts` recompute 3:1 or better from the tokens.
  - Text: studio placeholders move from `#9a938a` (2.99:1 on `--studio-field`) to the intake placeholder mix (5.10:1). The studio intro moves from `#4d4b47` to `--muted` (8.21:1 to 8.36:1 on paper). `/audio`'s kickers take `.page-kicker`'s accent (4.78:1 on paper), like the other kickers. The Old News hero lyric is slightly darker than before (relative luminance 0.0121 to 0.0114) with the same paper halo; its contrast against the picture itself was not measured.
- **PASS · Touch targets, locally and by source.**
  - The first three footer links on `/privacy` and the 404 page's secondary link each have a 44px-tall `::after` tap area.
  - Door buttons measured 44px tall on Home at 1280px, and on Home and `/services` at 360 to 390px.
  - By source: the review illustration's controls have `min-height: 44px`, and the `/building` project links get 44px `::after` areas.
- **PASS · 200% page zoom, emulated.** A 1280 × 800 window at 200% zoom was emulated as a 640 × 400 viewport at device scale 2. All 26 sitemap URLs and a missing path loaded with no horizontal overflow. The only console errors were the two documents' own 404 statuses (`/agreements/verify` without a key, and the missing path).
- **UNVERIFIED · Zoom in a real browser, including text-only zoom (owner).** The emulation above is not a browser's zoom control, and Chromium has no text-only zoom.
- **PASS · Reduced motion.** With reduced motion emulated on Home, no `.motion` class was set and no animation was running after load. The new hover scale on the round play buttons is limited to `prefers-reduced-motion: no-preference`. The studio fields' transitions are removed, not added.
- **PASS · Automated accessibility check.** axe-core 4.10.2 (installed in a scratch directory, not the repo), WCAG 2.0/2.1 A and AA plus WCAG 2.2 AA rules, run by the coordinating session on every public page in `scripts/screenshots/config.mjs` at 1280x800 and 390x844 with reduced motion. It compared the PR head with base `26e764a`, each served by `astro dev` with the screenshot preview config. The PR introduced no violations and removed none. One violation existed on both: `color-contrast` (serious) on the two `.direction-path h3` headings in the essay's figure, accent `#ae5534` on panel `#f3eee5` at 4.38:1 for 20px regular text. Fixed in this PR: the headings now use `color-mix(in srgb, var(--accent) 92%, var(--ink))`, 4.94:1, and axe reports no violations on `/writing/ai-gives-you-speed`. Automated checks are not a full audit; the manual measurements above complement them.
- **PASS · Widths, locally and in CI.**
  - At 320 and 375px, the 26 sitemap URLs and a missing path had no horizontal overflow (`scrollWidth` equal to the viewport).
  - Door rows on Home and `/services` at 360, 362, 363, 366, 369, 370, 371, 375 and 390px: no overflow, each label on one line, buttons 44px tall. The buttons sit under the picture at 370px and below and beside it from 371px, as `f0abd1f` intends.
  - Opened at 320 and 375px: the phone menu on Home and `/services`, Home's contact form, the `/about` resume form, and the first screens of `/software/start` and `/audio/start`. No overflow, and no field outside the viewport.
  - The session's sweep of 24 pages at 8 widths (see Evidence), and the CI captures at 390 and 1280px.
- **UNVERIFIED · Second browser and real device (owner).** Only Chromium is installed here. No Safari, Firefox or real phone check has been done.

## 4. Performance and resilience

- **PASS · Images.**
  - No image file changes (asset QA).
  - `/services` renders the doors in its first screen, so their pictures now load eagerly, the first with `fetchpriority="high"` (observed: `eager/high`, `eager`, `eager`). Home's doors stay lazy (observed).
  - The 404 picture displays at up to 450px wide instead of 700px. The file and its intrinsic dimensions are unchanged.
- **PASS · Client code, dependencies and fonts, by source.**
  - No dependency change (`package.json` and the lockfile are unchanged).
  - Client script: 3 net lines in `comparison-player.ts`. The deleted component's script was never shipped, because nothing rendered the component.
  - Fonts: the same Google Fonts request (Inter 400, 500 and 600; JetBrains Mono 400 and 500). `.eyebrow` now uses JetBrains Mono 400, which `.page-kicker` already loads. No font file or weight is added.
  - Compression and caching come from Cloudflare and `public/_headers`, which are unchanged. They were not measured.
- **UNVERIFIED · Performance measures.** No lab or field measurement was made for this change. An agent can measure, or the owner can accept the gap.
- **N/A · Async recovery.** No fetch, submit or retry code changes. Form scripts are unchanged; the resume form changes only its classes.
- **N/A · Missing or unavailable media.** No media loading or fallback code changes: `src/scripts/music-controls.ts` is unchanged, and `comparison-player.ts` only sets the volume fill. The disabled seek style and the muted icon are CSS and markup covered by `tests/components/audio-player.test.ts`. No autoplay is added.
- **PASS · Missing page, locally.** `/this-page-does-not-exist-qa` returned HTTP 404 with the "Page not found" page. No redirects change. Live check follows in section 7.

## 5. Forms and sensitive flows

- **N/A · Server validation, origin and rate checks.** No API or server code changes.
- **N/A · Failure matrix.** No form logic changes. Pending and disabled states keep their look through `.site-form button:disabled` (see section 3).
- **N/A · Without JavaScript.** The `noscript` messages on the resume form and studio sign-in are unchanged.
- **N/A · Delivery and receipt.** No email or delivery code changes.
- **N/A · Approval-gated flows.** Resume delivery, offers and agreements keep their approval steps; no API changes.
- **N/A · Inline confirmation.** Unchanged, apart from the curly apostrophe in "I’ll review your request."

## 6. Privacy, legal and measurement

- **N/A · Data inventory.** No new form data, storage, cookies, scripts, processors, fonts or embeds.
- **PASS · Privacy notice.**
  - `/privacy` gains the heading "Software project briefs and pages" and curly apostrophes. Its sentences are otherwise unchanged; `tests/pages/software-offer.test.ts` and `tests/scripts/brief-flow.test.ts` assert them with the new apostrophes.
  - It stays linked from the footer, and `#software-briefs` still resolves. Its date, "Updated October 19, 2026", is unchanged, since the notice says the same thing.
  - The CI capture `privacy-desktop.png` shows the new heading.
- **N/A · Consent.** No new cookies or optional processing.
- **N/A · Commerce disclosures.** No terms, address or commerce changes. The offer signing page changes only styles.
- **N/A · Analytics.** No analytics changes.
- **N/A · Monitoring.** No error logging or monitoring changes.

## 7. Release and final QA

- **PASS · Required checks.** Copy check, asset check, `astro check`, tests and build pass at `f0abd1f`, as recorded under Evidence. Warnings and hints were inspected; none come from files this PR changes.
- **PASS · Diff, dependencies and artifacts.**
  - The 60-file diff was read in full. What it changes beyond CSS, markup and tests is listed in the header.
  - No dependencies, generated files, images, secrets or private data. The added lines contain no tokens, keys or private URLs; the only URL is the existing Cloudflare terms link.
  - The `docs/website-system-plan.md` edit follows the deleted component. The stale link in `docs/audits/2026-09-09/website-audit.md` is left as it is in that dated record.
  - The four CI captures viewed render without visible breakage at the displayed scale. The other captures were not viewed by this agent; the owner's look review uses them.
- **PASS · Review of the final head.** An independent review covered `b771231..4726df39` (including the merge of `main`), ran the tests and `astro check`, and checked the signing pages live; its findings are fixed in `27e4d3b9`. The coordinating session verified `27e4d3b9` with the full suite (138 files, 1706 passed), `astro check` (0 errors) and CI on that head (`validate`, Screenshots `capture` and Workers Builds succeeded). The later merge of `0ab273da` adds #205 (reviewed in its own PR) and one conflict resolution in `src/pages/work.astro`; on that merge the suite, `astro check` and `npm run build` pass as above.
- **PASS · Production configuration, by source.**
  - `wrangler.jsonc`, bindings, secrets, migrations, `public/_headers`, `src/middleware.ts`, `src/lib/` (including `security-headers.ts` and `host-routing.ts`), `astro.config.mjs`, `package.json` and the lockfile are unchanged.
  - The built `dist/_headers` from the merged code equals `public/_headers` at `0ab273da` (which includes #203's `/og/*` cache block), and this PR changes nothing under `public/`.
  - Live headers, HTTPS and routing follow in the post-deployment item.
- **PASS · Rollback.** `0ab273da`, `main` when this branch last merged it; its `validate` run succeeded and production served its redirect at 15:20 UTC on October 22, 2026. No backup is needed: this PR writes no data and changes no schema. Check what has merged since before any rollback.
- **PASS · Post-deployment QA.** Before the merge, the head's `validate` (15:25:49 UTC), Screenshots `capture` (15:38:26 UTC) and Workers Builds preview succeeded, with no open review threads. On `b4350907`, `validate` succeeded at 15:42:18 UTC and the production Workers Builds at 15:45:14 UTC. A read-only Playwright script (Chromium, no form sent) then checked production. Its first full run at 15:45 UTC passed 40 of 44 checks. The four misses were the script's, not the site's: three were the known Turnstile console lines in a new wording (a connect-src refusal for `data:,`), and one tried to focus the resume email field while its disclosure was closed. With both fixed, the affected checks and then the full set passed: 44 of 44 at 15:48 to 15:50 UTC. The same script, run against production before the merge, failed the checks this PR fixes (the `/audio/releases` overflow, the `/work` links below the fold, the faint field edge and the missing privacy heading). It covered:
  - Production revision: the `/privacy` h2 "Software project briefs and pages", which only this PR adds, is served. Cloudflare's deployment history was not read here, so the Worker version is not recorded. `main` moved to `97321a6c` (#207, docs only, no site change) at 15:48:39 UTC, during the final run.
  - The four `/*` security headers and `strict-transport-security` on `/`, `/privacy` and the 404 response.
  - No horizontal overflow and no console errors, apart from the Turnstile lines that predate this PR, on `/`, `/work`, `/services`, `/about`, `/privacy`, `/building`, `/writing/ai-gives-you-speed`, `/music/old-news` and the 404 page, at 1280x800, 390x844 and 320x640.
  - The `/work` resume and hire links end inside the first screen at 1280x800 (781px) and 390x844 (676 and 727px).
  - The `/about` resume email field: the `--field-border` edge at rest, a solid 2px outline on focus, and the accent edge when marked invalid (nothing sent).
  - `/audio/releases` at 701, 900, 1100 and 1247px: no sideways scroll.
  - `audio.thesuperhuman.us/` and `/releases` at 390: no overflow or errors.
  - `robots.txt` names the sitemap; the sitemap has 22 URLs and no private sections.
  - Home's title, description, canonical and icon are present, and its `og:image` returns 200.
- **PASS, with gaps · Receipt.** Implemented: yes. Verified locally: yes, with the checks and Chromium measurements above. Deployed: yes, by the production Workers Builds check on `b4350907` (15:45:14 UTC). Verified live: yes, for the checks listed above. Not verified live: a second browser, a real device, browser zoom and performance (Known unknowns).

## 8. Private owner center

- **N/A · Access and owner response headers.** No owner route, Access, middleware or header change. `owner.css` changes only three field edges to `--field-border`.
- **N/A · Schema, persistence, traffic, playback, retention, studio enablement, payments, Stripe, webhooks and recovery.** None of these are touched.
- **N/A · Target health (`owner:health`).** It checks configuration, schema, release media, request storage, Stripe reconciliation, retention and the signing route (`scripts/owner-health.mjs`). This PR changes none of them. The remote run listed as remaining work in the October 20 record is unaffected and stays open there.

## Software agreement signing

- **PASS · Signing pages: CI captures, keyboard and overflow (client-facing pages).** The `software-signing` scenario ran fresh at `f0abd1f` and its overflow check passes at 320, 390, 768 and 1280. An independent reviewer pixel-diffed all 74 before and after captures (only change: +40px header spacing on 12 signing-form captures, as intended), viewed a representative set, and on a seeded local copy checked focus outlines, the error summary by keyboard, and no overflow from 320 to 1280 on the offer, sign, verify and `/agreements` pages. Owner signing pages and the waiting and executed states were covered by CI captures only. Signing-page apostrophes stay straight (see Copy).
- **N/A · The other signing checks.** Counsel review, contractor configuration, template previews, the signing setting, email authentication, PDF rendering, certificates, failures, downloads, restore and retention are untouched by this PR.

## Summary

| Section | PASS | FAIL | UNVERIFIED | N/A |
| --- | --- | --- | --- | --- |
| 1. Purpose and content | 7 | 0 | 0 | 1 |
| 2. Search and sharing | 2 | 0 | 0 | 5 |
| 3. Accessibility and responsive behavior | 10 | 0 | 2 | 0 |
| 4. Performance and resilience | 3 | 0 | 1 | 2 |
| 5. Forms and sensitive flows | 0 | 0 | 0 | 6 |
| 6. Privacy, legal and measurement | 1 | 0 | 0 | 5 |
| 7. Release and final QA | 7 | 0 | 0 | 0 |
| 8. Private owner center | 0 | 0 | 0 | 3 |
| Software agreement signing | 1 | 0 | 0 | 1 |
| Total | 31 | 0 | 3 | 23 |

Deployed on October 22, 2026, and the post-deployment checks pass (section 7). Not claimed launch-ready: still UNVERIFIED, with no owner-accepted exception, as in the previous record, are a second browser, a real device, browser zoom and lab performance.

## Known unknowns

For the owner to check or accept:

- 200% zoom in a real browser, including text-only zoom
- a second browser (Safari or Firefox)
- a real mobile device

An agent can close these, or the owner can accept them as exceptions:

- lab performance measurement (field data needs a deployed site)

## Remaining work

- Owner: check a second browser, a real phone and 200% browser zoom, or accept each gap as an exception with its impact and follow-up in this record.
- Agent: run a lab performance pass and record it here.
- Optional: point the stale `LyftWorkStory` link in `docs/audits/2026-09-09/website-audit.md` at a note, if dated audits are kept current. Not done here.
