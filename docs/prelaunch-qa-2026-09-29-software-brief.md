# Software project brief release gate

Date: September 29, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#150](https://github.com/kwilson21/thesuperhuman.us/pull/150)  
Code revision: `680003dccac4ee5c8cec3ba266d89c4029cd2583` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (`/software/start`, `POST /api/software-inquiry`, the owner Requests pages) and production `MUSIC_DB`  
Reviewer and deployment authorization: Kazon Wilson. They approved the look ("I think this looks good"), approved the guidance copy and the idea-path questions ("Approved"), and authorized applying the migration and releasing ("proceed") (owner, in conversation, 2026-09-29)  
Scope: a three-step software project brief with path-specific questions, hints and examples; persistence before notice with retry dedupe; an on-screen receipt; owner list and detail readback; migration `0019_software_requests.sql`; entry points repointed; privacy and owner-operations notes; a screenshot `prepare` hook  
Rollback revision: `c2c17a3d` (current `main`). The migration is backward compatible with it: the new column is nullable and existing inserts don't write it.

This is a scoped deployment record against the reusable pre-launch checklist.

## 1. Purpose and content

- **PASS · Project and authorization.** Branch `codex/software-inquiry` targets `main`; the owner authorized the migration and release in conversation.
- **PASS · Truthful claims.** The receipt says the brief is received, not reviewed, and that nothing is booked or due. No prices, hourly rates, availability or response-time promises (`npm run copy:check` passes).
- **PASS · Next step.** The Software door and the software service sheet link to `/software/start`; the page offers "Get in touch" and "Request my resume" escape hatches. Checked at 320, 390, 768 and 1280 px.
- **PASS · Navigation and links.** Main-site navigation and footer; "Back to Software" returns to `/services#software`.

## 2. Search and sharing

- **PASS · Title and description.** "Start a software project · Kazon Wilson" with a distinct description.
- **PASS · Canonical and sitemap.** Canonical `https://thesuperhuman.us/software/start` matches the sitemap entry (the same treatment as `/audio/start`).
- **PASS · Open Graph.** Title, description, URL and the site's existing card image.
- **N/A · Icons, robots, structured data.** Unchanged.
- **PASS · Private routes.** Owner pages stay out of the sitemap.

## 3. Accessibility and responsive behavior

- **PASS · Structure.** One `h1` per step, fieldset and legend for the path choice, labels tied to every field, hints and errors linked with `aria-describedby`, status messages announced with `role="status"`. Hidden question groups are hidden and disabled.
- **PASS · Keyboard and focus.** Radio cards work with the keyboard; step changes and errors move focus to the right step and field, including after Back and a path switch (browser-checked).
- **PASS · Responsive.** No horizontal overflow at 320, 390, 768 or 1280 px; review and receipt lists stack on phones.
- **FAIL (pre-existing) · Placeholder contrast.** The "For example:" text uses the site's default placeholder grey (`#9ca3af` on `#fbf8f2`, about 2.4:1), below 4.5:1. The live audio intake uses the same default. The visible hint above each field carries the same guidance at about 8.4:1. See the owner decision below.
- **UNVERIFIED · Other browsers and 200% zoom.** Checked in Chromium (Chrome and the desktop app's browser) only.

## 4. Performance and resilience

- **PASS · Assets.** No new images or fonts. One page script (about 7.4 KB, 3.2 KB gzipped); the stylesheet is shared with `/audio/start`.
- **UNVERIFIED · Lab metrics.** No mobile profile measured for this page.
- **PASS · Async states.** Validation (400), mismatched retry (409), rate limit (429), storage failure (503) and notice failure are covered by tests; input is preserved and retries reuse the submission ID so a lost response never creates a second brief.
- **UNVERIFIED · Offline and timeout in a browser.** Covered by the shared form helper used by the live audio intake; not re-exercised here.
- **N/A · 404 and redirects.** Unchanged.

## 5. Forms and sensitive flows

- **PASS · Server validation and abuse protection.** Same-origin JSON guard, 32 KB cap, zod validation per path with plain messages, control-character and lone-surrogate rejection, attempt limit, Turnstile, one success per five minutes.
- **PASS · Unavailable state.** Without bindings the page explains that sending is unavailable and keeps the email alternative.
- **UNVERIFIED · Live persistence and owner notice.** Turnstile protects production, so the release was not submitted end to end there. The owner can send one test brief and mark it resolved.
- **N/A · Approval-gated flows.** Resume and audio flows unchanged.
- **PASS · Confirmation.** Inline receipt rendered from the stored brief, with "Print or save".

## 6. Privacy, legal and measurement

- **PASS · Notice.** `/privacy` describes software briefs, their use, and how to withdraw or ask for deletion.
- **PASS · Retention.** Software briefs follow the existing non-audio rule (contact data removed 90 days after resolution; withdrawn immediately), confirmed by the owner and covered by a retention test.
- **N/A · Cookies, consent, analytics.** No new cookies, analytics or processors.
- **PASS · Monitoring.** A storage failure sends the existing urgent owner alert without visitor data; `owner:health` checks for 0019.

## 7. Release and final QA

- **PASS · Required checks.** `npm run check` 0 errors and 0 warnings; `npx vitest run` 101 files and 631 tests; `npm run build` completed. CI `validate`, `capture` and the Cloudflare Workers build passed.
- **PASS · Review.** Eight independent review passes (correctness and security; UI, copy and repository rules) with every verified finding fixed; the last found nothing above nit. The Codex review bot's three comments were fixed and answered, and its code and security reviews of `680003d` completed with no findings.
- **PASS · Migration and backup.** Before applying, the production ledger showed only 0019 pending and the live `owner_requests` definition matched 0001; no cascading foreign keys, views or dependent triggers existed. A full export was taken (stored privately, outside the repository) and restored into a scratch database with matching counts, and a D1 Time Travel bookmark was recorded. 0019 applied (14 statements) and its deferred foreign-key check passed at commit. Afterwards: row counts and a hash of every owner request row were identical, the three triggers and the status index were byte-identical, the unique `submission_id` index existed, `PRAGMA foreign_key_check` was empty, and the ledger had nothing left to apply. `owner:health --remote` passed every check.
- **PASS · Rollback.** Code: redeploy `c2c17a3d`. Data: the export or the Time Travel bookmark.
- **UNVERIFIED · Post-deployment production.** After the merge deploys, confirm `/software/start` on `thesuperhuman.us` serves the new page at both widths and the owner Requests page lists the Software kind.

## Owner decision on the placeholder contrast

Owner-accepted exception (owner, in conversation, 2026-09-29: "A"). Release now with the placeholder contrast recorded as a known, pre-existing issue. Impact: the "For example:" text is hard to read for low-vision visitors; the visible hint above each field carries the same guidance at full contrast. Follow-up: one small pull request that raises placeholder contrast on both the audio and software forms together.
