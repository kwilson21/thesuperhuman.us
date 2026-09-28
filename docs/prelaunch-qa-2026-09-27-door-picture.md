# Website door picture release gate

Date: September 27, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#133](https://github.com/kwilson21/thesuperhuman.us/pull/133)  
Code revision: `c328e96b7383070b62b2f09dbfc479d34a8c860c` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (Home, `/services`, `/building`). The `audio.thesuperhuman.us` entry routes those paths to audio pages, so the door never renders there  
Reviewer and deployment authorization: Kazon Wilson. Asked "Say the word if you want me to refresh it", they answered “the word”  
Scope: one image, `src/assets/site/work-with-me-website.webp`, replaced by a current capture of Home, and its asset review record  
Rollback revision: `10945a29202e251d56c3e534505e815697fcae02`

This is a scoped deployment record against the reusable pre-launch checklist.
Only one existing picture changes; every item outside it is N/A with the reason.

## 1. Purpose and content

- **PASS · Project and authorization.** The owner asked for the refresh; the
  change targets `main` from `claude/loving-fermi-ogos4c`.
- **PASS · Approved design and claims.** Same treatment the owner chose on
  September 26 (real work, one image each) and the same caption, "This site,
  redesigned September 2026". The picture is CI's capture of the released Home,
  so it shows the page as it is. No new claim.
- **N/A · First-screen purpose, navigation, contact and links.** No copy, route
  or link changes.

## 2. Search and sharing

- **N/A · All items.** No metadata, canonical, Open Graph, icon, robots,
  sitemap or structured-data change. The Open Graph image is a different file.

## 3. Accessibility and responsive behavior

- **N/A · Landmarks, headings, keyboard and forms.** Markup is unchanged.
- **PASS · Image alternatives.** The door picture keeps its empty alternative
  text; the visible caption, title, line and button carry the meaning.
- **PASS · Responsive behavior.** Inspected at 2x in the development preview
  in all four places it renders: the Home door at 345 × 229 (desktop) and
  102 × 67 (phone), the `/services` hub at 301 × 200, and Building's row at
  138 × 90. The file is 3:2 like the old one, so nothing is cropped at runtime.
- **N/A · Contrast, zoom, motion and browser coverage.** No color, layout or
  motion change.

## 4. Performance and resilience

- **PASS · Images.** 900 × 600 WebP at quality 80, 39,944 bytes, against
  38,932 before. Lazy-loaded and sized as before.
- **N/A · Client code, fonts, Web Vitals, errors, media and 404.** Unchanged.

## 5. Forms and sensitive flows

- **N/A · All items.** Not touched.

## 6. Privacy, legal and measurement

- **PASS · Publication check.** The capture is this public site's own Home: no
  private content, secrets, address, real money or third-party logo.
- **N/A · Data, notices, consent, analytics and monitoring.** Unchanged.

## 7. Release and final QA

- **PASS · Required checks.** `npm test` passed 99 files and 560 tests;
  `npm run check` reported 0 errors and 0 warnings; `npm run build` completed;
  asset QA matched 35 production files, including the new hash; the publicist
  gate passed locally for 38 entries.
- **N/A · Bindings and migrations.** None.
- **PASS · Rollback.** `10945a2` is the current `main`; reverting restores the
  September 26 picture.
- **UNVERIFIED · Post-deployment production.** After the merge deploys, confirm
  the door on Home, `/services` and `/building` serves the new picture on
  `thesuperhuman.us`.
