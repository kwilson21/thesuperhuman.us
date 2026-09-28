# Project status labels release gate

Date: September 28, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#135](https://github.com/kwilson21/thesuperhuman.us/pull/135)  
Code revision: `9c40c23ebca68e6e8293e9cc9a4800ce28925c36` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (Home, `/building`, and the project journals under `/building/`)  
Reviewer and deployment authorization: Kazon Wilson. They reported that the Personal website journal still treated the finished redesign as ongoing, agreed to start with this fix, and left the wording to Claude's discretion (owner, in conversation, 2026-09-28)  
Scope: project status labels move onto each project's story data; the Personal website status and description change; The Engineer’s Daily detail status shortens to match its listing  
Rollback revision: `625802f0d094dbbef1827c0f1cbdb95bd4b07dfe`

This is a scoped deployment record against the reusable pre-launch checklist.
Only status labels and one description change; every item outside them is N/A
with the reason.

## 1. Purpose and content

- **PASS · Project and authorization.** The owner asked for the website to stop
  reading as ongoing and agreed to this change; it targets `main` from
  `claude/project-status-single-source`.
- **PASS · Truthful claims.** Personal website now reads "Live · redesign
  complete", matching the owner's statement that the redesigns are complete.
  The other four statuses keep their existing listing wording. Dated milestone
  labels such as "Pre-launch review" are historical records and are unchanged.
- **N/A · First-screen purpose, navigation, contact and links.** No route,
  link or call to action changes.

## 2. Search and sharing

- **PASS · Meta description.** The Personal website journal's description also
  feeds its meta description: "From the original pages to the directions we
  explored and the choices that shaped the site you’re reading." It is distinct
  and descriptive.
- **N/A · Canonicals, Open Graph images, icons, robots, sitemap, structured
  data.** Unchanged.

## 3. Accessibility and responsive behavior

- **N/A · Landmarks, headings, keyboard and forms.** Markup structure is
  unchanged; only the text inside existing kicker and status elements changes.
- **PASS · Responsive behavior.** Checked in the development preview at desktop
  width (`/building`, `/building/personal-website`) and at 375 × 812
  (`/building/personal-website`, `/building/the-engineers-daily`,
  `/building/threadline`). Labels fit on one line with no overflow. Rendered
  kickers on `/building` and Home match the story data exactly.
- **N/A · Contrast, zoom, motion and browser coverage.** No color, layout or
  motion change.

## 4. Performance and resilience

- **N/A · All items.** No images, client code or fonts change.

## 5. Forms and sensitive flows

- **N/A · All items.** Not touched.

## 6. Privacy, legal and measurement

- **N/A · All items.** No data, notices or analytics change.

## 7. Release and final QA

- **PASS · Required checks.** `npm run check` reported 0 errors and 0
  warnings; `npm test` passed 99 files and 564 tests, including a guard that
  fails if a page types a project status by hand; `npm run build` completed.
  CI `validate` and the Cloudflare Workers build passed.
- **PASS · Review.** Independent review found two low findings (Threadline
  story shape, tests that restated constants); both fixed and re-reviewed clean.
- **N/A · Bindings and migrations.** None.
- **PASS · Rollback.** `625802f` is the current `main`; reverting restores the
  previous labels.
- **UNVERIFIED · Post-deployment production.** After the merge deploys, confirm
  `/building` and `/building/personal-website` on `thesuperhuman.us` show
  "Live · redesign complete".
