# Software offers release gate

Date: September 29, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#153](https://github.com/kwilson21/thesuperhuman.us/pull/153)  
Code revision: `a1db5807` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (the owner request page for software requests, `POST /api/owner/requests/[id]/software`, the owner offer preview, `/offer/[token]`) and production `MUSIC_DB`  
Reviewer and deployment authorization: Kazon Wilson approved the offer terms model (one statement of work covers up to 3 milestones or 90 days, two payment modes, required acceptance examples, optional checkpoints and range), the pricing reminders, and design studies 04 and 05 as direction, and authorized applying migration 0020 and releasing ("go ahead") (owner, in conversation, 2026-09-29)  
Scope: manual fit review; clarifying question and decline emails; versioned fixed-price offers (draft, sent, superseded, withdrawn) with an exact owner preview; a private, revocable client link per request; the client offer page; migration `0020_software_offers.sql`; owner-operations, README and health-check updates; a screenshot scenario  
Rollback revision: `d3a22c78` (current `main`). The migration is backward compatible with it: it adds tables and extends the audit action list, and existing code writes none of the new actions.

This is a scoped deployment record against the reusable pre-launch checklist.

## 1. Purpose and content

- **PASS · Authorization and claims.** Offer amounts come only from owner-entered terms; no software prices, hourly rates or availability appear anywhere public (`npm run copy:check` passes). Signing, invoices and payment are shown truthfully as not started ("Agreement · Not sent yet", "Invoice · Not issued", "Start date · Not confirmed"). Payment-mode wording matches the owner's agreement templates (interim MSA v2026-09-29, sections 4 and 7).
- **PASS · Owner signage.** The owner-approved reminders sit beside milestones, fees, checkpoints and the range; every field has a hint with its limit and an example.
- **PASS · Next step.** The client page offers "Ask a question" (email) and "Print or save"; the unavailable page tells the visitor how to get a current link.

## 2. Search and sharing

- **PASS · Private routes.** `/offer/*` and owner pages send `private, no-store`, `noindex, nofollow` and `no-referrer`; none are in the sitemap. The audio host redirects `/offer/*` to the main host.
- **N/A · Titles, canonicals, Open Graph.** Private pages only.

## 3. Accessibility and responsive behavior

- **PASS · Structure.** Numbered milestone fieldsets with legends, labels on every control, hints linked with `aria-describedby`, invalid fields marked, status messages announced. Headings in order on the client page.
- **PASS · Responsive.** No horizontal overflow at 320, 390 and 1280 px on the owner page, preview, client page (both payment modes) and unavailable page.
- **PASS · Audio unchanged.** Moving the owner rail styles into `owner.css` leaves the audio request pages' layout unchanged (compared against the published captures).
- **UNVERIFIED · Other browsers and 200% zoom.** Checked in Chromium only.

## 4. Performance and resilience

- **PASS · Assets.** No new images or fonts; the client page loads fonts exactly as the site layout does.
- **PASS · Email outcomes.** Confirmed rejection, uncertain delivery (provider error or timeout) and success each give a distinct owner message; a question records nothing unless its email is confirmed; a decline first withdraws the offer and closes its link, then resolves the request only once its email is confirmed; an offer is saved as sent before its email, the owner is told when the email didn't go out, and a link closed while its email was sending is reported instead of claimed as sent. With the database binding missing, the offer page returns a private 503 rather than the unavailable page.

## 5. Forms and sensitive flows

- **PASS · Link security.** 32 random bytes per link, stored only as a SHA-256 hash; unknown, revoked and unsent links return identical 404 pages; each send issues a new link; the link is shown to the owner only in the send response and in the owner's email copy.
- **PASS · Private data.** The client view is an explicit field list (name, company, path, version, terms); fit review, private note, drafts, audit and other versions never reach it (tested).
- **PASS · Owner actions.** Owner access required, same-origin enforced, zod validation with plain messages, one draft and one sent version per request enforced by the database, every change audited in the same batch, resolved requests reject new offers.
- **PASS · Decline and closing.** Declining withdraws the sent offer and any draft and revokes the client link. Revoking, declining, withdrawing and sending another version wait while an offer email is still sending, and resolved or withdrawn requests show history only.
- **PASS · Unsaved work.** The owner is asked before any reload that would discard unsaved text in the offer editor or another section, the page is locked while an action is saving, and an expired owner session shows a reload message instead of an error.

## 6. Privacy, legal and measurement

- **PASS · Retention.** Offer data, fit reviews and links are removed with the request under the existing 90-day non-audio rule (tested).
- **N/A · Notice.** The privacy page already covers software briefs and owner replies; offers add no new processor or data category.
- **PASS · Monitoring.** `owner:health` now requires the 0020 tables and indexes.

## 7. Release and final QA

- **PASS · Required checks.** `npm run check` 0 errors and 0 warnings; `npx vitest run` 108 files and 779 tests; `npm run build` completed. CI results, including the screenshot captures, are on the pull request for this revision.
- **PASS · Review.** Independent review passes on correctness and security and on UI, copy and rules, then re-reviews of each fix pass and three rounds of the Codex review bot; every verified finding fixed and answered on the pull request.
- **PASS · Print.** Measured in Chrome with the site fonts: a one-milestone offer prints on one US Letter page and a typical three-milestone offer on two, with headings kept with their content, links hidden and nothing below 8.5pt. An offer with every field at its maximum prints on four pages, which is accepted.
- **PASS · Migration and backup.** Before applying, the production ledger showed only 0020 pending, and only the personal-data trigger referenced the audit table. A full export was taken (stored privately, outside the repository) and restored into a scratch database with matching counts, and a D1 Time Travel bookmark was recorded. 0020 applied (12 statements). Afterwards: row counts and the audit id sequence were unchanged, a hash of every audit row was identical, the trigger and index definitions on `owner_requests` and `owner_request_audit` were identical, the new tables and both one-draft/one-sent indexes existed, no temporary table remained, `PRAGMA foreign_key_check` was empty, and the ledger had nothing left to apply. `owner:health --remote` passed every check.
- **PASS · Rollback.** Code: redeploy `d3a22c78`. Data: the export or the Time Travel bookmark.
- **UNVERIFIED · Post-deployment production.** After the merge deploys, confirm an unknown `/offer/…` link returns the unavailable page with private headers on `thesuperhuman.us`, and that the owner request page renders for a software request.
