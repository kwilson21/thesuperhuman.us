# Large text reflow release gate (Work page and closing button)

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/large-text-reflow`, merged with `origin/main` (a merge commit, never a rebase)
Commits: `06c52fd1`, `0878fce9`, `d7c8317e` (reverted `0878fce9`) and `b8f74bd3` from the earlier work; then `11ceb0c9` (merge of `origin/main` at `57e26842`), `5077befc` (button wrap query and padding), `0737ea2e` (browser check and tests), `42b99363` (design note) and this record's commit
Pull request: to be opened against `main` from this branch
Target: production `https://thesuperhuman.us` after merge. The shared footer also renders on `audio.thesuperhuman.us`.
Reviewers: Claude Haiku 5.5 subagent (implementation, test first). The independent reviews listed under Evidence and limits were run on commit `b8f74bd3`, before the revision recorded here. This revision has not been independently reviewed yet.
Rollback revision: `57e26842` (`origin/main` when this branch merged it). The PR adds no migration and writes no stored data.

## Scope

- `src/pages/work.astro`: the single-column story track may shrink below its widest child (`minmax(0, 1fr)`, and `minmax(0, ...)` in the two-column grid).
- `src/components/WorkDiagram.astro`: the diagram flow wraps by content (`flex-wrap: wrap`, parts share a row 1 : 1.2), and timeline and phase text may break inside a word only when the word cannot fit a line.
- `src/components/Footer.astro`: the closing panel's side padding is `min(1.25rem, 6.25vw)` at 600px wide and below.
- `src/styles/global.css`: `.site-button-large` padding only, `min(1.75rem, 8.75vw)`. The `.site-button` wrap query stays at `@media (max-width: 380px)`, as on `main`.
- `design.md`: one layout paragraph for the Work diagram and the viewport-capped paddings, and one owner-decision line.
- Tests: `tests/components/large-text-reflow.test.ts`, `tests/components/pill-buttons.test.ts` (one assertion for the large button's padding), `tests/components/closing-panel.test.ts` (one assertion for the footer padding), and `tests/browser/text-scale.cjs` (new browser check).
- `.github/workflows/screenshots.yml`: one step, "Check large text reflow", after the personal name check. It runs the browser check against the same preview and writes its failure screenshot to the `_failure-*` artifact.

No copy, route, header, binding, migration or dependency change. Nothing changes at the default text size from 320px wide up.

## Owner decisions

- On 2026-11-13, in conversation: fix the large-text problems with "whichever is more performant" (no media queries that follow text size, no scripts).
- On 2026-11-13, in conversation, from two renders: the closing button's arrow stays centred beside a two-line label ("1 for sure").
- Recorded in `design.md` under "Owner decisions (November 13, 2026)".

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1, pnpm from the repository lockfile, Chromium through Playwright. Enlarged text was emulated by setting the root font size to 200% (`document.documentElement.style.fontSize`), because the site pins `html { font-size: 16px }`; this stands in for text-only zoom and is not the same thing.

Before (earlier repro on this branch, same 375px viewport and 200% root): document 497px wide, closing label three lines, diagram cut off.

After (this revision, 375px viewport, 200% root, device scale factor 2):

- `scrollWidth` 375, `innerWidth` 375: no sideways scroll.
- Closing button label: 2 lines ("Get in" / "touch", arrow centred beside them). Button box 232px wide, 132px tall.
- Diagram flow 1 (before and after): "Support" (1 line, 162px wide), arrow beside it, "On-call engineer" (2 lines, 209px wide, on its own row). Stacked by the corrected definition (the last text part starts at or below the bottom of the first text part): yes.
- Diagram flow 2: "Support" (1 line), arrow beside it, "Self-service" (1 line, below). Stacked: yes.
- No diagram part overflows its box.
- Renders: `.screenshots/large-text-after-work.png` (the Work diagram at 200%, stacked, with the pinned contact pill covering the bottom edge in this viewport capture, as it does by design) and `.screenshots/large-text-after-button.png` (the closing panel at 200%, label on two lines). The diagram render was taken with requests to Google Fonts aborted, so Inter and JetBrains Mono fell back to local fonts in that capture. The closing panel render was taken in an earlier run that did not block font requests.

Browser check `tests/browser/text-scale.cjs` (run against the preview on 127.0.0.1:4324):

- Run against the branch: PASS (`text scale browser checks: PASS`).
- Mutant, flow kept on one row (`flex-wrap: nowrap` in `WorkDiagram.astro`): FAIL on sideways scroll at 375px with a 200% root (scrollWidth 462). The scroll check was bypassed in a scratch copy to reach the stacked check, which then FAILED: "a diagram flow does not stack at 200%".
- Mutant, `origin/main` grid rules restored in `work.astro`: FAIL on sideways scroll (scrollWidth 437).
- Each mutant file was restored byte for byte and confirmed with `cmp`. Afterwards `git diff` shows no change to `WorkDiagram.astro` (its branch version is the committed one).

Checks on the final tree:

- `pnpm test`: 265 files, 11,994 passed, 1 skipped.
- `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm run design:check`: 6 Hallmark gates, 12 allowlisted exceptions, passed.
- `pnpm run build`: exit 0, "Complete!".
- `pnpm run format` then `format:check`: format and two whitespace-only lint fixes in the browser check. The browser check was run again on the final file: PASS. The two mutant runs above were made before those whitespace-only edits.

Independent reviews on commit `b8f74bd3`, 2026-11-13:

- Claude Opus correctness review: at the default text size, a sweep of `/work` and `/services` from 300px to 1440px wide in steps of 20 (plus the widths around 320, 380, 400, 600 and 800) against the old rules found no element moving more than 0.016px from 320px up, and no flow wrapping at any width. The `min()` paddings equal the old values at 320px and above; below 320px only the large button's padding shrinks (3.5px at 300px). Two should-fix items, both fixed in this revision: the rem wrap query (restored to 380px) and the browser check's stacked and split-word logic.
- Claude Sonnet design and rules review with a read-only Hallmark audit from source and renders: no defect. Set aside, per `docs/design-standard.md`: the two-line clickable text finding (a recorded reflow exception and the owner's choice) and the stamp findings. Design choices noted for the owner and unchanged: the arrow after "Support" still points right when the next part stacks below it, and "After ·" can end a line with the dot dangling. Asked for the test fixes made in this revision.

UNVERIFIED until checked:

- Firefox and Safari text-only zoom, a second browser engine, a real phone, and text sizes above 200%. Only Chromium with a doubled root was run.
- "Automating" in a timeline heading on `/work` still splits inside the word in the repro, because it cannot fit a line of its own at 200%. The browser check counts this as allowed, by its rule. A shorter heading or a smaller size would avoid it; this is not changed.
- Other pages still scroll sideways in the repro and are out of scope: `/audio` 538px, `/audio/services` 502px, `/services` 453px outside the diagram, `/writing` 400px, measured at 375px.
- The header's desktop navigation overflows at 1024px and 1280px in the repro. Out of scope.
- The site pins `html { font-size: 16px }`, so a visitor's browser default text size does not enlarge the site's text. This is a separate owner decision.
- Production behaviour after an authorized merge.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `origin/main`, merged, with the scope above. Deployment authorization: not given by this record.
- **PASS · Approved design and truthful claims.** The closing button's wrapped label is the owner's choice from two renders. No professional claim, copy or image changes.
- **N/A · Explanatory copy.** No copy changes.
- **N/A · First screen and next step.** Layout only; the first screen and CTA are unchanged at the default text size.
- **PASS · Navigation, footer, contact and links.** Markup is unchanged. The footer's padding changes only at 600px wide and below, with the same values at 320px and above.

## 2. Search and sharing

- **N/A · Titles, descriptions, canonical URLs, Open Graph, icons, robots, sitemap, structured data.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **PASS · Landmarks and headings.** Markup unchanged, except that the diagram's text parts keep their elements.
- **N/A · Image alternatives, form labels and errors.** No images or forms change.
- **PASS · Keyboard and focus.** No focusable element is added or removed.
- **PASS, with limits · Contrast and touch targets.** Colours unchanged. The large button's height and width are unchanged except that its side padding shrinks only below 320px wide (3.5px at 300px).
- **PASS, with limits · 200% text zoom.** Checked in Chromium with a doubled root (see Evidence). Not checked in other engines, and not above 200%.
- **PASS · Widths.** At the default text size, the sweep from 300px to 1440px found no change from 320px up. At 375px with a 200% root: no sideways scroll, closing label two lines, both flows stacked, no part overflowing.
- **PASS, with limits · Reduced motion.** The browser check runs with `reducedMotion: "reduce"`. No motion added.
- **UNVERIFIED · Second browser engine, a real phone, and text-only zoom in Firefox or Safari.** Not checked.

## 4. Performance and resilience

- **N/A · Images, client code, dependencies, fonts.** No new asset, script, dependency or font.
- **N/A · 404 and redirects.** No route, header, redirect, host or cache change.
- **UNVERIFIED · Measured performance.** Not measured. The change is CSS only and is not expected to affect it.

## 5. Forms and sensitive flows

- **N/A.** No form, endpoint or approval flow changes.

## 6. Privacy, legal and measurement

- **N/A.** No data, storage, cookie, analytics or processor changes.

## 7. Release and final QA

- **PASS · Type, test, format and build checks.** `pnpm test` (265 files, 11,994 passed, 1 skipped), `pnpm run check` (0 errors), `pnpm run design:check`, `pnpm run format:check` and `pnpm run build` all pass on the final tree.
- **FAIL (pre-existing, not from this change) · Lint.** `pnpm run lint` exits non-zero with 64 findings in `src/lib/*`, `src/components/owner/*` and `tests/api/*`. None is in a file this change touches. The same findings are recorded as FAIL in `docs/prelaunch-qa-2026-11-13-closing-legal-balance.md`; they are not fixed here.
- **PASS · Diff review.** `git diff --stat origin/main` lists only the scope above. No secrets, no dependency changes, no generated files committed. `.jolli/` is untracked and `.screenshots/` is gitignored; neither is committed.
- **N/A · Bindings, secrets, migrations.** None change.
- **N/A · HTTPS, host routing, cache behaviour and response headers.** No route, header, redirect, host or cache change.
- **PASS · Rollback version.** `origin/main` before the merge of this branch.
- **UNVERIFIED · Production verification after deploy.** To be done after an authorized merge: `/work` and the closing panel at 320px and 375px, with enlarged text, and the footer on an audio host page.
- **PASS · Receipt and evidence.** This record. Status: implemented; tests, typecheck, design check and build pass locally; the Work page and closing panel were rendered and measured locally at 375px with a 200% root in Chromium; other browsers, a real phone and text above 200% are not checked; not deployed; not verified live. The Screenshots workflow's new step runs in CI on the PR.

## 8. Private owner center

- **N/A.** Not affected.

## Remaining work

- Open the ready-for-review PR against `main`; CI green on the final head; Greptile and Codex reviews on the head.
- A fresh review of this revision (correctness and security, and UI, copy and rules), since the two reviews above ran on `b8f74bd3`.
- The browser check in CI (the new "Check large text reflow" step) must pass on the PR.
- Firefox, Safari, a real phone, and text above 200% (UNVERIFIED above).
- Owner decision on the remaining design choices: the arrow after "Support" when the next part stacks below, and the "After ·" dot at a line end.
- Production check after an authorized merge (section 7). Merging deploys production.
