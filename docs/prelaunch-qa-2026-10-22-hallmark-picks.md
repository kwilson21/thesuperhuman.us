# Hallmark board picks release gate

Date: October 22, 2026 (UTC)  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#209](https://github.com/kwilson21/thesuperhuman.us/pull/209), "Build the owner's picks from the Hallmark decision boards"  
Branch: `claude/hallmark-picks`, from `main` at `97321a6c`  
Target: production `https://thesuperhuman.us` after merge, including the audio pages on `audio.thesuperhuman.us`, which share the stylesheets.  
Reviewer: Claude Code agents, collecting evidence for owner Kazon Wilson. Claude subagents wrote the code in seven groups; the coordinating session merged them. This record is evidence collection, not owner certification.  
Scope: the owner's 42 picks from the Hallmark decision boards (#206). The PR description lists each change and the calls made to fit the boards.

Rollback revision: `main` as it stands immediately before this PR merges. That is `97321a6c` unless #206 (docs only) merges first, in which case it is #206's merge commit. This PR adds no migration and writes no stored data, so a rollback has no stored-data caveat; signatures made after the deploy keep the curly consent text they recorded.

## Owner decisions and authorization

- The picks, quoted exactly with the owner's notes, are recorded in `docs/design-concepts/README.md` (#206).
- In conversation on October 22, 2026, after the PR description listed the open calls, the owner answered:
  - on recording the images that fail the new "reads as generated" check as exceptions: "I guess? I'm not sure what you're asking". The coordinating session then explained the question in plain words and recorded the exception in each failing image record, which the owner can withdraw;
  - on the public Hallmark credit (#208): "I feel like "I hold this site to Hallmark, an open-source design standard from Together AI (MIT license)" is enough";
  - on bumping `consent_version`: "Id k what that is". It stays `website-signing-v3`, because only the apostrophes changed, not the words;
  - on the smaller calls listed in the PR description: "Sure I guess".
- After viewing the branch preview, the owner wrote: "This looks great, in the future I'll wait for the screenshots though". The process is the same as the previous records: the PR merges after the owner approves the look, and merging deploys production.
- On usage, the owner asked: "I'm running low on usage so if you can achieve this without burning my remaining usage that'd be great". The coordinating session therefore stopped its planned independent review workflow for this PR and used Codex's reviews instead (section 7).

## Evidence and limits

- On `c4fd2092` (all seven groups merged, before the record-only commits):
  - `npm test`: 140 files, 1,723 passed, 1 skipped;
  - `npx astro check`: 0 errors, 0 warnings;
  - `npm run build`: passed, including asset QA (79 files), the copy check and the publicist gate.
- Later commits change only records (`docs/asset-reviews/*`, this file). Asset QA and `tests/scripts` (35 files) pass after them. CI runs the full suite on the final head.
- The design check from #208 passes on this tree.
- Each group's agent checked its pages in Chromium against `astro dev` with the screenshot preview config, at 320, 390 and 1280 at least and at the widths its board names, with motion and reduced motion. They found no horizontal overflow and no console errors. Their screenshots are in the session's scratchpad, not the repository.
- Limits: Chromium only. The dev server is not the Workers runtime. Nothing was checked in production.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions, audience and authorization.** The branch merges the seven group branches onto `main`; the site instructions and audience are unchanged. The owner approved the look (Owner decisions).
- **PASS · Approved design, truthful claims, placeholders and media rights.**
  - The design follows the owner's picks.
  - No professional claim changes.
  - Copy changes are those the picks name:
    - the five echo labels removed (D4.1-B);
    - the About label "Explore the Daily prototype" (D10.1-C);
    - curly apostrophes (D10.5-B);
    - "Live · evolving" (D10.7-B).
  - No new raster art: the 404 scenes are CSS and inline SVG, and the redrawn Threadline and Kaillera drawings are SVG.
  - The images that fail the new "reads as generated" check stay under the owner's exception.
- **PASS · Explanatory copy.** No explanatory copy changes beyond the labels above.
- **PASS · First screen and next step.**
  - The groups measured the primary actions on the first screen:
    - the `/work` links;
    - the 404 "Back to home" at 1280x800, 390x844 and 375x667;
    - the brief's Next button;
    - the premiere's buttons and whole poster at six desktop sizes.
  - On `/services` at 1024x768 the third door button ends just under the fold, a trade-off the D1.2-C board names.
- **PASS · Navigation, footer, contact and links.** No link targets change. The footer name is 24px (D10.3-B). The doors and site links keep their 44px tap areas.

## 2. Search and sharing

- **N/A · Titles and descriptions.** Unchanged.
- **N/A · Canonicals and sitemap.** No route is added or removed.
- **PASS · Open Graph images.**
  - Re-rendered and inspected at full and sharing size, recorded in `docs/asset-reviews/link-previews.md`:
    - `not-found` (scene B);
    - `building` (status separator and redrawn controller);
    - `personal-website` (status separator);
    - `software-start` (curly apostrophe; video only).
  - The other previews are unchanged. Their kickers still use the old mono face, a follow-up offered to the owner.
- **N/A · Icons.** Unchanged.
- **N/A · robots.txt.** Unchanged.
- **N/A · Preview indexing.** Unchanged.
- **N/A · Structured data.** Unchanged.

## 3. Accessibility and responsive behavior

- **PASS · Landmarks and headings.**
  - No heading text changes; removed kickers were labels, not headings.
  - The deleted components (D10.6-B) rendered nowhere.
- **PASS · Image alternatives.**
  - The 404 scenes and the redrawn drawings are decorative and hidden from screen readers.
  - The not-found preview's alt text describes scene B.
- **PASS · Keyboard and focus.**
  - Keyboard focus shows the finished Building drawings.
  - Each form's error summary moves focus by keyboard.
  - Focus outlines are unchanged.
- **PASS · Inputs, errors and announcements.** D9.2-D sets message text before the opening animation, so live announcements are not delayed (`tests` for `form-messages`).
- **UNVERIFIED · Contrast, touch targets, 200% zoom and reduced motion.**
  - Contrast was checked where colours or faces changed; the accent "B" letter now stays at full opacity (3.4:1 before).
  - Tap areas are 44px (D8.4-C).
  - Reduced motion shows final states.
  - 200% browser zoom was not checked.
- **PASS · Widths.** 320, 375, 390, 800, 1024, 1280, 1366, 1440, 1536 and 1920, as each board names: no overflow.
- **UNVERIFIED · Second browser and real device.** Only Chromium was used.

## 4. Performance and resilience

- **PASS · Images.** No new raster art. The re-rendered previews pass the renderer's size limits.
- **PASS · Client code and fonts.**
  - One font weight is added, Libron Bold (D8.1-B), loaded only where the premiere title uses it.
  - The agreement PDF's Libron TTF (about 124KB) is server-side only, replacing Newsreader.
  - `src/scripts/form-messages.ts` is shared by the forms.
- **UNVERIFIED · Performance measures.** None made.
- **N/A · Async UI states.** The loading and failure paths are unchanged; D9.2-D only animates how a message opens.
- **N/A · Media resources.** Playback is unchanged.
- **PASS · 404.** The page renders both scenes, and without JavaScript it shows scene B. The 404 status is unchanged and checked again after deploy.

## 5. Forms and sensitive flows

- **PASS · Server validation.**
  - The suggestion API turns straight apostrophes into curly before its exact question check, so pages opened before the deploy keep working.
  - The sign API still takes `consent: true` and builds the consent text itself.
  - Tests cover both.
- **UNVERIFIED · Failure states in a browser.**
  - Empty and invalid input were exercised in a browser on all seven forms.
  - 429, 500, network failure and timeout use the same message writer (unit-tested) but were not exercised in a browser.
- **PASS · No JavaScript.** Without JavaScript, messages appear as before; the 404 shows scene B.
- **UNVERIFIED · Delivery and receipt.** The signing-link email, its error and the brief's copy email change only their apostrophes; no real email was sent.
- **PASS · Approval-gated flows.** Unchanged, by source; the resume and signing tests pass.
- **N/A · Confirmation page.** Unchanged.

## 6. Privacy, legal and measurement

- **N/A · All six items.** No new data, storage, processor, cookie, analytics or monitoring. The privacy notice is unchanged.

## 7. Release and final QA

- **PASS · Required checks.** See Evidence. CI runs on the final head before merge.
- **PASS · Diff review.**
  - Codex's code review of `c4fd2092` found one P1: generated images failing the new check stayed in production. It was fixed in `7f89d09e` by recording the owner's exception, the remedy Codex itself named, and its thread is resolved.
  - Codex's security review and a Codex review of the final head are requested before merge; the merge waits for them.
  - The planned independent review agents were stopped at the owner's request to save usage (Owner decisions).
  - No secrets, dependencies or private data in the diff.
- **PASS · Production configuration.** `wrangler.jsonc`, `public/_headers`, `src/middleware.ts`, `astro.config.mjs`, `package.json`, the lockfile and the migrations are unchanged.
- **PASS · Rollback and authorization.** Rollback revision above; no backup needed; the owner approved the look.
- **UNVERIFIED · Post-deployment verification.** After the merge, check on production:
  - Home, `/work`, `/about`, `/services`, `/building` and a project page;
  - `/audio/releases` and `/music/old-news`;
  - `/software/start`;
  - the 404, for its 404 status and both scenes;
  - the headers, robots and sitemap.
- **UNVERIFIED · Receipt.** Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

## 8. Private owner center

- **N/A · All items.** Owner pages change only their serif face (D9.3-C); access, caching, schema, payments and retention are untouched.

## Software agreement signing

- **UNVERIFIED · Counsel review.** The consent sentence changes only its apostrophes; no counsel review of that change is recorded.
- **N/A · Address and contractor configuration.** Unchanged.
- **N/A · Template previews.** Unchanged.
- **N/A · Signing setting.** Unchanged.
- **N/A · Email authentication.** Unchanged.
- **UNVERIFIED · PDF rendering in the Workers runtime.** The PDF headings now use Libron. Sample PDFs were rendered and inspected under Node with `pdftoppm`, and `tests/lib/agreement-pdf.test.ts` passes, but not in the Workers runtime.
- **UNVERIFIED · Text extraction, certificates, packet hashes and retained copies.** The heading font changes. A test prints a stored straight-apostrophe consent unchanged, nothing is migrated, and the new TTF's glyphs match the pinned source, but full text extraction and the certificates were not re-verified on a signed packet.
- **N/A · Artifact failure and email retry.** Unchanged.
- **N/A · Downloads.** Unchanged.
- **N/A · Restore.** Unchanged.
- **N/A · Retention.** Unchanged.
- **PASS · Screens.** CI's `software-signing` scenario, keyboard use and no overflow from 320 to 1280 on the signing pages (forms group).

## Summary

| Section | PASS | FAIL | UNVERIFIED | N/A |
| --- | --- | --- | --- | --- |
| 1. Purpose and content | 5 | 0 | 0 | 0 |
| 2. Search and sharing | 1 | 0 | 0 | 6 |
| 3. Accessibility and responsive behavior | 5 | 0 | 2 | 0 |
| 4. Performance and resilience | 3 | 0 | 1 | 2 |
| 5. Forms and sensitive flows | 3 | 0 | 2 | 1 |
| 6. Privacy, legal and measurement | 0 | 0 | 0 | 6 |
| 7. Release and final QA | 4 | 0 | 2 | 0 |
| 8. Private owner center | 0 | 0 | 0 | 15 |
| Software agreement signing | 1 | 0 | 3 | 8 |
| Total | 22 | 0 | 10 | 38 |

Not claimed launch-ready. Still UNVERIFIED, with no owner-accepted exception:
- 200% zoom, a second browser and a real device;
- performance;
- browser failure states;
- real email delivery;
- counsel review of the punctuation change;
- PDF rendering in the Workers runtime and a signed packet's text extraction and certificates;
- the post-deployment checks and receipt, which follow the merge.

## Remaining work

- Before merge: Codex's security review and a review of the final head; CI green on the final head.
- After merge: the post-deployment checks in section 7, and the receipt.
- Owner, optional: a second browser, a real phone and 200% zoom; a signed test agreement in production to see the Libron headings in the Workers runtime.
- Follow-ups offered: re-render the link previews with the new label face and the new premiere and releases layouts.
