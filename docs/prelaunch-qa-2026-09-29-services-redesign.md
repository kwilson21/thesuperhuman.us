# Services redesign release gate

Date: September 29, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Branch: `codex/software-evidence` (this record is committed on top of the reviewed code)  
Target: production `https://thesuperhuman.us/services` and `https://thesuperhuman.us/audio/services` (also `audio.thesuperhuman.us/services`)  
Reviewer and authorization: Kazon Wilson chose Direction A ("A") from rendered mockups, asked that the page not repeat information and match the rest of the site, approved the revised version with the hero button removed, and chose the Transactions screen ("B") and hidden links in print ("hide") (owner, in conversation, 2026-09-29)  
Scope: the software section of `/services` becomes a sibling of `/audio/services` (hero beside the Lyft before/after evidence, "Find the right fit." rows with Skupos and Tally evidence, "Before we start." steps); shared service-page styles move into `src/styles/service-pages.css`; the phone menu's "Website design" link targets the website door; one new reviewed image  
Rollback: redeploy the previous `main`. No data or migrations change.

This is a scoped deployment record against the reusable pre-launch checklist.

## 1. Purpose and content

- **PASS · Authorization and claims.** Evidence is the site's existing, sourced wording (Lyft, Skupos, Tally) and the owner-reported Lyft figure with its label. No software prices, hourly rates or response-time promises; `npm run copy:check` passes.
- **PASS · Next step.** Each path row has one button into the brief with that path preselected; the hub doors are unchanged.
- **PASS · Links.** Work stories, work history, the Tally demo and project, the brief, and the audio cross-link route correctly on both hosts.

## 2. Search and sharing

- **N/A · Titles, canonicals, Open Graph, sitemap, robots.** Unchanged for both pages.

## 3. Accessibility and responsive behavior

- **PASS · Structure.** Heading order holds; rows are `<details>` open by default with the audio page's marker; repeated "Read the work story" links carry distinct accessible names; the figure arrow is hidden from screen readers with a spoken "to"; the steps are an ordered list.
- **PASS · Responsive.** No horizontal overflow or console errors at 320, 390, 768, 1024 and 1280 px; headings match the audio page's computed sizes at each width.
- **PASS · Motion.** The site's reveal-once motion applies; with reduced motion everything shows at rest, and every revealed element was visible after scrolling in both modes.
- **PASS · Audio unchanged.** `/audio/services` is pixel-identical to its pre-change capture at 390, 768 and 1280 px.
- **UNVERIFIED · Other browsers and 200% zoom.** Checked in Chromium only.

## 4. Performance and resilience

- **PASS · Assets.** One new 20 KB WebP (`tally-transactions.webp`, reviewed in `docs/asset-reviews/tally-transactions.md`); the shared stylesheet loads only on the two service pages.

## 5. Forms and sensitive flows

- **N/A.** No form changes.

## 6. Privacy, legal and measurement

- **N/A.** No data, notices or analytics change. The Tally image is demo data with its banner in frame.

## 7. Release and final QA

- **PASS · Required checks.** `npm run check` 0 errors and 0 warnings; `npx vitest run` 104 files and 646 tests; `npm run build`; copy and asset checks. CI results are on the pull request.
- **PASS · Print.** `/services` prints on exactly one US Letter page with links and images hidden.
- **PASS · Review.** Independent review passes on correctness and on UI, copy and rules, with verified findings fixed.
- **UNVERIFIED · Post-deployment production.** After the merge deploys, confirm both service pages on `thesuperhuman.us` and `audio.thesuperhuman.us`.
