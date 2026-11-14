# Closing panel legal line balance release gate

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/closing-legal-balance`, from `origin/main` at `88551410`
Commits: `2d29fd93` (test), `1e9c1085` (change), `ded6b517` (release record), `676cbad3` (review, audit and design note) and this record update
Pull request: [#260](https://github.com/kwilson21/thesuperhuman.us/pull/260)
Target: production `https://thesuperhuman.us` after merge. The shared footer also renders on `audio.thesuperhuman.us`.
Reviewer: Claude Haiku 5.5 subagent, test first. The coordinating session owns the review, the Hallmark audit and the browser checks listed as UNVERIFIED. This record does not certify them.
Rollback revision: `88551410` (`origin/main` when this branch was cut). The PR adds no migration and writes no stored data.

## Scope

- One CSS property on the closing panel's legal line (`.closing-legal` in `src/components/Footer.astro`): `text-wrap: balance`. Four files change: `src/components/Footer.astro`, `tests/components/closing-panel.test.ts`, `design.md` (one sentence on the typography line records the exception, plus a November 13 owner-decision entry) and this record.
- The line is `The Superhuman Group LLC · {year}`. At 320px wide it wrapped so that "· 2026" sat alone on a second line. Balanced, it breaks into two even lines ("The Superhuman" / "Group LLC · 2026"). The result was first seen as a mock on 2026-11-13, by applying the same declaration to the live Work page at 320px wide. It was then viewed on this branch, served locally, at 320px, 390px and 1280px in Chromium (see Evidence). Where the line fits on one line, nothing changes.
- Shown on every page that uses the shared footer, both the invitation and the quiet panel.
- No markup change, no font size change, no change to the panel's other rules.

## Owner decision

- On 2026-11-13, in conversation, the owner was shown options A to D side by side at 320px and answered "B" (option B, balanced wrap):
  - A: the line as it was.
  - B: balanced wrap (this change).
  - C: the year on its own line.
  - D: one line in smaller text.

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1, pnpm 12.20.0, on the branch after the two commits:

- Test first: the new assertion in `tests/components/closing-panel.test.ts` failed before the change (`text-wrap: balance` absent from `.closing-legal`). After the change, `tests/components/closing-panel.test.ts` passes, 27 of 27.
- `pnpm run format`: fixed 1 file (the new test's line wrapping). `pnpm run format:check`: no fixes, 677 files.
- **FAIL (pre-existing, not from this change) · Lint.** `pnpm run lint` exits non-zero with 64 findings, all in files this PR does not touch (`src/lib/agreement-draft.ts`, `src/lib/audio-client-access.ts`, `tests/api/*`, and others). None is in `src/components/Footer.astro`, the test or the docs. Lint is not a required CI check on `main` at this revision. Open PRs #256 to #258 are the work that removes these findings.
- `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 258 files, 11,812 passed, 3 skipped.
- `pnpm run design:check`: passed, 6 gates.
- `pnpm run build`: exit 0, "Complete!". The built CSS (`dist/_astro/index.*.css`) contains `text-wrap: balance`.
- Rendering on this branch at head `676cbad3`, 2026-11-13, by the coordinating session: the branch was served locally with the screenshots preview config (`pnpm run screenshots:preview`, then `astro dev --config scripts/screenshots/dev.config.mjs` on 127.0.0.1) and the Work page (`/work`) was opened in headless Chromium (Playwright's Chromium 153), with requests to other hosts blocked. On the legal line, computed `text-wrap` is `balance` at all three widths. At 320px wide it is two lines of 116px and 117px ("The Superhuman" / "Group LLC · 2026"), document width 320px, no horizontal overflow. At 390px wide it is one line of 236px, document width 390px. At 1280px wide it is one line of 236px, document width 1280px. The 320px render was looked at as an image: the two lines are centred and even, and the dot stays with the year.
- The PR's Screenshots workflow run 43493217578 on head `676cbad3` succeeded. It captures 390px and 1280px; at both the line is a single line, so it is unchanged there.
- Independent review on head `ded6b517` by two Claude Sonnet subagents on 2026-11-13. Correctness review: clean (the rule is scoped to the one paragraph by Astro; both footer variants and the audio host wrapper render it; the global `p { text-wrap: pretty }` in `src/styles/global.css` is overridden by the scoped class; a browser without support wraps as before; the built CSS keeps the declaration). Rules review: found no code or rule defect and asked for the documentation changes made in this commit.

Merge, reviews and live check, observed by the coordinating session:

- Before merge, on the final head `34c2a16a`: `validate` and `capture` succeeded, the Greptile check succeeded, and Codex's code and security reviews of that head found no issues.
- The owner authorized merging in conversation on 2026-11-13 ("Yes"). Merged 2026-11-13 20:27:49 UTC as `c786f38b`. The production build succeeded (checked on `fad7694e`, the merge commit that followed seconds later and contains it).
- Live check on 2026-11-13, a few minutes after the merges, in Chromium (the coordinating session's built-in browser) at 320px wide: on `https://thesuperhuman.us/work` and on `https://audio.thesuperhuman.us/` the legal line's computed `text-wrap` is `balance`, it renders as two lines of 116px and 117px ("The Superhuman" / "Group LLC · 2026"), and the document is 320px wide (no horizontal scroll). `https://thesuperhuman.us/` and `/work` returned 200 and a missing page returned 404.

UNVERIFIED until checked:

- A second browser engine (Safari, Firefox), and a real phone. The rendering above is Chromium only.
- 200% text size at the time of this PR. A later PR, #263, addressed enlarged text in the closing panel.
- A browser without `text-wrap: balance` support. There the line wraps as it does today (the orphaned "· 2026" returns). This is acceptable.
- Hallmark audit: run read-only from source by an independent reviewer on 2026-11-13: no defects (muted text on the panel is 7.6:1 at 14px; only the `--muted` token is used; the line is not clickable; the six `design:check` gates pass). The audit's missing-stamp findings are set aside as `docs/design-standard.md` says. No new design choice beyond the approved option B. The wrap at 320px, 390px and 1280px and horizontal overflow were then checked on this branch in Chromium (see Evidence). Not run, and still UNVERIFIED: contrast in context, the visual slop test and the structural fingerprint.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `origin/main`; one CSS property and its test. Deployment authorization: not given by this record; the owner authorized the merge in conversation on 2026-11-13.
- **PASS · Approved design and truthful claims.** The look is the owner's option B. No professional claim changes, no copy changes, no images.
- **N/A · Explanatory copy.** No copy changes.
- **N/A · First screen and next step.** Not changed.
- **PASS · Navigation, footer, contact and links.** Markup is unchanged, so the footer links and their targets are unchanged. The legal line still reads `The Superhuman Group LLC · {year}`.

## 2. Search and sharing

- **N/A · Titles, descriptions, canonical URLs, Open Graph, icons, robots, sitemap, structured data.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **PASS · Landmarks and headings.** Markup unchanged.
- **N/A · Image alternatives, form labels and errors.** No images or forms change.
- **PASS · Keyboard and focus.** The line is not focusable; no focus behavior changes.
- **PASS, with limits · Contrast and touch targets.** Colour and size are unchanged. Muted text on the panel is 7.6:1 at 14px; this rests on unchanged tokens, not a new measurement. Text wrapping does not change contrast.
- **UNVERIFIED · 200% text zoom and reduced motion.** Not checked by this subagent. The change has no motion.
- **PASS · Widths.** Checked by the coordinating session on this branch in Chromium: 320px (two even lines of 116px and 117px, "The Superhuman" / "Group LLC · 2026"), 390px (one line, 236px) and 1280px (one line, 236px). Computed `text-wrap` is `balance` at all three.
- **PASS · No horizontal overflow** at 320px, 390px and 1280px (document width equals viewport width).
- **UNVERIFIED · Second browser engine, a real phone, and a browser without `text-wrap: balance`.** Not checked.

## 4. Performance and resilience

- **N/A · Images, client code, dependencies, fonts.** One CSS property; no new asset, script or dependency.
- **N/A · 404 and redirects.** No route, header, redirect, host or cache change.
- **UNVERIFIED · Measured performance.** Not measured. The change is not expected to affect it.

## 5. Forms and sensitive flows

- **N/A.** No form, endpoint or approval flow changes.

## 6. Privacy, legal and measurement

- **N/A.** No data, storage, cookie, analytics or processor changes. The company name and year line is unchanged in content.

## 7. Release and final QA

- **PASS · Type, test, format and build checks.** See Evidence: `pnpm run check`, `pnpm test`, `pnpm run format:check`, `pnpm run design:check` and `pnpm run build` pass with the numbers given there.
- **FAIL (pre-existing, not from this change) · Lint.** `pnpm run lint` exits non-zero with 64 findings, all in files this PR does not touch; none is in `src/components/Footer.astro`, the test or the docs. Lint is not a required CI check on `main` at this revision. Open PRs #256 to #258 are the work that removes these findings. The lint-and-format-stack and closing-panel pill-buttons records state their lint findings as facts without a FAIL mark; this record marks them FAIL so lint is not read as passing.
- **PASS · Diff review.** Four files (`git diff --stat origin/main...HEAD`: 4 files changed): `src/components/Footer.astro` (one rule gains `text-wrap: balance`), `tests/components/closing-panel.test.ts` (one test), `design.md` (one sentence on the typography line records the exception, and a November 13 owner-decision entry) and this record. `design.md` was reviewed; this revision narrows its wording after review to the one approved case. No secrets, no dependency changes, no generated files committed. `.jolli/` is untracked and not committed.
- **N/A · Bindings, secrets, migrations.** None change.
- **N/A · HTTPS, host routing, cache behaviour and response headers.** No route, header, redirect, host or cache change.
- **PASS · Rollback version.** `88551410`.
- **UNVERIFIED · Production verification after deploy.** Partly done on 2026-11-13 (see Evidence): the legal line on `https://thesuperhuman.us/work` and on `https://audio.thesuperhuman.us/` at 320px in Chromium, and the 200 and 404 responses named there. Not done: the served revision header, main journeys, sitemap and robots, metadata and OG images, forms, monitoring, and a quiet-footer page.
- **PASS · Receipt and evidence.** This record. Status: implemented; tests, typecheck and build pass locally; the rendering on this branch was viewed locally in Chromium at 320px, 390px and 1280px; CI checks succeeded on the final head; deployed (merged 2026-11-13 20:27:49 UTC as `c786f38b`, production build succeeded); verified live in part (the 320px legal line check above, Chromium only); other browsers, a real phone and the rest of the post-deployment check are not checked.

## 8. Private owner center

- **N/A.** Not affected.

## Remaining work

- Done: CI green on the final head `34c2a16a`, and Greptile and Codex reviews with no findings (see Evidence).
- A second browser engine, a real phone, a browser without `text-wrap: balance` support and 200% text size at the time of this PR (UNVERIFIED above; a later PR, #263, addressed enlarged text in the closing panel).
- The rest of the production check (section 7): served revision header, main journeys, sitemap and robots, metadata and OG images, forms, monitoring. UNVERIFIED.
- The branch preview is behind Cloudflare Access, so the coordinating session could not open it.
- Note for design: `design.md` says "Headings balance; prose wraps `pretty`". The legal line is a paragraph, not a heading, and is now balanced. The owner approved this. `design.md` now records the one exception: the closing panel's LLC line balances (Nov 13 decision). It grants no general permission.
