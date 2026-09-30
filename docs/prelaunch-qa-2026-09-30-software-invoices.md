# Software invoices release gate

Date: September 30, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: #155  
Code revision: `81a11f04`  
Target: production `https://thesuperhuman.us` (private software client Invoices, owner milestone invoice actions, software invoice API and Stripe webhook) and production `MUSIC_DB`  
Reviewer and deployment authorization: Kazon chose Stripe-hosted invoices for software ("I want stripe invoices", owner, in conversation, 2026-09-29). Applying 0022 to production needs its own authorization, recorded below when given.  
Scope: explicit owner-created deposit, balance and milestone invoices; ACH with an owner-selected card option; paid-deposit project start; signed webhook payment records; retries, replacements, refunds and retention; client invoice ordering and capitalized labels; nonwrapping owner invoice links; migration `0022_software_invoices.sql`  
Rollback revision: `f5358b5a` (current `main`). Deploy order matters: this code requires 0022; the migration is additive and the current `main` keeps working with it applied.  

This is a scoped deployment record against the reusable pre-launch checklist. PASS means observed locally unless explicitly attributed to the owner's supplied production record. No build, screenshots, email, Stripe API calls, remote commands or deployment were performed.

## 1. Purpose and content

- **PASS · Scope and instructions (checklist 1.1).** Confirmed branch `codex/software-invoices`, starting HEAD `76f44f3`; read repository guidance. Deployment is not authorized by this job.
- **PASS · Approved wording (checklist 1.2).** Invoice labels preserve the agreed payment modes; copy check passed. No media changed.
- **UNVERIFIED · First screen and CTA (checklist 1.3).** Container tests render invoice links; desktop and narrow browser behavior were not exercised.
- **UNVERIFIED · Navigation and external links (checklist 1.4).** Hosted payment links render in container tests; actual links and navigation were not opened.

## 2. Search and sharing

- **N/A · Indexable titles (checklist 2.1).** Only private invoice views change.
- **N/A · Canonical URLs (checklist 2.2).** No indexable routes change.
- **N/A · Open Graph (checklist 2.3).** No sharing content changes.
- **N/A · Icons (checklist 2.4).** No icon assets change.
- **UNVERIFIED · Robots and sitemap (checklist 2.5).** Production indexing headers and sitemap were not requested.
- **UNVERIFIED · Preview indexing and access (checklist 2.6).** Session and owner authorization pass local tests; target-environment headers remain unchecked.
- **N/A · Structured data (checklist 2.7).** No structured data changes.

## 3. Accessibility and responsive behavior

- **UNVERIFIED · Landmarks and headings (checklist 3.1).** No heading changes; browser accessibility review pending.
- **N/A · Image alternatives (checklist 3.2).** No images or icon-only controls added.
- **UNVERIFIED · Keyboard and focus (checklist 3.3).** No browser interaction performed.
- **UNVERIFIED · Input guidance and announcements (checklist 3.4).** Invoice forms render in container tests; manual accessibility review pending.
- **UNVERIFIED · Contrast, zoom and motion (checklist 3.5).** No screenshots or browser checks authorized.
- **UNVERIFIED · Responsive widths (checklist 3.6).** Owner link has `white-space: nowrap`, asserted by container test; 320px, phone, tablet and desktop checks pending.
- **UNVERIFIED · Supported browsers and device (checklist 3.7).** No browser or device checks performed.

## 4. Performance and resilience

- **N/A · Image optimization (checklist 4.1).** No assets changed.
- **UNVERIFIED · Code and asset loading (checklist 4.2).** No dependencies added; compression, caching and built-site loading unchecked.
- **UNVERIFIED · Performance measures (checklist 4.3).** No mobile lab or field measurements performed.
- **PASS · Retry and duplicate safety (checklist 4.4).** Software project tests cover recoverable provider failures, reserved attempts, duplicate paid events and transaction races with mocked providers.
- **UNVERIFIED · External resources (checklist 4.5).** Stripe-hosted invoice availability remains unchecked.
- **UNVERIFIED · Errors and redirects (checklist 4.6).** Local authorization tests pass; target HTTP routing and recovery remain unchecked.

## 5. Forms and sensitive flows

- **PASS · Server boundaries (checklist 5.1).** Software project tests cover owner authorization, invoice amount/mode validation and prior-payment gates.
- **UNVERIFIED · Full failure matrix (checklist 5.2).** Local tests cover provider failure and retry; target timeout, offline, 429 and pending UI checks remain pending.
- **UNVERIFIED · JavaScript unavailable (checklist 5.3).** No browser test performed.
- **UNVERIFIED · Delivery and receipt (checklist 5.4).** No email sent or Stripe called; live-mode invoice delivery and payment receipt pending.
- **PASS · Approval and permissions (checklist 5.5).** Local tests pin invoices to the agreed offer, reject unauthorized creation and prevent another project identity from receiving invoice rows.
- **UNVERIFIED · Inline confirmation (checklist 5.6).** Container rendering does not verify interactive success behavior.

## 6. Privacy, legal and measurement

- **UNVERIFIED · Processor and data inventory (checklist 6.1).** Invoice projection tests exclude private owner and Stripe customer identifiers; production processor configuration unchecked.
- **UNVERIFIED · Privacy notice (checklist 6.2).** Retention tests pass locally; production invoice privacy copy and operator confirmation pending.
- **N/A · Consent changes (checklist 6.3).** No new browser cookies, embeds or analytics in this polish.
- **UNVERIFIED · Commerce terms (checklist 6.4).** Local tests verify agreed payment schedules; Stripe live-mode invoice disclosures remain unchecked.
- **N/A · Analytics (checklist 6.5).** No analytics changes.
- **UNVERIFIED · Monitoring (checklist 6.6).** Live alerts and operator receipt were not exercised.

## 7. Release and final QA

- **FAIL · Required checks (checklist 7.1).** `npm run copy:check` passed. `npm run check`: 382 files, 0 errors, 0 warnings, 11 hints. `npx vitest run`: 113 files passed, 1 failed; 924 tests passed, 1 failed (925 total), 1 unhandled error. Local R2 upload test timed out after sandbox `listen EPERM` on 127.0.0.1; Wrangler log write also denied. Build and asset checks UNVERIFIED, not authorized.
- **PASS · Diff inspection (checklist 7.2).** Only invoice presentation, its container regression tests and the two release records changed. No dependencies or generated public assets changed. Independent PR review remains pending.
- **UNVERIFIED · Production configuration (checklist 7.3).** No production bindings, secrets, HTTPS, caching or headers verified.
- **UNVERIFIED · Rollback and backup (checklist 7.4).** Starting polish revision recorded above; full-feature deployed rollback and recovery evidence pending.
- **UNVERIFIED · Post-deployment production (checklist 7.5).** No deployment performed; actual revision and supported-host journeys pending.
- **PASS · Local receipt (checklist 7.6).** This record captures implemented and locally tested work separately from deployment and live verification.

## 8. Private owner center

- **UNVERIFIED · Cloudflare Access (checklist 8.1).** Owner identity and target Access policy unverified; owner pages behind Cloudflare Access require authenticated production review.
- **UNVERIFIED · Owner headers (checklist 8.2).** Production private/no-store and noindex headers unchecked.
- **PENDING · Migration and backup (checklist 8.3).** Before applying, reconcile the production schema and migration ledger and confirm only the expected migration is pending. Take a full export (stored privately, outside the repository), restore into a scratch database with matching counts, and record a D1 Time Travel bookmark. Apply `0022_software_invoices.sql`. Afterwards: verify row counts and audit id sequence, hash every pre-existing audit row, compare pre-existing table, index and trigger definitions, confirm new objects, run `PRAGMA foreign_key_check`, confirm the ledger has nothing left to apply, and run `owner:health` against the target environment. Local migration tests preserve audit ids and notes and enforce invoice constraints; production procedure is not performed.
- **UNVERIFIED · Persistence and urgent notices (checklist 8.4).** Local transaction tests pass; target storage failure and authorized urgent-email receipt pending.
- **N/A · Traffic summary (checklist 8.5).** No changes to traffic summary.
- **N/A · Playback and campaigns (checklist 8.6).** No changes to playback measurement.
- **UNVERIFIED · Retention manifest (checklist 8.7).** Software retention tests pass locally; reviewed manifest apply in a non-production target remains pending.
- **UNVERIFIED · Studio activation (checklist 8.8).** Existing studio is extended; target email-code, keyboard/mobile, revocation and upload flows unchecked.
- **UNVERIFIED · Payments off (checklist 8.9).** Software invoice API feature flag covered by local tests; actual target flag and existing audio manual-payment journey unchecked.
- **UNVERIFIED · Real R2 retention (checklist 8.10).** Local R2 upload test blocked by sandbox; exact-manifest target storage lifecycle pending.
- **UNVERIFIED · Stripe activation (checklist 8.11).** Stripe live-mode payments, payouts, secrets and test-mode lifecycle not verified. Keep payments disabled until existing activation requirements pass.
- **PASS · Webhook and invoice safeguards (checklist 8.12).** Local suite covers signature verification, deduplication, recoverable invoice attempts, payment gates and identity mismatches with mocked Stripe; Stripe live-mode lifecycle UNVERIFIED.
- **PASS · Owner payment projection (checklist 8.13).** Container tests exclude private customer ids and owner data; no credential added to invoice views. Live HTML/API verification pending.
- **UNVERIFIED · Recovery procedures (checklist 8.14).** No production or target recovery exercises performed.
- **UNVERIFIED · Target health (checklist 8.15).** No remote command run in this job; invoice schema health remains unchecked.

