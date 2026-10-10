# Software agreement signing release gate

- Updated: October 10, 2026. Jewls (Codex), local integration and release-record preparation.
- Repository: `kwilson21/thesuperhuman.us`, PR #158, branch `codex/software-signing`.
- Integrated main and rollback revision: `5137d3d17b88c5c34c642869613bb757650e89cf` (PR #172). Confirm the actual deployed revision and preserve its deployment receipt before release.
- Signing revision before integration: `c6035bbf`. Merge revision: `5cbc4bc7fe55925bf3888b2ba5815c842183bd94`; the subsequent record-only commit is identifiable in Git history.
- Target: production `https://thesuperhuman.us`, private owner/client signing routes, MUSIC_DB and private agreement storage.
- Scope: one-page signing rework, one-time email-link landing, returning-client SOW wording, retained legal evidence, all implemented signing review fixes, and integration with main's brief conversation, AI suggestions, Turnstile pass and D1 daily caps.

PASS needs observed evidence and is local unless stated otherwise. Historical captures and earlier CI passes do not certify this revision. This task neither applies production migrations nor merges PR #158 to main. Implemented, verified locally, deployed and verified live remain separate states. The full local suite has a sandbox-caused failure; this record does not certify launch readiness.

## Owner decisions and authorization

October 9, 2026, source: owner statements recorded in spec S:

- S5: "3. A", one-time email link.
- S1: "4. A", one page, mostly filled in.
- S2/S3: "5. A", one required portfolio question, no initials or business tick, no client-visible interim label.
- S4: "6. A", name as signature and one consent tick.
- Copy: "wording OK".

October 10, 2026, owner statements supplied in this task:

- S6: "1. A". Opening the emailed link shows `Your agreement is ready.`; only `Continue to sign` consumes it.
- S7: "2. A". Two document links and intent referring to the documents linked above.
- Returning clients: "Let's pick the option that confuses the client the least". SOW-only signing wording and `Your signed agreement from {date} still applies.`
- Production migrations 0023/0024: "3 yes" (owner, in conversation).
- Deployment: "proceed with fixing reviews until we are ready to merge everything then merge" and "keep going until everything is merged".

These approvals supersede the older spec's production-authorization exclusions. This bounded job prepares the branch and record. Production migration receipts are recorded below from the supplied operator summary; approval alone is not evidence of execution. Signing stays off until its separate template, consent and configuration gates are satisfied.

## Current implementation and review fixes

PASS automated coverage in `tests/lib/software-agreements.test.ts`, `tests/pages/software-offer.test.ts`, the signing API tests and related retention/packet suites: one-time link single use/expiry, explicit landing consumption, two-hour session and saved draft, brief prefill, contact fallbacks, portfolio mapping, one consent tick, verbatim consent/intent and document hashes, validation, SOW-only reuse, waiting/signed pages and owner countersignature. Internal source revision identifiers remain separate from client version labels.

The branch includes fixes for Turnstile before recipient email allowance, preserving signing details while disabled, retiring unsigned reviews before external start, canonical access and stored statements, reused MSA pinning, agreed retention/review periods, recipient signature receipts, link retry verification, serialized attachment uploads, preserving existing links until replacement delivery succeeds, artifact and recipient delivery retry, invoice/retention reconciliation, owner health, and signed-copy archive access during project cleanup. Evidence: branch history through `c6035bbf`, including `d59123f3`, `878e9ced`, `aea6d083`, `4d6574ea`, `87092edf`, `b9faf139`, `cfca816d` and `c6035bbf`, with corresponding regression tests. These are implementation/test claims, not delivery or legal approval claims.

Main integration retains migrations 0023/0024 before 0025, the listed required schema objects, all 11 columns added by 0023, and both columns added by 0024, post-deploy-only signing-route health, AI and rate-limit bindings, retention binding identity, preview SITE_ORIGIN, both screenshot flows, and both privacy disclosures. Local owner-health regression coverage loads the complete schema, drops `software_offers.recipient_email_snapshot`, and requires schema attention instead of PASS. This checks the listed deployment requirements, not every column in every table. No new dependency or legal template source was added.

## Checks run October 10, 2026

After the test typing fix on parent revision `e122e50d`, reran `npm run check` (exit 0: 440 files, zero errors, zero warnings, 17 hints), `npx vitest run tests/lib/software-agreements.test.ts` (exit 0: 140 tests pass), and `npm run copy:check` (exit 0: no banned patterns). The archive cooldown assertion now uses the existing fixture secret supplied to `AUDIO_CLIENT_CODE_KEY`; production hashing is unchanged. Other checks below retain their earlier results and were not rerun for this test-only fix.

| Check | Status and evidence |
|---|---|
| `npx vitest run tests/scripts/screenshots.test.ts` | PASS: 30 tests. |
| `npx vitest run` | FAIL: 124 files pass, one fails; 1,325 tests pass, one local R2 upload test times out. Sandbox denies `listen 127.0.0.1` with EPERM, producing one unhandled error; Wrangler's default log path is also denied. Requires rerun where local listeners are permitted. No assertion was removed or bypassed. |
| `npm run check` | PASS: 440 files, zero errors, zero warnings, 17 hints, including main's deprecated keyboard keyCode hint. |
| `npm run copy:check` | PASS: no banned patterns. |
| `npm run assets:check` | PASS: 36 production assets match review records. |
| Migration concatenation | PASS: byte comparison of `db/music.sql` against all sorted `migrations/music/*.sql`, including 0022, 0023, 0024 and 0025. |
| JSONC | PASS: existing preview/JSONC regression tests retain and parse both sets of bindings. |
| `git diff --check` | PASS resolved-file and record diff. Integrated main has eight existing Markdown hard-break trailing-space warnings in its brief release record; preserved unchanged. |
| Build and visual screenshots | UNVERIFIED: not run, per spec S; CI captures require current-head review. |

## Applicable Definition of Done

The rows below map every check in `docs/prelaunch-checklist.md`. PASS source/test rows describe automated evidence in the current suite. Previous release manual observations are historical only; any unverified production or manual check remains a release gate.

## 1. Purpose and content

| Check | Status and evidence |
|---|---|
| 1.1 Project, instructions and authority | PASS locally: exact conversation, repository, PR and code recovered; owner production authorization and supplied migration execution evidence recorded below. |
| 1.2 Approved design and claims | PASS: existing owner presentation reused; fictional agreement fixtures only; legal text unchanged. |
| 1.3 First screen and CTA | PASS automated CTA/render tests. UNVERIFIED current-head manual desktop/phone CTA checks. |
| 1.4 Navigation and links | PASS for local signing routes and download states. UNVERIFIED for production links and delivery. |

## 2. Search and sharing

| Check | Status and evidence |
|---|---|
| 2.1 Titles | N/A: continuation changes private agreement flows only. |
| 2.2 Canonical URLs | N/A: no indexable canonical route changes in continuation. |
| 2.3 Open Graph | N/A: no sharing content changes. |
| 2.4 Icons | N/A: no icon changes. |
| 2.5 Robots and sitemap | PASS locally: private-route tests; UNVERIFIED current built sitemap, UNVERIFIED target headers and sitemap. |
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
| 3.6 Widths/long content | UNVERIFIED current-head visual captures at 320/390/768/1280; signing scenario coverage is present and harness tests pass. |
| 3.7 Other browser/device | UNVERIFIED: capture used Chromium; another browser and real mobile device remain pending. |

## 4. Performance and resilience

| Check | Status and evidence |
|---|---|
| 4.1 Images | N/A: no new product images. |
| 4.2 Dependencies/assets | PASS asset manifest check and existing bundled fonts; UNVERIFIED current build, UNVERIFIED deployed compression, caching and loading. |
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
| 5.6 Confirmation | PASS automated confirmation/render tests; UNVERIFIED current-head visual capture. |

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
| 7.1 Required checks | FAIL full suite due to sandbox-blocked local R2 listener; 1,325 tests pass. PASS Astro, screenshot harness, copy, assets and migration concatenation. UNVERIFIED build, deliberately not run under spec S. |
| 7.2 Diff/review | PASS local merge resolution inspection and independent merge reviews recorded below. UNVERIFIED current-head remote review, CI and screenshot receipt. |
| 7.3 Production bindings/schema/headers | UNVERIFIED: no production action performed. |
| 7.4 Rollback/backup | UNVERIFIED production backup, restore rehearsal and deployed rollback receipt. Candidate revision recorded above. |
| 7.5 Post-deployment | UNVERIFIED: feature not deployed by this task. |
| 7.6 Receipt | PASS local release record and check logs. UNVERIFIED current-head screenshot receipt; private journal checkpoint attempted separately. |

## 8. Private owner center

| Check | Status and evidence |
|---|---|
| 8.1 Access identity | PASS local signed-JWT/session tests. UNVERIFIED production owner Access policy. |
| 8.2 Owner headers | PASS local private/no-store/noindex behavior; UNVERIFIED edge responses. |
| 8.3 Migration/backup | PASS supplied production 0023/0024 execution and backup evidence recorded below. PASS local schema tests through 0025. |
| 8.4 Persistence/alerts | PASS local transactional writes and failure cases. UNVERIFIED live urgent notice receipt. |
| 8.5 Traffic fallback | N/A: no traffic-summary changes. |
| 8.6 Playback/campaigns | N/A: no measurement changes. |
| 8.7 Retention manifest | PASS synthetic exact-manifest tests, held/live-offer references and concurrent acquisition fences. UNVERIFIED production reviewed manifest use. |
| 8.8 Studio activation | UNVERIFIED target activation, inbox, mobile/keyboard and upload interruption. Existing studio access is reused. |
| 8.9 Payments off/manual path | PASS local external-start tests; omitted agreement fields survive draft edits while signing is disabled. UNVERIFIED actual target payment setting. |
| 8.10 R2 cleanup | FAIL sandbox-blocked local R2 upload test. PASS synthetic agreement retention failure/guard tests. UNVERIFIED deployed agreement cleanup/restore exercise. |
| 8.11 Stripe activation | N/A to signing continuation; existing invoice activation gate remains unchanged. |
| 8.12 Webhook/invoice safeguards | PASS existing local suite; UNVERIFIED live lifecycle. No payment action performed. |
| 8.13 Credential projection | PASS source/render tests; no credentials or private legal text copied to public output. |
| 8.14 Recovery | UNVERIFIED actual database/R2/template recovery and prior deployment rollback. |
| 8.15 Target health | PASS supplied pre-merge remote health: 8/8 checks. UNVERIFIED post-deploy health; the owner runs it after merge. |

## Software agreement signing checks

| Check | Status and evidence |
|---|---|
| Counsel review | UNVERIFIED final template and electronic-consent review. |
| Address/configuration | UNVERIFIED owner verification before enabling. |
| One/two/three milestones, both modes | PASS automated template/field/packet cases; UNVERIFIED current-head visual template previews. |
| Defaults/manual path | PASS signing defaults off and external signatures remain available; unsigned reviews are atomically abandoned and access revoked on external start. |
| Authentication/revocation/reuse | PASS relevant local regression tests. |
| Workers PDF/Unicode/attachments | PASS automated PDF tests. UNVERIFIED current-head actual Cloudflare runtime exercise. UNVERIFIED actual deployed Workers runtime. |
| Text/certificates/hashes/copies | PASS synthetic packet and hash tests. UNVERIFIED real-template fixture in this checkout and real two-party inbox receipt. |
| Artifact/email retries | PASS separate local failure/uncertain-recipient tests. |
| Project/archive downloads | PASS local automated tests; UNVERIFIED current-head captured scenario states. |
| Restore rehearsal | UNVERIFIED target agreement records/templates/fonts/storage restore with hashes. |
| Retention/open/held/reuse | PASS local exact-manifest tests, final-reference deletion and active-offer pinning. |
| CI screenshots/keyboard/no-JS/widths | PASS 30 screenshot-harness tests and retained signing scenarios. UNVERIFIED current-head CI images, manual keyboard/no-JS and width checks. Earlier captures do not certify the reworked flow. |

## Production migrations 0023 and 0024: applied

**PASS · Migration and backup, supplied operator record.** Kazon authorized applying 0023 and 0024 to production ("3 yes", owner, in conversation, October 10, 2026). The supplied operator summary records read-only checks at approximately 09:05 America/New_York from the signing worktree at `a5dcea23`. Only `0023_software_signing.sql` and `0024_software_delivery_selection_and_review_windows.sql` were pending; 0025 was already applied. A full export was taken privately (160,994 bytes, mode 600) and restored into scratch SQLite with matching request, audit, audio-project, offer and software-project counts and four triggers; scratch was deleted. This documentation job read only the summary, not the export.

Before and after counts were identical: 3 requests, 6 audit rows, 1 audio project, 0 offers, 0 software projects, 0 project updates, 1 audio payment and 0 suggestion budget rows. The audit sequence was 6 before migration; the audit hash was `dd461df916feaa70` both before and after. On October 10, 2026, remote migration apply completed 0023 (39 commands), then 0024 (3 commands); the summary does not supply exact completion times. Of 70 pre-existing definitions, only the three expected altered tables changed: `software_offers`, `software_projects` and `software_project_updates`, each with added columns. There were 26 new objects (signing tables, triggers and indexes); total schema objects went from 110 to 156. `software_signing_enabled = 0` was stored, keeping website signing off. `PRAGMA foreign_key_check` was empty, the ledger was clean ("No migrations to apply"), and `npm run owner:health -- --remote` passed 8/8 checks, including the listed migration columns and signing origin `https://thesuperhuman.us`.

The pre-migration D1 Time Travel bookmark `0000004e-00000002-00005100-6b80a5655c9775ec0adf38c01db5aa75` is the database rollback point. A full agreement/storage recovery rehearsal remains UNVERIFIED. These results are attributed to the supplied operator summary, not independent remote checks by this documentation job. After merge, the owner runs `npm run owner:health -- --remote --post-deploy` and records the deployed revision and live verification. Website signing stays off until the owner enables it after the separate template, consent and configuration gates are satisfied.

Deploy order:

1. Reconcile production MUSIC_DB and its migration ledger. Preserve database backup and recovery evidence.
2. Apply `0023_software_signing.sql`, then `0024_software_delivery_selection_and_review_windows.sql` before merging PR #158 to main. Both are additive; current main keeps working with them. 0023 initializes website signing off. 0024 adds delivery selections and extended review windows without changing the existing 5-to-30-day constraint.
3. Run `npm run owner:health -- --remote` before merge. It requires signing objects, all 11 columns added by 0023, both 0024 columns, `brief_suggestion_budget`, configuration and retention binding identity, but does not check the undeployed signing landing.
4. Complete exact-head review, green CI and CI screenshot inspection, resolve all applicable release gates or record an explicit owner-accepted exception, then merge under the recorded deployment authorization.
5. The owner runs `npm run owner:health -- --remote --post-deploy` after merge and deployment, including the bare `/agreements/verify` 401 check. Save the deployed revision and verify the live journeys, headers, indexing, delivery and monitoring.

Rollback: preserve `5137d3d17b88c5c34c642869613bb757650e89cf`, current origin/main at this job. A code rollback leaves additive schema in place. Do not drop signed evidence or restore the whole database over newer writes without separate recovery planning. Disabling signing prevents new signing and preserves existing evidence. Backup and pre-merge remote health are recorded above; actual rollback rehearsal and post-deploy health remain UNVERIFIED.

## Independent merge review

PASS: independent correctness/security and UI/copy agents reviewed all 12 conflict resolutions and their callers. Both reported no verified findings. These reviews cover the integration diff, not a new review of the entire PR #158 head or rendered screenshots.

## Remaining release work

- Rerun the full suite with loopback access; complete build and exact-head CI/review/screenshot receipts.
- Record the owner's post-deploy health receipt; supplied migration and pre-merge health evidence is recorded above.
- Complete manual accessibility, cross-browser/device, no-JS, actual Workers PDF, authorized inbox delivery, monitoring and recovery checks.
- Verify counsel/template status and owner contractor/address configuration before enabling signing. No owner understanding or legal suitability is certified by this record.
- Save post-deployment/live verification separately. No real email, payment, signing, migration or deployment was performed by this job.

## Signing lifecycle follow-up, October 10, 2026

Local regression coverage now refuses request resolution and withdrawal while a client signature awaits countersignature, displays the required owner guidance, removes external offer events with retained project content, sends executed copies without stale waiting notices on retry, and uses secret-keyed archive cooldown identities pruned by the existing allowance lifecycle. No schema or migration change.

PASS: focused signing, studio retention and rendered owner tests; copy check; Astro check (0 errors, 0 warnings); screenshot harness (30 tests). The full suite was run; local R2 upload remains blocked by sandbox loopback permission (EPERM). After correcting the rendered fixture, all 124 other suites pass (1,324 tests) with only the R2 upload file excluded. CI captures and exact-head review remain UNVERIFIED. No build, real email, remote command, push or deployment in this follow-up.

Uncertain signing notices still in `sending` are settled as `failed` in the countersign or abandonment transaction, preserving attempt evidence and recording `delivery-failed` with an obsolete-notice reason. They are excluded from email retry and its control count after the state change and no longer block retention. Genuinely failed notices remain retryable while the agreement is client-signed and no project has started. Executed client copies retain their separate delivery and retry flow. No schema or migration change.
