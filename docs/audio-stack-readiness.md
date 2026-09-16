# Complete website PR stack — September 16, 2026

## Merge order

1. #44 — career story; base `main`.
2. #47 — prelaunch, privacy and 404; base `codex/career-story`.
3. #49 — reusable music catalog and private media; base `codex/prelaunch-readiness`.
4. #50 — listener interest and playback counts; base `codex/music-foundation`.
5. #51 — Old News, collections, portfolio and synchronized players; base `codex/music-demand`.
6. #52 — sound-first services and guided intake; base `codex/music-release-pages`.

All are ready for review. Footer and sitemap overlaps are resolved in the branches. The final tree matches the reviewed combined preview. Old News is approved for public catalog visibility in the stack, but nothing has been merged or deployed.

Merge bottom-up into main. After each parent lands, retarget the next PR to main and verify its diff and checks before merging. Do not merge a child into its unmerged parent: that would fold later work into the earlier PR. Preserve history with merge commits for this stack; squash/rebase would require another reconciliation pass.

## What merging makes available

Career and prelaunch changes, the Releases/Portfolio page framework, the revised services and intake, and the music infrastructure become available after the main deployment. The Old News recording, release and portfolio example are public/released in the branch stack. They will become publicly reachable only after the stack is merged and deployed.

## Old News readiness

- PASS — owner confirmed direct streaming and portfolio permissions on September 16.
- PASS — mix, master and lyric video staged in the private audio bucket; sizes and object checksums match local files. Public bucket domain disabled; no custom bucket domains.
- PASS — dedicated music database created, schema initialized and read back; both tables are empty. Binding is version-controlled in #50.
- PASS — desktop/mobile visual review, shared-clock A/B and loudness, click/tap seeking, native video/audio time transfer, seek and fullscreen checks.
- PASS — 259 tests, Astro check (0 errors/warnings; 3 existing hints), asset QA and production build. Clean locked-dependency installation and Worker deployment dry-run pass.
- PASS — 90-day retention review produces private HTML and a matching manifest; approved cleanup archives daily totals atomically before removing raw events. No automatic deletion. Failure/race/retry tests and nonempty local D1 verification pass.
- PASS — production-built local candidate serves public release/portfolio/sitemap, media byte ranges, playback events and test fan-interest submissions; a real 30-second listening check excludes seeking time. The GitHub catalog is now public/released in the unmerged stack.
- PASS — prelaunch privacy review addressed by adding music disclosure with #50, where processing begins. Sharp dependency is explicit.
- UNVERIFIED — standalone production reporting via Wrangler needs refreshed D1 authentication on this computer. Authenticated Cloudflare connector access and production schema readback are verified; local reporting and retention workflows pass.
- UNVERIFIED — live email delivery and operator payment/booking operations. These are service-intake launch checks; the song remains a streaming preview with interest requests, not a checkout.
- UNVERIFIED — public release playback, range responses, first-party event delivery and fan-interest submission on the final production host; verify after authorized publication.
- N/A — live YouTube playback; the supplied hosted lyric video is used. A future YouTube ID requires a real integration check.

## Publication step still requires approval

Merge the stack from the bottom up, deploy it, then verify the actual production routes, media, event recording and interest submissions. Do not treat a successful build or merge as a live launch receipt. No automatic sales threshold or commerce flow is enabled.

## Recovery

A pre-stack Git bundle and prior source snapshots remain preserved locally. Existing original working files and private source media were not discarded. Current code is committed and pushed; private infrastructure receipts and journal checkpoints remain outside GitHub.
