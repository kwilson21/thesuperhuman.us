# Lint and format stack release gate

Date: November 12, 2026
Repository: `kwilson21/thesuperhuman.us`
Branches: a stack of six, bottom to top: `claude/lint-1-tooling`, `claude/lint-2-format`, `claude/lint-3-client-scripts`, `claude/lint-4-fix-tests`, `claude/lint-5-fix-source`, `claude/lint-6-review-fixes`
Pull requests: #234 to #239, linked as GitHub stack 240 (`https://github.com/kwilson21/thesuperhuman.us/stack/240`), bottom to top `claude/lint-1-tooling` #234, `claude/lint-2-format` #235, `claude/lint-3-client-scripts` #236, `claude/lint-4-fix-tests` #237, `claude/lint-5-fix-source` #238, `claude/lint-6-review-fixes` #239
Target: production `https://thesuperhuman.us`
Reviewer: built by Claude Haiku and Sonnet subagents; reviewed by independent Claude Opus and Sonnet subagents in several rounds. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `a96411f531ed6d99632d2056544242f093c997aa` (local `origin/main` when this record was written; re-check with `git fetch` before merge)

## Scope

Oxlint 1.93.0 with the vendored dmmulroy/anti-slop rules and Biome 2.5.14 as the formatter, matching the sibling repository Tally. The repository is formatted (tabs, double quotes). Inline client `<script>` code from 21 `.astro` files moved into `src/scripts/` modules. Anti-slop findings were fixed from 7,374 to 66. Shared test helpers were added. `music-playback.ts` no longer aliases `window`, and client scripts read route responses through small typed local readers or an inline cast under a `SAFETY` line that names the route; both changes are behavior-neutral. No page copy, markup, style, route, migration, binding or secret change. The lint rules are NOT enforced in the build or in CI yet.

## Owner decisions

- Owner, in conversation, 2026-11-12: adopt Biome like Tally with Tally's style, and fix the tests that depended on quote style.
- Owner, in conversation, 2026-11-12: fix every finding before enforcing; no ratchet.
- Owner, in conversation, 2026-11-12: mirror Tally's exemption of plain `.mjs` and `.cjs` scripts from `no-runtime-typeof`.
- Owner, in conversation, 2026-11-12: fix the remaining request-body validators and module mocks as the first step of the Effect, Effect Schema and XState conversion.
- Owner, in conversation, 2026-11-12: keep the one accepted behavior change (below).
- Owner, in conversation, 2026-11-12: deliver as stacked pull requests merged through the stack.

Accepted behavior change (the only one): `src/pages/api/owner/requests/[id]/updates/[updateId]/visual.ts` answers a Content-Type that names an inherited object key (for example `constructor`) with 415 before reading the body, where it answered 400 after reading it. Nothing was stored in either case. The owner approved it.

## Evidence and limits

All runs are local on macOS arm64, Node 26.13.1, pnpm 12.20.0, in clean exported copies; no logs retained.

At each of the six layer tips: `pnpm run check` 0 errors; `pnpm test` all passing (1,781, 1,781, 1,813, 1,818, 1,818 and 1,873 tests at the first pushed head of the top layer, `claude/lint-6-review-fixes`, which also skips 1; 1,879 passed and 1 skipped once this commit's test-helper tests were added); `pnpm run build` complete with all prebuild gates; publicist gate 84 entries.

Final head (top of the stack, `claude/lint-6-review-fixes`. The six branches are the stack; the top layer `claude/lint-6-review-fixes` carries the final commits, including this record):

- `pnpm run format:check`: no fixes applied (520 files).
- `pnpm run check`: 546 files, 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 153 test files passed; 1,879 tests passed, 1 skipped.
- `pnpm run build`: `Complete!`
- `node scripts/publicist/gate.mjs`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 66 findings, all in the deferred set listed below.

Equivalence checks:

- Format commit: 362 changed JS and TS files are AST-identical, with every string, template and regex literal unchanged. `.astro` markup and scripts are byte-identical. Prerendered pages are byte-identical.
- Script move (the `claude/lint-3-client-scripts` layer, commits up to `ffdb7fdf`, compared with the format layer before the move): the client chunk list is identical (190 and 190); 13 chunks differ only by a wrapper function and minified names; 11 inlined scripts are equivalent.
- Final head against `7603f506` (before the shared response reader was added and removed again): `dist/_astro` holds 190 files and 35 `.js` chunks in both builds, the chunk names are identical once content hashes are removed, no `portal-response` or `sign-in.astro_astro_type_script` chunk exists, and the worker manifest lists the same 44 inline and 96 external script entries in both. The sign-in and sign-out scripts are inlined as before.
- `src/lib` fixes: about 850 differential cases against the previous version, with differences only for non-plain objects that no caller can send. Agreement PDFs are byte-identical with a fixed clock. No SQL text changed.
- Stripe webhook guard: 13 event types by 4 metadata shapes give identical responses and database state.

Known and stated: layer 2 (`claude/lint-2-format`) taken alone contains a publicist capture-label check that matches nothing after formatting. It is fixed in layer 3 (commit `fcf37199`) with a test against the real file. The stack merges as one operation, so that state is not deployed alone.

Remaining lint findings (66): 25 `no-module-mocking` in tests, and 41 in request-body validators and their shared types under `src/lib` (plus `src/components/owner/SoftwareFitReview.astro:12` and `src/pages/owner/requests/[id].astro:181`). They are deferred by owner decision to the Effect conversion.

Pre-existing defect found, not changed here: a JSON `null` body to `src/pages/api/offer/[token]/draft.ts` with a valid agreement session throws and is answered as a server error. It behaves the same on `main` and is to be fixed separately.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: repository `kwilson21/thesuperhuman.us`, six stacked branches, tooling, formatting, script moves and lint fixes only, with one accepted behavior change. No deployment is authorized by this record.
- N/A, 1.2 Approved design and truthful claims: no page, copy or asset changed.
- N/A, 1.3 Explanatory copy and resume comparison: no explanatory copy, professional claim or stored resume changed.
- N/A, 1.4 First screen and CTA: no markup or style changed.
- N/A, 1.5 Navigation, footer, contact route and external links: no page, link or route changed.

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed; prerendered pages are byte-identical.

### 3. Accessibility and responsive behavior

- N/A, 3.1, 3.2, 3.5 and 3.6: no markup or style changed, and prerendered pages are byte-identical.
- UNVERIFIED, 3.3 and 3.4 (keyboard access, focus restoration, dialogs, status announcements): the scripts that drive them moved into modules. Only the built JavaScript was compared, and no real browser run was made.
- UNVERIFIED, 3.7 Browsers and real mobile device: not run. The CI screenshots are the remaining check.
- N/A, `hallmark audit`: not run because no page design changed.

### 4. Performance and resilience

- N/A, 4.1 and 4.3: no image changed and no performance measurement applies to a refactor with identical chunk output.
- PASS, 4.2 Client code against the built site: for the script-move layer (up to `ffdb7fdf`, compared with the format layer before the move) the client chunk list is identical (190 and 190), 13 chunks differ only by a wrapper function and minified names, and 11 inlined scripts are equivalent. At the final head, compared with `7603f506`, `dist/_astro` has the same 190 files and 35 `.js` chunks with identical chunk names, and the worker manifest has the same 44 inline and 96 external script entries.
- UNVERIFIED, 4.4 Async UI recovery from timeout, offline, malformed response and server error: the client scripts moved and were not exercised in a real browser.
- N/A, 4.5 and 4.6 (missing audio, video and external resources; 404 and server-error pages): no page or resource changed.

### 5. Forms and sensitive flows

- PASS, 5.1 Server validation and bounds: about 850 differential cases against the previous version differ only for non-plain objects that no caller can send. The one accepted change is the 415 response described above.
- UNVERIFIED, 5.2 and 5.3 (invalid verification token, 429, 500, network failure, retry, pending button, duplicate-submit prevention, JavaScript and verification unavailable): the form scripts moved and the behavior in a real browser, including event timing and Turnstile with a live site key, was not observed.
- N/A, 5.4 Delivery and receipt: no email content or delivery path changed; agreement PDFs are byte-identical with a fixed clock.
- PASS, 5.5 Approval-gated flows intact, by the test suite and the Stripe webhook guard comparison (13 event types by 4 metadata shapes, identical responses and database state). Not exercised live.
- N/A, 5.6 Confirmation page: no change.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no stored data, cookie, analytics, legal text, external embed or processor changed. Oxlint and Biome are development tooling and do not run on the site.

### 7. Release and final QA

- PASS, 7.1 Required type, test and build checks: see Evidence and limits for the numbers at each layer tip and at the final head.
- PASS, 7.2 Exact diff, dependency, generated-file and public-artifact review on the pull request heads as first pushed (`f3413cdc`, `5355bb25`, `ffdb7fdf`, `c6f6cbd6`, `1037a886`, `eafc2724`): independent Claude review on local heads, then Greptile and Codex code and security reviews on all six pull requests (see Delivery status). UNVERIFIED for the new head that the review-fix commits create.
- UNVERIFIED, 7.3 Production bindings, secrets, migrations, HTTPS, host routing, cache behavior and response headers (not deployed): no binding, secret or migration changed, but no deployed response was observed.
- PASS, 7.4 Rollback version preserved: revision `a96411f531ed6d99632d2056544242f093c997aa` is local `origin/main` when this record was written; re-check with `git fetch` before merge.
- UNVERIFIED, 7.5 After authorized deployment, production revision, journeys, sitemap, robots, metadata, missing page, forms and monitoring (not deployed): nothing deployed.
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately. Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no. Live verification remains UNVERIFIED.

### 8. Private owner center

- N/A, Access, cache headers, migrations and ledger, analytics, retention, rollback procedures and `owner:health`: no Access setting, binding, route set, migration or payment setting changed.
- UNVERIFIED, owner and studio journeys end to end, and the Stripe test-mode lifecycle: the owner API and payment source received lint fixes, checked by the differential cases and the Stripe webhook guard comparison above, but no browser, live or test-mode exercise was run.

## Delivery status and remaining gates

On the heads as first pushed (`f3413cdc`, `5355bb25`, `ffdb7fdf`, `c6f6cbd6`, `1037a886`, `eafc2724`, bottom to top):

- PASS: GitHub `validate` passed on all six pull requests.
- PASS: Cloudflare Workers Builds passed on all six.
- PASS: Screenshots `capture` passed on #235, #236, #238 and #239. It did not run on #234 and #237.
- PASS: Greptile reviewed all six (confidence 4/5 on #234, 5/5 on the rest) with one inline finding, on #234.
- PASS: Codex code and security reviews completed on all six, with four inline P2 findings on #234 and two on #236. They are answered by the review-fix commits on the top layer or by later layers.
- UNVERIFIED: checks and reviews on the new head that the review-fix commits create.
- UNVERIFIED: behavior of the moved client scripts in a real browser (event timing, Turnstile, printing, sign-in with a live site key). Only the built JavaScript was compared, so the CI screenshots are the remaining check.
- UNVERIFIED: Dependabot.
- UNVERIFIED: post-deployment live verification, apart from one report. The owner said in conversation on 2026-11-12 that a real payment on the live site succeeded after the deploy. That is the owner's report, not something this record observed, and it covers that one journey only.
- UI checks: no markup or style changed; `hallmark audit` not run because no page design changed (N/A).

No deployment is authorized by this record.

Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

Built by Claude Haiku and Sonnet subagents; reviewed by independent Claude Opus and Sonnet subagents. This record does not certify the checks listed as UNVERIFIED.
