# Home preview and release-order verification

Date: 2026-11-16 (America/New_York)
Repository: kwilson21/thesuperhuman.us, PR #336
Scope: the eleven-file PR diff at `572d1204`, refreshed onto main `2e5e9168`, plus this record. The public change is Home's preview-video waveform. The shared newest-release ordering preserves existing behavior.
Target: https://thesuperhuman.us. Owner authorized fixing and merging remaining project PRs on 2026-11-16.
Reviewer: OpenAI assistant; independent exact-head review required before merge.
Rollback: revert this PR's eventual squash commit. Its first parent is the precise pre-merge revision; record that from GitHub rather than reverting a whole historical main snapshot.

## Evidence

- Local targeted Vitest run: 5 files, 105 tests passed (`latest-release`, `latest-song`, `og-video-home-edge`, `og-media`, `og-video-copy`).
- `node scripts/check-asset-qa.mjs`: 79 production assets match review records.
- `oxlint --deny-warnings`: exit 0.
- Inspected a twelve-frame contact sheet sampled at 2 fps and a full-size frame at 4.3 seconds from the committed `home-e4fba17fa8.mp4`. The waveform crosses the frame during the existing transition; resting scenes remain legible. Poster and page layout are unchanged.
- Original head `572d1204` passed Validate, Screenshots and Workers Builds. Refreshed-head CI and independent review remain required before merge; earlier results are not a claim that the refreshed revision passed.

## Checklist

- PASS 1.1: repository, scope and merge authorization identified above.
- PASS 1.2: existing media and approved visual design preserved; waveform data matches the public music catalog through the drift test. N/A 1.3: no explanatory claims or resume change. N/A 1.4-1.5: CTA, navigation and links unchanged.
- N/A 2.1-2.2: titles, descriptions and canonicals unchanged. PASS 2.3 local: preview assets and manifest pass validation, image unchanged and video inspected at sharing size. Live delivery remains UNVERIFIED until deployment. N/A 2.4-2.7: icons, robots, sitemap, indexing and structured data unchanged.
- N/A 3.1-3.7: page semantics, controls, responsive layout and accessibility unchanged; existing preview alt text and poster remain unchanged. Real iMessage playback is UNVERIFIED and is not asserted by local frame inspection.
- PASS 4.1: video is 652,405 bytes at 1200x630; asset limits pass. PASS 4.2 for scope: no dependency or client-runtime addition. N/A 4.3-4.4: page performance and async interfaces unchanged. PASS 4.5 local: manifest/render validation passes; playback-route fallback unchanged. N/A 4.6: errors and redirects unchanged.
- N/A 5.1-5.6, 6.1-6.6, 8.1-8.15 and software-agreement checklist: no forms, personal-data processing, payments, owner flows or agreement changes.
- UNVERIFIED 7.1 until refreshed CI: targeted local checks above passed; full CI is the merge gate.
- UNVERIFIED 7.2 until independent exact-head review; inspected source and generated-video diff locally.
- N/A 7.3 for bindings, migrations and routing: none changed. Live media status/type/range verification is due after deployment.
- PASS 7.4: revert procedure above, no persistent data change.
- UNVERIFIED 7.5: not yet merged or deployed in this task. Verify the merge revision's deployment and the new media URL afterward; unrelated journeys are not recertified by this change.
- PASS 7.6: implemented yes; locally verified for the listed checks only; deployed no; verified live no. CI, review, merge and deployment receipts will be reported separately with their actual results.
