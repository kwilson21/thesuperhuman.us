# Closing panel legal line balance release gate

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/closing-legal-balance`, from `origin/main` at `88551410`
Commits: `2d29fd93` (test), `1e9c1085` (change), `ded6b517` (release record) and this record update
Pull request: [#260](https://github.com/kwilson21/thesuperhuman.us/pull/260)
Target: production `https://thesuperhuman.us` after merge. The shared footer also renders on `audio.thesuperhuman.us`.
Reviewer: Claude Haiku 5.5 subagent, test first. The coordinating session owns the review, the Hallmark audit and the browser checks listed as UNVERIFIED. This record does not certify them.
Rollback revision: `88551410` (`origin/main` when this branch was cut). The PR adds no migration and writes no stored data.

## Scope

- One CSS property on the closing panel's legal line (`.closing-legal` in `src/components/Footer.astro`): `text-wrap: balance`.
- The line is `The Superhuman Group LLC · {year}`. At 320px wide it wrapped so that "· 2026" sat alone on a second line. Balanced, it breaks into two even lines ("The Superhuman" / "Group LLC · 2026"). That result was seen on 2026-11-13 by applying the same single declaration to the live Work page at 320px wide in Chromium (the built-in browser of the coordinating session), before the change was built. It is not yet seen on a build of this branch. Where the line fits on one line, nothing changes.
- Shown on every page that uses the shared footer, both the invitation and the quiet panel.
- No markup change, no font size change, no change to the panel's other rules.

## Owner decision

- On 2026-11-13, in conversation, the owner was shown options A to D side by side at 320px and answered "B" (option B, balanced wrap):
  - A: the line as it was.
  - B: balanced wrap (this change).
  - C: the year on its own line.
  - D: one line in smaller text.

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1, pnpm 12.20.0, on the branch after the two commits:

- Test first: the new assertion in `tests/components/closing-panel.test.ts` failed before the change (`text-wrap: balance` absent from `.closing-legal`). After the change, `tests/components/closing-panel.test.ts` passes, 27 of 27.
- `pnpm run format`: fixed 1 file (the new test's line wrapping). `pnpm run format:check`: no fixes, 677 files.
- `pnpm run lint`: 64 error lines, all in files this change does not touch (`src/lib/agreement-draft.ts`, `src/lib/audio-client-access.ts`, `tests/api/*`, and others). None in `Footer.astro` or the closing-panel test. Lint is not a CI check.
- `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 258 files, 11,812 passed, 3 skipped.
- `pnpm run design:check`: passed, 6 gates.
- `pnpm run build`: exit 0, "Complete!". The built CSS (`dist/_astro/index.*.css`) contains `text-wrap: balance`.
- Independent review on head `ded6b517` by two Claude Sonnet subagents on 2026-11-13. Correctness review: clean (the rule is scoped to the one paragraph by Astro; both footer variants and the audio host wrapper render it; the global `p { text-wrap: pretty }` in `src/styles/global.css` is overridden by the scoped class; a browser without support wraps as before; the built CSS keeps the declaration). Rules review: found no code or rule defect and asked for the documentation changes made in this commit.

UNVERIFIED until checked:

- The rendering at 320px, at 390px and at desktop width, in a browser. The PR's Screenshots workflow captures every page at 1280×800 and 390×844; the 320px rendering has not been looked at.
- A second browser, and a real phone.
- A browser without `text-wrap: balance` support. There the line wraps as it does today (the orphaned "· 2026" returns). This is acceptable.
- Hallmark audit: run read-only from source by an independent reviewer on 2026-11-13: no defects (muted text on the panel is 7.6:1 at 14px; only the `--muted` token is used; the line is not clickable; the six `design:check` gates pass). The audit's missing-stamp findings are set aside as `docs/design-standard.md` says. No new design choice beyond the approved option B. Not run, because they need a rendered page, and still UNVERIFIED: the wrap at 320px, 390px and 1280px on this branch's build, horizontal overflow, contrast in context, the visual slop test and the structural fingerprint.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `origin/main`; one CSS property and its test. Deployment authorization: not given by this record.
- **PASS · Approved design and truthful claims.** The look is the owner's option B. No professional claim changes, no copy changes, no images.
- **N/A · Explanatory copy.** No copy changes.
- **N/A · First screen and next step.** Not changed.
- **PASS · Navigation, footer, contact and links.** Markup is unchanged, so the footer links and their targets are unchanged. The legal line still reads `The Superhuman Group LLC · {year}`.

## 2. Search and sharing

- **N/A · Titles, descriptions, canonical URLs, Open Graph, icons, robots, sitemap, structured data.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **PASS · Landmarks and headings.** Markup unchanged.
- **N/A · Image alternatives, form labels and errors.** No images or forms change.
- **PASS · Keyboard and focus.** The line is not focusable; no focus behavior changes.
- **PASS, with limits · Contrast and touch targets.** Colour and size are unchanged. Muted text on the panel is 7.6:1 at 14px; this rests on unchanged tokens, not a new measurement. Text wrapping does not change contrast.
- **UNVERIFIED · 200% text zoom and reduced motion.** Not checked by this subagent. The change has no motion.
- **UNVERIFIED · Widths.** 320px, 390px and desktop renderings have not been checked in a browser by this subagent.
- **UNVERIFIED · Second browser and a real phone.** Not checked.

## 4. Performance and resilience

- **N/A · Images, client code, dependencies, fonts.** One CSS property; no new asset, script or dependency.
- **N/A · 404 and redirects.** No route, header, redirect, host or cache change.
- **UNVERIFIED · Measured performance.** Not measured. The change is not expected to affect it.

## 5. Forms and sensitive flows

- **N/A.** No form, endpoint or approval flow changes.

## 6. Privacy, legal and measurement

- **N/A.** No data, storage, cookie, analytics or processor changes. The company name and year line is unchanged in content.

## 7. Release and final QA

- **PASS · Type, test, format, lint and build checks.** See Evidence. Lint: no new findings in touched files.
- **PASS · Diff review.** Two files: `src/components/Footer.astro` (one rule gains `text-wrap: balance`) and `tests/components/closing-panel.test.ts` (one test). Plus this record. No secrets, no dependency changes, no generated files committed. `.jolli/` is untracked and not committed.
- **N/A · Bindings, secrets, migrations.** None change.
- **N/A · HTTPS, host routing, cache behaviour and response headers.** No route, header, redirect, host or cache change.
- **PASS · Rollback version.** `88551410`.
- **UNVERIFIED · Production verification after deploy.** To be done after an authorized merge: the footer on an invitation page and a quiet page at 320px, and the audio host.
- **PASS · Receipt and evidence.** This record. Status: implemented; tests, typecheck and build pass locally; rendering on this branch not yet viewed; not deployed; not verified live.

## 8. Private owner center

- **N/A.** Not affected.

## Remaining work

- CI green on the final head, and Greptile and Codex reviews.
- PR Screenshots run: look at the 390px and desktop captures.
- A 320px browser check, a second browser and a real phone (UNVERIFIED above).
- Production check after an authorized merge (section 7).
- The branch preview is behind Cloudflare Access, so the coordinating session could not open it.
- Note for design: `design.md` says "Headings balance; prose wraps `pretty`". The legal line is a paragraph, not a heading, and is now balanced. The owner approved this. `design.md` now records the exception: a short centred line may balance, and the closing panel's LLC line does (Nov 13 decision).
