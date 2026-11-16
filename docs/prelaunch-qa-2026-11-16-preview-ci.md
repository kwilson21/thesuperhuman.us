# Selective link-preview rendering CI refresh

Scope: port PR #213 onto current main, preserve the existing renderer and scenes,
use pnpm, and make render and publish use the same immutable head revision.
The read-only render workflow has no write credentials. The trusted publisher
runs main's scripts, rejects unsafe paths/symlinks, changes outside declared
scenes, deleted in-use media, mismatched tokens, invalid metadata and content hashes.
Review sheets are derived by trusted ffmpeg from the exact accepted poster and
video, not from PR-supplied sheets. Source posters must decode to 1200×630.
The trusted inventory includes bounded regular scene HTML blobs from the exact
candidate Git tree without executing them; every new scene requires full evidence.
The publisher dispatches main's Validate workflow with an immutable revision.
An isolated read-only target job resolves a GitHub merge commit with exact base and
head parents; all code lanes test that merge. The trusted finalizer verifies the
run marker and merged-tree provenance against the still-current base before success.
Dispatched code jobs have read-only tokens and no private build secret.
A publisher rerun deterministically recreates its generated commit and may resume
only when the PR still names the original head or that exact generated child.
Unrelated moved heads are rejected; failed publication never reports success.

State flow: resolve exact head/base → test merged tree → authenticate run and
immutable sheet evidence → private approval gate → recheck authority/head/base →
required status. Publisher recovery: render original head → reproduce generated
child → compare current tip → publish sheets/receipt → dispatch validation.
Bootstrap remains UNVERIFIED: these trusted scripts must exist on main before the
new workflow can run; this change does not authorize bypassing any merge gate.

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


## Round 5 follow-up

Validation resolves the current main ref independently of the PR API's cached
base SHA and waits a bounded interval for the authenticated merge commit. The
trusted finalizer checks that same live ref at resolution and completion.
Publication pins its workflow-run default-branch SHA for deterministic replay;
if main subsequently changes, the old-base receipt is not sufficient for success
and fresh rendering/validation is required. The old publication can still be
replayed to finish its exact generated head without silently adopting new code.

Scene removals are authenticated from the candidate Git inventory. Only absent
scene names supplied by the trusted inventory comparison can be removed from the
manifest, and both old manifest paths and final deletion paths remain restricted
to scene-matching OG media. Routing changes require review as well. Artifact
metadata, individual payloads, file count/depth, and aggregate uncompressed bytes
are bounded before file reads; candidate-provided sheets remain ignored.

**Still blocked:** command-definition maintenance and first trusted-flow bootstrap
must not be solved by relaxing the script equality guard or inventing a passing
status. A future trusted-main harness can run the existing mandatory script map
against the candidate merge in a secretless job, with candidate-defined checks
as additional evidence. That harness has not been implemented or executed here.
The privileged finalizer and private gate remain unverified until a safe staged
bootstrap is established. No deployment or merge is authorized by these local
checks alone.
