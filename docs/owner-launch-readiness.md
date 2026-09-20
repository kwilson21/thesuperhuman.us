# Owner center launch readiness

**Review date:** September 20, 2026
**Target:** thesuperhuman.us production  
**Scope:** stacked owner data, interface, retention, health, and Old News measurement changes  
**Deployment decision:** blocked. Nothing in this review authorizes a migration or deployment.

| Gate | Result | Evidence or next action |
| --- | --- | --- |
| Repository tests | PASS | 304 tests pass across 58 files on Node 22.19 at the consolidated PR #44 stack head. Pull requests run tests, Astro checks, and the production build in GitHub Actions. |
| Astro check and build | PASS | `astro check` reports zero errors; the Cloudflare build completes. Existing content-loader and inline-script hints remain. |
| Owner access policy | PASS for Access boundary; BLOCKED on Worker settings | The production `Owner Center` Access application protects `thesuperhuman.us/owner` with a reusable one-owner email allow policy and a 24-hour application session. No external identity provider is configured, so Cloudflare's default one-time PIN login applies. The application AUD was retrieved. JWT verification, cached JWKS, and fail-closed middleware pass locally. `OWNER_ACCESS_TEAM_DOMAIN`, `OWNER_ACCESS_AUD`, and `OWNER_EMAIL` remain intentionally unconfigured on the deployed Worker until the approved release step; the signed production response remains unverified. |
| Private response headers | PASS locally | Middleware tests cover no-store and noindex behavior. Live headers remain part of post-deploy verification. |
| MUSIC_DB schema and ledger | PASS for read-only reconciliation | Production contains the three baseline music tables, their index and archive trigger. All three tables contain zero rows. The migration ledger is empty, so `0001_music_schema.sql` and `0002_owner_retention.sql` are pending. The current Time Travel bookmark was recorded privately. No migration was applied. |
| Request storage failure | PASS locally | Tests confirm success follows storage and urgent alerts are redacted. Live D1 and authorized email delivery remain unverified. |
| Traffic analytics fallback | PASS locally | Typed query and unavailable-state tests pass. Production token or dashboard fallback remains an operator configuration choice. |
| Playback integrity and sparse geography | PASS locally | Sequence, sparse-timer delivery, automated-traffic exclusion, retained totals, completion-only geography, and storage-level five-listen city coarsening tests pass. |
| Retention preview | PASS locally | The empty local preview generated matching private HTML and JSON. A scan found no email, request detail, private note, session ID, playthrough ID, JWT, IP address, or secret. No apply was performed. |
| Retention freshness | UNVERIFIED | Health correctly reports that no successful retention apply is recorded. Apply an exact reviewed manifest only after schema reconciliation. |
| Old News private media | PASS for stored objects | The master, mix, and lyric video were downloaded from private R2 on September 20. Their complete SHA-256 hashes match the content-addressed object keys, with expected nonzero sizes. |
| Old News preview routes | UNVERIFIED | The current live site does not contain the stacked media routes. Keep the release hidden until protected-preview range responses and permissions are verified with the candidate Worker. |
| Event-disable control | PASS locally | The API returns `204` and stores nothing when `MUSIC_EVENTS_ENABLED=false`; playback remains independent. Non-production deployment exercise remains unverified. |
| Rollback and recovery | UNVERIFIED | Wrangler confirms the previous-version deployment command exists. No non-production Worker target was available to exercise rollback, release hiding, or D1 recovery. |
| Owner interface | PASS locally | The stacked UI was previously checked across six owner routes at desktop and mobile widths, including unsigned rejection. Production access remains unverified. |

## Required before a deployment decision

1. Configure the three missing owner settings during the approved release step, then verify the Access login, signed identity response, and one-owner denial behavior.
2. Confirm all three Old News streaming routes in a protected preview environment; stored R2 objects are already verified.
3. Exercise event disable, release hiding, previous-version rollback, and visitor recovery in that preview environment.
4. Re-run the complete checklist and present the exact migration and deployment change set for explicit approval.

## Exact pending database change

When the remaining preview gates pass and deployment is approved, apply the two migrations in order:

1. `0001_music_schema.sql` records the already-present baseline through idempotent `CREATE ... IF NOT EXISTS` statements.
2. `0002_owner_retention.sql` adds the owner campaigns, request inbox and audit, detailed playback and daily reporting, geography rollups, retention-run record, supporting indexes, and personal-data deletion audit trigger.

The pre-migration recovery point is the private Time Travel bookmark captured during the September 20 reconciliation. Re-read it immediately before applying migrations because later production writes advance the bookmark.
