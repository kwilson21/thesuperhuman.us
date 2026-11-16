# Closing panel and pill buttons release gate

Date: November 12, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/design-inspiration-portfolio-b75d50`, from `main` at `a96411f5`, with `main` at `54c7627e` merged in
Pull request: [#233](https://github.com/kwilson21/thesuperhuman.us/pull/233)
Target: production `https://thesuperhuman.us` after merge, including the audio pages on `audio.thesuperhuman.us`, which share the footer and stylesheets.
Reviewer: Claude Haiku 5.5 subagents built, tests first (one fix commit, `2c29391f`, was written by Codex at a subagent's request). Independent Claude Opus and Sonnet subagents reviewed. The coordinating Claude session checked the pages in a browser and collected this evidence for owner Kazon Wilson. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `54c7627e` (`origin/main` after the lint and format stack, #239, merged; this branch merged that `main` in at `115f0bf2`). The PR adds no migration and writes no stored data.

## Scope

- The shared footer becomes a soft, tinted closing panel (`--panel`, `--radius-panel`).
  - Invitation pages (Work, About, Building, Writing index, the essay, project pages): one "Get in touch" button to Home's contact section, the footer links, the LLC line.
  - Quiet pages (Home, Privacy, 404, software and audio intake, audio pages): the name mark, the footer links, the LLC line.
- On invitation pages at 600px wide and below, a pinned "Get in touch" button stays at the bottom of the screen until the closing panel comes into view.
- Every action button is a pill (`--radius-button`). Fields, pictures, cards, tabs and toggles keep their corners.
- `design.md` is amended to match. The brief, plan and button inventory are in `docs/superpowers/` and `docs/design-concepts/2026-11-12/`.

## Owner decisions

All in conversation on November 12, 2026.

- On the three first mockups: "I really like B" (the soft panel).
- On how far the soft shapes go: "Pills on every button".
- On the design brief: "Approve the brief". On the plan: "Start the build".
- On the Writing index ending on two invitations: "Yes, move it". This was then superseded by the next decision.
- After seeing the built panel: "I don't like the text at the bottom, it feels like there's two calls to action, I just want a simple get in touch button tbh".
- On the simpler mockups: "The original one button only worked best, can you make it so it's sticky at the bottom like the reference website made it?"
- On where the pinned button appears: "Phones only".
- After seeing screenshots of the built panel and pinned button on a local copy: "Looks right".
- On the essay's "Get in touch" text link sitting directly above the panel's button: "Yes, remove it". Removed in `e89e9d09`; the essay keeps "Back to Writing".
- On the owner "Confirm terms" button: "Can you quickly fix the confirm terms pill button? The arrow seems to have a ton of extra space on it's left". Fixed in `115f0bf2`: `.owner-primary-action` centres its label and arrow with a `.6rem` gap.
- Merge authorization: asked "Do you authorize merging PR #233 once CI and the reviews are clean?", the owner answered "Yes, merge it". Merging to `main` deploys production.

Changes made during review that depart from the approved brief are listed in the brief under "Amendments from review". The owner has seen the list and has not objected; none has been explicitly accepted.

## Evidence and limits

After `main` (the Biome and Oxlint stack) was merged in at `115f0bf2`, on that head:

- `pnpm test`: 156 files, 1,923 passed, 1 skipped.
- `pnpm run format:check`: no fixes needed, 524 files.
- `pnpm run check`: 0 errors. `pnpm run design:check`, `pnpm run copy:check` and `pnpm run build`: passed (builder's run).
- `pnpm run lint`: 66 findings, the deferred set recorded in `docs/prelaunch-qa-2026-11-12-lint-format-stack.md`. None is in code this branch added; one, `src/pages/owner/requests/[id].astro:181`, is in a file where this branch changed CSS only. Lint is not a CI check.
- The merge conflicted in `src/components/Footer.astro` only (main reformatted its frontmatter); the branch's version was kept and formatted.
- The pages were not re-checked in a browser after the merge. The earlier runs below are from before it.

Local runs on macOS arm64, Node 26.13.1, pnpm 12.20.0:

- `pnpm test`: 146 files, 1,821 passed, 1 skipped, on `e89e9d09`.
- `pnpm run check`: 0 errors, 0 warnings, 17 hints (on `8225652e`; `c242936f` changes only `design.md`).
- `pnpm run design:check`: passed, 6 Hallmark gates, 12 allowlisted exceptions.
- `pnpm run copy:check`: passed.
- `pnpm run build`: passed on `8225652e`, including the asset, copy, design and publicist checks.

Browser checks, in the Claude desktop app's Chromium pane against `astro dev` with the screenshot preview config:

- 1280 and 390 wide, before the one-button revision: Home, Work, About, Building, Privacy, 404, Work with me, audio intake.
- 1280 and 390 wide, after the revision: Work (pinned button mid-page, hidden at the panel, absent at 1280), About (pinned button hides when the resume form's Name field is focused by a real click), Privacy (no pinned button).
- 320 wide, after the revision: Work (no horizontal overflow; pinned button 272px wide and 52px tall inside the 24px gutters) and the essay (no overflow; pinned button gone at the panel).
- 768 wide: About, no pinned button, no overflow.
- Structure of 14 pages fetched from the local server: each has at most one `#contact`, the right panel variant, "Work with me" in the link row, and the pinned element only on invitation pages, rendered with the `hidden` attribute.
- The intake's "Back" and "Send for review" fit side by side at 390 (163px each, not clipped).

CI on the pull request: Validate and Workers Builds passed on `c242936f`; the screenshot capture and Greptile review were still running when this record was written. All four checks passed on the earlier head `62047c42`.

Reviews: a task review after each build task; a whole-branch correctness and security review (Opus); a UI, copy and repo-rules review (Sonnet); a read-only Hallmark audit; Greptile (three findings, fixed, then 5 of 5 on `5f2e8c24`); Codex (two findings on `2c29391f`, fixed); an independent Sonnet review of the one-button and pinned-button commit `8225652e` (no code defects; two `design.md` wording slips, fixed in `c242936f`).

Limits:

- Chromium only. No second browser and no real phone.
- The dev server is not the Workers runtime.
- The Cloudflare branch preview is behind Cloudflare Access and was not opened.
- `pnpm run screenshots` was not run locally (the Playwright browser is not installed on this machine); the Screenshots workflow covers every page.
- Greptile and Codex have not reviewed `8225652e` or `c242936f`.
- Production was checked only as listed under section 7 (the merge session's live check on 2026-11-13). The owner, studio and agreement pages, a second browser, a real phone, 200% text zoom and tabbing under the pinned button were not checked live.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `main`; the site instructions and audience are unchanged. Deployment authorization: given, see Owner decisions.
- **PASS · Approved design, truthful claims, placeholders and media.** The look follows the owner's picks and his "Looks right". No professional claim changes. No new images.
- **PASS · Explanatory copy.** The only copy change is removals: the closing sections on Work ("Have a problem worth exploring?"), About ("Let’s talk.") and Writing ("Have something to discuss?") are gone, replaced by the "Get in touch" button.
- **PASS · First screen and next step.** First screens are unchanged. The pinned button is the sticky CTA this checklist allows when the journey justifies it: below 980px the header shows "Menu" in place of the "Work with me" button.
- **PASS · Navigation, footer, contact and links.** The panel's links keep their targets. "Work with me" is in the link row on every page. The panel button and pinned button resolve to `/#contact` on the main host and to the absolute `https://thesuperhuman.us/#contact` on prerendered project pages. No address is shown.

## 2. Search and sharing

- **N/A · Titles, descriptions, canonical URLs, Open Graph, icons, robots, sitemap, structured data.** Unchanged; no route is added or removed.
- **N/A · Preview indexing.** Unchanged.

## 3. Accessibility and responsive behavior

- **PASS · Landmarks and headings.** The `<footer>` landmark and the "Elsewhere" nav label are kept. The panel no longer adds a heading.
- **N/A · Image alternatives.** No images change. The button arrow is `aria-hidden`.
- **PASS, with limits · Keyboard and focus.** The global focus outline is unchanged and is not clipped by the panel. The pinned button is `display: none` whenever it is not shown, so it leaves the tab order and accessibility tree. While it shows, the page reserves `scroll-padding-bottom: 5.5rem` (measured 88px against a bar of about 80px). Tabbing through a page under the bar was not exercised by hand: **UNVERIFIED**.
- **N/A · Form labels and errors.** No form changes. The pinned button hides while a form field has focus.
- **PASS, with limits · Contrast, touch targets, zoom, reduced motion.** On `--panel`: ink 16.5:1, muted 7.6:1; accent 4.3:1 is used only for focus rings, not text. Buttons keep 44px or more; the large and pinned buttons are 52px. The pinned button has no motion; the button arrow now stays still under reduced motion. 200% text zoom was not checked: **UNVERIFIED**.
- **PASS, with limits · Widths.** 320, 360, 390, 768 and 1280 checked on the pages listed above, with no horizontal overflow. At 380px and below a button label may wrap. Not every page was checked at every width.
- **UNVERIFIED · Second browser and a real phone.** Chromium only.

## 4. Performance and resilience

- **N/A · Images.** None change.
- **PASS · Client code.** One small script, `src/scripts/pinned-contact.ts`, on invitation pages. Without JavaScript or `IntersectionObserver` the pinned button never shows and the panel's own button is the invitation.
- **UNVERIFIED · Measured performance.** Not measured. The change adds no image, font or dependency.
- **N/A · Async UI, media, redirects.** Unchanged. The 404 still returns HTTP 404 locally with the quiet panel.

## 5. Forms and sensitive flows

- **N/A.** No form, endpoint or approval flow changes. Intake and owner buttons change shape only.

## 6. Privacy, legal and measurement

- **N/A.** No data, storage, cookie, analytics or processor changes. The Privacy link stays in the panel on every page.

## 7. Release and final QA

- **PASS · Type, test, asset and build checks.** See Evidence.
- **PASS · Diff review.** 27 files against `main`: the footer, its callers, five stylesheets, one script, tests and docs. No secrets, no dependency changes, no generated files. `docs/handoffs/` and `.jolli/` are untracked and not in the PR.
- **N/A · Bindings, secrets, migrations.** None change.
- **PASS · Rollback version.** `54c7627e`.
- **PASS, with limits · Production verification after deploy.** The merge session reported on 2026-11-13 (an observation relayed to this record, not re-run here): PR #233 merged to `main` as `531ec1df` at 01:04 UTC, which deploys production. About two minutes later, production was checked live: the closing panels on both hosts, the pinned button on the Work page at phone width, the 404 page returning HTTP 404, and Home's contact section intact. The audio host renders only the quiet panel (`src/components/audio/AudioFooter.astro`), so the invitation panel was seen on the main host; the report does not name the pages or say which quiet pages were opened on each host.
- **PASS, with limits · CI and reviews on the final head.** On the merged head `e1237618`, the `validate` and `capture` checks, the Greptile Review check and the Workers build all succeeded before the merge (GitHub check results, read on 2026-11-13). Limit: Codex reviewed only the head the PR opened with (`2c29391f`) and did not review the later commits.
- **UNVERIFIED · The rest of the post-deployment check.** Not recorded for this release on either host: the production revision actually served, the main journeys, sitemap and robots, metadata, OG images and icons, the forms, and monitoring.
- **UNVERIFIED · Live check of the remaining pages.** The owner pages, the studio pages and the agreement pages were not checked live. The checks marked UNVERIFIED in section 3 (a second browser and a real phone, 200% text zoom, tabbing through a page while the pinned button shows) were not run live either.
- **PASS · Receipt and evidence.** This record. Status: implemented and verified locally; deployed by the merge on 2026-11-13; verified live in part (see the production verification entries above); the rest of the post-deployment check, the owner, studio and agreement pages and the section 3 UNVERIFIED items remain UNVERIFIED.

## 8. Private owner center

- **PASS, with limits · Owner, studio and agreement pages.** Shape only: action buttons are pills, and labels made of typed or stored text may wrap. Seen in the CI screenshots for the owner request, owner requests and studio home pages on `62047c42`. No owner route, header, access rule, migration or payment behaviour changes.
- **N/A · The remaining owner-center items.** Unchanged.

## Remaining work

- A Codex review of the commits after `2c29391f`, if wanted.
- Two controls the inventory left unsorted: `.saved-reference` picker cards and the GitHub sign-in submit.
- The rest of the post-deployment check on both hosts: served revision, main journeys, sitemap and robots, metadata, OG images and icons, forms and monitoring (section 7).
- Live checks of the owner, studio and agreement pages (section 7).
