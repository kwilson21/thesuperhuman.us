# Complete website PR stack — September 16, 2026

## Consolidated pull request

PR #44 is the single launch candidate against `main`. The reviewed child PRs #47 and #49 through #57 were merged inward on September 20, preserving their review history while leaving production unchanged.

The consolidated PR passes repository validation, Greptile review, and its Cloudflare preview build. Footer and sitemap overlaps are resolved. Old News remains draft in the release, recording, and mastering-example records. Merging PR #44 would target `main` and may trigger the connected production build, so it remains open until the production gates and explicit deployment approval are complete.

## What merging makes available

Career and prelaunch changes, the Releases/Portfolio page framework, the revised services and intake, and the music infrastructure become available after the main deployment. The Old News recording, release and portfolio example are implemented but draft. They remain absent from the production catalog until their three records are deliberately promoted in a separately reviewed release change.

## Old News readiness

- PASS — owner confirmed direct streaming and portfolio permissions on September 16.
- PASS — mix, master and lyric video staged in the private audio bucket; sizes and object checksums match local files. Public bucket domain disabled; no custom bucket domains.
- PASS — dedicated music database created and read back. The three baseline music tables are empty; their schema, index, archive trigger, empty migration ledger, pending migrations, and Time Travel recovery point were reconciled on September 20. No migration was applied.
- PASS — desktop/mobile visual review, shared-clock A/B and loudness, click/tap seeking, native video/audio time transfer, seek and fullscreen checks.
- PASS — 259 tests, Astro check (0 errors/warnings; 3 existing hints), asset QA and production build. Clean locked-dependency installation and Worker deployment dry-run pass.
- PASS — 90-day retention review produces private HTML and a matching manifest; approved cleanup archives daily totals atomically before removing raw events. No automatic deletion. Failure/race/retry tests and nonempty local D1 verification pass.
- PASS — production-built local candidate previously served release/portfolio/media byte ranges, playback events and test fan-interest submissions; a real 30-second listening check excludes seeking time. A regression test now pins all three Old News records to draft, and production catalog filtering excludes them.
- PASS — prelaunch privacy review addressed by adding music disclosure with #50, where processing begins. Sharp dependency is explicit.
- UNVERIFIED — standalone production reporting via Wrangler needs refreshed D1 authentication on this computer. Authenticated Cloudflare connector access and production schema readback are verified; local reporting and retention workflows pass.
- UNVERIFIED — live email delivery and operator payment/booking operations. These are service-intake launch checks; the song remains a streaming preview with interest requests, not a checkout.
- UNVERIFIED — public release playback, range responses, first-party event delivery and fan-interest submission on the final production host; verify after authorized publication.
- N/A — live YouTube playback; the supplied hosted lyric video is used. A future YouTube ID requires a real integration check.

## Publication step still requires approval

Complete the remaining protected-preview gates, review the exact migrations and production deployment, and obtain explicit approval before merging PR #44. After an authorized deployment, verify the actual production routes, media, event recording and interest submissions. Do not treat a successful build or merge as a live launch receipt. No automatic sales threshold or commerce flow is enabled.

## Recovery

A pre-stack Git bundle and prior source snapshots remain preserved locally. Existing original working files and private source media were not discarded. Current code is committed and pushed; private infrastructure receipts and journal checkpoints remain outside GitHub.
