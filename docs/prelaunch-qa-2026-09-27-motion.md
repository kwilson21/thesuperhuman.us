# Site motion release gate

Date: September 27, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#132](https://github.com/kwilson21/thesuperhuman.us/pull/132)  
Code revision: `f8c15150a7877359823f088377a6334ccdc449f0` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (Home, About, Audio, Building, Work, Writing) and the alternate `https://audio.thesuperhuman.us` entry served by the same Worker  
Reviewer and deployment authorization: Kazon Wilson, “Once the PRs are green and no more review issues go ahead and merge everything”  
Scope: a shared scroll and entrance motion layer with Home's worlds (living studio, dark screen world, waveform edge, inked notebook title, horizon) and lighter scenes on About, Audio, Building, Work and Writing; the website added as a `shipped` publicist project whose 17 existing entries are exempt from review notes; silent page recordings for the publicist (not deployed); docs  
Rollback revision: `3fb4e4d1784d3eb6af24f19bd0a0baac67b75ba0`

This is a scoped deployment record against the reusable pre-launch checklist.
Items outside the changed behavior are marked N/A with the reason. Evidence was
gathered in Chromium against the local dev server with external requests blocked.
This container cannot reach `thesuperhuman.us` (the network policy denies the
host), so production live verification remains UNVERIFIED until someone with
access reads it back.

## 1. Purpose and content

- **PASS · Project and authorization.** PR #132 targets `main` from
  `claude/loving-fermi-ogos4c` with explicit merge authorization once CI is green
  and reviews are clean. The owner chose to keep the dark screen world and the
  notepad trail, confirmed the website's publicist tier (`shipped`) and start
  (`2026-09-27`), and chose to keep recordings in the repository.
- **PASS · Approved design and claims.** Page copy, order, headings and calls to
  action are unchanged. One project story summary lost an em dash; its claim is
  the same. The motion draws in SVG over the existing reviewed images, whose
  hashes are unchanged; their visual review records describe each animated layer.
  No new image, dependency or font. The recordings are silent captures of this
  site, so no music rights apply.
- **PASS · First-screen purpose and CTA.** Home's hero copy and CTA are
  unchanged. The hero copy and art settle within about 1.5 seconds and the studio
  scene rests within five; the resting frame is the page without motion. The CTA and the `/#contact` deep link land correctly at
  320, 390 and 1280 pixels.
- **PASS · Navigation, footer, contact, and external links.** No route or link
  changes. `/#contact`, `/about#resumes` and `/writing#website-redesign` land on
  their targets with motion on. The Building feature's Tally link stays clickable
  above its tilt layer.

## 2. Search and sharing

- **N/A · Titles and descriptions.** No metadata changes.
- **N/A · Canonicals and sitemap.** No URL or indexing changes.
- **N/A · Open Graph.** No sharing metadata or image changes.
- **N/A · Icons.** No favicon or touch-icon changes.
- **N/A · robots and sitemap membership.** No crawler-policy changes.
- **N/A · Preview indexing.** Preview access is unchanged.
- **N/A · Structured data.** No structured-data changes.

## 3. Accessibility and responsive behavior

- **PASS · Landmarks and headings.** Page structure is unchanged. axe-core 4
  reports no violations on all six pages at 390 and 1280 pixels after every scene
  has played. Its remaining "needs review" items are decorative arrow glyphs and
  About's inline name span, both dark ink on paper and unchanged by this release.
- **PASS · Image alternatives and icon names.** Every added overlay is
  `aria-hidden` and not focusable. Existing alternatives are unchanged.
- **PASS · Keyboard and focus.** Tab order is unchanged. A block that is still
  fading in completes at once when focus lands inside it. Pointer tilt runs only
  for a fine pointer. No traps.
- **N/A · Form guidance and announcements.** No form changes.
- **PASS · Contrast, zoom, and motion.** Dark world text is 16.0:1 (ink),
  7.9:1 (muted) and 7.1:1 (accent) on its background, and at least 6.5:1 on its
  wells. At 640 pixels (1280 at 200% zoom) no page overflows. With reduced motion,
  the motion root class is never added and every page shows its complete resting
  frame; switching preference mid-visit tears motion down. Nothing that plays on
  its own lasts more than five seconds or loops. Printing stops motion and prints
  the resting frame. Without JavaScript the pages are complete.
- **PASS · Responsive behavior.** All six pages at 320, 390, 640, 768, 1280 and
  1440 pixels, with and without reduced motion: no horizontal overflow and no
  page errors. The Writing illustration holds its entrance when the first frame
  shows it off screen (320 × 568, 568 × 320, 844 × 390, 800 × 280, and deep
  links past it at 360 and 390), plays once half of it or half the viewport is
  filled, and plays on load where it is on screen.
- **UNVERIFIED · Browser coverage.** Only Chromium is available in this
  environment, and no real device. The motion uses widely supported CSS and
  IntersectionObserver, fails safe to the resting frame, and the page is
  complete without it, but Safari and a real phone have not been observed.
  Follow-up: the owner checks Home and About on an iPhone after deployment.

## 4. Performance and resilience

- **N/A · Images.** No image changes.
- **PASS · Client and font cost.** No dependency, embed, font file or weight was
  added. The shared motion layer is 4.1 KB (1.6 KB gzip); Home's scenes add
  3.7 KB (1.7 KB gzip); each other page adds under 0.4 KB. The recordings under
  `src/assets/projects/website/motion/` are not imported and are absent from the
  build output.
- **PASS · Web Vitals (lab).** Mobile profile at 390 × 844, 4x CPU slowdown,
  local dev server, median of three: LCP 164 to 356 ms with motion and 144 to
  296 ms without, CLS 0.000 on every page with motion on. Home's entrance adds
  about 80 ms of lab LCP. These are lab results, not field evidence.
- **PASS · Error resilience.** The motion driver catches its own failures and
  falls back to the resting frame. The count-up waits at its starting figure
  below the fold and restores the final figure on teardown.
- **N/A · Media failure.** Audio and video behavior is unchanged.
- **N/A · 404, redirects, and server-error disclosure.** No routing changes.

## 5. Forms and sensitive flows

- **N/A · All items.** Forms, resume approval and delivery, verification and
  storage are not touched.

## 6. Privacy, legal and measurement

- **N/A · Data inventory and processors.** No collected field, storage,
  processor, cookie, analytics or external resource change. The motion reads
  scroll position and pointer position in the browser only and sends nothing.
- **N/A · Privacy notice, consent, terms and address.** Unchanged.
- **N/A · Analytics and monitoring.** Unchanged.

## 7. Release and final QA

- **PASS · Required checks.** `npm test` passed 99 files and 560 tests;
  `npm run check` reported 0 errors and 0 warnings with 4 existing hints in files
  this release does not touch; `npm run build` completed; asset QA matched 35
  production files; the publicist gate passed locally for 38 entries. CI runs
  the gate with private note lookup.
- **PASS · Exact diff.** Independent review agents ran on every pushed head. The
  last pass found no blocking issues, and every verified finding from earlier
  passes was fixed and re-reviewed. No secrets, resume files, dependencies or unrelated runtime
  changes are present.
- **N/A · Bindings and migrations.** No binding, secret, migration,
  host-routing, cache-policy or header change.
- **PASS · Rollback.** `3fb4e4d` is the verified pre-release `main` revision.
  Reverting the PR restores the static pages.
- **UNVERIFIED · Post-deployment production.** Must confirm the merge revision,
  the Cloudflare production deployment, each changed page on both hosts, the
  motion script loading, reduced motion, a missing page returning 404, and
  sitemap and robots after merge. This container cannot reach production.
- **UNVERIFIED · Release receipt.** Must save the merge SHA, deployment result
  and production readback before claiming verified live.

## Pre-merge outcome

**PASS for authorized merge with mandatory post-deployment verification.** The
remaining UNVERIFIED items are Safari and real-device observation, and the
production readback that needs the merge and network access to the host.
