# Publishing consent page style release gate

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/publishing-sign-in-style`, from `origin/main` at `fad7694e`
Commits: `6151aa50` (style), `76f3fefb` (golden re-record for the style), then `bcfce0b0` (Libron and `font-src`), `14179d78` (label wrap), `dffc5aeb` (drift test and tap highlight), `64425f34` (design docs), `7eed2599` (golden re-record for Libron), `b9b4f37e` and `c9b1c20c` (format and lint fixes in the test file), `2fbd48ed` (heading size and word breaking, with the golden re-record), `77c047e8` (heading minimum 1.25rem, drift test, golden re-record), `ac16b966` and `be0c3834` (wrong-nonce test and the record), `dae9ea58` (pressed state uses the ink fill instead of opacity, with the golden re-record), and then the document commit that adds this revision.
Pull request: #261 (see the PR description for the link).
Target: production `https://thesuperhuman.us` after merge. The consent page is served by the Astro route `src/pages/api/publication/[...path].ts`, which returns 404 unless the request origin is `https://thesuperhuman.us` (`src/lib/publication/oauth.ts`). Its fonts are static files on the same origin (`public/fonts/libron-v0.25/`). The page is never served on the audio host.
Reviewer: Claude Haiku 5.5 subagent, tests first. The coordinating session owns the review, the browser checks listed as UNVERIFIED, and the deployment decision. This record does not certify them.
Rollback revision: `fad7694e` (`origin/main` when this branch was cut). The PR adds no migration and writes no stored data.
Evidence: the renders and the 320px and 200% measurements were gathered at code commit `77c047e8`. Commit `dae9ea58` changes one style declaration (the pressed state), so the golden comparison and the tests below were re-run at `dae9ea58`. The wrong-nonce test in `be0c3834` adds no production code change.

## Scope

- The publishing consent page's HTML shell and inline CSS in `src/lib/publication/oauth-login.ts`: the page is restyled to match the site, Libron loads from the site's own font files, the button label wraps whenever it does not fit on one line, and the button carries the site's tap highlight. The heading minimum is 1.25rem (`clamp(1.25rem, 8.2vw, 2.5rem)`), so "publishing" does not split at 320px with doubled text.
- Its Content-Security-Policy gains two directives: `style-src 'sha256-…'` (one hash of the inline style block, computed from the constant) and `font-src 'self'`. Nothing else in the policy changes.
- Re-recorded publication golden fixtures (`publication-oauth`, `publication-mcp`, `publication-token`). Their only differences are the consent page body and its CSP header (see Evidence).
- Tests in `tests/lib/publication-login.test.ts`, including a drift test that reads `src/styles/global.css` for the colours, the button's outline and hover fill, the rule line, the pill radius, the button's size, padding and line height, the tap highlight and the font stacks.
- Documents: `design.md`, `docs/design-standard.md`, `docs/design-concepts/2026-11-12/button-inventory.md`, and this record.
- No change to logic, state, cookies, redirects, the form, the nonce or escaping. The page's client name, return address and nonce are still escaped text, and the consent POST is unchanged.

## Owner decisions (2026-11-13, in conversation)

- "Restyle the sign in page but I want to see it": restyle the page to match the site. The owner saw the first render.
- On seeing the first render with fallback fonts: "We should def load libron". This is the reason for the `@font-face` rules and `font-src 'self'`.
- Not yet decided by the owner: the heading minimum change (1.25rem, from this revision). It is a small size change, shown in the 320px large-text render below. Show it to the owner before merge.

## Reviews

- Commits `6151aa50` and `76f3fefb`, reviewed on 2026-11-13 by independent Claude subagents:
  - Opus correctness and security review: no must-fix. The template is identical outside the added markup; the hash equals the served style bytes in every fixture; attacker-influenced values reach only escaped text after the style element; all three golden sets differ only in the consent page body and its CSP header, and each set rebuilt back to the old body with zero mismatches (publication-oauth 53 steps, publication-mcp 60, publication-token 43). One should-fix, label overflow at large text, is fixed in `14179d78`.
  - Sonnet design review: no visual defect; confirmed the colours and button values equal the site's; asked for the drift test and the document changes, which are in this round.
- Independent reviews of head `df3e6606` on 2026-11-13: a Claude Opus security and correctness review was clean (the policy's `font-src 'self'` resolves to `https://thesuperhuman.us` only; both fixed directives precede the request-derived origin; the style hash equals the served style bytes; all three golden sets differ only in the consent page body and its policy header, with zero residual after removing the added markup; 21 of 21 tests pass) and a Claude Sonnet design and rules review found no visual defect and asked for the document fixes made in this revision. This revision's one style change (a smaller heading minimum, for 320px with doubled text) is covered by the measurements below and by the bot reviews on the final head.
- Bot reviews and merge, observed by the coordinating session on GitHub (2026-11-13). On the final head `b898f307`: `validate` succeeded, the Greptile check succeeded, and the Cloudflare build succeeded. Codex's last full review was of `be0c3834` ("no major issues" in its code review; no security issues). Codex did not review the final two commits: `dae9ea58` (the pressed-state fill and golden re-record) and `b898f307` (the record update). Those two commits are covered by the local tests and golden comparison in Evidence, not by a Codex review.
- Review threads left for the owner, resolved on his go-ahead:
  - Codex suggested sending no referrer from this page. Not changed: under `no-referrer` the consent POST's Origin header would be `null` and the page's origin check would refuse it. The font requests go only to the same origin that already received the authorization URL.
  - Codex asked for a CI screenshot. Not done: the consent route answers only for the hard-coded production origin, so the local preview cannot reach it, and making that origin configurable is a separate owner decision (see Screenshot capture).
- The owner authorized merging in conversation on 2026-11-13 ("#261 is good to go"), having been told that the page has local renders only and that capturing it in CI needs a separate decision. Merged 2026-11-13 21:42:57 UTC as `57e26842`. The production build succeeded.

## Hallmark audit

- A first read-only Hallmark audit covered the first two commits (`6151aa50`, `76f3fefb`) and found no defect. A second read-only Hallmark audit by an independent Claude Sonnet reviewer covered head `df3e6606` from the source and five renders (desktop, phone, focus, 320px, 200% text). It found no visual defect. It found two document defects, both fixed in this revision (the `design.md` one-line button rule now records this page's exception, and the large-text render is now captured full page). It set aside the raw-hex, zero-chroma, two-line-button, `overflow-wrap`, `disabled` and stamp findings for the reasons in `docs/design-standard.md`. It sent these to the owner as design choices, unchanged here: the heading sitting on two lines on desktop, the 13px sans cancel note, whether the return address should be set in ink, and the bold client name. Not run: the structural fingerprint (not applicable), and any check in a real browser other than Chromium, on a device or in forced-colors mode.
- Result: PASS, with limits.

## Contrast (from the first review, unchanged in this round)

Body text 18.21:1, muted text 8.36:1, button label on accent 4.78:1, focus ring 4.78:1. The colours have not changed since the first audit.

## Evidence

Local runs on macOS arm64, Node 26.13.1, pnpm, on code commit `77c047e8`:

- Test first: the h1 clamp assertion was changed to `1.25rem` and failed on the old value (`clamp(1.5rem …)`), then passed after the one-line change. The drift test and the test rename were added and pass. Final: `tests/lib/publication-login.test.ts`, 22 of 22 at `77c047e8`; 23 of 23 after the wrong-nonce test added in this revision.
- `pnpm test`: 264 files, 11,988 passed, 1 skipped.
- `pnpm run format`: no fixes, 693 files. `pnpm run format:check`: no fixes, 693 files.
- `pnpm run lint`: FAIL (pre-existing, not from this change). 64 findings, none in a file this PR touches (`src/lib/publication/oauth-login.ts`, `tests/lib/publication-login.test.ts`, `design.md`, `docs/design-standard.md`, `docs/design-concepts/2026-11-12/button-inventory.md`).
- `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm run design:check`: passed, 6 gates, 12 allowlisted exceptions.
- `pnpm run build`: exit 0, "Complete!". The built worker contains the Libron font path.
- Golden fixtures: `UPDATE_GOLDEN=1` run once per file on `dae9ea58` (the pressed-state change, which changes the style bytes and so the `style-src` hash); `pnpm exec vitest run` on the three files passed (229 of 229). The golden comparison below uses `node scripts/golden-diff.mjs diff <set> origin/main`. A residual check parses each fixture, takes every consent body against its `origin/main` counterpart, removes the `style` block, the `<meta name="color-scheme">` and the `class` attributes, and compares what is left:
  - publication-oauth: 124 cases; 53 cases differ, all in the consent step; every differing path is `body` or `headers.content-security-policy`; consent bodies compared: 53; residual: 0.
  - publication-mcp: 60 cases; 60 cases differ; every differing path is `body` or `headers.content-security-policy`; consent bodies compared: 60; residual: 0.
  - publication-token: 42 cases; 42 cases differ, 43 consent steps in total (one case has two consent steps); every differing path is `body` or `headers.content-security-policy`; consent bodies compared: 43; residual: 0.
- Renders, from the page HTML and its real CSP header, served from the Astro dev server on `127.0.0.1:4323` (the screenshots config, which serves the same-origin fonts), with requests to other hosts blocked, at device scale factor 2. Files are in the gitignored `.screenshots/` folder and are not attached:
  - `.screenshots/sign-in-desktop.png` (1280x800)
  - `.screenshots/sign-in-phone.png` (390x844)
  - `.screenshots/sign-in-focus.png` (1280 wide, button focused with Tab)
  - `.screenshots/sign-in-320.png` (320 wide)
  - `.screenshots/sign-in-large-text.png` (390 wide, root font size 200%, full page)
  - `.screenshots/sign-in-320-large-text.png` (320 wide, root font size 200%, full page)
- Fonts under the real policy: `document.fonts` reports `Libron 400 loaded` and `Libron 700 loaded` in every case; the `h1` computed `font-family` starts with `Libron`; `strong` computes to weight 700. The two files are 80,848 and 82,328 bytes.
- Console errors: none. CSP violations: none. Blocked external requests: none (0 in every case).
- Horizontal overflow (`documentElement.scrollWidth` against `clientWidth`): 320 wide 320/320; 390 wide 390/390; 390 wide with 200% root 390/390; 320 wide with 200% root 320/320.
- Noindex: the consent response carries no `X-Robots-Tag` header and no robots `meta` (`src/lib/publication/oauth-login.ts`; the route file does not add one). It renders only for a valid authorization request (client, PKCE, scope and resource are checked first), so a plain crawl cannot reach it. See Remaining work.

## Heading fit and button label at large text (measured at `77c047e8`)

Measured in Chromium with the root font size set through `document.documentElement.style.fontSize` (not the browser's own text size setting). Lines are read from the rendered characters, and a mid-word break is two adjacent letters on different lines.

| Case | h1 font size | h1 lines (rendered) | h1 mid-word break | scrollWidth / clientWidth |
| --- | --- | --- | --- | --- |
| 1280px, default root | 40px | "Connect project" / "publishing" (2) | none | 1280 / 1280 |
| 320px, default root | 26.24px | "Connect project" / "publishing" (2) | none | 320 / 320 |
| 390px, default root | 31.98px | "Connect project" / "publishing" (2) | none | 390 / 390 |
| 390px, root 200% | 40px | "Connect" / "project" / "publishing" (3) | none | 390 / 390 |
| 320px, root 200% | 40px | "Connect" / "project" / "publishing" (3) | none | 320 / 320 |

At 200% the h1 is 40px, the 1.25rem minimum at a 32px root. Before this revision the minimum was 1.5rem (48px at 200%), and at 320px with 200% text the word "publishing" did not fit its 224px column.

| Case | Button label lines (rendered) | Button box (w x h, css px) | Label box inside the rounded outline | Button border radius | Label mid-word break |
| --- | --- | --- | --- | --- | --- |
| 320px, default root | "Allow and sign in with" / "GitHub" (2) | 272 x 64.4 | yes (4 corners) | 999px | none |
| 390px, default root | "Allow and sign in with GitHub" (1) | 281.8 x 44 | yes (4 corners) | 999px | none |
| 390px, root 200% | "Allow and" / "sign in with" / "GitHub" (3) | 294 x 171.6 | yes (4 corners) | 999px | none |
| 320px, root 200% | "Allow" / "and" / "sign in" / "with" / "GitHub" (5) | 224 x 261.2 | yes (4 corners) | 999px | none |

The inside check compares the label's four corners with the button's rounded outline (radius clamped to half the button's smaller side, so the pill's ends are half-circles).

Body text: at 320px with 200% text, the domain in the body paragraph breaks inside "thesuperhuman.us" ("thesuperhum" / "an.us."), because the token is wider than the column and `main` uses `overflow-wrap: break-word`. At 390px with 200% text the full stop of the same domain sits alone on its own line. The heading and button measurements above do not cover body text. This is recorded under Remaining work for the owner to decide, and it is not changed in this revision.

What the renders show (each read as an image):

- `sign-in-320-large-text.png` (320px, 200%, full page): the title sits on three lines, "Connect / project / publishing", with no word split. The body copy wraps to many short lines, and the domain breaks as described above. The return address is on three lines. The button is a tall pill (224 x 261) with the label on five lines, all inside the rounded outline. The button sits below the return address, and "Close this page to cancel." is under it. Nothing is cut off, and no text runs past the column.
- `sign-in-large-text.png` (390px, 200%, full page): the title on three lines, the button a tall pill (294 x 172) with the label on three lines, inside the outline. The domain's full stop is on its own line in the body.
- `sign-in-320.png` (320px): the title on two lines, "Connect project" / "publishing". The button is a two-line pill, 272 wide, and the label is complete.
- `sign-in-phone.png` (390px): the title on two lines. The one-line button sits in the column, and the cancel note is below it.
- `sign-in-desktop.png` (1280px): the title on two lines (a design choice the Hallmark reviewer raised, unchanged), the button on one line, the cancel note below.
- `sign-in-focus.png` (1280px): the button with the 2px accent focus ring after one Tab press; the focused element is the BUTTON.

## Pressed state (`dae9ea58`)

The button's `:active` rule was `opacity: .78`, copied from the site's `.site-button:active`. At that opacity the label's contrast on the paper background drops to about 3.24:1. The rule is now `background: #0E0E0E; border-color: #0E0E0E`, the same ink fill and border the hover state uses (label on ink 18.21:1). The site's own `.site-button` is unchanged. `tests/lib/publication-login.test.ts` checks that the active rule has no `opacity` and sets the ink background and border, read from `global.css`. The test was written first and failed on the old rule. The full suite passes (264 files; 11,989 tests passed, 1 skipped). The button inventory records the exception.

## Screenshot capture (blocked)

The Screenshots workflow does not capture the consent page, and no `publication-consent` scenario was added. The page renders only for a valid authorization request, and the route refuses any origin but a hard-coded production origin:

- `src/lib/publication/oauth-login.ts:6`: `export const publicationOrigin = "https://thesuperhuman.us";`
- `src/lib/publication/oauth.ts:92`: `if (url.origin !== publicationOrigin || !paths.has(url.pathname)) return 404`. Every request to the route, including the authorize page, fails at this line on the preview at `127.0.0.1:4321`.
- `src/lib/publication/oauth-login.ts:230`: the consent POST requires `request.headers.get("origin") === publicationOrigin`, so the approve step is blocked too.
- `SITE_ORIGIN` in `PREVIEW_OVERRIDES` does not reach these checks. The route never reads it.

No production behaviour was changed and no bypass was added. Option for the owner: read the publication origin from a configured variable (for example `PUBLICATION_ORIGIN`) that defaults to `https://thesuperhuman.us` in `wrangler.jsonc`, and set it to the preview address in `PREVIEW_OVERRIDES`. That change touches the route, the consent POST, the redirect URIs and the CSP `form-action`, so it needs the owner's approval before it is made. With it in place, a scenario would seed one fictional client, then drive `/api/publication/authorize` with fixed PKCE and state values, and capture the page at both sizes.

## Deviation from the brief

- The drift test checks the cancel note's sans stack against `--font-sans` without `'Inter'`, the first family in that token. Inter is not self-hosted, and the policy admits no font host, so the note keeps the system part of the stack. Adding `'Inter'` to the note is a one-line change if the owner wants it.

## 1. Purpose and content

- **UNVERIFIED · Project, branch, local changes, instructions and audience.** One branch from `origin/main`; the changes are the code commits listed above and the document commit. Deployment authorization: not given by this record; the owner authorized the merge in conversation on 2026-11-13. The owner has not yet seen the 1.25rem heading minimum (see Owner decisions).
- **PASS · Approved design and truthful claims.** The look is the owner's approved restyle. No professional claim, copy or image changed.
- **N/A · Explanatory copy.** No copy changed; the consent sentences are as before.
- **N/A · First screen and next step.** This is a consent page, not a site page. Its one action is the button, which the renders show at every width measured.
- **N/A · Navigation, footer and contact route.** The page has no navigation, footer or links; its only other destination is the form action.

## 2. Search and sharing

- **N/A · Titles and descriptions.** The page title "Connect project publishing" is unchanged. The page has no meta description and is not an indexable content page.
- **N/A · Canonical URLs.** No canonical link; the page is not an indexable content page.
- **N/A · Open Graph and social card.** The page is not shared.
- **N/A · Favicon and Apple touch icon.** The page declares no icon; site-wide icons are unchanged.
- **UNVERIFIED · robots.txt and sitemap.** The sitemap script (`scripts/sitemap-pages.mjs`) has no publication entry. robots.txt was not checked in this PR.
- **UNVERIFIED · Noindex on the consent response.** The response has no `X-Robots-Tag` and no robots `meta`. It renders only for a valid authorization request, so a crawler cannot reach it through a normal link, but production headers were not observed. This PR does not add noindex. Listed under Remaining work.
- **N/A · Preview indexing and structured data.** No preview route or structured data on this page.

## 3. Accessibility and responsive behavior

- **PASS · Semantic landmarks, language and heading.** `html lang="en"`, one `main`, one `h1` ("Connect project publishing"), and the button's text names the action. Evidence: markup and the test that checks the h1 and the form.
- **N/A · Images and icon-only controls.** The page has no images and no icon-only controls.
- **PASS · Keyboard access and visible focus.** Tab moves focus to the button (focused element `BUTTON`). The focus render shows the 2px accent ring. The page has one control, so no trap is possible.
- **N/A · Skip link, menus, dialogs.** None on the page.
- **N/A · Inputs and status messages.** The only form field is the hidden nonce; there are no user inputs.
- **PASS (limits) · Contrast and touch targets.** Contrast figures are those of the first Hallmark audit (see Contrast); the colours are unchanged. Button minimum height 44px, measured 44px at 1280px and 390px. Measured at 200% text only by setting the root font size in Chromium (see Heading fit); the browser's own text size setting is UNVERIFIED.
- **N/A · Reduced motion.** The page has no animation or transition; the button's `:active` state swaps to the ink fill and border with no opacity change and no transition.
- **PASS (limits) · Widths.** 320, 390 and 1280 checked, with no horizontal overflow (scrollWidth equals the viewport in every case). Tablet widths were not rendered: UNVERIFIED.
- **UNVERIFIED · Browsers and devices.** Chromium only. Safari, Firefox, a real phone and forced-colors mode were not run.

## 4. Performance and resilience

- **PASS (limits) · Font weights and files.** Only the Regular and Bold faces are declared and loaded (`Libron-Regular.woff2`, `Libron-Bold.woff2`), from the same origin, with `font-display: swap`. The Italic and BoldItalic files are not referenced by the page.
- **UNVERIFIED · LCP, CLS and INP on a mobile profile.** Not measured.
- **N/A · Images, embeds and audio.** None on the page.
- **UNVERIFIED · Response headers and cache behavior on production.** The code sends `Cache-Control: no-store`, the policy and the referrer policy; production responses were not observed.
- **N/A · Async UI and recovery.** The page has no async UI. The consent POST is unchanged.
- **N/A · Branded 404 on arbitrary paths.** Unchanged in this PR; the route's unknown-path response is a plain 404 (`src/lib/publication/oauth.ts` and `oauth-login.ts`).

## 5. Forms and sensitive flows

- **PASS · Form shape.** The form is unchanged: a native POST to `/api/publication/authorize` with a hidden nonce and no JavaScript. Covered by the publication login tests, which check the form, the action and the hidden nonce, and by the golden comparison, which shows no change to the POST route.
- **PASS · No JavaScript needed.** The page has no `<script>` element (asserted by the tests) and the form posts natively. Not run in a browser with JavaScript disabled in this PR.
- **PASS · Server-side origin, nonce and state checks.** The consent POST is unchanged. Tests cover a cross-site POST (refused on the origin check, in "rejects cross-site consent and callback state tampering before upstream calls"), a same-origin POST with a wrong nonce (refused with no redirect to GitHub, and the correct nonce still succeeds from the same cookie, in "refuses a same-origin consent POST with a wrong nonce before any redirect, and the right nonce still works", added in this revision), and the callback cases (a tampered `state` in the same test as the cross-site POST, and "denies another GitHub account and expired browser state"). `tests/lib/publication-login.test.ts`: 23 of 23 pass.
- **UNVERIFIED · Error and load paths on the live route.** Timeouts, 429, 500, network failure and duplicate-submit prevention were not run against the live route. The route's upstream behavior is unchanged.
- **N/A · Delivery and receipt.** No email is sent by this page.
- **PASS · Approval-gated flow.** The consent step still precedes the GitHub sign-in; no remembered approval was added (existing test coverage).
- **N/A · Inline confirmation.** No confirmation page is involved.

## 6. Privacy, legal and measurement

- **PASS · Inventory.** The page loads only its own inline style and two same-origin font files. No scripts, no external hosts (0 blocked requests in every render). The cookie set is the existing short-lived, sealed login cookie, unchanged.
- **N/A · Privacy notice.** No new personal data is collected or stored; the data flow matches `origin/main`.
- **N/A · Consent banner.** No nonessential cookie or processing is added.
- **N/A · Terms and legal disclosures.** Nothing added.
- **N/A · Analytics.** None added.
- **N/A · Monitoring.** No change to logs or monitoring.

## 7. Release and final QA

- **PASS · Type, test, asset and build checks.** `pnpm run check`: 0 errors, 0 warnings, 17 hints. `pnpm run design:check`: passed. `pnpm test`: 264 files, 11,988 passed, 1 skipped. `pnpm run build`: exit 0.
- **FAIL (pre-existing, not from this change) · Lint.** 64 findings, none in a file this PR touches. Open PRs #256 to #258 remove these findings, per the closing-legal record.
- **PASS · Exact diff.** The diff is limited to the files listed under Scope and the document commit. No secrets, no unrelated changes, no generated files committed (`.screenshots/` and `.jolli/` are not committed).
- **UNVERIFIED · Production bindings, secrets and headers on dynamic responses.** Not deployed; no production response was observed.
- **PASS · Rollback version.** `fad7694e`. No backup is needed: the PR writes no data and adds no migration.
- **UNVERIFIED · Post-deploy verification.** Merged to `main` on 2026-11-13 21:42:57 UTC as `57e26842`, and the production build succeeded. Live check by the coordinating session on 2026-11-13 after the merge: `https://thesuperhuman.us/` returned 200; `https://thesuperhuman.us/fonts/libron-v0.25/Libron-Regular.woff2` returned 200 (the font file the page loads, same origin); a bare request to `/api/publication/authorize` without a valid authorization request returned 400, as expected. The restyled page itself was NOT viewed in production, because it renders only for a valid authorization request. This record does not by itself authorize deployment.
- **UNVERIFIED · Receipt and monitoring.** Monitoring was not checked. Status: implemented: yes. Verified locally: yes. Verified in CI: `validate`, Greptile and the Cloudflare build succeeded on the final head. Deployed: yes (merged 2026-11-13 as `57e26842`, production build succeeded). Verified live: in part (the three responses above); the restyled page was not viewed in production.

## 8. Private owner center

- **N/A · Owner center.** No owner route or owner page is changed in this PR.

## Remaining work

- Owner decision: the 1.25rem heading minimum (new in this revision). Show the 320px large-text render before merge.
- Owner decision: the body domain "thesuperhuman.us" breaks inside the word at 320px with 200% text, and its full stop sits alone at 390px with 200% text (see Heading fit). A fix would change how long tokens wrap in the body copy.
- Noindex: decide whether the consent response should carry `X-Robots-Tag: noindex`. It is not added here, because it changes behavior.
- Follow-up outside this PR (pre-existing): reject redirect origins containing `;` or `,` when a client registers. An injected directive can only tighten the policy.
- Remaining checks listed as UNVERIFIED above: the restyled page in production (it renders only for a valid authorization request), Safari and Firefox, a real phone, the browser's own 200% text setting, forced-colors mode, tablet widths, production headers and cache behavior, and the live error paths.
- Screenshots: CI does not capture the consent page. The blocker and a proposed option are under "Screenshot capture (blocked)" above. The owner decides whether to take that option.

## Deployment

This record does not by itself authorize deployment. Merging to `main` deploys production. The owner authorized the merge in conversation on 2026-11-13, and it deployed as `57e26842` (2026-11-13 21:42:57 UTC).
