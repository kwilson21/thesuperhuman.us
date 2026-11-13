# Large text reflow release gate (Work page and closing button)

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/large-text-reflow`, merged with `origin/main` (a merge commit, never a rebase)
Commits: `06c52fd1`, `0878fce9`, `d7c8317e` (reverted `0878fce9`) and `b8f74bd3` from the earlier work; then `11ceb0c9` (merge of `origin/main` at `57e26842`, with the design note), `5077befc` (button wrap query and padding), `0737ea2e` (browser check and tests), `2dca2376` (the first record), `b85f77a8` (the record's commit list), `415ff8e3` (merge of `origin/main` at `7de68720`), `0d2a90b8` (the closing buttons, the Work page text, the browser check's width sweep, the workflow path, the documents), and `abe5fe28` (the release record for that revision). This revision, which fixes the failing CI step on `abe5fe28`, is the commit that adds this record, directly after `abe5fe28`
Pull request: [#263](https://github.com/kwilson21/thesuperhuman.us/pull/263)
Target: production `https://thesuperhuman.us` after merge. The shared footer also renders on `audio.thesuperhuman.us`.
Reviewers: Claude Haiku 5.5 subagent (implementation, test first). The independent reviews listed under Evidence and limits ran on `b8f74bd3`, `b85f77a8` and `abe5fe28`. This revision has not been independently reviewed.
Rollback revision: `7de68720`, `origin/main`'s tip at the time this branch merged it (`origin/main` still points there after `git fetch origin`). The earlier rollback point was `57e26842`. The PR adds no migration and writes no stored data.

## CI status

CI run `43520072156` failed on head `abe5fe28` at the new step "Check large text reflow": `the closing button leaves its panel at 320px with a 200% root`. The check measured the button against the panel's border box, and the button overlapped the panel's right padding by 20.4px at 320px. The closing label was also three lines from 320px to 356px. The earlier claims in this record that everything stays inside its box, and that the browser check passes on the final tree, were made before that run and were wrong for `abe5fe28`.

This revision changes the cause: the footer's side gutter is capped by the viewport (see Scope), so the closing panel keeps its content width at enlarged text, and the label is two lines at every width measured from 320px to 430px. The browser check is tightened (see Browser check). Its result on this revision is recorded below; CI has not yet run on this revision.

## Scope

- `src/pages/work.astro`: the single-column story track may shrink below its widest child (`minmax(0, 1fr)`, and `minmax(0, ...)` in the two-column grid). Long words in the lede, the work evidence, the story text, the experience headings and the list items break only when they cannot fit a line (`overflow-wrap: break-word` on `.page-lede`, `.work-evidence` and `.experience-groups`). The Work evidence link's flex row may wrap, so its arrow can go to its own line.
- `src/components/WorkDiagram.astro`: the diagram flow wraps by content (`flex-wrap: wrap`, parts share a row 1 : 1.2), and timeline and phase text may break inside a word only when the word cannot fit a line.
- `src/components/Footer.astro`: three rules, all scoped to the footer.
  - The footer's side gutter is `min(var(--site-gutter), 7.5vw)` on `.compact-footer`. `--site-gutter` is `clamp(1.5rem, 5vw, 3.5rem)`, a rem value that doubles with the text. The cap equals the site gutter from 320px wide up at the default text size (both are 24px at 320px, and the 5vw term takes over above 480px), so nothing changes at the default size from 320px up. At a doubled root the gutter stays at the viewport cap instead of 48px, which gives the closing panel about 48px more width at 320px.
  - The closing panel's side padding is `min(1.25rem, 6.25vw)` at 600px wide and below, as before.
  - The large "Get in touch" button of the closing panel may wrap its label at any width when it does not fit (`.closing-panel .site-button-large { white-space: normal; text-align: center; }`). The pinned contact button has no rule of its own; at 380px and below the global query wraps it, and above 380px its label fits on one line (see Browser check).
- `src/styles/global.css`: `.site-button-large` padding, `min(1.75rem, 8.75vw)`, and `overflow-wrap: break-word` on `.page-lede` (every page's lede, when a word cannot fit its line). The `.site-button` wrap query stays at `@media (max-width: 380px)`, as on `main`.
- `src/components/SiteNav.astro`: the header name (`.site-name`) may wrap between its words when the row is too narrow.
- `design.md`: the layout paragraphs (the closing panel's second wrap exception, the footer gutter cap, and the viewport caps) and the owner-decision line on the arrow. `docs/design-concepts/2026-11-12/button-inventory.md`: the closing panel's large button is the only closing-panel exception; the pinned button follows the global 380px rule.
- Tests: `tests/components/large-text-reflow.test.ts` (including the footer gutter cap and the closing-only wrap rule), `tests/components/pill-buttons.test.ts` (one assertion for the large button's padding), `tests/components/closing-panel.test.ts` (one assertion for the footer padding), `tests/scripts/screenshots.test.ts` (the workflow runs on `tests/browser/**`), and `tests/browser/text-scale.cjs` (the browser check).
- `.github/workflows/screenshots.yml`: one step, "Check large text reflow", after the personal name check. It runs the browser check against the same preview and writes its failure screenshot to the `_failure-*` artifact. `tests/browser/**` is in both the `pull_request` and the `push` path lists.

No copy, route, binding, migration or dependency change. Nothing changes at the default text size from 320px wide up (measured below).

## Owner decisions

- On 2026-11-13, in conversation: fix the large-text problems with "whichever is more performant" (no media queries that follow text size, no scripts).
- On 2026-11-13, in conversation, from two renders: the closing button's arrow stays centred beside its wrapped label ("1 for sure"). The label is two lines at the widths measured below, so the decision is the two-line layout the owner saw. A width where the label needs three lines has not been approved and is an owner decision.
- Recorded in `design.md` under "Owner decisions (November 13, 2026)".

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1, pnpm from the repository lockfile, Chromium through Playwright. Enlarged text was emulated by setting the root font size to 200% (`document.documentElement.style.fontSize`), because the site pins `html { font-size: 16px }`; this stands in for text-only zoom and is not the same thing. External requests were blocked. Only Inter falls back to a local font in these renders; Libron and the name's font are served locally.

### This revision: doubled root, 320 to 430px on `/work` (step 2, every `<details>` open)

Measured on the preview with the footer gutter cap in place. All 56 widths give the same result:

- `scrollWidth` equals the viewport at every width.
- The large button's left and right edges are inside the panel's content box (border box minus padding), with no tolerance needed.
- The label is two lines.
- The button fills the content box at every width (free space 0px on each side), so it is centred. The arrow's vertical centre is 0.8px below the label's vertical centre at every width.

Content box and label at selected widths:

| Width (px) | Content box (px) | Content box width (px) | Label lines |
| --- | --- | --- | --- |
| 320 | 44 to 276 | 232 | 2 |
| 344 | 47.3 to 296.7 | 249.4 | 2 |
| 360 | 49.5 to 310.5 | 261.0 | 2 |
| 390 | 53.6 to 336.4 | 282.8 | 2 |
| 430 | 59.1 to 370.9 | 311.8 | 2 |

Before the fix (`abe5fe28`), the content box at 320px was 68 to 252 (184px), the button overhung the right padding by 20.4px, and the label took three lines from 320 to 356px.

Renders of the closing panel at a doubled root, saved at `.screenshots/closing-200-320.png`, `.screenshots/closing-200-344.png`, `.screenshots/closing-200-360.png` and `.screenshots/closing-200-390.png` (the `.screenshots/` folder is not committed). At each width the label reads "Get in / touch" on two lines, the arrow sits centred beside both lines, and the button spans the panel's content width. The footer links below wrap by their own text, and the legal line wraps as it did before this change.

### Default text size (no zoom), this revision against `abe5fe28`

- Twelve full-page screenshots at 320, 390 and 1280px (device scale factor 2) of `/work`, `/`, `/about` and `/services`: pixel-identical to `abe5fe28`. The comparison restores the old gutter by injected CSS (`padding-inline: var(--site-gutter)` on `.compact-footer`). The earlier revision's record reports the same identity against `origin/main` and `415ff8e3`; this revision did not repeat that comparison.
- A sweep from 320 to 1440px in steps of 20 on `/work`, `/` and `/audio/`, recording the footer, the closing panel, the large button, the legal line, the six footer nav links and the document width: 171 measurements (57 widths on three pages). Largest movement against `abe5fe28`: 0.000px. No line count changed. The large button exists only on `/work` in this sweep; `/` and `/audio/` use the quiet footer.

### Ten widths on `/work` at a 200% root from the earlier revision (`document.documentElement.scrollWidth`)

| Width (px) | Before (`415ff8e3`) | Earlier revision (`0d2a90b8`) |
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

The earlier revision's claim that nothing on the page extended past the viewport at these widths was not borne out: the closing button overlapped its panel at 320 to 348px. The scroll widths above are correct; the box claim is withdrawn.

The two diagram flows at 375px with a 200% root: flow 1 is "Support" (1 line, 162px wide), arrow beside it, "On-call engineer" (2 lines, 209px wide, on its own row), stacked; flow 2 is "Support" (1 line), arrow beside it, "Self-service" (1 line, below), stacked. No diagram part overflows its box. Before, the causes were:

- 320 to 360px: the lede's and the Work evidence's long words, the story headings and list items (`overflow-wrap` was not set), and the header name (`white-space: nowrap`; the name is 297px wide at a 48px font size).
- 381 to 414px: the closing panel's large button label (`.site-button` is `nowrap` above 380px), which made the panel's grid track as wide as the label.

The diagram's part widths differ from the old grid rules by about 0.02px at 320 to 330px. This is not visible, and the diagram's default-size screenshots are pixel-identical.

Widths between the ten above, from the independent review of `abe5fe28` (below): `scrollWidth` equals the viewport at every width from 320 to 430px in steps of 2 with every `<details>` open, and at 480, 600, 768 and 800px. At 1024px and 1280px the page scrolls (1426px and 1463px) because of the desktop navigation and the "Work with me" button. That is out of scope and not changed here.

Not changed, by design: the global `.site-button` rule and its `@media (max-width: 380px)` query, and every button other than the closing panel's large button.

### Browser check `tests/browser/text-scale.cjs`

Run against the preview on 127.0.0.1:4324 (`MUSIC_PREVIEW_CONFIG=.screenshots/wrangler.json`, the dev config). The check covers 320, 360, 375, 390, 414 and 430px at a 200% root. It opens every `<details>` first.

- Closing button: its label, its arrow and the button are inside the button and the panel's content box (border box minus computed padding), with a 0.5px tolerance; the button is centred (left and right free space within 1px); the label is at most two lines at each width.
- Pinned contact button: measured on a page with the `<details>` closed, because with them open the bar is not rendered (observed on this branch; not investigated further here). It must be rendered, and its label must be inside the button's content box with the 0.5px tolerance.
- Split words: checked in the lede, the story text, the experience text, the diagram, and the closing button. A word may break inside itself only when it cannot fit a line of its container. A word that contains a hyphen or dash may break there, because that is a line-break opportunity.
- Sideways scroll, flows stacked, and the pinned button inside the viewport are checked as before.

Results on the final tree:

- `text scale browser checks: PASS`.

Mutants, each restored byte for byte and confirmed with `cmp`:

- Footer gutter cap removed (`padding-inline: min(var(--site-gutter), 7.5vw)` deleted): FAIL, `the closing panel button label takes 3 lines at 320px with a 200% root (limit 2)`.
- `.experience-groups` `overflow-wrap` removed: FAIL, `/work scrolls sideways at 320px with a 200% root: scrollWidth 363`.
- `.selected-story` `overflow-wrap` removed: PASS. The rule was not needed at 320 to 430px and was removed from `work.astro`.
- Pinned contact button's wrap rule (`.pinned-contact .site-button-large { white-space: normal; }`): the rule was not needed. Above 380px its label fits on one line, and at 380px and below the global query wraps it. The rule was removed from `Footer.astro`.
- Global 380px query removed from `global.css` (so the pinned label is `nowrap` at 320px): FAIL, `the pinned contact label leaves its button's content box at 320px with a 200% root`. This is the check that caught the pinned label overflowing its padding. An earlier version of the check read the pinned bar with the details open, where the bar is not rendered, so it passed this mutant without measuring anything.

Earlier mutants from the previous revision and the independent review (run on earlier heads): flow kept on one row: FAIL; `origin/main` grid rules restored: FAIL on sideways scroll (scrollWidth 437, and 462 for the old grid alone); uncapped paddings: label takes three lines; `.site-button` `nowrap`: scrollWidth 416; `word-break: break-all` on the timeline: split words.

### Other reviews

- `abe5fe28`: an independent Claude Opus review, 2026-11-13, swept the widths above and the header. Its findings: `scrollWidth` equals the viewport at 320 to 430px in steps of 2 with every `<details>` open, and at 480, 600, 768 and 800px; at 1024px and 1280px the page scrolls because of the desktop navigation and the "Work with me" button (out of scope). The same review swept the shared header's name from 280 to 1440px in steps of 1 on ten pages: it never wraps and is identical to the old rule (it first wraps at 196px). It found zero differences for the Work-page text rules from 320 to 1440px at the default size. It found the closing-button defect and the check gaps this revision fixes.
- `b8f74bd3`: an independent Claude Opus correctness review, and a Sonnet design and rules review with a read-only Hallmark audit. Set aside, per `docs/design-standard.md`: the two-line clickable text finding (a recorded reflow exception and the owner's choice) and the stamp findings. Design choices noted for the owner and unchanged: the arrow after "Support" still points right when the next part stacks below it, and "After ·" can end a line with the dot dangling.
- `b85f77a8`: an independent Claude Opus run of the browser check's mutants (listed above).

UNVERIFIED until checked:

- This revision (the commit that adds this record) has not been independently reviewed.
- CI on this revision: the "Check large text reflow" step must pass on the PR.
- Firefox and Safari text-only zoom, a second browser engine, a real phone, and text sizes above 200%. Only Chromium with a doubled root was run.
- Widths below 320px. The footer gutter cap is `min(var(--site-gutter), 7.5vw)`, so below 320px the footer's side gutter is smaller than before (21px at 280px instead of 24px). Not measured here beyond the default-size comparison from 320px up.
- Widths above 430px at a 200% root were not swept in this revision; the review's sweep covered 480, 600, 768 and 800px for the document width only.
- "Automating" in a timeline heading on `/work` can split inside the word at 200% because it cannot fit a line of its own. The browser check counts this as allowed by its rule. A shorter heading or a smaller size would avoid it; this is not changed.
- The pinned contact bar is not rendered while the experience `<details>` are open (observed at the default size and at 200%, on this branch). The browser check measures it with the details closed. Whether this matches `origin/main` and whether it is a defect was not investigated.
- Other pages are out of scope and were not re-measured in this revision. In the earlier repro they still scrolled sideways: `/audio` 538px, `/audio/services` 502px, `/services` 453px outside the diagram, `/writing` 400px, measured at 375px.
- The site pins `html { font-size: 16px }`, so a visitor's browser default text size does not enlarge the site's text. This is a separate owner decision.
- Production behaviour after an authorized merge.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `origin/main`, merged, with the scope above. Deployment authorization: not given by this record.
- **PASS · Approved design and truthful claims.** The closing button's wrapped label is the owner's choice from two renders. No professional claim, copy or image changes.
- **N/A · Explanatory copy.** No copy changes.
- **N/A · First screen and next step.** Layout only; the first screen and CTA are unchanged at the default text size.
- **PASS · Navigation, footer, contact and links.** Markup is unchanged. The footer's padding changes only at 600px wide and below, and the gutter cap changes nothing from 320px up at the default size.

## 2. Search and sharing

- **N/A · Titles, descriptions, canonical URLs, Open Graph, icons, robots, sitemap, structured data.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **PASS · Landmarks and headings.** Markup unchanged, except that the diagram's text parts keep their elements.
- **N/A · Image alternatives, form labels and errors.** No images or forms change.
- **PASS · Keyboard and focus.** No focusable element is added or removed.
- **PASS, with limits · Contrast and touch targets.** Colours unchanged. The large button's height is unchanged; its side padding and the footer's gutter shrink only below 320px wide.
- **PASS, with limits · 200% text zoom.** Checked in Chromium with a doubled root (see Evidence). Not checked in other engines, and not above 200%.
- **PASS, with limits · Widths.** At the default text size, the sweep from 320px to 1440px found no box movement and no line change (see Evidence). At a 200% root, `/work` has no sideways scroll from 320 to 430px in steps of 2 (this revision), and the closing label is two lines at each of those widths.
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

- **PASS · Type, test, format and build checks on this revision.** `pnpm test` (269 files, 12,038 passed, 1 skipped), `pnpm run check` (0 errors, 0 warnings, 17 hints), `pnpm run design:check` (6 Hallmark gates, 12 allowlisted exceptions), `pnpm run format:check` and `pnpm run build` (exit 0) pass.
- **FAIL (pre-existing, not from this change) · Lint.** `pnpm run lint` exits non-zero with 60 findings, all `anti-slop` rules, in directories this change does not touch: `src/lib`, `src/lib/publication`, `src/components/owner`, `src/pages/owner/requests`, `tests/api`, `tests/lib`, `tests/scripts`, and `tests/middleware.test.ts`. None is in a file this change touches. Three findings in the browser check's new code were fixed (blank-line spacing) before this count was taken. The same kind of findings are recorded in `docs/prelaunch-qa-2026-11-13-closing-legal-balance.md`; they are not fixed here.
- **PASS · Diff review.** `git diff --stat origin/main` lists only the scope above. No secrets, no dependency changes, no generated files committed. `.jolli/` is untracked and `.screenshots/` is gitignored; neither is committed.
- **N/A · Bindings, secrets, migrations.** None change.
- **N/A · HTTPS, host routing, cache behaviour and response headers.** No route, header, redirect, host or cache change.
- **PASS · Rollback version.** `origin/main`'s tip at the time this branch merged it, `7de68720` (see the header).
- **UNVERIFIED · Production verification after deploy.** To be done after an authorized merge: `/work` and the closing panel at 320px and 375px, with enlarged text, and the footer on an audio host page.
- **PASS · Receipt and evidence.** This record. Status: CI run `43520072156` failed on `abe5fe28`; this revision fixes the cause locally and passes the checks above; the browser check passes on this revision locally; CI has not yet run on this revision; not deployed; not verified live.

## 8. Private owner center

- **N/A.** Not affected.

## Remaining work

- An independent review of this revision (correctness and security, and UI, copy and rules).
- CI green on the PR head with the "Check large text reflow" step passing; Greptile and Codex reviews on the head.
- Firefox, Safari, a real phone, and text above 200% (UNVERIFIED above).
- Owner decisions: the arrow after "Support" when the next part stacks below it, the "After ·" dot at a line end, the three-line case if any width needs it, and whether the pinned bar's disappearance with `<details>` open is a defect.
- Production check after an authorized merge (section 7). Merging deploys production.
