# Dependabot Wrangler release gate

Date: October 10, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#164](https://github.com/kwilson21/thesuperhuman.us/pull/164)
Branch: `codex/deps-164-wrangler`
Starting head: `8a5d42b6c26867cb155ef4fa0cc18471a73649f5`
Merged-main revision: `8b2252c4e59b904ba8cf07f4492dda0d51189235` (caller-supplied origin/main snapshot). No merge or rebase performed in this task.
Current branch verification: the rebased stack base is `e9341580c9f57b86387b738bb3b284547b8e9d5f`, the dependency commit is `0527d43916bcb68532dd64c7335fb07c405fc914`, and the original record commit is `c18c3122`. The starting head and dependency hash in the earlier run evidence below describe the pre-rebase history, not the current two-commit chain.
This record's commit: the record-only commit following the dependency commit, identifiable with `git log -1 -- docs/prelaunch-qa-2026-10-10-dependabot-wrangler.md`. The final handoff supplies its hash.
Target: production `https://thesuperhuman.us`
Reviewer: Codex (gpt-6.1-sol), local evidence collection for owner Kazon Wilson. This record does not certify independent current-head review.
Rollback revision: `8b2252c4e59b904ba8cf07f4492dda0d51189235`

Scope: dependency and lockfile change only, plus the v5 runtime type declaration and the existing Wrangler pin test expectation. No migration, public copy, page, asset or route change. No runtime behavior was changed.

## Owner decisions and authorization

This branch is stacked on PR #165 at starting head 8a5d42b6. PR #165 is waiting for review and is not yet merged. The diff against main shrinks once #165 merges. The owner authorized offline implementation, evidence collection and two local commits only. No network, fetch, push, PR creation, rebase, merge or deployment is authorized. Current-head CI, independent engineering/security review, Greptile review and answered review threads remain UNVERIFIED. No release exception is accepted here.

## Evidence and limits

Read AGENTS.md, CLAUDE.md, coding approach, project journal, publication protocol, prelaunch checklist and the minor/patch record. Journal status succeeded. Two checkpoint input attempts failed schema validation; the corrected attempt failed with `Operation not permitted` on the private journal `.lock`. No checkpoint was saved. Untracked .jolli/ is excluded. Git commit hooks are disabled for these two commits to preserve the offline boundary. No cloud backup is claimed. The dependency commit returned success and verified HEAD 8403fbc95d32c0b6713dbb7e9c5a50bbe1a1b60d despite `error: Unable to create` the shared Git `packed-refs.lock` with `Operation not permitted`.

The caller prepared package.json, package-lock.json and node_modules with a successful npm install. This run did not install, run npm ci or query the registry. Manifest and lockfile were not changed further. Installed tree inspection confirms root wrangler 4.146.0 and workers-types 5.20261010.1; Astro Cloudflare 12.6.13 retains nested wrangler 4.59.2 and workers-types 4.20260702.1. Wrangler's optional workers-types peer accepts the root v5 dependency. Caller-reported npm audit totals are identical before and after: 33 vulnerabilities, comprising 2 low, 7 moderate, 22 high and 2 critical. That audit was a registry query made by the caller, not by this run. Existing vulnerabilities are not fixed by this update.

### Types v5 compatibility

Tests first: npm run check initially failed at src/lib/publication/oauth.ts:63 with ts(2345). Astro's nested v4 ExecutionContext was missing v5 exports and abort. App.Locals now refines the existing Runtime runtime.ctx to ExecutionContext with an intersection in src/env.d.ts. The real Worker context is passed through unchanged; no any, fabricated methods or runtime wrapper was added. Fetcher, Ai, RateLimit, D1Database, KVNamespace and R2Bucket needed no changes. Final check: 441 files, 0 errors, 0 warnings, 17 hints.

The first npm test also found the existing exact-pin test expecting 4.90.0. Its expectation now matches 4.146.0. Round 2 renamed it to "pins the reviewed Wrangler release" because the assertion checks only the package version, not migration ordering.

### Offline migration-order comparison (round 2)

Confirmed both installed package.json versions: 4.90.0 in the prior minor/patch worktree and 4.146.0 in this worktree. Extracted migration discovery, unapplied filtering, ledger reads and application code from both wrangler-dist/cli.js files and diffed after normalizing whitespace and esbuild numeric identifier suffixes. The bodies are not byte-identical, including after normalization.

- **FAIL: ordering code unchanged between 4.90.0 and 4.146.0.** In 4.90.0, getMigrationNames (lines 186460-186471) opens migrationsPath with opendirSync, retains names ending in .sql and returns default lexical toSorted(). getUnappliedMigrations (186430-186459) removes names already in the ledger without reordering. The apply handler (186646-186684) then sorts by parseInt(name.split("_")[0]) before sequential application with awaited executeSql.
- In 4.146.0, getMigrationNames (233488-233500) delegates to getD1MigrationFiles (61103-61121). listFilesRelative (61140-61168) uses readdirSync with file types, retains matching files and returns out.sort(compareMigrationPaths). The default pattern is migrations_dir/*.sql; this repository has no migrations_pattern override. compareMigrationPaths/compareSegments (61169-61207) compare path segments by finite numeric prefix first, put numbered segments before unnumbered segments, then break ties lexically and finally by path depth. getUnappliedMigrationNames (233475-233483) preserves that order. The apply handler (233712-233756) no longer re-sorts and awaits each executeSql in its for-of loop. This makes lexical tie-breaking explicit, changes unnumbered-name behavior, and adds nested-pattern discovery, even though the repository's flat numbered files retain their expected order.
- Both versions read the default d1_migrations table with SELECT * ORDER BY id and exclude applied names by exact membership. The newer version escapes the table identifier and filename string in ledger SQL and extracts query construction into helpers; these bodies also differ.
- **PASS (static reasoning only): expected 0009 before 0010 for the repository's flat numbered filenames in both versions.** Numeric prefixes parse as 9 and 10. This is reasoning from the extracted code, not execution of migrations or a claim that the ordering code is unchanged.
- The caller-saved changelog includes D1 migration entries for migrations_pattern (#14089), SQL identifier/filename escaping (#14394), cancellation errors (#13882), test-harness migration setup (#14490), temporary remote authentication, CRLF normalization and lowercase END parsing. The migrations_pattern entry affects discovery and mentions the default *.sql pattern preserving prior discovery behavior; it does not document the changed comparator or assert ordering compatibility. The other entries do not change file ordering.
- **UNVERIFIED: executed ordering on 4.146.0.** Fresh independent verification failed before application with Error: listen EPERM: operation not permitted 127.0.0.1. Before the next production migration, run the following exact command from this worktree in a permitted local environment, and observe 0009 before 0010. It uses only local D1 and a fresh throwaway state directory: `WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler d1 migrations apply MUSIC_DB --local --persist-to "$(mktemp -d /private/tmp/wrangler-order-XXXXXX)"`. Production ledger reconciliation and backups remain separate requirements.

### Dependency tree integrity (caller measurement, round 2)

The caller reports that removing node_modules and running npm ci outside the sandbox succeeded locally. The caller's subsequent npm ls --all still reports optional WebAssembly fallback packages: root @img/sharp-wasm32@0.35.5 is invalid for nested sharp@0.34.5 under Astro and @astrojs/cloudflare, which declare 0.34.5, and @img/sharp-wasm32@0.35.4 is extraneous under miniflare. These optional fallback entries are not a resolution failure. The caller reports the same quirk on PR #165's head, where CI npm ci and validate passed. These are the caller's measurements, not checks performed in this round.

The earlier verifier's npm ci --dry-run crashed with macOS SecItemCopyMatching exit 139, a sandbox keychain issue; it is not clean-install evidence. **UNVERIFIED: CI npm ci on the pushed head**, which is the authoritative clean-install check until it runs. No install, dependency-tree command, network operation or push was performed in this round.

### Wrangler compatibility findings

Searched wrangler.jsonc, package.json, scripts, .github/workflows, README.md, docs and tests. Read the caller-saved upstream changelog locally and inspected installed CLI help, config schema and relevant implementation.

| Search item | Finding |
| --- | --- |
| legacy_env / --legacy-env | No repo usage. Upstream removed service environments and these settings; each environment is now a separately named Worker. No environment config change needed. |
| /cdn-cgi/mf/ | No repo usage, including /cdn-cgi/local/. Upstream scheduled endpoint moves to /cdn-cgi/local/scheduled; streaming and image endpoints move to /__cf_local/. No endpoint replacement needed. |
| wrangler types | No invocation or generated Wrangler types in the searched repo. Manual Env and tsconfig types remain in use. Upstream runtime type generation and Node-global changes therefore do not require a regeneration. |
| unstable_ imports | None in the searched repo. Removed unstable_dev testMode and changed unstable_printBindings signature do not affect direct callers. |
| getPlatformProxy | Used by music-preview, music-analytics, studio-retention and the local R2 integration test, with a mocked music-preview test. configPath, persist.path, envFiles and remoteBindings remain supported by installed declarations. No Workflow bindings or route-zone reliance found. Runtime R2 startup remains blocked by sandbox EPERM; this is not a successful real proxy exercise. Astro also uses its own nested Wrangler. |
| no_bundle | No repo usage. Upstream no-bundle module scanning and dev fixes do not require a change. Dry-run uses normal bundling. |
| nodejs_compat | Explicit in production config and music preview; screenshot config mirrors production. Unchanged compatibility_date 2026-05-14 precedes the new 2026-08-04 default-enablement threshold. Explicit flag remains supported. |
| compatibility_date | Production and music preview pin 2026-05-14; R2 fixture pins 2026-09-22; screenshots mirror production; retention propagates selected date. No --latest or missing-date reliance in these configs. Upstream fixed defaults and --latest resolution do not change these pinned values. |

### CLI inventory and offline help checks

Each row ran `npx --offline wrangler <command> --help` with WRANGLER_SEND_METRICS=false and a temporary log path. All exit codes were 0. An assert-based inspection confirmed every listed flag is present. These are help checks, not remote operations.

| Command | Call sites | Flags checked | Result |
| --- | --- | --- | --- |
| dev | package preview; publicist documentation | --local; bare dev | PASS |
| d1 execute | music-analytics; screenshot capture; owner-insights plan | --remote, --local, --config, --persist-to, --json, --command, --yes, --file | PASS |
| d1 migrations apply | music-preview; screenshot preview; publication/retention docs | --local, --remote, --config, --persist-to | PASS |
| d1 migrations list | publication-deployment; owner-insights plan | --remote | PASS |
| r2 object put | upload-music, upload-audio; audio plan | --file, --content-type, --remote | PASS |
| r2 object delete | studio-retention | --remote | PASS |
| r2 bucket create | README; audio plan | bucket positional argument | PASS |
| kv key get | README resume backup/readback | --binding, --remote | PASS |
| kv key put | README; build-services-pdf | --binding, --remote, --path | PASS |
| deploy | README git deployment; audio plan; this dry-run | bare deploy; --dry-run, --outdir | PASS |
| versions list | owner rollback docs | bare list | PASS |
| versions deploy | owner rollback docs | version-id@100% positional argument | PASS |
| versions upload | no literal invocation in searched files; checked as requested | bare upload | PASS |
| secret list | owner-health; owner-health test | --format json | PASS |

GitHub screenshot workflow invokes Astro, which resolves its adapter's nested Wrangler; it does not invoke root Wrangler directly. Remote commands above were never executed.

### Configuration and bundle validation

PASS: parsed wrangler.jsonc using installed jsonc-parser, validated against node_modules/wrangler/config-schema.json using installed Ajv (strict:false, allErrors:true), with no validation errors or warnings. Dry-run also accepted the config with no configuration warning or error.

- ai: binding AI accepted; no model invocation performed.
- ratelimits: simple limits 30/60 and 120/60 accepted with their existing namespace IDs; dry-run prints 30 requests/60s and 120 requests/60s.
- observability: enabled:true accepted; real monitoring and delivery remain UNVERIFIED.
- assets: binding ASSETS and directory ./dist accepted; dry-run read 460 assets.

Wrangler 4.146.0 dry-run emitted the Worker bundle: Total Upload: 7304.47 KiB / gzip: 1730.92 KiB. It ended with `--dry-run: exiting now.` No upload or deployment occurred. The cached CLI banner advertises 4.149.0; this task retains the requested 4.146.0 pin.

### Local checks

| Command/check | Result | Evidence |
| --- | --- | --- |
| python3 scripts/development_journal.py status | PASS | Actual America/New_York clock and existing private index returned. |
| git status, rev-parse, diff and repository/changelog searches | PASS | Starting head and bounded diff verified; no fetch. |
| npm run check, initial | FAIL | ts(2345), nested v4 ExecutionContext lacks exports and abort at oauth.ts:63. |
| npm run check, final | PASS | 441 files, 0 errors, 0 warnings, 17 hints. |
| npm test, initial | FAIL | 124 files passed, 2 failed; 1389 passed, 2 failed, 1 skipped. Pin test and expected R2 EPERM below. |
| npm test, final | FAIL | 125 files passed, 1 failed; 1390 passed, 1 failed, 1 skipped. Only expected R2 EPERM below. |
| env -u PUBLICIST_PRIVATE_TOKEN ASTRO_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false npm run build | PASS | Prebuild assets, copy and mechanical publicist gate passed; full Astro build completed. Direct Astro fallback not needed. |
| npm exec --offline -- wrangler --version | PASS | 4.146.0. |
| All 14 npx --offline wrangler command --help calls and flag assertions | PASS | Inventory above. |
| npm ls wrangler @cloudflare/workers-types --all | PASS | Root v5 and nested adapter v4 tree confirmed. |
| Installed JSON Schema validation with Node/Ajv/jsonc-parser | PASS | No validation error or warning. |
| npx --offline wrangler deploy --dry-run --outdir (temporary output) | PASS | Worker bundled with root Wrangler 4.146.0; no deploy. |
| git diff --check | PASS | No whitespace errors. |
| Local dependency commit | PASS | HEAD verified despite packed-refs.lock sandbox diagnostic. |
| python3 scripts/development_journal.py checkpoint | FAIL | Corrected input reached private journal .lock and was denied by sandbox. No write claimed. |

Initial additional failure verbatim:

```text
FAIL  tests/lib/owner-schema.test.ts > owner insights schema > pins the Wrangler release that preserves numbered D1 migration order
AssertionError: expected '4.146.0' to be '4.90.0' // Object.is equality
Expected: "4.90.0"
Received: "4.146.0"
```

Final remaining failure verbatim:

```text
FAIL  tests/lib/audio-project-uploads.test.ts > finishes an upload using the opaque part tag returned by local R2
Error: listen EPERM: operation not permitted 127.0.0.1
```

Build gate output verbatim:

```text
publicist-gate: skipped private note lookup for 49 entries (no token; local build).
publicist-gate passed: 49 entries checked.
```

Private approval lookup remains UNVERIFIED. Asset QA verifies 36 existing file hashes. Copy checks pass. Build warnings are the existing absent notes/audio-tracks collections and Zod PURE annotation placement; Rollup removes those comments and completes. Checker retains 17 hints (unused declarations, retention properties, inline JSON-LD and deprecated keyCode). No warning caused a source patch. Configuration validation and dry-run report no warnings or errors.

PASS below covers only observed evidence. Unknown is UNVERIFIED. This record does not claim launch readiness. Deployment, Workers Builds, live verification and monitoring remain UNVERIFIED until after merge. Post-deploy follow-up includes production merge-commit check-runs, `npm run owner:health -- --remote --post-deploy`, live journeys and operator response to attention results.


## 1. Purpose and content

- **PASS · 1.1. Confirm the correct project, branch, local changes, site instructions, audience and deployment authorization.** Branch, scope and offline-only authorization verified.

- **PASS · 1.2. Preserve approved design and truthful claims; remove placeholders and verify ownership/rights for media.** No copy or media changes; existing asset hashes and copy checks pass. Rights are not recertified.

- **N/A · 1.3. For explanatory copy, explain who does what, what action they take, and the supported result or reason when visitors need that context; keep useful labels and personal or creative writing in their intended roles. For professional-claim or resume changes, record a private website/resume comparison of facts, metric scope, attribution and status, including intentional differences and the actual stored PDF version. N/A is appropriate when neither changes.** No explanatory copy, professional claims or resume changes.

- **UNVERIFIED · 1.4. The first screen explains who/what the site is for and offers a useful next step. Verify the CTA works at narrow and desktop sizes. A sticky CTA is optional, justified by the actual journey.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 1.5. Navigation, footer, contact route and important external links work. Never invent an address or expose a home address.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 2. Search and sharing

- **UNVERIFIED · 2.1. Each indexable page has a descriptive, distinct title and meta description.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.2. Absolute canonical URLs use the production HTTPS domain, match the sitemap and normalize duplicate host/path/query variants. Preserve query parameters only when they identify distinct indexable content.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.3. Open Graph title, description, URL and reachable image are correct; inspect the image at sharing size. Include a social card type and suitable image description when applicable.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.4. Branded SVG/raster favicon and Apple touch icon return the correct formats and remain legible at small sizes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.5. robots.txt reflects intended indexing and links to the real sitemap. Sitemap includes public canonical routes, including server-rendered pages, and excludes redirects/errors/private routes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.6. Preview environments cannot be accidentally indexed. Secrets and private data require access control, never robots.txt alone.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 2.7. Verify structured data when present. Do not invent ratings, credentials or organization details.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 3. Accessibility and responsive behavior

- **UNVERIFIED · 3.1. Semantic landmarks, page language, sensible heading order and one primary heading.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.2. Meaningful image alternatives; decorative images use empty alt text. Icon-only controls have names.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.3. Keyboard access, visible focus, skip link, menus, dialogs and focus restoration work. No keyboard traps.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.4. Inputs have labels, required/optional guidance, useful error associations and status announcements. Success and failure do not depend on color alone.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.5. Text/UI contrast, touch targets, 200% text zoom and reduced-motion behavior are checked. Use automated accessibility checks plus manual review.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.6. Check at least 320px, typical phone, tablet and desktop widths, including long content and expanded menus/forms. No horizontal overflow or concealed controls.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 3.7. Check Chromium and another supported browser, plus a real mobile device for critical interactions where available. Record limits.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 4. Performance and resilience

- **UNVERIFIED · 4.1. Images are appropriately sized/compressed, have intrinsic dimensions, and use responsive sources where beneficial. Prioritize the hero; lazy-load below-fold images.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.2. Avoid unnecessary client code, dependencies, embeds and font weights. Verify compression, caching and asset loading against the built site.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.3. Measure representative pages with a repeatable mobile profile. Record LCP, CLS and INP when field data exists; lab results are not field evidence. Investigate LCP over 2.5s, CLS over 0.1 or INP over 200ms.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.4. Async UI visibly loads and recovers from timeout, offline, malformed response and server error. Preserve user input and allow retry without duplicate submissions.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.5. Test missing/unavailable audio, video and external resources where used; avoid autoplay surprises.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 4.6. Useful branded 404 returns actual HTTP 404 on arbitrary missing paths. Verify redirects and their status codes. Server errors expose no secrets and leave a usable recovery path.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 5. Forms and sensitive flows (N/A if absent)

- **UNVERIFIED · 5.1. Validate and bound input on the server. Verify origin/auth checks, abuse protection and rate limits.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.2. Test empty/invalid input, invalid verification token, 429, 500, network failure, timeout, retry, pending button, success and duplicate-submit prevention.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.3. Provide an alternative when JavaScript or verification cannot load. Verify disabled/unavailable states.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.4. Confirm delivery/receipt in the intended environment using authorized test recipients. Mocked UI success is not proof of email delivery.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.5. Keep approval-gated flows intact. Check expired/reused links, permissions and sensitive file access.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 5.6. Use an inline confirmation unless a separate thank-you page serves a real need. Protect its indexing if appropriate.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 6. Privacy, legal and measurement

- **UNVERIFIED · 6.1. Inventory actual form data, storage, logs, external fonts/embeds, cookies, analytics and processors, including host-injected scripts.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.2. Where personal data is processed, publish an accessible, accurate privacy notice linked near collection and in the footer. Confirm purposes, recipients, retention, contact and applicable rights with the operator; do not invent retention periods or compliance claims.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.3. Determine consent needs from actual technology, audience and jurisdiction. Add a cookie banner only when required, and verify reject/withdraw actually controls nonessential processing.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.4. Terms, physical business address and additional legal disclosures depend on commerce, accounts, contributions, licensing and applicable rules. Do not add boilerplate just to tick a box.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.5. Analytics needs a concrete question and a privacy decision. N/A is valid. If enabled, verify events without collecting sensitive input or duplicating counts.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 6.6. Confirm existing error logs/monitoring work, who receives actionable failures and how they respond. Configuration alone is not verified monitoring. Do not create new paid accounts or services by assumption.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## 7. Release and final QA

- **FAIL · 7.1. Run the project's required type, test, asset and build checks. Inspect warnings; record pre-existing exceptions.** Type, asset, copy and build checks pass; local R2 integration is blocked by sandbox EPERM. Green CI remains required.

- **UNVERIFIED · 7.2. Review the exact diff, dependencies, generated files and public artifacts. No secrets, private logs, unapproved claims or accidental unrelated changes.** Local dependency/type/test diff inspected; independent current-head review and CI remain pending.

- **UNVERIFIED · 7.3. Verify production bindings/secrets, migrations/backups where applicable, HTTPS, host routing, cache behavior and response headers on dynamic as well as static responses.** Local schema validation and bundling pass; no migration or binding change. Production bindings, secrets, ledger, headers and routing not queried. Offline ordering comparison is recorded above; executed ordering remains UNVERIFIED.

- **UNVERIFIED · 7.4. Preserve a rollback version and any required backup before deployment. Follow existing review and authorization rules.** Rollback revision recorded; production recovery and authorization/review gates pending.

- **UNVERIFIED · 7.5. After authorized deployment, verify the actual production revision, main journeys, sitemap/robots, metadata/OG/icons, missing page, forms and monitoring on every supported host.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **PASS · 7.6. Save a receipt and QA evidence. Report **implemented**, **verified locally**, **deployed**, and **verified live** separately. Reopen the checklist after material changes.** This receipt separates implementation, local evidence, deployment and live verification.


## 8. Private owner center (N/A if absent)

- **UNVERIFIED · 8.1. Cloudflare Access has one approved owner identity for both `/owner*` and `/api/owner*` (the owner pages post their actions to `/api/owner`, and without Access there every action returns 403); the Worker independently verifies the signed JWT issuer, audience, signature, and email. Unsigned and wrong-owner requests fail closed.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.2. Every owner response uses `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Private routes stay out of the sitemap.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.3. Reconcile the production MUSIC_DB schema and migration ledger before applying any migration. Record backup and recovery evidence separately from local schema tests.** Static comparison found changed discovery and ordering code, with expected 0009 before 0010 reasoned from both versions. Executed ordering is UNVERIFIED due to sandbox listen EPERM. Run the local throwaway-state command above before the next production migration; production ledger and backup evidence remain UNVERIFIED.

- **UNVERIFIED · 8.4. Verify a valid request persists before success. Force storage failure and confirm the visitor receives an honest retry while the urgent email contains no request content or raw database error.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.5. Verify the Cloudflare traffic summary and its safe unavailable fallback. Confirm owner pages remain usable without the optional analytics token.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.6. Confirm automated playback is excluded, campaign tags are controlled, and city rows below five qualifying human listens are combined under **Other locations**.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.7. Preview retention and inspect the private manifest for contact data or secrets. Apply only an exact reviewed manifest in a non-production environment before production use.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.8. Before enabling the private studio, reconcile portal migrations `0005` through `0017`, then exercise email-code access, mobile and keyboard use, private audio playback, upload interruption, failed notice delivery, and project revocation in the target environment.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.9. Confirm the launch scope with payments off. While `STRIPE_PAYMENTS_ENABLED=false`, no invoices are created. The owner collects each installment another way (Zelle, cash, and so on) and records it with **Record booking received** or **Record balance received** in Book the work. That marks the installment paid with no Stripe invoice, shows it as "Paid outside Stripe", and logs the method and reference in Activity. It is allowed only for an installment with no invoice and no pending invoice creation, and the balance only after the booking. A recorded installment can never be invoiced, and a Stripe invoice for it is held as unmatched rather than adopted.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.10. Run the studio-retention preview and exact-manifest apply against a non-production project with a real private R2 object; verify access closes before deletion, a storage failure is retryable, and owner-request retention waits for studio cleanup.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.11. Keep `STRIPE_PAYMENTS_ENABLED=false` until Stripe payments and payouts are active, migration `0003_audio_payments.sql` is reconciled, secrets are configured, and the test-mode booking and balance lifecycle passes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.12. Verify invalid Stripe signatures change no data, repeated webhook events apply once, repeated invoice actions create no duplicate invoice, and the balance action stays locked until the booking invoice is paid.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.13. Confirm the owner Payment section exposes no Stripe secret, webhook secret, payment credential, or customer identifier in HTML or API responses.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.14. Exercise the documented previous-version rollback, Old News visibility, event-disable, retention-pause, D1 recovery, and visitor-recovery procedures without changing production.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · 8.15. Run `owner:health` against the target environment. Resolve every attention result or record it as a launch-blocking UNVERIFIED item.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.


## Software agreement signing

- **UNVERIFIED · Agreement.1. Record counsel review status for the templates and electronic consent.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.2. Owner verifies the registered-agent business address and contractor config.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.3. Preview seeded templates for one, two and three milestones in both payment modes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.4. Verify the signing setting defaults off and the outside-site path still works.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.5. Verify scoped email authentication, revocation, stale hashes and MSA reuse confirmation.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.6. Exercise PDF rendering in the actual Workers runtime, including Unicode and attachments.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.7. Verify full text extraction, every document certificate, packet hashes and two retained copies.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.8. Test artifact failure and each recipient's uncertain email/retry separately.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.9. Verify project-page and archive downloads, including closed project and redacted request.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.10. Rehearse restoring agreement database records, templates, fonts and private storage, with hashes.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.11. Verify custom project retention and exclusion of open, held and actively reused agreements.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

- **UNVERIFIED · Agreement.12. Review real CI screenshots, keyboard/no-JS behavior and overflow from 320 to 1280 pixels.** No target-environment or manual verification in this offline task. Unchanged source and local regressions do not certify the full checklist item.

## Delivery status and remaining gates

- **Implemented:** Wrangler 4.146.0 and workers-types v5, lockfile resolutions, v5 context declaration and exact-pin test update. No migration or runtime behavior change.
- **Verified locally:** Type check, 1390 passing tests, full build, asset/copy checks, CLI help/flags, installed schema validation and Wrangler dry-run bundle. Full test suite remains FAIL under the expected sandbox constraint.
- **Deployed:** UNVERIFIED. No push or merge performed.
- **Verified live:** UNVERIFIED. No network access performed.

Owner follow-up: allow PR #165 to complete its own review and merge; require green current-head CI and real local R2 integration evidence, independent engineering/security review, Greptile current-head review and answered threads before authorizing a production merge. Resolve checklist unknowns or explicitly accept bounded exceptions. Confirm Workers Builds and live journeys after merge. Existing audit findings need separate owner triage; no new security approval is implied.
