# Software project pages release gate

Date: September 29, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: #154  
Code revision: `6a2f3a46` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (the private studio's sign-in and project list, `/studio/software/[id]`, the owner request page's Project rail, `/owner/requests/[id]/update`, the owner Today list, their APIs and visuals routes) and production `MUSIC_DB`  
Reviewer and deployment authorization: Kazon Wilson approved Stage 5 as described with design studies 06 to 08 ("And yes to stage 5"), the software sign-in and project-list wording, update visuals in the existing private bucket and one-year project-page retention ("1-3 yes"), the agreement-driven start wording ("1. Yes"), and the final screens after the example wording was made plain ("stage 5 looks good to go") and applying 0021 to production ("yes you can apply the database change") (owner, in conversation, 2026-09-29)  
Scope: starting a project from a sent offer (owner-recorded signatures and first payment step, manual until invoicing and signing are integrated); email-code access for software clients through the existing studio; the client project page (state, step track, updates with visuals and previews, what we agreed, messages); the owner Project rail and update composer with a live client preview; direction and delivery reviews with the client's explicit decisions; milestone payment records; handoff after acceptance and full payment; earlier versions; reminders on the owner Today list; two new client email templates; migration `0021_software_projects.sql`; retention; privacy and owner-operations notes; a screenshot scenario  
Rollback revision: `d3a22c78` (current `main`). Deploy order matters: this code requires 0021; deploying it before the migration breaks studio sign-in (audio too) and the owner Today page. The migration is additive and the current `main` keeps working with it applied.

This is a scoped deployment record against the reusable pre-launch checklist.

## 1. Purpose and content

- **PASS · Agreement fidelity.** Review, acceptance, correction and handoff wording follow the owner's agreement templates (interim MSA v2026-09-30, sections 3, 5 and 8): a design approval confirms only the design stage; delivery shows evidence for every agreed check; acceptance is only the client's explicit action on a named version, never silence; change requests name the unmet checks; the review window is 5 Business Days or longer (America/New_York, US federal holidays); corrections run 30 days from the earlier of acceptance or recorded full payment; handoff follows full payment. Start confirmation is written (the "Your project has started" email and the page).
- **PASS · Truthful status.** Owner-recorded confirmations are labelled as the owner's records; no percent-complete or activity feed; concepts are labelled not implemented.
- **PASS · Copy rules.** No prices on the project page outside the agreed terms, no hourly rates, no em dashes (`npm run copy:check` passes).

## 2. Search and sharing

- **PASS · Private routes.** Studio, owner and visual routes send `private, no-store` and `noindex`; none are in the sitemap.

## 3. Accessibility and responsive behavior

- **PASS · Structure.** Headings in order, labelled fields with linked hints, the step track as an ordered list with the current step marked, decision forms with fieldsets and required checks, status messages announced.
- **PASS · Responsive.** Every captured state at desktop and phone widths without horizontal overflow; on phones the review decision follows the agreed checks.
- **PASS · Audio unchanged.** Audio sign-in, project list, project page, owner rail and Today rows render as before for audio-only clients.
- **UNVERIFIED · Other browsers and 200% zoom.** Checked in Chromium only.

## 4. Performance and resilience

- **PASS · Visuals.** PNG, JPEG or WebP up to 5 MB, type and signature checked on the server, stored privately under `software/` in the existing bucket, never reachable through the public audio file routes; replacements clean up the old object.
- **PASS · Email outcomes.** Invitation and update notices follow the studio's pending, sending, sent and failed states with retry; uncertain outcomes aren't reported as failures.

## 5. Forms and sensitive flows

- **PASS · Access.** A software project grants studio access by the request's email exactly like audio; revoking the project or withdrawing the request ends it; clients can't open other clients' projects (tested).
- **PASS · Client projection.** No private notes, fit review, drafts, audit rows, storage keys or other clients' data reach the client page (tested).
- **PASS · Decisions.** One decision per review version, enforced by the database; only the latest undecided review can be decided; audit rows record factual notes (version, milestone, checks) without message text.
- **PASS · Offers after start.** Once a project exists, offer drafts, sends, questions and declines are refused.

## 6. Privacy, legal and measurement

- **PASS · Notice.** `/privacy` describes project pages, what they store, email-code access and retention.
- **PASS · Retention.** Page content (updates, visuals, messages, payment records) becomes eligible one year after completion or closed access; audit records, including decision notes, after two years; cleanup is reviewed and run manually (tested). Matches MSA section 10's project-page default.

## 7. Release and final QA

- **PASS · Required checks.** `npm run check` 0 errors and 0 warnings; `npx vitest run` 112 files and 859 tests; `npm run build` completed; copy and asset checks. CI results are on the pull request.
- **PASS · Review.** Independent correctness, security and UI reviews of each pass, re-reviews of every fix pass, and the Codex review bot; every verified finding fixed.
- **PENDING · Migration and backup.** To be done immediately before the merge, as for 0020: confirm only 0021 is pending, take a full export (stored privately) and restore it into a scratch database with matching counts, record a D1 Time Travel bookmark, apply 0021, verify row counts, the audit id sequence and the unchanged trigger and index definitions, run `PRAGMA foreign_key_check`, and run `owner:health --remote`. This line is updated with the results before merging.
- **PASS · Rollback.** Code: redeploy `d3a22c78`. Data: the export or the Time Travel bookmark.
- **UNVERIFIED · Post-deployment production.** After the merge deploys, confirm `/studio/sign-in` and `/studio/sign-in?for=software` render on `thesuperhuman.us`, an audio client can still request a code, and the owner Today page loads.
