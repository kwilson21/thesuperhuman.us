# Dependabot minor and patch release gate

Date: October 10, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#165](https://github.com/kwilson21/thesuperhuman.us/pull/165)
Branch: `codex/deps-165-minor-patch`
Starting head: `67f2ecbdd25fb87ee3da0b3caf185bdca2d47144`
Merged-main revision: `8b2252c4e59b904ba8cf07f4492dda0d51189235`. Local merge commit: `bc49efd76b248d8c7b987a82b2ee6a2362e8d5d5`.
This record's commit: the record-only commit directly following that merge, identifiable with `git log -1 -- docs/prelaunch-qa-2026-10-10-dependabot-minor-patch.md`. A commit cannot embed its own hash; the final handoff supplies the exact hash.
Target: production `https://thesuperhuman.us`
Reviewer: Codex (gpt-6.1-sol), local evidence collection for owner Kazon Wilson. This record does not certify independent current-head review.
Rollback revision: `8b2252c4e59b904ba8cf07f4492dda0d51189235`

Scope: dependency and lockfile change only, apart from this release record. No public copy, page, asset or route change. No application source patch was needed.

## Owner decisions and authorization

Owner, in conversation, 2026-10-10: asked to handle the four open Dependabot PRs on `kwilson21/thesuperhuman.us`, merging each only when CI is green, Codex review and Codex security review are clean on the current head, Greptile has reviewed the current head, and every review thread is answered.

This task authorizes a local merge of existing origin/main and a record-only commit. No fetch, network, push, PR creation, main merge or deployment is authorized here. Current-head CI, Codex engineering/security review, Greptile review and answered threads remain UNVERIFIED. No exception to those gates is accepted by this record.

## Evidence and limits

Read AGENTS.md, CLAUDE.md, coding approach, project-journal protocol, publication protocol, prelaunch checklist and the work-first release record. Merged existing origin/main without conflicts using the default message. Git reported a sandbox denial for packed-refs.lock after creating the merge; branch HEAD and merge revision were verified. Untracked .jolli/ is excluded. Journal status was read successfully; checkpoint writing failed with Operation not permitted on the private journal lock. No journal checkpoint or cloud backup is claimed. The record-only commit disables hooks to preserve the no-network boundary.

Compared package.json and package-lock.json against origin/main. The root manifest changes exactly the eight requested dependencies. The lockfile carries their resolution/transitive changes: 42 existing package versions changed, 78 package entries added and 15 removed. Neither manifest nor lockfile changed during merge or checks. The lockfile is byte-identical to starting head, which the owner supplied as the npm ci installation source; all eight installed versions match it. No install was run.

**No migration in this PR.** Production D1 (`MUSIC_DB`) migrations 0001 through 0025 are untouched. This describes the unchanged migration files, not a remote ledger readback. Local `cmp` confirms db/music.sql equals `LC_ALL=C cat migrations/music/*.sql`. No database, migration, production binding or secret was changed.

Installed packages contain no changelog or release-note files. Read each package.json and the relevant current implementation and callers instead. Historical release changes, deprecations and upstream security advisories cannot be certified from that evidence. No earlier triage text was used.

### Package findings

- **@modelcontextprotocol/sdk 1.30.0 to 1.32.1:** Publication uses McpServer, strict Zod input schemas and a fresh stateless WebStandardStreamableHTTPServerTransport with JSON responses per request. Installed transport enforces single-use stateless transports and protocol versions; the caller fits those constraints. OAuth verification stays in unchanged workers-oauth-provider 0.10.3 before MCP and scope checks. Publication regressions passed; live OAuth and historical auth/transport changes remain unverified.
- **zod 4.4.3 to 4.6.5:** Direct Zod callers use strict objects, regex/bounds and safeParse success/data. Many API validators import astro/zod instead; they do not all resolve to this direct Zod dependency. SDK compatibility accepts v3/v4 schemas. API/validation regressions passed; no parsing or error-shape regression observed, but historical stricter parsing and deprecations are unverified without release notes.
- **jose ^6.1.0 to ^6.2.12:** Owner verification uses createRemoteJWKSet and jwtVerify with explicit RS256, issuer, audience and owner email, failing closed on errors. Screenshot fixtures use SignJWT/exportJWK/generateKeyPair. Local auth tests passed. Real Cloudflare Access JWKS fetching and historical verification changes remain unverified.
- **@astrojs/sitemap ^3.2.1 to ^3.7.4:** Actual locked baseline was 3.7.2. Installed code deduplicates route/customPages URLs, applies filter before serialization and awaits serialize, excluding falsy serialized results; configured synchronous callbacks remain compatible. Build emits 26 normalized public routes including /music/old-news; no owner/API/file-download/dynamic private project routes or redirect/error routes. The public /studio and /studio/sign-in entry pages remain included. Historical option changes remain unverified.
- **@astrojs/check ^0.9.4 to ^0.9.10:** Actual locked baseline was 0.9.9; metadata changes yargs from ^17.7.2 to ^18.0.0 while retaining language-server ^2.16.7. Node 22.19.0 runs the checker successfully: 441 files, zero errors, zero warnings, 17 hints. No checker regression observed; historical diagnostic changes remain unverified.
- **vitest ^5.0.2 to ^5.0.3:** Installed metadata requires Node ^22.12.0, ^24.0.0 or >=26.0.0; local Node 22.19.0 satisfies it. Existing configuration, Worker OAuth mock/inline dependency and suite run. 125 files passed; the sole failing local R2 test and unhandled localhost EPERM are detailed below. No additional assertion failure observed.
- **playwright ^1.56.1 to ^1.63.0:** Capture imports Chromium; the installed package requires Node >=20 and pins playwright-core 1.63.0. Local screenshot scenario tests passed as part of the suite. No real browser capture or matching browser-binary verification was run, so browser behavior and historical capture changes remain unverified.
- **sharp ^0.34.5 to ^0.35.5:** Asset tooling uses SVG resize/PNG and cover WebP operations; installed metadata requires Node >=20.9.0. SVG to 32px PNG buffer and metadata roundtrip passed on sharp 0.35.5/libvips 8.18.7, and Astro image build passed. assets:check verifies 36 asset hashes, not encoding equivalence. No public assets were regenerated; historical codec behavior remains unverified.

### Local checks

| Command/check | Result | Evidence |
| --- | --- | --- |
| git merge --no-edit origin/main | PASS | No conflicts, default merge message, verified merge commit; packed-refs.lock sandbox diagnostic recorded above. |
| Manifest/lockfile diff and installed metadata | PASS | Exactly eight root updates; lock unchanged from installed starting head. |
| npm run check | PASS | 441 files, 0 errors, 0 warnings, 17 hints. |
| npm test | FAIL | 125 files passed, 1 failed; 1,390 passed, 1 failed, 1 skipped; one unhandled error. |
| npm run assets:check | PASS | 36 production files match visual review hashes. |
| npm run build (private token removed to prevent network lookup) | FAIL | After prebuild passed: ERROR: SecItemCopyMatching failed -50, exit 139. |
| npm exec --offline -- astro build (telemetry disabled) | PASS | Complete server/image build and sitemap generated. |
| npm run build (private token removed, telemetry disabled) | PASS | Complete prebuild and Astro build. |
| Generated sitemap XML inspection | PASS | sitemap-index.xml references sitemap-0.xml; 26 production-domain routes, normalized paths, public release included. |
| cmp db/music.sql against LC_ALL=C cat migrations/music/*.sql | PASS | Byte-identical; no schema drift. |
| Sharp SVG resize/PNG metadata roundtrip | PASS | 32 by 32 PNG; no asset writes. |
| git diff --check | PASS | No whitespace errors. |

Failing test verbatim: `tests/lib/audio-project-uploads.test.ts > finishes an upload using the opaque part tag returned by local R2`. `Error: Test timed out in 15000ms.` Unhandled error: `Error: listen EPERM: operation not permitted 127.0.0.1`. Wrangler log writing was also denied. This is the supplied sandbox limitation; CI must run the integration for real. No other failing test was reported.

The first build failed in macOS keychain access. Repeating direct and full builds with `WRANGLER_SEND_METRICS=false ASTRO_TELEMETRY_DISABLED=1` succeeded without source changes. This establishes a successful bounded local build, not the exact cause of the keychain failure. Both full builds removed PUBLICIST_PRIVATE_TOKEN to honor the no-network instruction. Prebuild asset/copy checks passed; publicist gate skipped private note lookup for 49 entries and reported its local mechanical pass. Private approval lookup remains UNVERIFIED.

Checker hints include existing unused declarations, retention-script properties, inline JSON-LD and deprecated autocomplete keyCode. Build warns about absent notes/audio-tracks content collections and misplaced PURE annotations in Zod core util.js and regexes.js; Rollup removes the comments and completes both bundles. These were inspected and no source was patched. No browser/device capture, remote migration ledger, real email, payment, remote health, review threads or CI was accessed.

PASS below means only the named observed local evidence. Unknown is UNVERIFIED. This record does not claim launch readiness. Deployment, live verification, monitoring and Workers Builds remain UNVERIFIED until after merge; post-deploy verification uses `npm run owner:health -- --remote --post-deploy` and production `check-runs` for the merge commit, with journey checks and operator follow-up for attention results.



## 1. Purpose and content

- **PASS · 1.1. Confirm the correct project, branch, local changes, site instructions, audience and deployment authorization.** Correct branch, local diff, instructions and conditional authorization verified above.

- **PASS · 1.2. Preserve approved design and truthful claims; remove placeholders and verify ownership/rights for media.** No copy or media changes; asset hashes and copy check pass. Existing ownership is not recertified.

- **N/A · 1.3. For explanatory copy, explain who does what, what action they take, and the supported result or reason when visitors need that context; keep useful labels and personal or creative writing in their intended roles. For professional-claim or resume changes, record a private website/resume comparison of facts, metric scope, attribution and status, including intentional differences and the actual stored PDF version. N/A is appropriate when neither changes.** Neither explanatory copy nor professional claims nor stored resume changes.

- **UNVERIFIED · 1.4. The first screen explains who/what the site is for and offers a useful next step. Verify the CTA works at narrow and desktop sizes. A sticky CTA is optional, justified by the actual journey.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 1.5. Navigation, footer, contact route and important external links work. Never invent an address or expose a home address.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 2. Search and sharing

- **UNVERIFIED · 2.1. Each indexable page has a descriptive, distinct title and meta description.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.2. Absolute canonical URLs use the production HTTPS domain, match the sitemap and normalize duplicate host/path/query variants. Preserve query parameters only when they identify distinct indexable content.** Built sitemap uses production HTTPS and normalized paths; live canonical/host/query behavior was not exercised.

- **UNVERIFIED · 2.3. Open Graph title, description, URL and reachable image are correct; inspect the image at sharing size. Include a social card type and suitable image description when applicable.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.4. Branded SVG/raster favicon and Apple touch icon return the correct formats and remain legible at small sizes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.5. robots.txt reflects intended indexing and links to the real sitemap. Sitemap includes public canonical routes, including server-rendered pages, and excludes redirects/errors/private routes.** Local sitemap generation and public-route exclusions pass; live robots and sitemap pending.

- **UNVERIFIED · 2.6. Preview environments cannot be accidentally indexed. Secrets and private data require access control, never robots.txt alone.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.7. Verify structured data when present. Do not invent ratings, credentials or organization details.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 3. Accessibility and responsive behavior

- **UNVERIFIED · 3.1. Semantic landmarks, page language, sensible heading order and one primary heading.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.2. Meaningful image alternatives; decorative images use empty alt text. Icon-only controls have names.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.3. Keyboard access, visible focus, skip link, menus, dialogs and focus restoration work. No keyboard traps.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.4. Inputs have labels, required/optional guidance, useful error associations and status announcements. Success and failure do not depend on color alone.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.5. Text/UI contrast, touch targets, 200% text zoom and reduced-motion behavior are checked. Use automated accessibility checks plus manual review.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.6. Check at least 320px, typical phone, tablet and desktop widths, including long content and expanded menus/forms. No horizontal overflow or concealed controls.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.7. Check Chromium and another supported browser, plus a real mobile device for critical interactions where available. Record limits.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 4. Performance and resilience

- **UNVERIFIED · 4.1. Images are appropriately sized/compressed, have intrinsic dimensions, and use responsive sources where beneficial. Prioritize the hero; lazy-load below-fold images.** Local image build and Sharp roundtrip pass; responsive loading and live image performance were not measured.

- **UNVERIFIED · 4.2. Avoid unnecessary client code, dependencies, embeds and font weights. Verify compression, caching and asset loading against the built site.** Only existing dependency versions change; build passes, but target compression/cache/asset loading not exercised.

- **UNVERIFIED · 4.3. Measure representative pages with a repeatable mobile profile. Record LCP, CLS and INP when field data exists; lab results are not field evidence. Investigate LCP over 2.5s, CLS over 0.1 or INP over 200ms.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.4. Async UI visibly loads and recovers from timeout, offline, malformed response and server error. Preserve user input and allow retry without duplicate submissions.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.5. Test missing/unavailable audio, video and external resources where used; avoid autoplay surprises.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.6. Useful branded 404 returns actual HTTP 404 on arbitrary missing paths. Verify redirects and their status codes. Server errors expose no secrets and leave a usable recovery path.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 5. Forms and sensitive flows (N/A if absent)

- **UNVERIFIED · 5.1. Validate and bound input on the server. Verify origin/auth checks, abuse protection and rate limits.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.2. Test empty/invalid input, invalid verification token, 429, 500, network failure, timeout, retry, pending button, success and duplicate-submit prevention.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.3. Provide an alternative when JavaScript or verification cannot load. Verify disabled/unavailable states.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.4. Confirm delivery/receipt in the intended environment using authorized test recipients. Mocked UI success is not proof of email delivery.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.5. Keep approval-gated flows intact. Check expired/reused links, permissions and sensitive file access.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.6. Use an inline confirmation unless a separate thank-you page serves a real need. Protect its indexing if appropriate.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 6. Privacy, legal and measurement

- **UNVERIFIED · 6.1. Inventory actual form data, storage, logs, external fonts/embeds, cookies, analytics and processors, including host-injected scripts.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.2. Where personal data is processed, publish an accessible, accurate privacy notice linked near collection and in the footer. Confirm purposes, recipients, retention, contact and applicable rights with the operator; do not invent retention periods or compliance claims.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.3. Determine consent needs from actual technology, audience and jurisdiction. Add a cookie banner only when required, and verify reject/withdraw actually controls nonessential processing.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.4. Terms, physical business address and additional legal disclosures depend on commerce, accounts, contributions, licensing and applicable rules. Do not add boilerplate just to tick a box.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.5. Analytics needs a concrete question and a privacy decision. N/A is valid. If enabled, verify events without collecting sensitive input or duplicating counts.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.6. Confirm existing error logs/monitoring work, who receives actionable failures and how they respond. Configuration alone is not verified monitoring. Do not create new paid accounts or services by assumption.** Monitoring requires post-deploy health and production check-runs; no actual notification or response test.


## 7. Release and final QA

- **FAIL · 7.1. Run the project's required type, test, asset and build checks. Inspect warnings; record pre-existing exceptions.** Type, asset, copy and telemetry-disabled builds pass. Full test suite retains the sandbox R2 failure; green CI remains required.

- **UNVERIFIED · 7.2. Review the exact diff, dependencies, generated files and public artifacts. No secrets, private logs, unapproved claims or accidental unrelated changes.** Local dependency diff and generated sitemap inspected; independent current-head review, security review and CI remain pending.

- **UNVERIFIED · 7.3. Verify production bindings/secrets, migrations/backups where applicable, HTTPS, host routing, cache behavior and response headers on dynamic as well as static responses.** No migration or binding change; local schema comparison passes. Target bindings, ledger, backup, HTTPS, routing, cache and headers were not queried.

- **UNVERIFIED · 7.4. Preserve a rollback version and any required backup before deployment. Follow existing review and authorization rules.** Exact rollback revision recorded; production backup/readback and conditional review gates pending.

- **UNVERIFIED · 7.5. After authorized deployment, verify the actual production revision, main journeys, sitemap/robots, metadata/OG/icons, missing page, forms and monitoring on every supported host.** No deployment. Verify post-deploy health, production merge-commit check-runs and live journeys on supported hosts.

- **PASS · 7.6. Save a receipt and QA evidence. Report **implemented**, **verified locally**, **deployed**, and **verified live** separately. Reopen the checklist after material changes.** This receipt separates implemented, locally verified, deployed and live verified outcomes.


## 8. Private owner center (N/A if absent)

- **UNVERIFIED · 8.1. Cloudflare Access has one approved owner identity for both `/owner*` and `/api/owner*` (the owner pages post their actions to `/api/owner`, and without Access there every action returns 403); the Worker independently verifies the signed JWT issuer, audience, signature, and email. Unsigned and wrong-owner requests fail closed.** Local owner-auth regressions pass with jose; actual Access policy and production signed JWT exercise pending.

- **UNVERIFIED · 8.2. Every owner response uses `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Private routes stay out of the sitemap.** Local sitemap excludes owner routes; target private/no-store/noindex headers pending.

- **UNVERIFIED · 8.3. Reconcile the production MUSIC_DB schema and migration ledger before applying any migration. Record backup and recovery evidence separately from local schema tests.** No migration; 0001 through 0025 untouched and local concatenation matches. Remote ledger/backups/recovery not verified.

- **UNVERIFIED · 8.4. Verify a valid request persists before success. Force storage failure and confirm the visitor receives an honest retry while the urgent email contains no request content or raw database error.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.5. Verify the Cloudflare traffic summary and its safe unavailable fallback. Confirm owner pages remain usable without the optional analytics token.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.6. Confirm automated playback is excluded, campaign tags are controlled, and city rows below five qualifying human listens are combined under **Other locations**.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.7. Preview retention and inspect the private manifest for contact data or secrets. Apply only an exact reviewed manifest in a non-production environment before production use.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.8. Before enabling the private studio, reconcile portal migrations `0005` through `0017`, then exercise email-code access, mobile and keyboard use, private audio playback, upload interruption, failed notice delivery, and project revocation in the target environment.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.9. Confirm the launch scope with payments off. While `STRIPE_PAYMENTS_ENABLED=false`, no invoices are created. The owner collects each installment another way (Zelle, cash, and so on) and records it with **Record booking received** or **Record balance received** in Book the work. That marks the installment paid with no Stripe invoice, shows it as "Paid outside Stripe", and logs the method and reference in Activity. It is allowed only for an installment with no invoice and no pending invoice creation, and the balance only after the booking. A recorded installment can never be invoiced, and a Stripe invoice for it is held as unmatched rather than adopted.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.10. Run the studio-retention preview and exact-manifest apply against a non-production project with a real private R2 object; verify access closes before deletion, a storage failure is retryable, and owner-request retention waits for studio cleanup.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.11. Keep `STRIPE_PAYMENTS_ENABLED=false` until Stripe payments and payouts are active, migration `0003_audio_payments.sql` is reconciled, secrets are configured, and the test-mode booking and balance lifecycle passes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.12. Verify invalid Stripe signatures change no data, repeated webhook events apply once, repeated invoice actions create no duplicate invoice, and the balance action stays locked until the booking invoice is paid.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.13. Confirm the owner Payment section exposes no Stripe secret, webhook secret, payment credential, or customer identifier in HTML or API responses.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.14. Exercise the documented previous-version rollback, Old News visibility, event-disable, retention-pause, D1 recovery, and visitor-recovery procedures without changing production.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.15. Run `owner:health` against the target environment. Resolve every attention result or record it as a launch-blocking UNVERIFIED item.** Target health not run; use owner:health --remote --post-deploy after deployment and resolve attention results.


## Software agreement signing

- **UNVERIFIED · Agreement.1. Record counsel review status for the templates and electronic consent.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.2. Owner verifies the registered-agent business address and contractor config.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.3. Preview seeded templates for one, two and three milestones in both payment modes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.4. Verify the signing setting defaults off and the outside-site path still works.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.5. Verify scoped email authentication, revocation, stale hashes and MSA reuse confirmation.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.6. Exercise PDF rendering in the actual Workers runtime, including Unicode and attachments.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.7. Verify full text extraction, every document certificate, packet hashes and two retained copies.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.8. Test artifact failure and each recipient's uncertain email/retry separately.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.9. Verify project-page and archive downloads, including closed project and redacted request.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.10. Rehearse restoring agreement database records, templates, fonts and private storage, with hashes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.11. Verify custom project retention and exclusion of open, held and actively reused agreements.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.12. Review real CI screenshots, keyboard/no-JS behavior and overflow from 320 to 1280 pixels.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## Delivery status and remaining gates

- **Implemented:** Eight dependency bumps retained, existing main merged locally, release record added. No application source change.
- **Verified locally:** Type check, 1,390 passing tests, asset/copy checks, telemetry-disabled builds, sitemap output, Sharp roundtrip and schema comparison. Full suite is FAIL under the supplied sandbox constraint.
- **Deployed:** UNVERIFIED. No push or production merge performed.
- **Verified live:** UNVERIFIED. No network access performed.

Owner follow-up: require green current-head CI, clean current-head Codex engineering and security review, Greptile current-head review and answered review threads before main merge. Confirm the R2 integration in CI and successful production Workers Builds, then run post-deploy health and live journey verification. Resolve applicable checklist unknowns or explicitly accept bounded exceptions; this task records none as accepted.
