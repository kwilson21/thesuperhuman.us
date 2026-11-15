# Studio menu release gate (Home hero objects)

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/studio-menu`, merged with `origin/main` at `59573d70` and again at `351ce67f` (merge commits, never a rebase)
Pull request: [#291](https://github.com/kwilson21/thesuperhuman.us/pull/291)
Revision: the branch head that carries this record.
Target: production `https://thesuperhuman.us` after merge. Only Home (`/`) changes; `/writing` reads the shared latest-essay constant.
Decisions and merge authorization: Kazon Wilson, in conversation on November 15, 2026 ("looks good to me", then "yes" to merging). Implementation and independent review passes were done with Claude Code.
Rollback revision: `351ce67f`, `origin/main`'s tip when it was last merged into the branch. Re-check `origin/main` at merge time. The PR adds no migration, binding, secret or dependency, and writes no stored data.

## Scope

- `src/components/Hero.astro`: the desk's four objects (monitor, headphones, notebook, controller) are links over their areas of the picture, in the artwork's own pixels. Labels show on hover with a fine pointer or on keyboard focus; touch screens and widths of 800px and below show one-word pins instead. Labels and pins are frosted glass (local `--glass-*` tokens mixed from the site's own), the monitor's pin is dark glass, and where a browser cannot blur the glass is plain paper.
  - Monitor: "What I'm building", `/building`.
  - Headphones: "Hear a mix and master", the newest released song (Home's A/B when it holds that song, otherwise the song's page).
  - Notebook: "What I'm writing", the latest essay.
  - Controller: "Play Kaillera Next", the game itself at `https://kaillera-next.thesuperhuman.us`, marked ↗ as a link that leaves the site.
- `src/components/home/StudioLife.astro`: each object's scene plays when it is pointed at or focused, and a new Combo scene for the controller (the D-pad glints, then the four buttons light in turn). Arrival still plays the three original scenes.
- `src/scripts/studio-objects.ts`: hover, focus, Escape, touch and back-forward cache handling, and the headphones' click into Home's A/B.
- `src/data/writing.ts`, `src/lib/music-catalog.ts` (`latestRelease`, `homeComparisonExample`), `src/pages/index.astro`, `src/pages/writing/index.astro`: shared constants for the latest essay and the newest song.
- `design.md`: Owner decisions (November 15, 2026) and one line under the departures from Hallmark's defaults (frosted glass pills).
- Tests: `tests/scripts/studio-objects.test.ts`, `tests/lib/latest-release.test.ts`, `tests/components/comparison-player.test.ts`. Screenshot scenario `scripts/screenshots/scenarios/studio-objects.mjs` and its mappings.

## Owner decisions

All on November 15, 2026, in conversation and on the private decision pages:
- The objects as a menu, the headphones playing the latest song, the notebook opening the latest essay, the monitor going to `/building`, no headline, and the keyboard order kept.
- Frosted glass for labels and pins ("Frosted glass looks the best but let's improve upon what we have with that"), "Play Kaillera Next", and the Combo scene.
- The controller goes "straight to the game".
- "looks good to me" after the branch preview, then "yes" to merging.

Open, not blocking: the label arrow keeps the accent colour on the glass (about 3.1 to 4.3:1, decorative and `aria-hidden`; design.md keeps accent text at 4.5:1), and the pill corners stay as recorded. Both were put to the owner and left as built.

## Checklist

### 1. Purpose and content
- Project, branch, instructions and authorization: PASS. Branch `claude/studio-menu` of this repository; the owner authorized the merge in conversation.
- Approved design and truthful claims: PASS. Copy is the owner's chosen wording; no new claims. The studio artwork is the existing `studio-v1.webp` (D5.1-A); the Combo draws only glows over it.
- Explanatory copy and resume parity: N/A. No professional claims or resume content change.
- First screen and CTA: PASS. The hero copy and its two links are unchanged; the desk links sit after them in the focus order. Captured at 360, 390, 768 and 1280px.
- Navigation, footer, contact and external links: PASS. Each desk link's destination exists (a test checks the internal pages exist and that the controller's address equals the one the Kaillera Next project page links).

### 2. Search and sharing
- Titles, descriptions, canonicals, Open Graph, icons, robots, sitemap, previews, structured data: N/A. Unchanged by this PR (no head, route or metadata change).

### 3. Accessibility and responsive behavior
- Landmarks and headings: PASS. The links sit in a labelled `nav` ("Around the studio"); the picture and scenes stay `aria-hidden`.
- Image alternatives and control names: PASS. Each link's name is its full label; pins are `aria-hidden` and each is a word of its label (WCAG 2.5.3), checked by a test.
- Keyboard and focus: PASS. Tab reaches each object with the site's 2px focus ring; Escape hides a label (WCAG 1.4.13); no trap. Covered by unit tests and an independent review in Chromium.
- Forms: N/A. No form.
- Contrast, touch targets, zoom, reduced motion: PASS for contrast (text on the glass measured at 11.98:1 or more over the keyboard, 13.2 to 17.1:1 elsewhere; the dark monitor pin 15.7:1) and touch targets (each area at least 44px; tapping a moved pin opens its link). Reduced motion shows finished frames and never plays the Combo. 200% text zoom: UNVERIFIED for this change (labels wrap at 16rem; not measured at a doubled root).
- Widths: PASS at 360, 390, 768 and 1280px locally, and from 801 to 1440px for label placement and 820 to 1180px touch for pin placement in the independent review. 320px: UNVERIFIED for the pins (not captured).
- Second browser and real device: UNVERIFIED. Only Chromium is installed in this environment. `backdrop-filter` has a plain-paper fallback for browsers without it.

### 4. Performance and resilience
- Images: PASS. No new images; the scene is inline SVG.
- Client code: PASS. No new dependency; the browser bundle guard runs in the suite below.
- Measured Web Vitals: UNVERIFIED. Not measured; the change adds CSS, a small SVG group and `backdrop-filter` on hover labels and phone pins.
- Async recovery, missing media, 404 and redirects: N/A. Unchanged.

### 5. Forms and sensitive flows
- N/A. No form, sign-in or approval flow changes.

### 6. Privacy, legal and measurement
- N/A. No data collection, storage, cookie, analytics or processor change. The controller links to the owner's own subdomain.

### 7. Release and final QA
- Type, test, asset and build checks: PASS. See Evidence below.
- Diff review: PASS. Reviewed by independent passes on `557edb81`, `5d54f8ab`, `3ed29108` and `17273b97`; neither merge of `origin/main` brought a conflict. #330's navigation inventory is built from page files and excludes other sites, so the desk links need no entry and the game link is never prefetched.
- Production bindings, headers, cache: N/A. No binding, header or route change.
- Rollback: PASS. `351ce67f` recorded above.
- Live verification after deploy: UNVERIFIED until the deploy; recorded in the pull request once checked.
- Receipt: this record.

### 8. Private owner center, and software agreement signing
- N/A. Not touched.

## Evidence and limits

- Local checks on the merged tree: `pnpm run lint` (0 findings), `pnpm run check` (0 errors), `format:check`, `design:check` and `copy:check` pass. `pnpm run build` succeeds, and the full `pnpm test` with `REQUIRE_CLIENT_BUNDLE=1` (so the browser bundle guard runs against the build) passes: 343 files, 13,931 tests, 1 skipped.
- CI on `3ed29108` and `17273b97` (before the merge of `origin/main`): `validate`, `capture` and `neutrality` succeeded, and the Cloudflare preview built.
- CI screenshots at `3ed29108`: the controller label at 1280px and the phone pins at 390px, checked by eye.
- Independent reviews: one on the glass and the Combo (contrast, tap targets, the hover bridge strip, the translate and the Combo's rest state measured in Chromium against a local preview; 0 critical and 0 major Hallmark findings), one on the tidy-up, and one on the controller link (no internal-link handling, prefetch or navigation policy affected).
- After the second merge of `origin/main` (`351ce67f`): lint, check, format, design and copy checks, `pnpm run build`, and the architecture, script, component, library and page tests with `REQUIRE_CLIENT_BUNDLE=1` pass (147 files, 2,431 tests).
- CI on `89756521`: `validate` failed in `tests/api/studio-signin-noninterference.test.ts` ("a request racing the passing of time"). The test is intermittent on `main` as well (1 failure in 13 local runs at `351ce67f`; 3 in 9 on this branch), it touches only studio sign-in, which this PR does not change, and its failing examples show the order of the sign-in code's clock reads around the test's clock step varying from run to run. A fix is proposed separately; the PR carries no workaround.
- Limits: Chromium only; no real device; no field data.
