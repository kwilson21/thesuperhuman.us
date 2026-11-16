# Listening desk, loudness meters and Home signal release gate

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Branches: `claude/loop-desk` ([#315](https://github.com/kwilson21/thesuperhuman.us/pull/315)), `claude/loudness-meters` ([#319](https://github.com/kwilson21/thesuperhuman.us/pull/319), stacked on #315) and `claude/one-signal` ([#320](https://github.com/kwilson21/thesuperhuman.us/pull/320), stacked on #319). `claude/one-signal` is merged with `origin/main` at `cd9a8186` (merge commits, never a rebase), which already includes #291, live since 2026-11-15. The three land together by merging #320, which holds all three, into `main`; #315's and #319's heads are ancestors of #320's.
Revision: the head of `claude/one-signal` that carries this record.
Target: production `https://thesuperhuman.us` and `https://audio.thesuperhuman.us` after merge. The full comparison player renders on the audio pages and song pages; Home's waveform edge and horizon render on `/`.
Decisions and merge authorization: Kazon Wilson, in conversation and on the private decision pages on November 15, 2026, then "yes" to merging. Implementation and independent review passes were done with Claude Code.
Rollback revision: `cd9a8186`, `origin/main`'s tip when it was merged into the branch. Re-check at merge time; the merge message records the actual one. The PRs add no migration, binding, secret or dependency, and write no stored data.

## Scope

- #315, the listening desk (`src/scripts/comparison-player.ts`, `src/scripts/comparison-transport.ts`, `src/components/audio/ComparisonPlayer.astro`): Loop repeats 4, 8 or 16 seconds from where the visitor is, shaded on both waveforms; Flip A/B switches versions on each pass on the audio clock; a seek moves the loop. Playback still waits for synced audio, as on `main`. Where synced playback fails, the desk turns off and focus moves to the native player of the chosen version; each new try clears the failure state.
- #319, loudness meters: each version of the full player shows its measured whole-song loudness on one scale (-20 to -6 LUFS) with a rounded bar end; Match loudness brings the louder one down and says by how much; in the fallback the meters show each export's own level. The reading keeps room for its longest form, so toggling Match never moves the controls. `src/lib/loudness-meter.ts` is added to the reviewed browser modules.
- #320, one signal through Home: the waveform edge draws the newest released song's waveform (Old News today; `src/lib/latest-song.ts`), and while the A/B plays the edge rises and falls with the music's live level (an analyser both versions pass through) and a ring of light around the horizon sun glows with it. Both rest when the music stops, only a visitor's Play starts them, and nothing moves with reduced motion or in print. `design.md`'s motion stance records the decision.
- Tests: `tests/scripts/comparison-desk.test.ts`, `tests/scripts/comparison-transport.test.ts`, `tests/scripts/home-signal.test.ts`, `tests/lib/loudness-meter.test.ts`, `tests/lib/latest-song.test.ts`, `tests/lib/home-motion.test.ts`, `tests/components/comparison-player-render.test.ts`, `tests/components/signal-edge-render.test.ts` and the helper `tests/helpers/render-astro.ts`. The `loop-desk` screenshot scenario and its mappings.

## Owner decisions

On November 15, 2026:
- Wait for synced playback rather than starting a stream at once (the instant start was dropped).
- Desk wording "Loop length" and "Loop repeats a few seconds from where you are"; lengths 4, 8 and 16 seconds; flips silent; loop seams as they are; and, on the round-two page, loop edges, the instruction line, "4 s" and the failure note all kept as they are.
- Meters show export loudness, not the volume; rounded bar ends.
- Home: option A (the edge and the sun move while the A/B plays), the edge shows "whatever the latest song I uploaded", the distance from the player is fine, the glow as it is.
- "yes" to merging.

## Checklist

### 1. Purpose and content
- Project, branch, instructions and authorization: PASS. The three branches of this repository; the owner authorized the merge in conversation.
- Approved design and truthful claims: PASS. Wording is the owner's choice; LUFS readings come from the catalog's measured loudness. Home's edge draws the owner's own released song.
- Explanatory copy and resume parity: N/A. No professional claims or resume content change.
- First screen and CTA: N/A. Unchanged.
- Navigation, footer, contact and external links: N/A. Unchanged.

### 2. Search and sharing
- N/A. No head, route or metadata change. The OG preview video still shows the old drawn edge; regenerating it is optional follow-up.

### 3. Accessibility and responsive behavior
- Landmarks, names and keyboard: PASS. Loop is a native button with `aria-pressed`; the length menu and Flip are labelled controls; Flip is disabled until Loop is on; a failure that disables a focused control moves focus to a native player. The meters' bars are `aria-hidden` and their readings are text. The edge and horizon stay `aria-hidden`.
- Status announcements: PASS. Loop changes are written to the player's status line; a seek's line waits until seeking settles; the "Preparing synchronized audio…" and failure notes are kept.
- Contrast and touch targets: PASS. Desk controls are at least 44px; meter text 8.4:1 (mix) and 4.78:1 (master) on paper; the bar track is decorative.
- Reduced motion: PASS. The meter's clip transition and Home's edge and glow run only with motion allowed; the edge and sun rest otherwise.
- Widths: PASS at 320 (computed), 390, 768 and 1280px for the desk and meters (no layout shift on Match), and 390 and 1280px for Home's edge.
- 200% text zoom: UNVERIFIED for these changes.
- Second browser and real device: UNVERIFIED. Only Chromium is installed in this environment; Web Audio scheduling was exercised against a stand-in clock in tests, not on Safari or a phone.

### 4. Performance and resilience
- Images and client code: PASS. No new images or dependencies; the browser bundle guard passes with the new browser module listed.
- Measured Web Vitals: UNVERIFIED. Not measured. The analyser reads 1024 samples per frame only while playing; the glow changes only opacity; the edge is not redrawn off screen.
- Missing or failing audio: PASS. The load-failure fallback is covered by tests (the desk turns off, the meters show export levels, a retry recovers).
- 404 and redirects: N/A. Unchanged.

### 5. Forms and sensitive flows
- N/A. No form, sign-in or approval flow changes.

### 6. Privacy, legal and measurement
- N/A. No data collection, storage, cookie, analytics or processor change. The level is read in the visitor's browser and never sent.

### 7. Release and final QA
- Type, test, asset and build checks: PASS. See Evidence below.
- Diff review: PASS. Independent review passes on every head through the final changes (#315 at `29ce6e65`, #319 at `a93bc5e0` and `4b6a652f`, #320 at `2618d5e0` and `c52d974a`), the last of each finding nothing.
- Production bindings, headers, cache: N/A. No binding, header or route change.
- Rollback: PASS. `cd9a8186`, re-checked at merge time.
- Live verification after deploy: UNVERIFIED until the deploy; recorded in the pull request once checked.
- Receipt: this record.

### 8. Private owner center, and software agreement signing
- N/A. Not touched.

## Evidence and limits

- On the tree merged with `origin/main` at `cd9a8186` (which brings #291's studio objects and #330's navigation prefetch): `pnpm run build` succeeds, and the full `pnpm test` with `REQUIRE_CLIENT_BUNDLE=1` passes (350 files, 14,005 tests, 1 skipped). Lint, format, design and copy checks pass.
- `pnpm run check` caught one merge defect: #291 had dropped `signal` from what `src/scripts/home-worlds.ts` takes from the motion layer, and #320's listener passes it to `followComparison`. The build does not type-check, so it would have thrown at run time and turned off Home's motion. Fixed by taking `signal` again; `pnpm run check` then reports 0 errors.
- Merged Home in Chromium against a local preview with motion allowed: the motion layer stays on (`.motion` on the root), no page errors, the controller's glass label shows on hover, and while the A/B plays `--glow` follows the level with `data-playing` on the horizon; both clear when it stops.
- CI on the heads before the merge of `origin/main`: #315 `29ce6e65`, #319 `4b6a652f` and #320 `c52d974a` each had `validate`, `capture` and `neutrality` succeed, and the Cloudflare previews built.
- CI screenshots checked by eye: the desk with Loop and Flip at both widths, and the meters with Match on.
- Local preview captures: the desk's edge styles, the meters at 390, 768 and 1280px with Match on and off, and Home's edge at rest, playing and stopped (a stand-in beat in place of the song files, which the preview does not have).
- Limits: Chromium only; no real device; no field data; the playing state is not captured in CI (captures run with reduced motion).
