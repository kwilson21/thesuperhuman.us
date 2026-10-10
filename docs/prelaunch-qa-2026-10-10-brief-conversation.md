# Software brief conversation release gate

Date: October 10, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#172](https://github.com/kwilson21/thesuperhuman.us/pull/172)  
Branch: `codex/brief-conversation`  
Starting code revision: `c33e0b59`; verified revision after merging `origin/main`: `a5d201d6462f63bf30584f2ad23d2e01a3539606` (this record is committed on top).  
Target: production `https://thesuperhuman.us`, `/software/start`, `/privacy`, `POST /api/software-inquiry`, `POST /api/software/brief/pass`, `POST /api/software/brief/suggest`, Workers AI and production `MUSIC_DB`.  
Reviewer: Jewls (Codex), local evidence collection for owner Kazon Wilson. This record does not certify independent current-head review.  
Scope: one question at a time across workflow and idea paths, browser draft resume, inline next-word AI suggestions, keyboard and touch acceptance, optional suggestion toggle, privacy disclosures, Turnstile pass, minute limits and persistent daily caps; migration `0025_brief_suggestion_budget.sql`. Existing PR #170 receipt and release record are preserved from main.  
Rollback revision: `7d6b00a5e556cab7e5a52e1fa4d0af6720a6054a`, current local `origin/main`. Deploy order: apply additive 0025 before merging to main. Current main keeps working with it applied; suggestion code fails closed without its table. Keep the additive table on code rollback; no request data is migrated or deleted.

## Owner decisions and authorization

Owner, in conversation, 2026-10-09:

- B1: "1. C with AI autocomplete would be incredible here."
- "Autocomplete as a person types, it works just like how ai autocomplete works except it detects their next word or words."
- "wording OK and workers AI is fine"

Owner, in conversation, 2026-10-10:

- "Yes a hard daily cap is a good idea"
- In-box suggestion feedback: "why force them to take a hand off the keyboard to click a suggestion? Why not finish it in the textbox like it shows in the image above?"
- Deployment: "proceed with fixing reviews until we are ready to merge everything then merge"
- Migration 0025 production authorization: "2 yes"

Deployment authorization is conditional on review, CI and applicable deployment gates. This job merges main into the feature branch only; it does not merge the PR or deploy.

## Evidence and limits

Read AGENTS.md, CLAUDE.md, the reusable checklist and both requested release-record examples. Merged local `origin/main` without conflicts; PR #170 content remains intact. Git's post-merge operation reported a sandbox denial for `packed-refs.lock`, but the merge commit and branch HEAD were verified. No remote fetch was performed.

Inspected the 28-file feature diff against main: page and client flow, suggestion and pass APIs/helpers, privacy notice, bindings/types, schema/migration, owner health, screenshot scenario and regression tests. No dependency or generated image additions in the feature diff. Untracked `.jolli/` was left out of the commit.

Checks at the merged revision:

- `npm run copy:check`: PASS.
- `npm run check`: PASS, 395 files, 0 errors, 0 warnings, 14 hints. Hints include existing retention-script properties, unused declarations, inline JSON-LD and deprecated `keyCode` in autocomplete. Content sync reports absent notes and no audio-track files.
- `npx vitest run`: FAIL, 117 files passed, 1 failed; 1,081 tests passed, 1 failed (1,082 total), 1 unhandled error. `tests/lib/audio-project-uploads.test.ts` local R2 integration timed out after 15 seconds with sandbox `listen EPERM` on localhost; Wrangler log writing was also denied. This is not a green full-suite result.
- `npx vitest run tests/scripts/screenshots.test.ts`: PASS, 23 tests.

Viewed local `origin/screenshots` artifacts: `pr-172/713cdfd/software-brief-suggestion-desktop.png` and `software-brief-suggestion-phone.png`, plus older `pr-172/cb66f1d/software-brief-question-1-phone.png` and suggestion desktop/phone captures. The 713cdfd captures show ghost text inside the answer box with Tab/tap hints, Back/Next, disclosure and Turn off. Older cb66f1d captures show the prior separate suggestion control and are historical evidence only. These screenshots precede c33e0b59's sizing and draft fixes and the main merge; they do not verify the final head. No screenshots at c33e0b59 or the merge revision are present in the local screenshot ref. Scenario responses are mocked, not evidence of real AI or email delivery. CI conclusions were not retrieved.

This is a scoped record. PASS means observed local tests, source inspection or explicitly named screenshots, not production verification. Applicable unknowns remain UNVERIFIED. No build, real email, Workers AI invocation, remote migration, deployment or live verification was performed.

## 1. Purpose and content

- **PASS · Scope and instructions (checklist 1.1).** Branch, revisions, scope and conditional owner authorization recorded above.
- **PASS · Approved design and claims (checklist 1.2).** Owner wording decisions recorded verbatim; copy check passes; no feature media changes.
- **UNVERIFIED · First screen and CTA (checklist 1.3).** One-question phone capture and regression traversal tests reviewed; final-head desktop/narrow CTA interaction pending.
- **UNVERIFIED · Navigation and links (checklist 1.4).** Escape, footer and privacy links visible in captures; destinations not exercised.

## 2. Search and sharing

- **N/A · Titles and descriptions (checklist 2.1).** Existing titles/descriptions are unchanged.
- **N/A · Canonicals (checklist 2.2).** No canonical configuration or public route additions.
- **N/A · Open Graph (checklist 2.3).** Sharing metadata and images unchanged.
- **N/A · Icons (checklist 2.4).** No icon changes.
- **UNVERIFIED · Robots and sitemap (checklist 2.5).** Target sitemap and private API exclusion not checked live.
- **UNVERIFIED · Preview indexing and access (checklist 2.6).** Local previews cannot invoke AI by tested hostname guard; target indexing and access controls unchecked.
- **N/A · Structured data (checklist 2.7).** No structured data changes.

## 3. Accessibility and responsive behavior

- **PASS · Structure by source (checklist 3.1).** Question headings and form structure inspected; page regression tests pass. Full browser landmark audit pending.
- **PASS · Alternatives and names (checklist 3.2).** No image additions; accessible acceptance button has suggestion-specific name in code and tests.
- **UNVERIFIED · Keyboard and focus (checklist 3.3).** Tests cover Tab, ArrowRight, selection, normal Tab navigation and Back/Edit; manual focus and keyboard review pending.
- **UNVERIFIED · Labels and announcements (checklist 3.4).** Tests cover required answers and remapped errors; screen-reader announcement review pending.
- **UNVERIFIED · Contrast, zoom and motion (checklist 3.5).** No measured contrast, automated accessibility, 200% zoom or reduced-motion review.
- **UNVERIFIED · Widths and long content (checklist 3.6).** Earlier desktop/phone captures show in-box completion; sizing test passes. Final-head captures, 320px, tablet and expanded menus pending.
- **UNVERIFIED · Browsers and devices (checklist 3.7).** No second-browser or real-device interaction.

## 4. Performance and resilience

- **N/A · Images (checklist 4.1).** No feature image changes.
- **UNVERIFIED · Client code and loading (checklist 4.2).** No dependency added; built compression, caching and asset loading unchecked.
- **UNVERIFIED · Performance measures (checklist 4.3).** No lab or field measurements.
- **PASS · Suggestion recovery by tests (checklist 4.4).** Tests cover errors, timeout, empty output, stale responses, cancellation, pass renewal and preservation of drafts on failed delivery. Suggestions never block writing; manual offline recovery pending.
- **UNVERIFIED · External resources (checklist 4.5).** Workers AI, Turnstile and Resend mocked; actual availability unchecked.
- **UNVERIFIED · Errors and redirects (checklist 4.6).** Fail-closed API tests pass; target 404, redirects and HTTP recovery unchecked.

## 5. Forms and sensitive flows

- **PASS · Server boundaries (checklist 5.1).** Bounded strict schema, origin/content checks, signed IP-bound Turnstile pass and rate/budget safeguards covered locally. Direct AI binding uses a 12-token output cap, at most six words and a 1.2-second response timeout.
- **UNVERIFIED · Full failure matrix (checklist 5.2).** API/flow tests cover invalid input, limit exhaustion, errors, retry and duplicate submission. Full browser verification/network/pending matrix not exercised.
- **UNVERIFIED · Unavailable JavaScript or verification (checklist 5.3).** Silent pass requiring interaction yields no suggestion in tests; manual no-JavaScript and verification-unavailable fallback pending.
- **UNVERIFIED · Delivery and receipt (checklist 5.4).** No authorized real target email or AI call. PR #170 receipt behavior preserved, not live verified.
- **PASS · Approval and permissions by tests (checklist 5.5).** Full local suite includes existing owner/access and inquiry guards; no intended approval-gate changes. Live links and permissions pending.
- **PASS · Inline confirmation by tests (checklist 5.6).** Existing inline receipt remains; no separate thank-you route introduced.

## 6. Privacy, legal and measurement

- **UNVERIFIED · Data inventory (checklist 6.1).** Source sends only answer text and allowed earlier answers to Workers AI, excluding contact fields. Browser draft and preference use localStorage; security cookie is HttpOnly, Secure, SameSite=Strict, path-scoped, 30 minutes. D1 stores UTC-day keyed HMAC visitor counters and site count, not answer text. Production logs/injected scripts unchecked.
- **UNVERIFIED · Privacy notice (checklist 6.2).** Updated notice discloses Workers AI, contact-field exclusion, browser drafts, toggle, security cookie and bounded cleanup caveat; nearby link exists. Operator retention/processor confirmation and live notice pending.
- **UNVERIFIED · Consent decision (checklist 6.3).** Security cookie and optional AI processing disclosed; no new analytics. Jurisdiction/consent assessment not established by this job.
- **N/A · Commerce disclosures (checklist 6.4).** No commerce, contract or business-address changes.
- **N/A · Analytics (checklist 6.5).** No new analytics.
- **UNVERIFIED · Monitoring (checklist 6.6).** Owner health schema requirement updated and tested; real failure receipt and response not exercised.

## 7. Release and final QA

- **FAIL · Required checks (checklist 7.1).** Copy and Astro pass; screenshot tests pass; full suite has sandbox-blocked R2 failure detailed above. Build/asset checks and green CI unverified.
- **UNVERIFIED · Exact diff and review (checklist 7.2).** Feature diff inspected; this record is the only new tracked change after merge. Independent review of final head and green CI remain pending; this record is evidence collection, not a review pass.
- **UNVERIFIED · Production configuration (checklist 7.3).** AI, Turnstile secret, MUSIC_DB, flag and both limiter bindings configured locally, not verified in production. Minute limits: 30 per visitor, 120 site-wide; D1 UTC daily hard caps: 300 visitor, 10,000 site. Missing/throwing bindings, missing schema and exhausted limits return no suggestion. Migration evidence pending below.
- **UNVERIFIED · Rollback and backup (checklist 7.4).** Exact main rollback recorded; additive migration compatibility inspected. Production backup/recovery and redeployment not exercised.
- **UNVERIFIED · Post-deployment QA (checklist 7.5).** No deployment; verify revision, both brief paths, suggestions on/off, pass renewal, saved receipt, privacy, supported hosts and indexing after deployment.
- **PASS · Local receipt (checklist 7.6).** This record distinguishes implemented/local verification from deployment/live verification; reopen after material changes.

## 8. Private owner center

- **UNVERIFIED · Cloudflare Access (checklist 8.1).** Existing target owner policy and signed-JWT identity not exercised.
- **UNVERIFIED · Owner headers (checklist 8.2).** Target private/no-store and noindex unchecked.
- **UNVERIFIED · Migration reconciliation and backup (checklist 8.3).** 0025 is additive CREATE TABLE with composite day/scope primary key. Local schema tests pass; production ledger, backup and applied evidence pending below.
- **PASS · Persistence before success by tests (checklist 8.4).** Inquiry persistence/failure and brief-copy regressions pass locally; actual urgent-email receipt unchecked.
- **N/A · Traffic summary (checklist 8.5).** No traffic-summary changes.
- **N/A · Playback and campaigns (checklist 8.6).** No playback/campaign changes.
- **UNVERIFIED · Retention manifest (checklist 8.7).** No target manifest preview/apply. Suggestion cleanup is bounded to 1,000 rows before previous UTC day on first site reservation; tests verify retention and capped-request behavior.
- **N/A · Studio activation (checklist 8.8).** No activation/access/upload changes.
- **N/A · Payments off (checklist 8.9).** No payment flag or installment changes.
- **N/A · Real R2 retention (checklist 8.10).** No R2 retention changes; unrelated local R2 upload verification failed as recorded.
- **N/A · Stripe activation (checklist 8.11).** No Stripe activation changes.
- **N/A · Webhook and invoice safeguards (checklist 8.12).** No webhook/invoice changes.
- **N/A · Payment projection (checklist 8.13).** No owner payment HTML/API changes.
- **UNVERIFIED · Recovery procedures (checklist 8.14).** No target rollback, D1 recovery or visitor recovery exercise.
- **UNVERIFIED · Target health (checklist 8.15).** No remote owner:health run; new table is required by local health/schema tests.

## Production migration 0025: pending

**UNVERIFIED.** Authorized by owner "2 yes" (in conversation, 2026-10-10). Required release order: 0025 is applied before merge to main. It has not been applied or verified by this job. Fill this section with the actual production ledger reconciliation, backup/recovery evidence, application timestamp and result, schema/ledger readback and target health result. Do not treat authorization or passing local schema tests as an applied receipt.

Remaining work: production migration evidence first; current-head review and green required CI; final-head screenshot and applicable accessibility/responsive QA; target bindings, privacy decisions, delivery, monitoring, recovery and health verification; authorized merge/deployment followed by live receipt. This record does not claim launch readiness.
