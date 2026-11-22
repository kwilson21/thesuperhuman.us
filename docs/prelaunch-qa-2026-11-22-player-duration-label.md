# Project player duration label release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/player-duration-label`
Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson. Implementation was done with Claude Code; independent review passes are recorded under Reviews. Greptile and Codex review on the pull request. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `0097b63f`, the revision of `main` this branch was cut from. If `main` moves before the merge, the rollback point is the merge commit's first parent, and to undo only this change, revert the merge commit.

## Scope

One behaviour fix in the studio's audio player, and the removal of the screenshot tooling's workaround for it.

- `src/scripts/project-player.ts`: after a player's listeners are attached, the script checks the audio's state once. If the audio has already failed, the player shows its "could not load" state. If its metadata has already loaded, the time label is rendered. Before this, both depended on events that may have fired before the script ran, so the label could stay at `0:00` with no duration, and a failed load could go unreported until the visitor pressed play.
- `scripts/screenshots/media.mjs` and its README section: the capture no longer dispatches a `loadedmetadata` event into the page. It still waits for the metadata and for the label to show the duration.
- Tests: `tests/scripts/project-player.test.ts` and `tests/scripts/screenshot-media.test.ts`.

No copy, markup, style, route, binding, secret, migration or workflow change. The player is used on the client project page (`src/pages/studio/projects/[id].astro`, through `src/components/ProjectPlayer.astro`).

## Owner decisions

- Owner, in conversation, 2026-11-22: approved fixing the duration label in the site code and dropping the capture workaround ("Yes to all four", answering a list whose first item was this fix).

## Evidence and limits

Local runs: macOS arm64, Node 26.13.1, on commit `336f4fae`, in the pull request worktree.

- New tests failed before the fix, as they should: the label test with `expected '' to be '0:00 / 2:05'`, and the failed-audio test with `expected false to be true`. The third new test (metadata not yet loaded, then a `loadedmetadata` event) passed before and after; it guards the existing behaviour. A fourth test, added after review, pins the order of the two checks (an audio with both an error and loaded metadata shows the failed state); it failed when the two checks were swapped locally (`expected false to be true`), and the swap was then undone. The failed-audio test also asserts that the message is shown and contains "could not load".
- `pnpm run format`: no fixes applied.
- `pnpm run lint`: no findings, exit 0.
- `pnpm run check`: 0 errors, 0 warnings, 16 hints.
- `pnpm test`: 387 test files passed; 15,016 tests passed, 3 skipped.
- `pnpm run build`: complete, exit 0, and the client bundle and client graph tests passed with `REQUIRE_CLIENT_BUNDLE=1` (112 tests). Both were run on `91c85bdd`; the commits since change only this record and two test files.

Limits:

- The fix was verified by unit tests with a simulated audio element. It was not observed in a real browser against a real audio file, on a phone, or in Safari or Firefox: UNVERIFIED.
- The CI capture of the studio project page is the first real-browser evidence. It waits for the label to show a duration and fails if it never does. Its result on this branch had not been read when this record was written: UNVERIFIED.

### Reviews

- An independent review of head `1d0ebebf` found nothing that had to change. It confirmed that the page's script runs once per load, that showing the failed state at setup matches what the existing error listener does, and that the new tests run the real setup code. It asked for three test improvements (the order test, the visible-message assertions and the removal of unused test scaffolding), which are in `336f4fae`, and for the header wording of this record.
- A second independent review, of head `03ddfad6`, found the added tests and the code sound: the scaffolding removal is complete, no assertion was weakened, the order test would catch a swap of the two checks, and nothing under `src/` or `scripts/` changed after the first review. It found one wrong sentence in this record (which commits followed `91c85bdd`), corrected in the commit after it.
- The Greptile and Codex reviews on the pull request had not reported when this record was written: UNVERIFIED.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: see Scope and Rollback revision. Untracked `.jolli/` is not part of the change. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no design, copy, first screen, navigation or link changed.

### 2. Search and sharing

- N/A, every item in this section: no page metadata, sitemap, robots, icon or structured data changed. The player is on a signed-in client page.

### 3. Accessibility and responsive behavior

- PASS, the changed behaviour: the render that now runs at setup is the same one that sets the seek control's `aria-valuetext`, and the failed state is the same one that disables the controls and writes the status text. No markup or style changed.
- UNVERIFIED: a screen reader or real device check of the player.
- N/A, `hallmark audit`: not run because no page design changed.

### 4. Performance and resilience

- PASS, failure behaviour: an audio that failed before the script ran now shows the "could not load" message with its retry control at once.
- N/A, the remaining items: no asset, script weight worth measuring (four lines), caching or network behaviour changed.

### 5. Forms and sensitive flows

- N/A, every item in this section: no form, email, sign-in, payment or stored data changed.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no stored data, cookie, analytics, legal text, external embed or processor changed.

### 7. Release and final QA

- PASS, 7.1 Required type, test and build checks: see Evidence and limits.
- PASS, 7.2 Exact diff review: 5 files changed besides this record, all named under Scope. Independent reviews of `1d0ebebf` and `03ddfad6` (see Reviews). The Greptile and Codex reviews had not reported when written: UNVERIFIED.
- N/A, 7.3 Production bindings, secrets, migrations, HTTPS, host routing, cache behavior and response headers: none changed.
- PASS, 7.4 Rollback version preserved: see Rollback revision above.
- UNVERIFIED, 7.5 After authorized deployment: not merged when this record was written.
- PASS, 7.6 Receipt and QA evidence, with the four states reported separately. Implemented: yes. Verified locally: yes (unit tests and local checks; no real browser). Verified in CI: not yet read. Deployed: no. Verified live: no.

### 8. Private owner center

- N/A, every item in this section: no Access setting, binding, route, migration, payment setting or owner page changed.

## Remaining work and follow-ups

- Read the CI capture of the studio project page on this branch.
- A real-browser check of the player with a real file, by the owner or after deployment.

## Delivery status

Implemented: yes. Verified locally: yes. Verified in CI: not yet read. Deployed: no. Verified live: no.

This record does not by itself authorize deployment. Merging to `main` deploys production and needs the owner's authorization.

Decisions and merge authorization: Kazon Wilson. Implementation was done with Claude Code; independent review passes are recorded under Reviews. Greptile and Codex review on the pull request. This record does not certify the checks listed as UNVERIFIED.
