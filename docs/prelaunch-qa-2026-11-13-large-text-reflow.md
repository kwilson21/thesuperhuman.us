# Large text reflow release gate (Work page and closing button)

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/large-text-reflow`, merged with `origin/main` (a merge commit, never a rebase)
Commits: `06c52fd1`, `0878fce9`, `d7c8317e` (reverted `0878fce9`) and `b8f74bd3` from the earlier work; then `11ceb0c9` (merge of `origin/main` at `57e26842`, with the design note), `5077befc` (button wrap query and padding), `0737ea2e` (browser check and tests), `2dca2376` (the first record), `b85f77a8` (the record's commit list), `415ff8e3` (merge of `origin/main` at `7de68720`), and `0d2a90b8` (this revision: the closing buttons, the Work page text, the browser check's width sweep, the workflow path, the documents). The release record itself is in the commit that adds it
Pull request: [#263](https://github.com/kwilson21/thesuperhuman.us/pull/263)
Target: production `https://thesuperhuman.us` after merge. The shared footer also renders on `audio.thesuperhuman.us`.
Reviewers: Claude Haiku 5.5 subagent (implementation, test first). The independent reviews listed under Evidence and limits were run on commit `b8f74bd3` and `b85f77a8`, before the revision recorded here. Revision `0d2a90b8` has not been independently reviewed.
Rollback revision: `7de68720`, `origin/main`'s tip at the time this branch merged it (`origin/main` still points there after `git fetch origin`). The earlier rollback point was `57e26842`. The PR adds no migration and writes no stored data.

## Scope

- `src/pages/work.astro`: the single-column story track may shrink below its widest child (`minmax(0, 1fr)`, and `minmax(0, ...)` in the two-column grid). Long words in the lede, the work evidence, the story text, the experience headings and the list items break only when they cannot fit a line (`overflow-wrap: break-word`). The Work evidence link's flex row may wrap, so its arrow can go to its own line.
- `src/components/WorkDiagram.astro`: the diagram flow wraps by content (`flex-wrap: wrap`, parts share a row 1 : 1.2), and timeline and phase text may break inside a word only when the word cannot fit a line.
- `src/components/Footer.astro`: the closing panel's side padding is `min(1.25rem, 6.25vw)` at 600px wide and below. The large "Get in touch" button and the pinned contact button (both `.site-button-large`) may wrap their label at any width when it does not fit, in the footer's own scoped style. The label, arrow, button and pinned button stay inside their boxes.
- `src/components/SiteNav.astro`: the header name (`.site-name`) may wrap between its words when the row is too narrow, so at 320px the name no longer pushes the menu button off the edge. At the default text size it stays on one line at every width, measured below.
- `src/styles/global.css`: `.site-button-large` padding, `min(1.75rem, 8.75vw)`, and `overflow-wrap: break-word` on `.page-lede` (every page's lede, when a word cannot fit its line). The `.site-button` wrap query stays at `@media (max-width: 380px)`, as on `main`.
- `design.md`: the layout paragraph for the Work diagram and the viewport-capped paddings ("at the default text size" added), the button rule's second exception (the two closing-panel buttons), and the owner-decision line on the arrow beside "the wrapped label".
- `docs/design-concepts/2026-11-12/button-inventory.md`: the two closing-panel buttons added to the stated `nowrap` exceptions.
- Tests: `tests/components/large-text-reflow.test.ts`, `tests/components/pill-buttons.test.ts` (one assertion for the large button's padding), `tests/components/closing-panel.test.ts` (one assertion for the footer padding), `tests/scripts/screenshots.test.ts` (the workflow runs on `tests/browser/**`), and `tests/browser/text-scale.cjs` (the browser check, now at six widths).
- `.github/workflows/screenshots.yml`: one step, "Check large text reflow", after the personal name check. It runs the browser check against the same preview and writes its failure screenshot to the `_failure-*` artifact. `tests/browser/**` is now in both the `pull_request` and the `push` path lists, so a change to only the browser checks runs the workflow.

No copy, route, binding, migration or dependency change. The header changes only in that its name may wrap when it cannot fit, which does not happen at the default text size. Nothing changes at the default text size from 320px wide up (measured below).

## Owner decisions

- On 2026-11-13, in conversation: fix the large-text problems with "whichever is more performant" (no media queries that follow text size, no scripts).
- On 2026-11-13, in conversation, from two renders: the closing button's arrow stays centred beside a wrapped label ("1 for sure"). The design note now says "the wrapped label, however many lines it takes", because at 320px with a 200% root the label takes three lines. The decision itself is unchanged.
- Recorded in `design.md` under "Owner decisions (November 13, 2026)".

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1, pnpm from the repository lockfile, Chromium through Playwright. Enlarged text was emulated by setting the root font size to 200% (`document.documentElement.style.fontSize`), because the site pins `html { font-size: 16px }`; this stands in for text-only zoom and is not the same thing. External requests were blocked, so fonts fell back to local fonts in every run below.

### Ten widths on `/work` at a 200% root (`document.documentElement.scrollWidth`)

| Width (px) | Before (`415ff8e3`) | After (`0d2a90b8`) |
| --- | --- | --- |
| 320 | 369 | 320 |
| 340 | 369 | 340 |
| 360 | 369 | 360 |
| 375 | 375 | 375 |
| 381 | 416 | 381 |
| 390 | 418 | 390 |
| 393 | 418 | 393 |
| 400 | 419 | 400 |
| 414 | 421 | 414 |
| 430 | 430 | 430 |

After: no element or text run on `/work` extends past the viewport at any of the ten widths.

The two diagram flows at 375px with a 200% root, as recorded in the earlier single-width check (the browser check confirms the stacking and no overflow at 375px in this revision): flow 1 is the Before flow: "Support" (1 line, 162px wide), arrow beside it, "On-call engineer" (2 lines, 209px wide, on its own row), stacked; flow 2 is the After flow: "Support" (1 line), arrow beside it, "Self-service" (1 line, below), stacked. No diagram part overflows its box. Before, the causes were:

- 320 to 360px: the lede's and the Work evidence's long words, the story headings and list items (`overflow-wrap` was not set), and the header name (`white-space: nowrap`, 297px at 48px wide).
- 381 to 414px: the closing panel's large button label (`.site-button` is `nowrap` above 380px), which made the panel's grid track as wide as the label. The footer nav did not overflow once the button could wrap.

The closing label takes 3 lines at 320px with a 200% root and 2 lines from 360px. The label, arrow, button and the pinned contact button stay inside their boxes at all six widths the browser check covers.

Not changed, by design: the global `.site-button` rule and its `@media (max-width: 380px)` query, and every button other than the two closing-panel buttons.

### Default text size (no zoom)

- Twelve full-page screenshots at 320, 390 and 1280px wide (device scale factor 2) of `/work`, `/`, `/about` and `/services`, compared pixel for pixel: identical to `origin/main` (`7de68720`) and to the previous revision (`415ff8e3`). One capture of `/services` at 320px in the first run of the previous revision showed an empty image box; a second capture of that baseline showed the image, and the comparison was then identical. That was a lazy-load timing artifact, not a layout difference. The Work diagram's flow is pixel-identical too, so no sub-pixel difference was seen there.
- A sweep from 320 to 1440px in steps of 20 on `/work` and `/`, recording each box and its line count: for `/work`, the closing button, the pinned contact button, the six footer nav links, the header's four children and the lede; for `/`, the footer nav links and the header's children (the home page has no closing invitation or lede). Largest movement against `origin/main` and against `415ff8e3`: 0.000px. No line count changed.

### Browser check `tests/browser/text-scale.cjs`

Run against the preview on 127.0.0.1:4324 (`MUSIC_PREVIEW_CONFIG=.screenshots/wrangler.json`, the dev config).

- Final tree (`0d2a90b8`, after formatting): `text scale browser checks: PASS`.
- Mutant, Footer's wrap rule removed (`.closing-panel .site-button-large, .pinned-contact .site-button-large` line deleted from `Footer.astro`): exit 1, `AssertionError: /work scrolls sideways at 390px with a 200% root: scrollWidth 418`. The file was restored and confirmed identical with `cmp`; `git diff` for `Footer.astro` against the commit is empty.
- Earlier mutants (run on the code before this revision, when the check covered one width, 375px): flow kept on one row (`flex-wrap: nowrap` in `WorkDiagram.astro`): FAIL on sideways scroll at 375px (scrollWidth 462), with the stacked check failing behind it ("a diagram flow does not stack at 200%"); `origin/main` grid rules restored in `work.astro`: FAIL on sideways scroll (scrollWidth 437). Each file was restored byte for byte and confirmed with `cmp`.
- Mutants run by an independent Claude Opus reviewer against the browser check on head `b85f77a8`, 2026-11-13. All failed as they should:
  - one row with squeezed split words: "does not stack";
  - `nowrap` with hidden overflow: "does not stack";
  - old grid: scrollWidth 462;
  - old grid plus old story track: scrollWidth 497;
  - `word-break: break-all` on the timeline: split words;
  - flow always stacked: fails the one-row check at 390px;
  - uncapped paddings: label takes three lines;
  - `.site-button` `nowrap`: scrollWidth 416.

The same review confirmed the merge of `origin/main`, and that the workflow step is sound. It said `global.css` differs from `main` only in the large button's padding. That was true at `b85f77a8`; this revision also adds `overflow-wrap: break-word` to `.page-lede`, so it no longer holds at `0d2a90b8`. The review asked for the corrections made in this revision (the rem query at 380px, the browser check's stacked and split-word logic, and the test fixes), which are in place.

Checks on the final tree (`0d2a90b8`):

- `pnpm test`: 269 files, 12,035 passed, 3 skipped.
- `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm run design:check`: 6 Hallmark gates, 12 allowlisted exceptions, passed.
- `pnpm run build`: exit 0, "Complete!".
- `pnpm run format` then `format:check`: passes.
- `pnpm run lint`: 60 findings, all in files this change does not touch (see section 7). None in `Footer.astro`, `SiteNav.astro`, `work.astro`, `global.css`, `WorkDiagram.astro`, `text-scale.cjs` or the two test files changed here.

Independent reviews on commit `b8f74bd3`, 2026-11-13:

- Claude Opus correctness review: at the default text size, a sweep of `/work` and `/services` from 300px to 1440px wide in steps of 20 (plus the widths around 320, 380, 400, 600 and 800) against the old rules found no element moving more than 0.016px from 320px up, and no flow wrapping at any width. The `min()` paddings equal the old values at 320px and above; below 320px only the large button's padding shrinks (3.5px at 300px). Two should-fix items, both fixed in the later revisions: the rem wrap query (restored to 380px) and the browser check's stacked and split-word logic.
- Claude Sonnet design and rules review with a read-only Hallmark audit from source and renders: no defect. Set aside, per `docs/design-standard.md`: the two-line clickable text finding (a recorded reflow exception and the owner's choice) and the stamp findings. Design choices noted for the owner and unchanged: the arrow after "Support" still points right when the next part stacks below it, and "After ·" can end a line with the dot dangling.

UNVERIFIED until checked:

- Revision `0d2a90b8` has not been independently reviewed.
- Firefox and Safari text-only zoom, a second browser engine, a real phone, and text sizes above 200%. Only Chromium with a doubled root was run.
- Widths between the ten measured (for example 300px, 330px or 440px) and text sizes between 200% and above were not swept at 200%; the sweep at the default size covers 320 to 1440px.
- "Automating" in a timeline heading on `/work` split inside the word in the earlier repro, because it cannot fit a line of its own at 200%. The browser check counts this as allowed, by its rule. A shorter heading or a smaller size would avoid it; this is not changed.
- Other pages are out of scope and were not re-measured in this revision. In the earlier repro they still scrolled sideways: `/audio` 538px, `/audio/services` 502px, `/services` 453px outside the diagram, `/writing` 400px, measured at 375px.
- The header's desktop navigation overflowed at 1024px and 1280px in the earlier repro. Out of scope, not re-measured here.
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
- **PASS · Widths.** At the default text size, the sweep from 320px to 1440px in steps of 20 found no box movement and no line change (see Evidence). At a 200% root, `/work` has no sideways scroll at 320, 340, 360, 375, 381, 390, 393, 400, 414 or 430px. The browser check covers 320, 360, 375, 390, 414 and 430px: closing label at most three lines at 320px and two from 360px, label and arrow inside the button, button inside the panel, pinned button inside the viewport, both flows stacked, no split words.
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

- **PASS · Type, test, format and build checks.** `pnpm test` (269 files, 12,035 passed, 3 skipped), `pnpm run check` (0 errors, 0 warnings, 17 hints), `pnpm run design:check`, `pnpm run format:check` and `pnpm run build` all pass on the final tree (`0d2a90b8`).
- **FAIL (pre-existing, not from this change) · Lint.** `pnpm run lint` exits non-zero with 60 findings, all `anti-slop` rules, in these directories: `src/lib` (29), `src/lib/publication` (4), `src/components/owner` (1), `src/pages/owner/requests` (1), `tests/api` (16), `tests/lib` (3), `tests/scripts` (5), and `tests/middleware.test.ts` (1, top-level `tests`). None is in a file this change touches. The count was 64 before the merge of `origin/main` at `7de68720`. The same kind of findings are recorded in `docs/prelaunch-qa-2026-11-13-closing-legal-balance.md`; they are not fixed here.
- **PASS · Diff review.** `git diff --stat origin/main` lists only the scope above. No secrets, no dependency changes, no generated files committed. `.jolli/` is untracked and `.screenshots/` is gitignored; neither is committed.
- **N/A · Bindings, secrets, migrations.** None change.
- **N/A · HTTPS, host routing, cache behaviour and response headers.** No route, header, redirect, host or cache change.
- **PASS · Rollback version.** `origin/main`'s tip at the time this branch merged it, `7de68720` (see the header).
- **UNVERIFIED · Production verification after deploy.** To be done after an authorized merge: `/work` and the closing panel at 320px and 375px, with enlarged text, and the footer on an audio host page.
- **PASS · Receipt and evidence.** This record. Status: implemented in `0d2a90b8`; tests, typecheck, design check, lint (with the pre-existing findings above) and build pass locally; `/work` was measured at ten widths with a 200% root in Chromium, and the default size was compared with pixel and box checks; other browsers, a real phone and text above 200% are not checked; not deployed; not verified live. The Screenshots workflow's new step and its new path run in CI on the PR.

## 8. Private owner center

- **N/A.** Not affected.

## Remaining work

- A fresh independent review of `0d2a90b8` (correctness and security, and UI, copy and rules), since the reviews above ran on earlier heads.
- Open the ready-for-review PR against `main`; CI green on the final head; Greptile and Codex reviews on the head.
- The browser check in CI (the new "Check large text reflow" step) must pass on the PR.
- Firefox, Safari, a real phone, and text above 200% (UNVERIFIED above).
- Owner decision on the remaining design choices: the arrow after "Support" when the next part stacks below, and the "After ·" dot at a line end.
- Production check after an authorized merge (section 7). Merging deploys production.
