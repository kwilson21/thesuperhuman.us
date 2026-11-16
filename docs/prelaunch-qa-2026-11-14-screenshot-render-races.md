# Screenshot rendering races release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/screenshot-render-races`
Pull request: #280
Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson. Implementation and independent review passes were done with Claude Code. Greptile and Codex review on the pull request. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `82e61315dc007e358eb427f0acd05014750dc51d`, the revision of `main` this branch was last merged with when this record was written. If `main` moves before the merge, the rollback point is the merge commit's first parent, and to undo only this change, revert the merge commit.

## Scope

Screenshot tooling only: files under `scripts/screenshots/` (the tooling, its README and scenario scripts) and `tests/scripts/`. No page, copy, asset, route, binding, secret, migration or workflow change. The net diff has no change under `src/` (`git diff --stat origin/main...HEAD -- src` prints nothing). `screenshots.yml` and `screenshots-publish.yml` are unchanged, and the reuse rules are unchanged.

Purpose: two captures of identical code should produce identical images.

What changed:

- A seeded `Math.random` on preview-origin pages, and a second 404 capture so both of the page's scenes are pinned (`not-found-desktop` and `not-found-wave-desktop`).
- An image wait before each capture: lazy images are made eager, then the capture waits for every image to be complete and decoded, capped at 3 seconds.
- A wait for audio metadata on pages with the project player.
- Fixed display values for the generated SOW number and agreement hash in the `software-signing` `guided-full` capture, with a caption note saying so.
- The Turnstile widget's box must hold still through the paint pause before a capture.
- A `cap:` settle reason now says whether the first pending request had a response, and its status.

## Owner decisions

- Owner, in conversation, 2026-11-13: approved the list of loose ends from the Screenshots speed-up, which included these rendering races ("yes to all the loose ends").
- No visual, copy or product decision is made in this change.

## Evidence and limits

Local runs: macOS arm64, Node 26.13.1, on head `c0bca2c9` (the branch merged with `main` at `82e61315`), in the pull request worktree.

- `pnpm run format:check`: `Checked 775 files ... No fixes applied.`
- `pnpm run lint`: no findings, exit 0.
- `pnpm run check`: 801 files, 0 errors, 0 warnings, 19 hints.
- `pnpm test`: 303 test files passed; 12,820 tests passed, 3 skipped (12,823).
- `pnpm run build`: `Complete!`
- `node scripts/publicist/gate.mjs`: `publicist-gate passed: 84 entries checked.` The private note lookup was skipped (no token; local build), so the private-note part of the gate is UNVERIFIED here.
- `git diff --stat origin/main...HEAD` before this record was added: 18 files changed, 1,909 insertions, 25 deletions.

### Image evidence

- Before this change, two full captures with the frozen clock (runs 43449812056 and 43470151487) differed in 29 images. Two local full captures at the start of this work differed in 27 of 325.
- Two local full captures of this change's code differed in 0 of 327 images by pixel comparison. This was measured on an earlier head of this branch; the commits since changed the README, tests and log wording, and the comparison was not repeated on the final head.
- The comparison was local. Two CI runs of this change have not been compared image by image: UNVERIFIED.

### Cost

- The image wait took 17.3 s of a full capture in CI at head `3327dc0a`, and 5.6 s of 366.8 s in a local full run.
- Capture runs on this branch (full captures, because the capture code changed): 43598351967, 43601786670 and 43605247022 each succeeded in 8 to 9 minutes from creation to finish.

### Known limits

- Two captures of `/owner/requests/screenshot-software-project` (`balance-open-desktop` and `redelivery-invoice-phone`) still wait the full 5 second settle cap. The log shows a request to that project's `messages` endpoint with a 200 response that never finishes in the browser. The cause is undetermined. The images did not differ between runs.
- The audio wait works around a race in the site's project player (`src/scripts/project-player.ts`), where the duration label can stay empty if the audio's metadata loads before the script listens for it. The capture shows the label a visitor sees when the race does not happen. The site code is unchanged; whether to fix it is with the owner.
- Project update images in `src/components/SoftwareProjectUpdate.astro` are lazy and have no declared size. The capture makes them eager; the site code is unchanged.
- The widget size check reads the container and its light-DOM descendants only, so a reflow inside a closed shadow root or a cross-origin frame is not detected.
- Once, a local capture stopped in the image wait because source files were edited during the run and the dev server reloaded the open pages. Nothing edits files during a CI run. The image wait now retries once when a navigation interrupts one of its page reads and the capture has no `prepare` step.

### Reviews

- Three independent review rounds of the pull request. The first two found code and wording items, all fixed. The third found the code clean and asked for two wording corrections, in the README and the pull request description, both applied.
- Greptile and Codex had not reviewed when this record was written: UNVERIFIED.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: repository `kwilson21/thesuperhuman.us`, branch `claude/screenshot-render-races`, screenshot tooling and its tests only. Untracked `.jolli/` is not part of the change. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or route changed.

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no page, copy, markup or style changed.
- N/A, `hallmark audit`: not run because no page design changed.

### 4. Performance and resilience

- N/A, every item in this section: nothing about the served site changed. The cost figures above concern the CI capture job.

### 5. Forms and sensitive flows

- N/A, every item in this section: no form, email, route, binding, secret or migration changed.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no stored data, cookie, analytics, legal text, external embed or processor changed. The fixed SOW number and hash are display values in a CI capture of demo data, labelled as such in the caption, and never reach a real agreement.

### 7. Release and final QA

- PASS, 7.1 Required type, test and build checks: see Evidence and limits.
- PASS, 7.2 Exact diff review: all changes under `scripts/screenshots/`, `tests/scripts/` or this record; no change under `src/`. Independent reviews (see Reviews). Greptile and Codex reviews of the final head: UNVERIFIED when written.
- N/A, 7.3 Production bindings, secrets, migrations, HTTPS, host routing, cache behavior and response headers: none changed.
- PASS, 7.4 Rollback version preserved: see Rollback revision above.
- UNVERIFIED, 7.5 After authorized deployment: not merged when this record was written.
- PASS, 7.6 Receipt and QA evidence, with the four states reported separately. Implemented: yes. Verified locally: yes. Verified in CI: yes for the checks and the capture job; no for a run-to-run image comparison. Deployed: no. Verified live: no (nothing about the served site changes).

### 8. Private owner center

- N/A, every item in this section: no Access setting, binding, route, migration, payment setting or owner page changed.

## Remaining work and follow-ups

- Find why the `messages` request on the software project page never finishes in the browser.
- Owner decisions: fix the project player's duration label in the site code (the capture workaround could then be removed), and give project update images a declared size.
- Seed speed (about 80 seconds per full run), unchanged here.

## Delivery status

Implemented: yes. Verified locally: yes. Verified in CI: checks and capture job yes, image comparison no. Deployed: no. Verified live: no.

This record does not by itself authorize deployment. Merging to `main` deploys production and needs the owner's authorization.

Decisions and merge authorization: Kazon Wilson. Implementation and independent review passes were done with Claude Code. Greptile and Codex review on the pull request. This record does not certify the checks listed as UNVERIFIED.
