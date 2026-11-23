# Update image size release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/project-image-dimensions`
Pull request: #375
Target: production `https://thesuperhuman.us`
Decisions and merge authorization: Kazon Wilson. Implementation was done with Claude Code; independent review passes are recorded under Reviews. Codex reviews on the pull request. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `628b52f9`, the revision of `main` immediately before this pull request merged as `9c0bcd9f` (its first parent). To undo only this change, revert the merge commit `9c0bcd9f`. Migration 0028 is additive and can stay applied after a revert: code from before this change does not name its columns.

## Scope

A software project update can carry one image. The page now knows the image's pixel size before the image loads, so it reserves the right space and the text below does not jump.

- `migrations/music/0028_software_update_visual_size.sql` and `db/music.sql`: two nullable integer columns on `software_project_updates`, `visual_width` and `visual_height`.
- `src/lib/image-structure.ts`: `imageSize` reads the pixel size of a complete PNG, JPEG or WebP. It returns null when it is not certain.
- `src/pages/api/owner/requests/[id]/updates/[updateId]/visual.ts`: the owner's upload stores the size with the image, or NULL.
- `src/lib/software-projects.ts`: the two columns in the types and in `sharedSoftwareUpdates`, and `visualSize`, which gives the two attributes only when both values are positive integers.
- `src/components/SoftwareProjectUpdate.astro`: both `<img>` tags carry `width` and `height` when the size is stored. With no stored size the markup is as before.
- `src/pages/owner/requests/[id]/update.astro`: the owner's preview passes the stored size to the component. The small revision image on that page is unchanged, because its CSS sets no width and an attribute would set its displayed width.
- `src/scripts/software-composer.ts`: when the owner picks a new file the preview drops the old size; a rejected file puts the saved image back with its size; a finished upload clears the remembered size.
- `scripts/owner-health.mjs`: reports the two columns as missing until 0028 is applied.
- `README.md`: the "Update image size migration" note.
- Comments in `scripts/studio-retention.mjs`, `scripts/owner-health.mjs`, `src/server/studio-signin-store.ts`, `src/lib/audio-client-access.ts`, `tests/architecture/retired-sign-in-codes.test.ts`, `docs/verification.md` and `docs/plans/2026-11-audio-projects-conversion.md`: the future migration that drops `audio_client_codes` (issue 271) is no longer called 0028, because 0028 is now this migration. No code changed in those files other than the owner-health row above.
- Tests: `tests/security/image-size.test.ts`, `tests/lib/software-projects.test.ts`, `tests/pages/software-offer.test.ts`, `tests/scripts/software-composer.test.ts`, `tests/scripts/owner-health.test.ts`.
- Golden fixtures: 77 files re-recorded (see Golden fixtures).

No copy, style, class, route, binding, secret or workflow change. No new dependency.

Images uploaded before this change keep NULL and render as before. There is no backfill. `scripts/screenshots/images.mjs` still makes lazy images eager for captures, because older images have no size.

## Owner decisions

- Owner, in conversation, 2026-11-22: approved giving project update images a declared width and height ("Yes to all four", answering a list whose second item was this).
- Owner, in conversation, 2026-11-22: chose storing the size at upload over a fixed frame in CSS ("A for image size"). The owner was also asked whether to leave existing images or backfill them and did not answer; this change leaves them, which writes nothing to production.
- Owner, in conversation, 2026-11-22: accepted the standard for the size reader ("Yes, bounded standard"): correct for files that ordinary tools write, never crashes or hangs on bad input, stores unknown when unsure, and the rarer shapes found in review are recorded as known limits and not fixed.

## Before merge: migration 0028

Merging deploys. The new code names the two columns, so 0028 must be applied to production first. Nothing in the repository applies migrations; the owner applies them by hand (README, "Sign-in codes migration" and "Update image size migration").

- Deploying the code before 0028 breaks the client project page, the owner update page and the owner request page for a software request with a project, and an image upload answers 409 "The draft changed. The visual was not replaced." without saving.
- Applying 0028 before the deploy is safe: it only adds two nullable columns, and the code running before the deploy does not name them.
- `pnpm exec wrangler d1 migrations list MUSIC_DB --remote` shows what is pending; `pnpm exec wrangler d1 migrations apply MUSIC_DB --remote` applies every pending migration in order, so read the list first.
- Applied, 2026-11-22. Before: the production ledger, listed read-only, showed exactly one pending migration, `0028_software_update_visual_size.sql`. The owner then ran the apply command and pasted its output in conversation. After: the ledger, listed read-only, showed nothing pending, and `software_project_updates` in production has `visual_width` and `visual_height` (read with `pragma_table_info`).

## Known limits of the size reader

These are accepted, not open defects. In each, the stored size can differ from what some browsers show, so the reserved shape is wrong and that image shifts when it loads. Nothing is distorted, because the CSS sets `height: auto`.

- An Orientation tag stored outside the first EXIF directory (the Exif, GPS or second directory). Observed in review: Chrome, Firefox and WebKit each apply some of these.
- An orientation given only in XMP inside a PNG. Observed in review: WebKit applies it.
- EXIF resolution tags with pixel dimension tags that differ from the real size, which make a browser scale the image. Observed in review in all three engines for JPEG, and in Firefox for PNG.

The browsers disagree with each other on several of these files, so no stored size would be right for every viewer.

## Golden fixtures

This is a behaviour change, not a conversion. The pull request does not carry the `conversion` label and `golden:neutral` does not apply.

- Commit `28255d30` re-records 77 fixtures, one file at a time, and holds nothing else. Its message says "76 files" in one place; 77 is the right count, and the message lists all 77 names.
- 76 of them changed only because the dump of `software_project_updates` gained two NULL columns and the database digests moved with it. An independent review decoded three of them before and after and found no changed response, statement or effect.
- `owner-request-update-visual` also changed in its upload statement: the UPDATE sets the two new columns, with two more binds (4 and 4 for the test images, NULL for placeholder bytes).
- No fixture changed in any later commit on the branch.

## Evidence and limits

Local runs: macOS arm64, Node 26.13.1, on commit `a1ce0656` (after merging `main` at `98e9404a`), in the pull request worktree.

- New tests were committed before the code in each round and failed first, as they should.
- `pnpm test`: 402 test files passed; 15,228 tests passed, 3 skipped.
- `pnpm run lint`: no findings, exit 0.
- `pnpm run format`: no fixes applied.
- `pnpm run build`: complete, exit 0. With `REQUIRE_CLIENT_BUNDLE=1`, the client bundle and client graph tests passed (112 tests). The browser's set of modules is unchanged: `image-structure.ts` is reached only by server routes.
- FAIL locally, `pnpm run check`: 1 error, 0 warnings, 16 hints. The error is in `astro.config.mjs` line 46, a file this change does not touch: a type mismatch between two copies of Vite's types. An independent review traced it to a stray real directory at `node_modules/vite` in this checkout, which a clean install does not create; `pnpm install --frozen-lockfile` did not remove it. The same command passes in CI: the Validate workflow, which runs `pnpm run check`, succeeded on `4f17ec61` (run 45086078322).

Limits:

- The size reader was checked with unit tests on bytes built in the tests, and in review against files written by Pillow, `cwebp` and `sips`, and one macOS screenshot. No image the owner has uploaded to a project went through it: UNVERIFIED.
- The rendered pages were not opened by hand in a browser. The CI capture is the real-browser evidence: the Screenshots run on `4f17ec61` (run 45086078294) succeeded. Four of its software project captures (direction review at both sizes, the owner composer and the delivery review at 1280 by 800) are byte for byte the same as the captures of another pull request made before this change (`pr-362/fa4697d` on the `screenshots` branch), so the loaded pages look the same as before. The delivery review capture was opened and shows the uploaded image at its own proportions. The captures are taken after every image has loaded, so they do not show the space being reserved during loading: UNVERIFIED.
- Layout shift was not measured before or after.

### Reviews

- Four rounds of independent review. Every finding from the first three rounds was fixed, including optional ones.
- Round one found a size reader that could read EXIF data outside its block and an incomplete README list of what breaks before the migration. Round two found three JPEG layouts where Chrome and Firefox read different EXIF blocks; the reader now returns null for each. Round three compared about 100 built files with Chrome, Firefox and WebKit and found the shapes listed under Known limits, and that the browsers disagree with each other on some of them. The owner then set the standard recorded under Owner decisions.
- Codex's code review of `4f17ec61` on the pull request reported no findings, and its security review of the same head completed with no finding posted (observed on GitHub, 2026-11-23 UTC).
- Round four reviewed head `b4758e0e` against that standard and found nothing that had to or should change. It ran files from ordinary tools through the reader with correct sizes, and 5 MB hostile inputs finished in under 200 ms with no exception. Its two optional points, both about one code comment, were fixed in `a1ce0656`, a comment-only commit that no independent pass has read.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: see Scope and Rollback revision. Untracked `.jolli/` is not part of the change. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no design, copy, first screen, navigation or link changed.

### 2. Search and sharing

- N/A, every item in this section: no page metadata, sitemap, robots, icon or structured data changed. The pages are signed-in client and owner pages.

### 3. Accessibility and responsive behavior

- PASS, the changed markup: `alt` is unchanged on every image; the only added attributes are `width` and `height`. The image CSS (`width: 100%; height: auto`) is unchanged, so the attributes set the reserved shape and cannot stretch the image.
- PASS, the pages at 1280 by 800 and 390 by 844: the CI captures match the captures from before the change (see Limits).
- N/A, `hallmark audit`: not run because no page design changed.

### 4. Performance and resilience

- PASS, failure behaviour: an image whose size cannot be read uploads as before and stores NULL. The reader never throws.
- UNVERIFIED: the reduction in layout shift was not measured.

### 5. Forms and sensitive flows

- PASS, the owner's image upload: status codes, guards, audit entry and cleanup are unchanged; the size is read from the same bytes that are stored. Covered by the route tests and the re-recorded golden fixture.
- N/A, the remaining items: no email, sign-in or payment changed.

### 6. Privacy, legal and measurement

- PASS, stored data: two integers per image, derived from the image the owner uploaded. No personal data, cookie, analytics, legal text, external embed or processor changed.

### 7. Release and final QA

- PASS, 7.1 Required type, test and build checks: tests, lint, format and build pass locally; `pnpm run check` fails in the local checkout for a reason outside the change and passes in CI (see Evidence and limits).
- PASS, 7.2 Exact diff review: 21 files changed besides this record and the 77 fixtures, all named under Scope. See Reviews.
- PASS, 7.3 Production bindings, secrets, migrations, HTTPS, host routing, cache behavior and response headers: migration 0028 is applied (see Before merge). No binding, secret, routing, cache or header changed.
- PASS, 7.4 Rollback version preserved: see Rollback revision above.
- UNVERIFIED, 7.5 After authorized deployment, production revision, journeys, sitemap, robots, metadata, missing page, forms and monitoring: merged to `main` on 2026-11-23 UTC as `9c0bcd9f`. Observed afterwards: the Cloudflare production build for that commit succeeded (00:43 UTC), and `https://thesuperhuman.us/` and `https://audio.thesuperhuman.us/` answered 200. The client project page and the owner pages that read the new columns were not checked live: they are signed-in pages, and no sign-in was made for this record. None of the other items was rechecked.
- PASS, 7.6 Receipt and QA evidence, with the four states reported separately: see Delivery status.

### 8. Private owner center

- PASS, the migration item: 0028 is applied (see Before merge).
- PASS, the owner pages changed: the update page's preview and the image upload, covered by tests. No Access setting, binding or payment setting changed.

## Remaining work and follow-ups

- Open one software project page on the live site, and upload one real project image and confirm it shows as expected (owner).
- Images uploaded before this change have no size. A backfill would be a production data write and was not decided.

## Delivery status

Implemented: yes. Verified locally: partly (tests, lint, format and build pass; `pnpm run check` fails in this checkout for a reason outside the change). Verified in CI: yes on the final head `e4d17123` for Validate, Golden neutrality, the Screenshots capture and the Cloudflare preview build. Migration 0028: applied to production before the merge. Deployed: yes (merged 2026-11-23 UTC as `9c0bcd9f`; production build succeeded). Verified live: no (hosts answer 200; the pages that show update images were not checked).

- The final head `e4d17123` differs from `4f17ec61`, the head Codex reviewed, by one commit that changed only this record and by a merge of `main` at `628b52f9`. Neither was read by Codex or by an independent review.
- Before merge, on `e4d17123` (observed on GitHub): every listed check had succeeded, no workflow was queued or running for the branch, no review thread was open, and the production ledger listed no pending migration.
- The owner authorized merging in conversation ("Yes, merge #375"). After the merge the owner said the pull request had not been explained clearly; it was then explained in plain terms and the owner chose to keep the change ("Keep it").

This record does not by itself authorize deployment.

Decisions and merge authorization: Kazon Wilson. Implementation was done with Claude Code; independent review passes are recorded under Reviews. Codex reviews on the pull request. This record does not certify the checks listed as UNVERIFIED.
