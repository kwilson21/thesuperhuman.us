# Software agreement signing release gate

- Date: September 30, 2026
- Repository: `kwilson21/thesuperhuman.us`
- Pull request: #158
- Code revision: `f5335fa` (integrates current main `2beb025` with the independently reviewed safeguards and editor fix)
- Local continuation branch: `codex/continue-software-signing`
- Remote PR revision before the authorized update: `308d668e0867ba4a1d063ce4a68051cac504095a`
- Target: production `https://thesuperhuman.us`, private owner and client signing routes, production `MUSIC_DB` and private R2 agreement objects.
- Authorization: Kazon explicitly approved updating PR #158 and checking CI on September 30, 2026 ("Yes", directly replying to the request to push reviewed fixes and check CI). This approval excludes production migration, merge and deployment. Earlier signing decisions remain unchanged.
- Scope: Stage 4b signing implementation, recovered Agreements page structure, five verified PR review fixes, attachment-retention race safeguards, and this release record. Real MSA/SOW text and existing signed evidence were not edited.
- Candidate rollback revision: `2beb02538c597789db8afbcaab4ebc0ff724ce4e`, the observed current GitHub main at verification time. The release operator must confirm the actual deployed revision and save its rollback receipt before production changes.

PASS means observed locally unless an environment is stated. The approved PR update publishes this reviewed branch for CI. No production migration, merge, manual deployment, real signing, external email or payment is authorized or performed by this task. This record is not a launch-ready certification.

## Local evidence

- **PASS:** `npm test`: 119 files, 1,045 passed, one private-template test skipped (1,046 total). Includes local R2 upload verification with loopback access.
- **PASS:** `npm run check`: 420 files, zero errors, zero warnings, 18 existing hints.
- **PASS:** `npm run build`, including asset, copy and publicist prebuild gates.
- **PASS:** The existing software-signing scenario ran against a fresh isolated local Cloudflare preview with public fictional templates: 46 screenshot states. Each state checked overflow at 320, 390, 768 and 1280 pixels. PDF generation and downloads succeeded in the local Cloudflare development runtime.
- **PASS:** Visually inspected Agreements desktop/phone, signature controls and owner countersignature. The recovered editor commit supplies the standard heading, breadcrumb, active Agreements navigation and normal document scrolling without repeated headers.
- **PASS:** Independent correctness/security review reran real caller reproductions and found no remaining verified findings. Independent UI/copy review passed, including 23 targeted render/editor tests.
- **PASS:** `git diff --check`; no dependencies, migrations, legal source text, credentials or unrelated edits in the continuation fix.
- **RELEASE GATE:** Current-head remote CI and screenshots must reach a successful terminal result after the approved push. The final exact-head CI receipt is saved privately and linked in the PR handoff; earlier green checks at `308d668` are insufficient.
- **PASS:** Current main `2beb025` was merged into the signing continuation at `f5335fa` without conflicts. The full suite, Astro check, build and fresh independent reviews pass on the integrated code. Latest-main Building files match main exactly; signing code and editor remain unchanged from the reviewed fixes.

Local logs, manifest and the bounded scenario runner are retained in `.private/continuation/`; generated images are in `screenshots/`. The private fixture test is skipped intentionally because real agreement text is not copied into this checkout or public CI.

## 1. Purpose and content

| Check | Status and evidence |
|---|---|
| 1.1 Project, instructions and authority | PASS locally: exact conversation, repository, PR and code recovered; production authorization pending. |
| 1.2 Approved design and claims | PASS: existing owner presentation reused; fictional agreement fixtures only; legal text unchanged. |
| 1.3 First screen and CTA | PASS locally: owner editor, offer signing and project states captured at desktop/phone and narrow widths. |
| 1.4 Navigation and links | PASS for local signing routes and download states. UNVERIFIED for production links and delivery. |

## 2. Search and sharing

| Check | Status and evidence |
|---|---|
| 2.1 Titles | N/A: continuation changes private agreement flows only. |
| 2.2 Canonical URLs | N/A: no indexable canonical route changes in continuation. |
| 2.3 Open Graph | N/A: no sharing content changes. |
| 2.4 Icons | N/A: no icon changes. |
| 2.5 Robots and sitemap | PASS locally: private-route tests and built sitemap; UNVERIFIED target headers and sitemap. |
| 2.6 Preview indexing/access | PASS local authorization and private headers tests; UNVERIFIED actual edge policy and target preview indexing. |
| 2.7 Structured data | N/A: no structured-data change. |

## 3. Accessibility and responsive behavior

| Check | Status and evidence |
|---|---|
| 3.1 Landmarks/headings | PASS source and render tests: standard owner heading and breadcrumb structure. |
| 3.2 Image alternatives | N/A: no product images added. |
| 3.3 Keyboard/focus | UNVERIFIED comprehensive manual keyboard and focus restoration. |
| 3.4 Input guidance/status | PASS source/render tests and fictional interaction/error states; UNVERIFIED manual screen-reader announcements. |
| 3.5 Contrast/zoom/motion | UNVERIFIED automated accessibility scan, contrast measurement and 200 percent text zoom. Reduced-motion captures alone are not proof. |
| 3.6 Widths/long content | PASS: 46 states, overflow checked at 320/390/768/1280; long editor preview inspected. |
| 3.7 Other browser/device | UNVERIFIED: capture used Chromium; another browser and real mobile device remain pending. |

## 4. Performance and resilience

| Check | Status and evidence |
|---|---|
| 4.1 Images | N/A: no new product images. |
| 4.2 Dependencies/assets | PASS local build and existing bundled fonts; UNVERIFIED deployed compression, caching and loading. |
| 4.3 Performance measures | UNVERIFIED mobile lab and field metrics. |
| 4.4 Retry/duplicates | PASS local signature, artifact, delivery, stale-state and transaction regression tests. |
| 4.5 External resources | PASS mocked failure tests; UNVERIFIED real Turnstile and email availability. |
| 4.6 Error/redirect behavior | PASS relevant local routes and deliberate scenario failures; UNVERIFIED production routing and full offline matrix. |

## 5. Forms and sensitive flows

| Check | Status and evidence |
|---|---|
| 5.1 Boundaries | PASS server validation, owner/session scopes, stale hashes and email rate-limit tests. Invalid Turnstile attempts consume IP allowance but do not exhaust recipient allowance. |
| 5.2 Failure matrix | PASS automated relevant invalid/stale/duplicate/provider failure cases; UNVERIFIED full manual timeout/offline/pending-button matrix. |
| 5.3 No JavaScript | PASS native route and editor tests; UNVERIFIED complete manual no-JavaScript journey and unavailable challenge behavior. |
| 5.4 Delivery | UNVERIFIED production PDF attachment delivery and inbox receipt; mocked provider responses are not delivery evidence. |
| 5.5 Permissions/approval | PASS local scopes, download controls, signing-off defaults and external-start retirement rollback tests. |
| 5.6 Confirmation | PASS local inline statuses and separate review/signing stages captured. |

## 6. Privacy, legal and measurement

| Check | Status and evidence |
|---|---|
| 6.1 Data/processors | PASS implementation inspection: immutable signatures, scoped verification, private templates and R2 evidence. UNVERIFIED deployed processor/configuration inventory. |
| 6.2 Privacy notice | PASS source changes align with configured ten-year agreement retention. UNVERIFIED operator confirmation and deployed notice. |
| 6.3 Consent | UNVERIFIED counsel review and jurisdictional suitability. Do not infer legal approval from implementation tests. |
| 6.4 Legal disclosures/address | UNVERIFIED: prior lawyer involvement was reported; final template/consent review was not completed. Owner must verify contractor configuration and registered-agent address before enabling signing. |
| 6.5 Analytics | N/A: no analytics change. |
| 6.6 Monitoring | UNVERIFIED live failure alerts, authorized recipient receipt and operational response. |

## 7. Release and final QA

| Check | Status and evidence |
|---|---|
| 7.1 Required checks | PASS all local checks listed above; one intentional private-template skip. |
| 7.2 Diff/review | PASS independent reviews and exact continuation diff inspection. Fresh independent reviews pass on integrated code; exact remote CI evidence is required after push. |
| 7.3 Production bindings/schema/headers | UNVERIFIED: no production action performed. |
| 7.4 Rollback/backup | UNVERIFIED production backup, restore rehearsal and deployed rollback receipt. Candidate revision recorded above. |
| 7.5 Post-deployment | UNVERIFIED: feature not deployed by this task. |
| 7.6 Receipt | PASS: local release record, journal checkpoint, logs and screenshot manifest retained. |

## 8. Private owner center

| Check | Status and evidence |
|---|---|
| 8.1 Access identity | PASS local signed-JWT/session tests. UNVERIFIED production owner Access policy. |
| 8.2 Owner headers | PASS local private/no-store/noindex behavior; UNVERIFIED edge responses. |
| 8.3 Migration/backup | PENDING production 0023 authorization and the procedure below. Local 0001 through 0023 application and schema tests pass. |
| 8.4 Persistence/alerts | PASS local transactional writes and failure cases. UNVERIFIED live urgent notice receipt. |
| 8.5 Traffic fallback | N/A: no traffic-summary changes. |
| 8.6 Playback/campaigns | N/A: no measurement changes. |
| 8.7 Retention manifest | PASS synthetic exact-manifest tests, held/live-offer references and concurrent acquisition fences. UNVERIFIED production reviewed manifest use. |
| 8.8 Studio activation | UNVERIFIED target activation, inbox, mobile/keyboard and upload interruption. Existing studio access is reused. |
| 8.9 Payments off/manual path | PASS local external-start tests; omitted agreement fields survive draft edits while signing is disabled. UNVERIFIED actual target payment setting. |
| 8.10 R2 cleanup | PASS local R2 upload test and synthetic agreement retention failure/guard tests. UNVERIFIED deployed agreement cleanup/restore exercise. |
| 8.11 Stripe activation | N/A to signing continuation; existing invoice activation gate remains unchanged. |
| 8.12 Webhook/invoice safeguards | PASS existing local suite; UNVERIFIED live lifecycle. No payment action performed. |
| 8.13 Credential projection | PASS source/render tests; no credentials or private legal text copied to public output. |
| 8.14 Recovery | UNVERIFIED actual database/R2/template recovery and prior deployment rollback. |
| 8.15 Target health | UNVERIFIED: no remote health command in this continuation. |

## Software agreement signing checks

| Check | Status and evidence |
|---|---|
| Counsel review | UNVERIFIED final template and electronic-consent review. |
| Address/configuration | UNVERIFIED owner verification before enabling. |
| One/two/three milestones, both modes | PASS automated template/field/packet cases; scenario visually exercises one milestone with standard terms. |
| Defaults/manual path | PASS signing defaults off and external signatures remain available; unsigned reviews are atomically abandoned and access revoked on external start. |
| Authentication/revocation/reuse | PASS relevant local regression tests. |
| Workers PDF/Unicode/attachments | PASS PDF tests and local Cloudflare development runtime. UNVERIFIED actual deployed Workers runtime. |
| Text/certificates/hashes/copies | PASS synthetic packet and hash tests. UNVERIFIED real-template fixture in this checkout and real two-party inbox receipt. |
| Artifact/email retries | PASS separate local failure/uncertain-recipient tests. |
| Project/archive downloads | PASS local automated and scenario states. |
| Restore rehearsal | UNVERIFIED target agreement records/templates/fonts/storage restore with hashes. |
| Retention/open/held/reuse | PASS local exact-manifest tests, final-reference deletion and active-offer pinning. |
| CI screenshots/keyboard/no-JS/widths | PASS local 46-state widths and visual review. UNVERIFIED updated remote CI screenshots and comprehensive manual keyboard/no-JS checks. |

## Migration 0023 and deployment boundary

**PENDING:** Apply `0023_software_signing.sql` to production only after exact authorization. Reconcile the migration ledger and current schema; export the database, record a recovery bookmark and restore-test the export; apply the approved migration; verify existing counts, new objects, foreign keys, ledger and owner health; save a private receipt before any production merge.

The migration adds private agreement/settings/template/signature/access/artifact/delivery/retention tables, columns on existing software offers and projects, indexes and immutable-evidence triggers. It initializes website signing off. It does not drop/rebuild existing tables or rewrite existing client rows. The feature code depends on this schema.

A code rollback can redeploy the prior build while leaving these additive database objects in place. Removing the schema after clients sign would delete legal evidence and requires separate recovery planning; an entire database restore can also discard newer unrelated writes. Disabling signing prevents new signing but does not erase stored evidence. No down migration or automatic schema reversal is claimed.

## Remaining release actions

1. **PASS locally:** Recovered editor and continuation commits are integrated with current main `2beb025`; required local checks and independent reviews pass. Preserve history while updating the existing PR branch.
2. Publish the approved PR #158 update and verify terminal CI/screenshots for its exact new head. Save the private final-head receipt; keep production gates below separate.
3. Obtain exact production 0023 approval and complete the backup/recovery/apply/verification receipt above.
4. Obtain/confirm production merge and deployment authorization; merge only with current-head checks and required review satisfied. Verify the deployed revision and scoped journeys.
5. Keep signing off until the owner reviews templates/consent/configuration and approves enabling it. Real-client signing and PDF delivery remain separate live checks.
