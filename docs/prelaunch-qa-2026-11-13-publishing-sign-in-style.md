# Publishing consent page style release gate

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/publishing-sign-in-style`, from `origin/main` at `fad7694e`
Commits: `6151aa50` (style), `76f3fefb` (golden re-record for the style), then `bcfce0b0` (Libron and `font-src`), `14179d78` (label wrap), `dffc5aeb` (drift test and tap highlight), `64425f34` (design docs), `7eed2599` (golden re-record for Libron), `b9b4f37e` and `c9b1c20c` (format and lint fixes in the test file), `2fbd48ed` (heading size and word breaking, with the golden re-record), and this record.
Pull request: see the PR description for the link.
Target: production `https://thesuperhuman.us` after merge. The consent page is served by the Worker at `/api/publication/authorize`; its fonts come from the same origin's static assets.
Reviewer: Claude Haiku 5.5 subagent, tests first. The coordinating session owns the review, the browser checks listed as UNVERIFIED, and the deployment decision. This record does not certify them.
Rollback revision: `fad7694e` (`origin/main` when this branch was cut). The PR adds no migration and writes no stored data.

## Scope

- The publishing consent page's HTML shell and inline CSS in `src/lib/publication/oauth-login.ts`: the page is restyled to match the site, Libron loads from the site's own font files, the button label wraps at large text sizes, and the button carries the site's tap highlight.
- Its Content-Security-Policy gains two directives: `style-src 'sha256-…'` (one hash of the inline style block, computed from the constant) and `font-src 'self'`. Nothing else in the policy changes.
- Re-recorded publication golden fixtures (`publication-oauth`, `publication-mcp`, `publication-token`). Their only differences are the consent page body and its CSP header (see Evidence).
- New tests in `tests/lib/publication-login.test.ts`, including a drift test that reads `src/styles/global.css`.
- Documents: `design.md`, `docs/design-standard.md`, `docs/design-concepts/2026-11-12/button-inventory.md`, and this record.
- No change to logic, state, cookies, redirects, the form, the nonce or escaping. The page's client name, return address and nonce are still escaped text, and the consent POST is unchanged.

## Owner decisions (2026-11-13, in conversation)

- "Restyle the sign in page but I want to see it": restyle the page to match the site. The owner saw the first render.
- On seeing the first render with fallback fonts: "We should def load libron". This is the reason for the `@font-face` rules and `font-src 'self'`.

## Reviews

- Commits `6151aa50` and `76f3fefb`, reviewed on 2026-11-13 by independent Claude subagents:
  - Opus correctness and security review: no must-fix. The template is identical outside the added markup; the hash equals the served style bytes in every fixture; attacker-influenced values reach only escaped text after the style element; all three golden sets differ only in the consent page body and its CSP header, and each set rebuilt back to the old body with zero mismatches (publication-oauth 53 steps, publication-mcp 60, publication-token 43). One should-fix, label overflow at large text, is fixed in `14179d78`.
  - Sonnet design review: no visual defect; confirmed the colours and button values equal the site's; asked for the drift test and the document changes, which are in this round.
- The changes in this round (Libron, `font-src 'self'`, label wrap, drift test, tap highlight, documents, re-recorded fixtures) have not been independently reviewed yet.

## Hallmark audit

- Result: PASS, with limits. Run on 2026-11-13 by an independent Claude Sonnet reviewer, read-only, on the first two commits (`6151aa50`, `76f3fefb`), from the source and four renders (desktop, phone, focus, 320px).
- Defects found: none.
- Checked: contrast (body 18.21:1, muted 8.36:1, button label on accent 4.78:1, focus ring 4.78:1), visible focus, the 44px target, no horizontal overflow at 320px, the action visible in the first screen, no `transition: all`, no `outline: none`, no gradients or shadows, no em dashes.
- Set aside, as `docs/design-standard.md` allows: the raw-hex gate (the page inlines tokens as literals under its own Content-Security-Policy; this is recorded in `design.md` and guarded by a test) and the missing-stamp findings.
- Design choices noted for the owner, not changed: whether the consent sentence should be set in ink, how the return address is styled, and the gap above the button.
- Not run: the structural fingerprint (not applicable to a one-form page), the slop test against pixels, and any check in Safari or Firefox.
- After that audit the page gained Libron, the wrapping button label and the smaller heading minimum. The coordinating session viewed the renders of that round and found the heading splitting a word at 200% text; `2fbd48ed` fixes it. The audit does not cover `2fbd48ed` or later; the re-render check is in Heading fit above.

## Contrast (from the first review, unchanged in this round)

Body text 18.21:1, muted text 8.36:1, button label on accent 4.78:1, focus ring 4.78:1.

## Evidence

Local runs on macOS arm64, Node 26.13.1, pnpm on the branch at `2fbd48ed`:

- Test first: each new assertion was run before its change and failed for the expected reason (font faces, `font-src`, label wrap, tap highlight, and in `2fbd48ed` the h1 clamp and the absence of `overflow-wrap: anywhere`). After each change the publication login tests passed. Final: `tests/lib/publication-login.test.ts`, 21 of 21.
- `pnpm test`: 264 files, 11,986 passed, 1 skipped.
- `pnpm run format`: fixed 1 file (the test file). `pnpm run format:check`: no fixes, 693 files.
- `pnpm run lint`: FAIL (pre-existing, not from this change). 64 findings in total, none in a file this PR touches. The three touched files (`src/lib/publication/oauth-login.ts`, `tests/lib/publication-login.test.ts`, `design.md`) have none; the two lint findings this PR had in its test file were fixed in `c9b1c20c`.
- `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm run design:check`: passed, 6 gates, 12 allowlisted exceptions.
- `pnpm run build`: exit 0, "Complete!". The built worker contains the Libron font path.
- Golden fixtures: `UPDATE_GOLDEN=1` run once per file; then `pnpm exec vitest run` on the three files passed (publication-oauth 125 tests, publication-mcp 61, publication-token 43). `node scripts/golden-diff.mjs diff <set> origin/main`:
  - publication-oauth: 53 cases changed; every differing path is `body` or `headers.content-security-policy`.
  - publication-mcp: 60 cases changed; every differing path is `body` or `headers.content-security-policy`.
  - publication-token: 42 cases changed, 43 steps changed (one case has two consent steps); every differing path is `body` or `headers.content-security-policy`.
- Renders, from the page HTML and its real CSP header, served from the Astro dev server on `127.0.0.1:4323` (the screenshots config), with other hosts blocked, at device scale factor 2. Files are in the gitignored `.screenshots/` folder and are not attached:
  - `.screenshots/sign-in-desktop.png` (1280x800)
  - `.screenshots/sign-in-phone.png` (390x844)
  - `.screenshots/sign-in-focus.png` (1280 wide, button focused with Tab)
  - `.screenshots/sign-in-320.png` (320 wide)
  - `.screenshots/sign-in-large-text.png` (390 wide, root font size 200%)
- Fonts under the real policy: `document.fonts` reports `Libron 400 loaded` and `Libron 700 loaded`; the `h1` computed `font-family` starts with `Libron`; `strong` computes to weight 700.
- Console errors: none. CSP violations: none. Blocked external requests: none.
- Horizontal overflow (`documentElement.scrollWidth` against `clientWidth`): 320 wide 320/320; 390 wide 390/390; 390 wide with 200% root 390/390; 320 wide with 200% root 320/320.
- Heading fit at 200% root, golden and style checks for `2fbd48ed`: see Heading fit above. Golden diff against `origin/main` after the re-record: publication-oauth 53 of 124 cases, publication-mcp 60 of 60, publication-token 43 steps in 42 cases; every differing step path is `body` or `headers.content-security-policy` and nothing else.

## Heading fit at large text (fixed in `2fbd48ed`)

- The title broke inside the word "publishing" at 200% root text on a 390px phone ("publishin" and "g"). The cause was the heading's 2rem minimum (64px at a doubled root) and `overflow-wrap: anywhere` on `main`.
- Fix: the h1 size is `clamp(1.5rem, 8.2vw, 2.5rem)`, and `main` uses `overflow-wrap: break-word`, so a word breaks only when it cannot fit on a line by itself. A very long client name still wraps and stays visible.
- Measured in Chromium after the fix (device scale factor 2, Libron loaded, CSP as served):

| Case | h1 font size | Lines (rendered text) | Mid-word break | scrollWidth / clientWidth |
| --- | --- | --- | --- | --- |
| 320px, default root | 26.24px | "Connect project " / "publishing" (2) | none | 320 / 320 |
| 390px, default root | 31.98px | "Connect project " / "publishing" (2) | none | 390 / 390 |
| 390px, root 200% | 48px | "Connect " / "project " / "publishing" (3) | none | 390 / 390 |

- The five renders (`.screenshots/sign-in-desktop.png`, `sign-in-phone.png`, `sign-in-focus.png`, `sign-in-320.png`, `sign-in-large-text.png`) each show the title on whole words. The focus render shows the button's focus ring.
- Console errors: none. CSP violations: none. Blocked external requests: none. Libron 400 and 700 loaded in every case. The preview server was stopped and port 4323 was free afterwards.
- The 200% check was emulated: the root font size was set to 200% with `document.documentElement.style.fontSize` in Chromium. It did not use the browser's own text size setting.

## Deviation from the brief

- The drift test checks the cancel note's sans stack against `--font-sans` without `'Inter'`, the first family in that token. Inter is not self-hosted, and the policy admits no font host, so the note keeps the system part of the stack, as the brief asked. Adding `'Inter'` to the note is a one-line change if the owner wants it.

## UNVERIFIED until checked

- Safari and Firefox, and a real phone. The renders above are Chromium only.
- 200% text size in a real browser's own text size setting. The fit at 200% was checked only by setting the root font size to 200% in Chromium (see Heading fit).
- Forced-colors mode.
- The page in production with its real policy. The fonts are served from the same origin as the page; this is inferred from `wrangler.jsonc` (static assets from `./dist`, Worker route for `/api/publication/*`) and from the dev server, not observed on the live site.
- Hallmark audit of the final head: not run on the current page (see Hallmark audit below for what was run, and on which commits).
- Independent review of the final head (a second review of `2fbd48ed` and later is remaining work).

## Not in the Screenshots workflow

The Screenshots workflow does not capture this page, because the page needs a valid authorization request. Remaining work: add a scenario in `scripts/screenshots/scenarios/` that makes one. The renders above were made locally.

## Deployment

This record does not authorize deployment. Merging to `main` deploys production.
