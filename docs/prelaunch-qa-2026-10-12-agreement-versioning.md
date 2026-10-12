# Software agreement versioning release gate

Date: October 12, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#176](https://github.com/kwilson21/thesuperhuman.us/pull/176)  
Branch: `claude/agreement-versioning-v1-b28b03`  
Starting revision: `2d98c299` (`origin/main` at branch start). Verified revision: `c033811c`, where the checks under Evidence and limits were rerun. Commits after the three review rounds (`05419bad`): `bcd252ec` and `1baa440c` record the release gate and the production migration; `73112d20` rewords the Source revision hint in `src/pages/owner/agreements.astro` and its assertions in `tests/pages/software-offer.test.ts` to the owner-approved copy; `7bb99943` adds a source revision limit test; `c033811c` corrects the runbook's hint wording. This record is committed on top of `c033811c`, with docs-only corrections after it.  
Target: production `https://thesuperhuman.us`, `/owner/agreements`, `POST /api/owner/agreements` (`preview`, `publish`, new `template-version`), owner request pages with a software offer (agreement details), `/offer/{token}/sign`, signed agreement PDFs and certificates, and production `MUSIC_DB`.  
Reviewer: Claude (Opus 5.5) coordinating for owner Kazon Wilson. Claude Haiku 5.5 subagents implemented each task tests first. Claude Sonnet 5.5 reviewed each task, and two Claude Opus 5.5 reviewers (correctness and security; UI, copy and repository rules) reviewed the whole branch in three rounds up to `05419bad`, with each finding checked by an independent verifier. The third round found nothing to fix. `73112d20` (the hint reword) was reviewed separately, clean, by two Claude Sonnet 5.5 reviewers. Fixes made after the review of `1baa440c` (`7bb99943`, `c033811c`) have not been reviewed yet. This record does not certify Greptile or CI results at the final head.  
Scope: each published template version carries its own `version_label` and optional `source_revision`, replacing the fixed `v2026-09-30` label and the fixed interim source revision; the Agreements page publish form gains Version label and Source revision fields; Preview shows a line diff against the current version (`Changes from {label}`, or `First version. Nothing to compare yet.`); version history gains View text and Compare with previous; publishing identical text or a reused label is refused; the sign page, PDF page headers and certificates show each document's own label; an MSA the owner reuses under Existing MSA keeps the version the client signed, and the offer editor says which MSA a reused agreement uses. Migration `0026_agreement_template_labels.sql`.  
Rollback revision: `04c32461` (#177), `origin/main` at inspection and the revision production ran per the Workers Builds run that succeeded at 2026-10-12 20:38 UTC. Rolling back to `2d98c299` would also undo #177's profile correction. Confirm this against the production deployment or `git ls-remote origin main` at merge time, and record what it shows if main has moved. Deploy order: apply additive 0026 before merging to main, because a push to main deploys production. Current main keeps working with 0026 applied: it reads templates with `SELECT *` and its insert names its columns. Keep the additive columns on code rollback; no data is migrated or deleted.

## Owner decisions and authorization

Owner, in conversation, 2026-10-12:

- "A and A are fine, go ahead": existing clients keep the MSA they signed until both agree otherwise and new clients get the current MSA; mid-project changes to a signed SOW become change orders (separate design, not in this release).
- Implementation by Claude Haiku 5.5 subagents with Sonnet or Opus review rounds, for this repository.
- Migration 0026 production authorization, with a read-only check of the template rows: "Yes, apply 0026".
- The `{{msa.source_revision}}` placeholder in agreement text prints the MSA's version label, which keeps today's rendered text; the typed source revision is stored in the agreement values and the certificate JSON (the signing record attached to the signed PDF), not on the visible PDF pages: "Yes, keep it".
- Source revision hint reworded to "Your reference for the legal source, for example a counsel revision. Clients can see it in the signing record attached to the signed PDF." (owner chose to reword the hint).

Coordinator ruling: each document's certificate carries its own template's label and source revision, so a SOW shows the SOW template's.

## Evidence and limits

Checks at `c033811c`, rerun from this worktree by a Claude Haiku 5.5 subagent for this fix round (the three whole-branch review rounds ran against `05419bad`):

- `npx vitest run`: PASS, 130 files, 1,451 passed, 1 skipped. The extra pass over `05419bad` is the new source revision limit test. The skip is the private-template test that runs only when the private template file exists.
- `npm run check`: PASS, 447 files, 0 errors, 0 warnings, 17 hints. The two hints in touched files predate this branch.
- `npm run copy:check`: PASS. `npm run assets:check`: PASS, 36 production files match their review records.
- `npx vitest run tests/scripts/screenshots.test.ts`: PASS, 36 tests.
- `grep -rn "2026-09-30\|Interim" src`: no output. `cmp db/music.sql <(LC_ALL=C cat migrations/music/*.sql)`: silent.
- Re-checked at `c033811c`: no em dashes in added lines since `2d98c299`; `package.json` and `package-lock.json` unchanged since `2d98c299`. From `05419bad`, not rechecked here: no buzzwords in added lines, and no private template text, rates or PDFs in the diff.
- `73112d20` (hint copy and its test) was reviewed clean by two Sonnet reviewers before this run, and this run covers it.

Not run locally: `npm run build` and screenshot capture (CI runs both). The checks above are local. Remote work for this record: migration 0026 with its read-only checks and `owner:health --remote` run (under Production migration 0026), and the rollback revision read from `origin/main` and the Workers Builds run (above). No deployment of this branch and no live check of `/owner/agreements` was performed for this record.

## 1. Purpose and content

- **PASS · Scope and instructions (checklist 1.1).** Branch, revisions, scope and owner decisions recorded above; migration 0026 is authorized and applied (see Production migration 0026: applied); deployment waits on review of the final head, green CI and owner approval of the screenshots, as listed under Remaining work.
- **PASS · Approved design and claims (checklist 1.2).** Field labels, hints, diff copy, refusals, sign-page line and offer-editor line match the owner-approved spec character for character (UI and copy reviewer, round 3, at `05419bad`; the reworded Source revision hint at `73112d20` checked by two Sonnet reviewers). No media changes.
- **N/A · Explanatory copy (checklist 1.3).** Owner and signing UI only; no public explanatory copy or resume claims change.
- **N/A · First screen and CTA (checklist 1.4).** No public page changes.
- **N/A · Navigation and links (checklist 1.5).** No navigation changes.

## 2. Search and sharing

- **N/A · Checklist 2.1 to 2.7.** Owner pages, the owner API and the token-gated sign page are private and noindex; no titles, canonicals, sharing metadata, icons, sitemap or structured data change.

## 3. Accessibility and responsive behavior

- **PASS · Structure by source (checklist 3.1).** Heading order h1, h2, h3 on the Agreements page; the diff heading is an h3.
- **N/A · Alternatives and names (checklist 3.2).** No images or icon-only controls added.
- **UNVERIFIED · Keyboard and focus (checklist 3.3).** History buttons are `type="button"` and move focus to their output; tests cover this in a script harness. Manual keyboard pass pending.
- **PASS · Labels and announcements by source (checklist 3.4).** Both inputs have visible labels and hints joined with `aria-describedby`; the preview diff is a polite live region cleared before each request. Screen-reader pass pending.
- **UNVERIFIED · Contrast, zoom and motion (checklist 3.5).** Diff rows use the existing muted and accent tokens; no measurement taken.
- **UNVERIFIED · Widths and long content (checklist 3.6).** Long labels wrap on the Agreements page and in the offer editor's agreement details (tests and a 390px browser harness); the screenshot scenario's 320 to 1280 overflow guard runs with the diff shown. CI captures pending review.
- **UNVERIFIED · Browsers and devices (checklist 3.7).** No second-browser or real-device check.

## 4. Performance and resilience

- **N/A · Images (checklist 4.1).** No images.
- **PASS · Client code (checklist 4.2).** No dependencies added; the line diff is a 64-line module capped at 4,000,000 table cells, with a coarse fallback above the cap. Built output unchecked.
- **N/A · Performance measures (checklist 4.3).** Owner-only tool.
- **PASS · Async recovery by tests (checklist 4.4).** Preview, publish and history errors show as text in their output; an unfinished label still previews with the sample label.
- **N/A · External resources (checklist 4.5).** None added.
- **N/A · Errors and redirects (checklist 4.6).** No route changes beyond the owner API action, which returns 404 for an unknown version.

## 5. Forms and sensitive flows

- **PASS · Server boundaries by tests (checklist 5.1).** Owner-only API; strict schema; label pattern `^[A-Za-z0-9.-]{1,40}$`, unique per kind by index; source revision trimmed of surrounding whitespace, blank stored as NULL, and refused above 120 characters; identical text refused before a reused label; a label race maps to the same refusal; all SQL bound.
- **PASS · Failure matrix by tests (checklist 5.2).** Missing, invalid, duplicate and identical publishes, stale version, unknown history version and older stored agreement values are covered.
- **N/A · Unavailable JavaScript (checklist 5.3).** The existing native form post remains; Publish still requires a valid label.
- **N/A · Delivery and receipt (checklist 5.4).** Agreement emails print no version label today and are unchanged.
- **PASS · Approval and permissions by tests (checklist 5.5).** Publishing still needs the explicit confirmation; signed agreements, sent offers and templates stay immutable; returning-client tests show a newer MSA never forces re-signing.
- **N/A · Inline confirmation (checklist 5.6).** Unchanged.

## 6. Privacy, legal and measurement

- **PASS · Data inventory (checklist 6.1).** New stored data: a version label and an optional owner-typed source revision per template, copied into agreement values and certificates. The source revision is visible to clients only inside the signing record attached to the signed PDF.
- **N/A · Privacy notice, consent, commerce, analytics (checklist 6.2 to 6.5).** No visitor data collection changes.
- **PASS · Schema monitoring (checklist 6.6).** `owner:health` requires both columns and the index; `owner:health --remote` passed 8/8 after 0026. Real failure receipt not exercised.

## 7. Release and final QA

- **PASS · Required checks, local (checklist 7.1).** Counts above. Build and CI pending.
- **UNVERIFIED · Exact diff and review (checklist 7.2).** Three whole-branch review rounds to `05419bad`, the last clean; `73112d20` reviewed clean by two Claude Sonnet 5.5 reviewers; independent review subagents reviewed `1baa440c` (Greptile's trial has ended and Codex review is out of usage on #176, so the CLAUDE.md fallback applies), leading to `7bb99943` and `c033811c`. Independent review of the final head and green CI remain pending.
- **PASS · Production schema (checklist 7.3).** No new bindings or secrets. 0026 applied with the evidence below.
- **PASS · Rollback and backup (checklist 7.4).** Rollback revision recorded; full export restore-tested and Time Travel bookmark recorded before 0026 (below). Redeployment not exercised.
- **UNVERIFIED · Post-deployment QA (checklist 7.5).** No deployment yet.
- **PASS · Local receipt (checklist 7.6).** This record separates local verification from deployment and live verification.

## 8. Private owner center

- **UNVERIFIED · Access and headers (checklist 8.1, 8.2).** The new action uses the existing owner guard; target Access and headers not exercised.
- **PASS · Migration reconciliation and backup (checklist 8.3).** 0026 is two `ADD COLUMN` statements and a partial unique index; the immutability trigger is unaffected. Ledger, export, restore test and applied evidence below.
- **N/A · Checklist 8.4 to 8.14.** No request persistence, traffic, playback, retention, studio, payment or recovery changes.
- **PASS · Target health (checklist 8.15).** `owner:health -- --remote` 8/8 PASS after 0026; the post-deploy run follows merge.

## Software agreement signing

- **UNVERIFIED · Signing.1. Record counsel review status for the templates and electronic consent.** Counsel review: not changed by this release.
- **N/A · Signing.2. Owner verifies the registered-agent business address and contractor config.** This diff does not change contractor config or the address; inherited from #158.
- **PASS · Signing.3. Preview seeded templates for one, two and three milestones in both payment modes.** PASS by tests for the typed label, the sample label while the label is unfinished, and the diff in preview. The milestone and payment-mode matrix is not changed by this diff and was not rerun for this record.
- **N/A · Signing.4. Verify the signing setting defaults off and the outside-site path still works.** This diff does not change the signing setting, its default or the outside-site path; inherited from #158 (see docs/prelaunch-qa-2026-09-30-software-signing.md). Supporting context: the production readback before 0026 showed website signing off (the current value, not a test of the default).
- **PASS · Signing.5. Verify scoped email authentication, revocation, stale hashes and MSA reuse confirmation.** MSA reuse confirmation by tests: reused MSAs keep their own label on the sign page, certificates and the offer editor line. Scoped email authentication, revocation and stale hashes are not changed by this diff and were not rerun.
- **UNVERIFIED · Signing.6. Exercise PDF rendering in the actual Workers runtime, including Unicode and attachments.** Rendering checked in Node tests only.
- **UNVERIFIED · Signing.7. Verify full text extraction, every document certificate, packet hashes and two retained copies.** Certificates by tests: each document's certificate and page header carry its own label; older stored values fall back to their template row. Text extraction, packet hashes and two retained copies are UNVERIFIED because the certificate JSON content changed.
- **UNVERIFIED · Signing.8. Test artifact failure and each recipient's uncertain email/retry separately.** Not N/A: prepareAgreementArtifact now does template-row lookups (documentVersionLabel and documentSourceRevision), and no failure or retry test added in this release covers them.
- **N/A · Signing.9. Verify project-page and archive downloads, including closed project and redacted request.** Download routes are unchanged; only the PDF contents differ.
- **UNVERIFIED · Signing.10. Rehearse restoring agreement database records, templates, fonts and private storage, with hashes.** The D1 export restore is recorded under 7.4 and 8.3; templates, fonts and private storage with hashes were not rehearsed.
- **N/A · Signing.11. Verify custom project retention and exclusion of open, held and actively reused agreements.** Retention is unchanged by this release.
- **UNVERIFIED · Signing.12. Review real CI screenshots, keyboard/no-JS behavior and overflow from 320 to 1280 pixels.** CI screenshots: the templates shot now appends a synthetic line and waits for `Changes from v2026-09-30`; captures pending review. Keyboard, no-JS and 320 to 1280 overflow: pending, see 3.3 and 3.6.

## Production migration 0026: applied

**PASS · Migration and backup.** Kazon authorized applying 0026 to production ("Yes, apply 0026", owner, in conversation, 2026-10-12). Before applying, read-only checks at approximately 18:44 America/New_York from revision `bcd252ec` showed only `0026_agreement_template_labels.sql` pending. Counts were 3 requests, 6 request audit rows, 1 audio project, 0 offers, 0 software projects, 0 project updates, 1 audio payment, 0 suggestion budget rows, 0 agreement templates, 0 agreements, 0 signatures and 0 contractor config versions; website signing was off; no template text contained "Interim"; the audit sequence was 6 and there were 156 schema objects. The request audit rows were hashed as the SHA-256 of their JSON (ordered by id, sorted keys), first 16 hex characters: `e9c998004e46defd` (a different method from earlier records, so the values are not comparable across records). A full export was taken (stored privately, outside the repository) and restored into scratch SQLite with matching request, audit, audio project, offer and template counts (3/6/1/0/0) and 11 triggers; the scratch database was deleted. The pre-migration D1 Time Travel bookmark `00000054-00000000-00005102-3342184cc315d40e287db7bcbf8392d3` is the database rollback point.

0026 applied on October 12, 2026 (4 commands), before merge to main. Afterwards: every count was unchanged; the request audit hash was identical (`e9c998004e46defd`); of 156 pre-existing definitions, 155 were identical and only `software_agreement_templates` changed, gaining `version_label TEXT` and `source_revision TEXT`; the one new object is the partial unique index `software_agreement_templates_label`, for 157 schema objects. `PRAGMA foreign_key_check` was empty, the ledger was clean ("No migrations to apply!"), and `owner:health --remote` passed 8/8 checks.

Remaining work: review of the final head and green CI; owner approval of the screenshots; merge; post-deploy `owner:health -- --remote --post-deploy` and a live check of `/owner/agreements`. This record does not claim launch readiness.
