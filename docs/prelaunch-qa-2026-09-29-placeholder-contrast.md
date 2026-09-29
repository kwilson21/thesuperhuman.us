# Intake placeholder contrast release gate

Date: September 29, 2026  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#151](https://github.com/kwilson21/thesuperhuman.us/pull/151)  
Code revision: `c6cd129901b67ca06f9d89607f659acbe97a6a03` (this record is committed on top of it)  
Target: production `https://thesuperhuman.us` (`/audio/start` and `/software/start`)  
Reviewer and deployment authorization: Kazon Wilson. They accepted the placeholder contrast exception in [#150](https://github.com/kwilson21/thesuperhuman.us/pull/150) on condition of this follow-up, then chose option A (this colour) over `var(--muted)` from a side-by-side of both forms at 1280 and 390 px ("A", owner, in conversation, 2026-09-29)  
Scope: one placeholder colour rule in `src/styles/audio-intake.css`, which both intake pages load, and a test that recomputes its contrast from the tokens  
Rollback revision: `48ae7f75dc2d9e41e6f82bc4b0cf9f3c7ed35ae3` (current `main`)

This is a scoped deployment record against the reusable pre-launch checklist.
Only the placeholder colour on the two intake forms changes; every item outside
it is N/A with the reason. It resolves the placeholder contrast exception in
[the software brief record](prelaunch-qa-2026-09-29-software-brief.md).

## 1. Purpose and content

- **PASS · Project and authorization.** Branch `claude/placeholder-contrast`
  targets `main`; the owner asked for this follow-up and approved the look.
- **N/A · Claims, first screen, navigation and links.** No copy, route or link
  changes. The placeholder text itself is unchanged.

## 2. Search and sharing

- **N/A · All items.** No titles, metadata, images or routes change.

## 3. Accessibility and responsive behavior

- **PASS · Placeholder contrast.** Placeholders were Tailwind's default
  `#9ca3af` on `#fbf8f2` (about 2.4:1). They are now
  `color-mix(in srgb, var(--muted) 80%, var(--paper))`, which Chromium renders
  as `#6d6d6c`, about 4.9:1. Measured with `getComputedStyle(…, '::placeholder')`
  on the software brief's "For example:" textarea and the audio song title and
  file link fields at 1280 × 800 and 390 × 844; every intake input keeps the
  paper background, including the one inside the tinted file link panel.
- **PASS · Why this colour.** Derived from the existing `--muted` and `--paper`
  tokens, so no new colour or token is added. 80% is the lightest mix that
  clears 4.5:1 (75% gives about 4.3:1), which keeps the example a step lighter
  than the hint above it (`--muted`, about 8.4:1) so it still reads as a
  placeholder rather than entered text.
- **PASS · Scope.** Every placeholder on both pages sits inside `.intake-field`,
  and only these two pages use that class. Contact, resume request and studio
  forms are unchanged.
- **PASS · Responsive.** Before and after captures at both widths have
  identical dimensions; only the placeholder text differs.
- **N/A · Structure, keyboard, focus, zoom and motion.** Markup and layout are
  unchanged.
- **UNVERIFIED · Other browsers.** Checked in Chromium only. A browser without
  `color-mix` support drops the rule and shows the previous grey.

## 4. Performance and resilience

- **N/A · All items.** No images, fonts or client code change; the stylesheet
  grows by one rule.

## 5. Forms and sensitive flows

- **N/A · All items.** Validation, submission and receipts are unchanged.

## 6. Privacy, legal and measurement

- **N/A · All items.** No data, notices or analytics change.

## 7. Release and final QA

- **PASS · Required checks.** `npm run check` reported 0 errors and 0
  warnings; `npx vitest run` passed 103 files and 640 tests, including
  `tests/components/intake-placeholder-contrast.test.ts`; `npm run build`
  completed and the built CSS keeps the `color-mix` rule; `npm run copy:check`
  passed.
- **UNVERIFIED · Review.** Independent review of the final head is pending.
- **N/A · Bindings and migrations.** None.
- **PASS · Rollback.** `48ae7f7` is the current `main`; reverting restores the
  previous placeholder grey.
- **UNVERIFIED · Post-deployment production.** After the merge deploys, confirm
  the placeholders on `/software/start?path=workflow` and the audio song step
  on `thesuperhuman.us` render `#6d6d6c`.
