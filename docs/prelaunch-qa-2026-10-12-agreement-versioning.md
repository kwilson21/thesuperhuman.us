# Software agreement versioning release gate

Date: October 12, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#176](https://github.com/kwilson21/thesuperhuman.us/pull/176)  
Branch: `claude/agreement-versioning-v1-b28b03`  
Starting revision: `2d98c299` (`origin/main`). Verified revision: `05419bad` (this record is committed on top).  
Target: production `https://thesuperhuman.us`, `/owner/agreements`, `POST /api/owner/agreements` (`preview`, `publish`, new `template-version`), owner request pages with a software offer (agreement details), `/offer/{token}/sign`, signed agreement PDFs and certificates, and production `MUSIC_DB`.  
Reviewer: Claude (Opus 5.5) coordinating for owner Kazon Wilson. Claude Haiku 5.5 subagents implemented each task tests first. Claude Sonnet 5.5 reviewed each task, and two Claude Opus 5.5 reviewers (correctness and security; UI, copy and repository rules) reviewed the whole branch in three rounds, with each finding checked by an independent verifier. The third round found nothing to fix. This record does not certify Greptile or CI results at the final head.  
Scope: each published template version carries its own `version_label` and optional `source_revision`, replacing the fixed `v2026-09-30` label and the fixed interim source revision; the Agreements page publish form gains Version label and Source revision fields; Preview shows a line diff against the current version (`Changes from {label}`, or `First version. Nothing to compare yet.`); version history gains View text and Compare with previous; publishing identical text or a reused label is refused; the sign page, PDF page headers and certificates show each document's own label; returning clients keep the MSA they signed, and the offer editor says which MSA a reused agreement uses. Migration `0026_agreement_template_labels.sql`.  
Rollback revision: `2d98c299`, current `origin/main`. Deploy order: apply additive 0026 before merging to main, because a push to main deploys production. Current main keeps working with 0026 applied: it reads templates with `SELECT *` and its insert names its columns. Keep the additive columns on code rollback; no data is migrated or deleted.

## Owner decisions and authorization

Owner, in conversation, 2026-10-12:

- "A and A are fine, go ahead": existing clients keep the MSA they signed until both agree otherwise and new clients get the current MSA; mid-project changes to a signed SOW become change orders (separate design, not in this release).
- Implementation by Claude Haiku 5.5 subagents with Sonnet or Opus review rounds, for this repository.
- Migration 0026 production authorization, with a read-only check of the template rows: "Yes, apply 0026".
- The `{{msa.source_revision}}` placeholder in agreement text prints the MSA's version label, which keeps today's rendered text; the typed source revision is stored in the agreement values and the certificate JSON (the signing record attached to the signed PDF), not on the visible PDF pages: "Yes, keep it".
- Source revision hint reworded to "Your reference for the legal source, for example a counsel revision. Clients can see it in the signing record attached to the signed PDF." (owner chose to reword the hint).

Coordinator ruling: each document's certificate carries its own template's label and source revision, so a SOW shows the SOW template's.

## Evidence and limits

Checks at `05419bad`, run by the third-round reviewers from this worktree:

- `npx vitest run`: PASS, 130 files, 1,450 passed, 1 skipped. The skip is the private-template test that runs only when the private template file exists.
- `npm run check`: PASS, 447 files, 0 errors, 0 warnings, 17 hints. The two hints in touched files predate this branch.
- `npm run copy:check`: PASS. `npm run assets:check`: PASS, 36 production files match their review records.
- `npx vitest run tests/scripts/screenshots.test.ts`: PASS, 36 tests.
- `grep -rn "2026-09-30\|Interim" src`: no output. `cmp db/music.sql <(LC_ALL=C cat migrations/music/*.sql)`: silent.
- No em dashes or buzzwords in added lines; `package.json` and `package-lock.json` unchanged; no private template text, rates or PDFs in the diff.

Not run locally: `npm run build` and screenshot capture (CI runs both). No remote command, migration, deployment or live check was performed for this record.

## 1. Purpose and content

- **PASS · Scope and instructions (checklist 1.1).** Branch, revisions, scope and owner decisions recorded above; deployment waits on migration authorization.
- **PASS · Approved design and claims (checklist 1.2).** Field labels, hints, diff copy, refusals, sign-page line and offer-editor line match the owner-approved spec character for character (UI and copy reviewer, round 3). No media changes.
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

- **PASS · Server boundaries by tests (checklist 5.1).** Owner-only API; strict schema; label pattern `^[A-Za-z0-9.-]{1,40}$`, unique per kind by index; source revision trimmed to 120 characters; identical text refused before a reused label; a label race maps to the same refusal; all SQL bound.
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
- **UNVERIFIED · Exact diff and review (checklist 7.2).** Three whole-branch review rounds, the last clean. Greptile review of the final head pending.
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

- **UNVERIFIED · Counsel review.** Not changed by this release.
- **PASS · Template preview by tests.** Preview renders with the typed label, or the sample label while the label is unfinished, and shows the diff.
- **PASS · MSA reuse by tests.** Reused MSAs keep their own label on the sign page, certificates and the offer editor line.
- **PASS · Certificates by tests.** Each document's certificate and page header carry its own label; older stored values fall back to their template row.
- **UNVERIFIED · Workers runtime PDF.** Rendering checked in Node tests only.
- **UNVERIFIED · CI screenshots.** The templates shot now appends a synthetic line and waits for `Changes from v2026-09-30`; captures pending review.

## Production migration 0026: applied

**PASS · Migration and backup.** Kazon authorized applying 0026 to production ("Yes, apply 0026", owner, in conversation, 2026-10-12). Before applying, read-only checks at approximately 18:44 America/New_York from revision `bcd252ec` showed only `0026_agreement_template_labels.sql` pending. Counts were 3 requests, 6 request audit rows, 1 audio project, 0 offers, 0 software projects, 0 project updates, 1 audio payment, 0 suggestion budget rows, 0 agreement templates, 0 agreements, 0 signatures and 0 contractor config versions; website signing was off; no template text contained "Interim"; the audit sequence was 6 and there were 156 schema objects. The request audit rows were hashed as the SHA-256 of their JSON (ordered by id, sorted keys), first 16 hex characters: `e9c998004e46defd` (a different method from earlier records, so the values are not comparable across records). A full export was taken (stored privately, outside the repository) and restored into scratch SQLite with matching request, audit, audio project, offer and template counts (3/6/1/0/0) and 11 triggers; the scratch database was deleted. The pre-migration D1 Time Travel bookmark `00000054-00000000-00005102-3342184cc315d40e287db7bcbf8392d3` is the database rollback point.

0026 applied on October 12, 2026 (4 commands), before merge to main. Afterwards: every count was unchanged; the request audit hash was identical (`e9c998004e46defd`); of 156 pre-existing definitions, 155 were identical and only `software_agreement_templates` changed, gaining `version_label TEXT` and `source_revision TEXT`; the one new object is the partial unique index `software_agreement_templates_label`, for 157 schema objects. `PRAGMA foreign_key_check` was empty, the ledger was clean ("No migrations to apply!"), and `owner:health --remote` passed 8/8 checks.

Remaining work: review of the final head and green CI; owner approval of the screenshots; merge; post-deploy `owner:health -- --remote --post-deploy` and a live check of `/owner/agreements`. This record does not claim launch readiness.
