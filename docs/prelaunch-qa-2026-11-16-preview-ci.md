# Selective link-preview rendering CI refresh

Scope: port PR #213 onto current main, preserve the existing renderer and scenes,
use pnpm, and make render and publish use the same immutable head revision.
The read-only render workflow has no write credentials. The trusted publisher
runs main's scripts, rejects unsafe paths/symlinks, changes outside declared
scenes, deleted in-use media, mismatched tokens, invalid metadata and content hashes.
Review sheets are derived by trusted ffmpeg from the exact accepted poster and
video, not from PR-supplied sheets. Only the trusted scene inventory is allowed;
new scene names require landing their source before automatic publication.
The publisher dispatches main's Validate workflow with an immutable revision.
Dispatched code jobs have read-only tokens and no private build secret; a separate
no-checkout job reports their aggregate result on that exact revision.

Purpose and content: PASS for CI automation; no intentional visual redesign.
Search/sharing and asset QA: UNVERIFIED until hosted renders are checked.
Accessibility/responsive/no-JS: existing served pages unchanged, N/A for scripts;
preview contact sheets require inspection before merge.
Security: targeted boundary regressions pass locally; independent review pending.
Tests: 21 publisher regressions and 51 model-driver regressions pass; full current-head CI pending. Chromium cannot
open sockets in this execution environment, including the escalated attempt.
CI rendering is required; no output hashes have been invented or re-baselined.
Model: Apalache exhaustive check passes through 8 steps (both invariants).
See verification/link-previews.qnt and docs/verification.md for bounds.
Deployment: UNVERIFIED. No production data or bindings changed. Merge deploys.
Rollback: revert the merge commit, retaining any already-rendered valid media.
Postmerge: run one scene through render/publish on a test branch, verify its
artifact, bot commit, validation and contact sheets.
Implemented: in progress. Verified locally: focused tests. Deployed: no.
