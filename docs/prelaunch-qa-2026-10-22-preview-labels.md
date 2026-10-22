# Link-preview label update release gate

Date: October 22, 2026 (UTC). Local checks ran between about 17:38 and 17:56 UTC.  
Repository: `kwilson21/thesuperhuman.us`  
Branch: `previews-after-hallmark`  
Verified revision: `2b319b12`, one commit on top of `main` at `6c51010c`. This record is committed on top of it.  
Merged revision: `bdf17fe`, squash-merged to `main` on October 22, 2026 from the final head `21df610`. Its Workers Builds production build succeeded at 18:22:40 UTC (build `a2895a5d-f8cb-4003-b1fe-be7d9c417edd`), and `wrangler deployments status` showed Worker Version `dd0b4365-fcaa-4cba-b821-890fe29e7fc7` serving 100% of traffic since 18:22:31 UTC.  
Target: production `https://thesuperhuman.us` and `audio.thesuperhuman.us`: the link-preview posters at `/og/<scene>-<hash>.png` or `.jpg`, the videos at `/og/raw/<scene>-<hash>.mp4`, and the `og:image` and `og:video` tags that point at them.

Scope:
- `scripts/og-video/kit.css`: the scene kicker is set in Inter 500 capitals tracked at 0.12em, and the status line in Inter, the site's label and status styles since the Hallmark picks (D4.2-C, D4.1-D).
- `scripts/og-video/scenes/home.html`, `services.html`, `building.html`, `project-kaillera-next.html`: home's project statuses move under the names as dot lines, services drops the kicker the hub removed, building's statuses become dot lines, and Kaillera-next's diagram label uses the label face.
- `public/og/` and `src/data/og-media.json`: 21 scenes rendered again (music-old-news's frames were unchanged and its files kept).
- `docs/asset-reviews/link-previews.md`: the change, its inspection, and the new files' hashes.

Rollback revision: `6c51010c` (`main`, PR #210's squash merge), serving as Worker Version `a333392a-2aa1-48da-a64d-5901c582f541` at 100% since 17:25:29 UTC (read with `wrangler deployments status`). No migration, binding, secret, dependency, route or copy change. A rollback restores the previous posters and videos. A preview an app scraped after the deploy would then point at files that no longer exist until the app scrapes the page again.

Remaining work: the live checks at the end passed. The owner-side checks that the #203 record leaves open (Messages, the preview debuggers, the branch preview's gate and headers, alerting on the video route, the remote `owner:health` run) still apply.

## Owner decisions and authorization

On October 22, 2026, the owner asked for this work once the Hallmark feedback work finished ("We may need to update this after the hallmark website feedback work finishes"), then, at about 17:27 UTC, "Check now, then cancel if you can begin now" (in conversation). When the owner later said "We can't do unnecessary reviews here I don't have the usage for this", the multi-agent audit was stopped before any agent finished, and the coordinating session did the comparison itself. Later on October 22, shortly before the merge, the owner wrote "No need to make this a ci job right this moment, just update the live videos for now" (in conversation), the go-ahead to merge and deploy. The Screenshots `capture` check on `21df610` was cancelled at its 20-minute limit: every page imports `src/data/og-media.json`, so the capture treated every page as changed. No visible page changed; Validate and Workers Builds passed. No independent review agents ran, per the owner's usage instruction.

## Evidence and limits

- **Checks at `2b319b12`:** `npm test`: 141 files, 1,757 passed, 1 skipped (the agreement PDF test that needs a private file). `npm run build` passed, including `assets:check` (79 files match their review records), `copy:check`, `design:check` (6 gates) and the publicist gate. The build's warnings (the `SESSION` binding note, two empty content folders, a zod comment) predate this change.
- **Renders:** `node scripts/og-video/render.mjs` with `CHROMIUM_PATH=/opt/pw-browsers/chromium`. For every scene the renderer reported fonts loaded, no overflow, no text wider than its box and a last frame matching the first.
- **Visual check:** the coordinating Claude Code session compared every new poster with a 1280 × 800 screenshot of its live page, and inspected the building and project-kaillera-next posters and home's frame at 2.6 s at full size. Other moments of each loop, where only the label face changed, were not inspected frame by frame. No separate review agents ran, per the owner's instruction above.
- **Not done before the merge:** no request to a branch preview; no real device. After the deploy, production was checked (Live checks after deploy).

PASS means the evidence named here was observed.

## 1. Purpose and content

- **PASS · 1.1 Project, branch, changes, instructions and authorization.** Branch from `main` at `6c51010c`; the diff is the files in Scope. The owner asked for the work; merging waits for the owner's go-ahead.
- **PASS · 1.2 Approved design, claims, media.** The scenes follow the owner's picks D4.2-C and D4.1-B/D. No new art, captures or claims; every file is a re-render of reviewed scenes.
- **N/A · 1.3 Explain who does what.** No copy change. `tests/scripts/og-video-copy.test.ts` passes, so every scene line still appears on the site.
- **N/A · 1.4 and 1.5.** No page, CTA, navigation or footer change.

## 2. Search and sharing

- **N/A · 2.1, 2.2, 2.4 to 2.7.** No title, description, canonical, icon, robots, sitemap, preview-environment or structured-data change.
- **PASS · 2.3 Open Graph image at sharing size.** Every poster was inspected at about 560 × 294 beside its page; `tests/pages/og-tags.test.ts` and `tests/lib/og-media.test.ts` pass, so every page's tags name the new files and each file's fingerprint matches its sources. The alt text is unchanged and still matches the posters.

## 3. Accessibility and responsive behavior

- **N/A · 3.1 to 3.7.** No page markup, style or behavior change. Preview type stays 20px or larger.

## 4. Performance and resilience

- **PASS · 4.1 Media size.** Videos 99,955 to 1,066,222 bytes (budget 2.5 MB), posters under 600 KB, as the renderer enforces.
- **N/A · 4.2 to 4.6.** No route, caching, client code or 404 change.

## 5. Forms and sensitive flows

- **N/A · 5.1 to 5.6.** No form change.

## 6. Privacy, legal and measurement

- **N/A · 6.1 to 6.5.** No data, cookie, notice or analytics change.
- **UNVERIFIED · 6.6 Monitoring.** No monitoring change; the #203 record's open item (nothing alerts on the video route's failure path) still applies.

## 7. Release and final QA

- **PASS · 7.1 Required checks.** See Evidence and limits.
- **PASS · 7.2 Diff review.** Scene, kit, manifest, media and record files only; no secrets, private paths or dependency changes. The old files are removed and the new ones listed with their hashes.
- **N/A · 7.3 Headers and routing.** Unchanged.
- **PASS · 7.4 Rollback, review and authorization.** Rollback revision above. The owner gave the go-ahead (Owner decisions and authorization). No independent review agents ran, at the owner's instruction.
- **UNVERIFIED · 7.5 Post-deployment verification.** The serving version is read from Cloudflare (Merged revision), and live checks 1 to 3 passed on both hosts. Monitoring (6.6) and `owner:health` (8.15) stay open as in the #203 record.
- **UNVERIFIED · 7.6 Receipt.** Implemented at `2b319b12`, verified locally, deployed as `bdf17fe` (Worker Version `dd0b4365-fcaa-4cba-b821-890fe29e7fc7`) from 18:22 UTC, and live checks 1 to 3 passed at 18:23 UTC; monitoring (6.6) and the remote `owner:health` run (8.15) are open.

## 8. Private owner center

- **N/A · 8.1 to 8.14.** No owner code change.
- **UNVERIFIED · 8.15 `owner:health`.** No remote run; the #203 record's open run applies to the serving Worker. It stays a launch-blocking UNVERIFIED item until the owner runs `npm run owner:health -- --remote --post-deploy` or accepts it as an exception with its impact and follow-up.

## Software agreement signing

- **N/A · S.1 to S.12.** No signing change.

## Live checks after deploy

1. Workers Builds on the merge commit succeeds, and `wrangler deployments status` shows its version serving.
   - **PASS.** See Merged revision.
2. On `/`, `/services`, `/building` and `/building/kaillera-next`, `og:image` and `og:video` name the files in `src/data/og-media.json`; each poster answers 200 and each video answers HEAD 200 and `Range: bytes=0-1` 206.
   - **PASS** at 18:22:58 to 18:23:08 UTC, plain `curl` over HTTPS by the coordinating Claude Code session, matched against `src/data/og-media.json` at `bdf17fe`.
3. On `https://audio.thesuperhuman.us/`, the same holds for the audio scene's tags.
   - **PASS**, in the same run.
4. Owner, when convenient: share one link in Messages and check the new labels read clearly.
