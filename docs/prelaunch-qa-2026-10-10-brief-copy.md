# Software brief copy release gate

Date: October 10, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#170](https://github.com/kwilson21/thesuperhuman.us/pull/170)  
Code revision: `f9b582d470713ac10e0809c8494ff603878d013c` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (`/software/start`, `POST /api/software-inquiry`, owner request detail and `POST /api/owner/requests/[id]/brief-copy`), existing Resend delivery and production `MUSIC_DB`  
Reviewer and deployment authorization: Kazon Wilson. B2 decisions: "2. A" / "3. A" on the decision images (owner, in conversation, 2026-10-09). The owner approved the look with "sure" (in conversation, 2026-10-10), authorizing deployment by merging PR #170 to `main`, subject to the remaining review, CI and deployment gates below. Merging to `main` deploys production.  
Look approval: "sure" (owner, in conversation, 2026-10-10), after reviewing the CI screenshots at f9b582d4 beside decision image B2 option A.  
Scope: the client's emailed brief copy; personalized receipt with delivery copy card and next steps; owner copy status and guarded retry; answered fields only; screenshot coverage for sent, failed, uncertain and unattempted states  
Rollback revision: `ec7fdd592226f8f7f0e46469f6694f7eb289fe25` (current local `origin/main` HEAD at inspection). No migration in this PR. Delivery status and attempt time use the existing request `details_json`; no schema or data migration is required.

This is a scoped deployment record against the reusable pre-launch checklist. PASS means observed locally unless explicitly attributed to CI screenshots. No real email, remote command or deployment was performed. Implemented and verified locally are separate from deployed and verified live.

Evidence: inspected the branch diff against `origin/main` and the private B2 implementation and look instructions. Ran `npm run copy:check`, `npm run check`, and `npx vitest run tests/api/software-inquiry.test.ts tests/pages/software-offer.test.ts tests/scripts/screenshots.test.ts`. Reviewed the 16 receipt and owner-state PNGs in `pr-170/f9b582d` on local `origin/screenshots`, including desktop and phone variants. The scenario uses fictional data, mocked receipt responses and seeded owner delivery states; screenshots do not prove email delivery. No local CI job-result report was available to establish validate, full-suite or deployment success. Screenshot artifacts establish captured output only.

## 1. Purpose and content

- **PASS · Scope and instructions (checklist 1.1).** Confirmed branch `codex/brief-emailed-copy` and code revision above; read repository guidance and prior release records. Docs only; owner deployment authorization is recorded above, subject to the remaining gates.
- **PASS · Approved wording (checklist 1.2).** Receipt and email retain "within two business days" and the fixed-price next step. Rendered tests cover the three next steps, removal of Print or save and Not provided, and booking reassurance once on the send step. Copy check passed. No media added. Owner look approval is recorded above.
- **PASS · Receipt next step (checklist 1.3).** CI screenshots show personalized thanks, a copy card before the numbered steps, and Back to Software at desktop and phone widths in all four states. CTA interaction and the earlier form journey were not re-exercised locally.
- **UNVERIFIED · Navigation and external links (checklist 1.4).** Navigation, footer and escape links are visible in receipt captures; destination behavior was not exercised.

## 2. Search and sharing

- **N/A · Indexable titles (checklist 2.1).** No title or description changes.
- **N/A · Canonical URLs (checklist 2.2).** No canonical or route changes to indexable content.
- **N/A · Open Graph (checklist 2.3).** No sharing metadata or images changed.
- **N/A · Icons (checklist 2.4).** No favicon or touch-icon changes.
- **UNVERIFIED · Robots and sitemap (checklist 2.5).** Unchanged configuration; production indexing and exclusion of the new private API route were not requested remotely.
- **UNVERIFIED · Preview indexing and access (checklist 2.6).** Local retry tests reject a missing owner identity; target access policy and indexing headers remain unchecked.
- **N/A · Structured data (checklist 2.7).** No structured data changes.

## 3. Accessibility and responsive behavior

- **PASS · Receipt structure (checklist 3.1).** Rendered tests verify a three-item ordered list and one copy card before it; receipt screenshots show the heading and hide the form step bar. Full page landmark audit remains unverified.
- **PASS · Icon alternatives (checklist 3.2).** Copy-card envelope is decorative with `aria-hidden`; sent and uncertain states show it, failed and unattempted states hide it. Retry controls have text labels. No images added.
- **UNVERIFIED · Keyboard and focus (checklist 3.3).** No manual keyboard, focus restoration or trap review performed.
- **UNVERIFIED · Input guidance and announcements (checklist 3.4).** Owner status and confirmation-gated retry render in tests; assistive-technology announcements and interactive errors were not exercised.
- **UNVERIFIED · Contrast, zoom and motion (checklist 3.5).** Neutral copy cards are visible in CI captures; no automated accessibility, measured contrast, 200% zoom or reduced-motion review performed.
- **UNVERIFIED · Responsive widths (checklist 3.6).** Reviewed desktop and phone captures for all four receipt and owner states; no obvious clipped copy card or state control. 320px, tablet, expanded menus and long-input cases remain unchecked.
- **UNVERIFIED · Supported browsers and device (checklist 3.7).** CI captures are browser evidence only; another supported browser and real mobile device were not checked.

## 4. Performance and resilience

- **N/A · Image optimization (checklist 4.1).** No raster assets or fonts added; envelope is inline SVG.
- **UNVERIFIED · Code and asset loading (checklist 4.2).** Diff adds no dependency and reuses existing email and retry helpers; built-site compression, caching and loading unchecked.
- **UNVERIFIED · Performance measures (checklist 4.3).** No mobile lab or field measurements performed.
- **PASS · Copy failure and duplicate safety (checklist 4.4).** Focused tests cover saved brief persistence despite provider failure, duplicate submissions, atomic send claims, final-status write failure remaining uncertain, and guarded retry. Browser offline, timeout and malformed-response recovery remain unverified.
- **UNVERIFIED · External resources (checklist 4.5).** Resend is mocked; actual provider availability unchecked.
- **UNVERIFIED · Errors and redirects (checklist 4.6).** Local API tests cover storage and authorization errors; target routing, branded 404 and redirects were not exercised.

## 5. Forms and sensitive flows

- **PASS · Server boundaries (checklist 5.1).** Focused API tests cover origin, content type, size, missing bindings, invalid answers, rate limit and identity-safe deduplication. Retry endpoint checks owner identity and bounded JSON input.
- **UNVERIFIED · Full failure matrix (checklist 5.2).** Local tests cover validation, storage failure, retry and duplicate prevention; screenshots capture success and copy failure states. Full browser network, verification-token, timeout and pending-button matrix remains unchecked.
- **UNVERIFIED · JavaScript unavailable (checklist 5.3).** No manual no-JavaScript or unavailable-verification test performed.
- **UNVERIFIED · Delivery and receipt (checklist 5.4).** Mocked tests verify subject, recipient, configured contact Reply-To and answered fields only in plain text and HTML. No authorized target-recipient email or reply was sent.
- **PASS · Approval and permissions (checklist 5.5).** Retry tests block unauthenticated, already-sent, withdrawn and unconfirmed uncertain attempts. Resolved-request blocking exists in code but has no dedicated test: UNVERIFIED by test, PASS by code reading. Uncertain retry requires explicit confirmation and a one-minute wait. Resume, studio access and file permissions are unchanged.
- **PASS · Inline confirmation (checklist 5.6).** Rendered tests and CI screenshots cover all four inline receipt outcomes, one copy card, hidden step bar and removal of answer readback and print control. No separate thank-you route added.

## 6. Privacy, legal and measurement

- **UNVERIFIED · Processor and data inventory (checklist 6.1).** Diff sends the saved answered brief to its client's email through existing Resend and stores copy status/time in existing D1 JSON. No new processor, dependency or analytics added. Production logs and host-injected scripts unchecked.
- **UNVERIFIED · Privacy notice (checklist 6.2).** Privacy and retention configuration are unchanged; operator confirmation that the existing notice accurately covers client-copy delivery and target retention remains pending.
- **N/A · Consent changes (checklist 6.3).** No new cookies, embeds or browser measurement.
- **N/A · Commerce terms (checklist 6.4).** No payment, contract or business-address changes; reassurance stays on the send step.
- **N/A · Analytics (checklist 6.5).** No analytics changes.
- **UNVERIFIED · Monitoring (checklist 6.6).** Local tests cover storage-failure alerts and failed copy status; actual owner receipt, logs and response procedures were not exercised.

## 7. Release and final QA

- **UNVERIFIED · Required checks (checklist 7.1).** `npm run copy:check` passed. `npm run check`: 386 files, 0 errors, 0 warnings, 13 hints; existing retention-script property hints, unused declarations and inline-script hint remain. Content sync reports absent notes and no audio-track files. Focused Vitest run: 3 files, 70 tests passed. Full suite, build and asset gate not run in this docs-only job; CI job conclusions are unverified.
- **PASS · Diff inspection (checklist 7.2).** Inspected the 14-file implementation diff and this docs-only addition. The file count is measured from the merge base with `origin/main` (`git diff origin/main...HEAD`), since `main` has moved on with PR #169. No migration, dependency or generated public asset changes. No private spec paths or contents copied into this record. Independent review of the final PR head remains unverified; this record does not certify it.
- **UNVERIFIED · Production configuration (checklist 7.3).** No target bindings, sender configuration, secrets, HTTPS, routing, caching or headers verified. No migration in this PR.
- **UNVERIFIED · Rollback and backup (checklist 7.4).** Exact local `origin/main` rollback revision recorded above. No migration backup required by this PR. Previous-version redeployment and review/authorization gates remain unchecked. Rollback cannot recall an email already sent.
- **UNVERIFIED · Post-deployment production (checklist 7.5).** Not deployed in this job. Verify the deployed revision, brief submission, recipient copy and reply routing, owner status/retry and supported-host behavior after authorized deployment.
- **PASS · Local receipt (checklist 7.6).** This record separates implementation, local checks and CI screenshot review from deployment and live verification. Owner look approval is recorded above; reopen after material changes.

## 8. Private owner center

- **UNVERIFIED · Cloudflare Access (checklist 8.1).** Local missing-owner retry rejects with 403; production Access identity, API coverage and signed-JWT enforcement not exercised.
- **UNVERIFIED · Owner headers (checklist 8.2).** Production private/no-store and noindex headers on the new retry route unchecked.
- **N/A · Migration and backup (checklist 8.3).** No migration in this PR; existing `details_json` stores delivery state. No schema application requested.
- **PASS · Persistence before success (checklist 8.4).** Focused tests verify storage failure prevents success and alerts without exposing the raw database error; copy or owner-notice failure does not undo the saved brief. Actual urgent-email receipt remains unverified.
- **N/A · Traffic summary (checklist 8.5).** No traffic-summary changes.
- **N/A · Playback and campaigns (checklist 8.6).** No playback or campaign changes.
- **UNVERIFIED · Retention manifest (checklist 8.7).** Retention unchanged; no preview or exact-manifest apply performed for request JSON with copy metadata.
- **N/A · Studio activation (checklist 8.8).** No studio activation, access or upload changes.
- **N/A · Payments off (checklist 8.9).** No payment flags or installment behavior changed.
- **N/A · Real R2 retention (checklist 8.10).** No R2 objects or cleanup behavior changed.
- **N/A · Stripe activation (checklist 8.11).** No Stripe activation or configuration changed.
- **N/A · Webhook and invoice safeguards (checklist 8.12).** No webhook or invoice changes.
- **N/A · Owner payment projection (checklist 8.13).** No owner payment HTML or API changes.
- **UNVERIFIED · Recovery procedures (checklist 8.14).** No previous-version or data-recovery exercise performed; local copy-retry checks do not establish target recovery.
- **UNVERIFIED · Target health (checklist 8.15).** No remote `owner:health` run. Target health remains a deployment gate.

Remaining work: current-head independent review and green required CI; target delivery and reply verification; applicable accessibility, responsive, configuration, privacy, recovery and health checks above; authorized deployment after the remaining gates, followed by live verification. This record does not claim launch readiness.
