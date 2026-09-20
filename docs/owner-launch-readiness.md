# Owner center launch readiness

**Review date:** September 20, 2026
**Target:** thesuperhuman.us production  
**Scope:** stacked owner data, interface, retention, health, and Old News measurement changes  
**Deployment decision:** awaiting explicit approval. Nothing in this review authorizes a production migration, merge, or deployment.

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
| Old News preview routes | PASS in protected preview | The master and hosted lyric video each loaded as a 160-second seekable stream. The A/B player decoded and played both mix and master while preserving its playhead across the switch. Controlled playback wrote ordered rows to the isolated preview database. |
| Event-disable control | PASS in protected preview | With `MUSIC_EVENTS_ENABLED=false`, the song continued playing while a clean session left the isolated database unchanged at 19 rows. Restoring the reviewed candidate re-enabled collection and the next controlled play produced row 20. |
| Rollback and recovery | PASS in protected preview | Returning all three Old News records to draft removed the release route, then restoring the reviewed candidate returned the page and stream. A disposable D1 table was created after a preview bookmark; Time Travel removed it while preserving all 20 pre-bookmark playback rows. Earlier Worker versions remain available. Production rollback remains approval-gated. |
| Owner interface | PASS locally | The stacked UI was previously checked across six owner routes at desktop and mobile widths, including unsigned rejection. Production access remains unverified. |

## Production change set requiring approval

1. Re-read the production schema, pending migration list, and Time Travel bookmark immediately before the change.
2. Apply `0001_music_schema.sql`, then `0002_owner_retention.sql`, to `thesuperhuman-music`; read back the migration ledger and new objects.
3. Configure `OWNER_ACCESS_TEAM_DOMAIN`, `OWNER_ACCESS_AUD`, and `OWNER_EMAIL` on the production Worker without publishing their values.
4. Merge PR #44 and allow its connected Cloudflare build to deploy the reviewed infrastructure while Old News remains draft.
5. Verify production owner authentication, private response headers, health reporting, request failure behavior, public navigation, and hidden Old News routes.
6. Merge the separately reviewed Old News publication PR, then verify the release page, mix/master/video streams, event recording, interest submission, sitemap, and owner reporting on the production hostname.

If any verification fails, hide Old News if necessary and deploy the recorded last-known-good Worker version. D1 recovery uses the pre-change bookmark only after schema and ledger readback identify a database rollback as necessary.

## Exact pending database change

When the remaining preview gates pass and deployment is approved, apply the two migrations in order:

1. `0001_music_schema.sql` records the already-present baseline and adds the owner campaigns, campaign tags, request inbox and audit, detailed playback, daily reporting, and supporting indexes through idempotent `CREATE ... IF NOT EXISTS` statements.
2. `0002_owner_retention.sql` adds the retention-run record, privacy-thresholded geography rollups, and personal-data deletion audit trigger.

The pre-migration recovery point is the private Time Travel bookmark captured during the September 20 reconciliation. Re-read it immediately before applying migrations because later production writes advance the bookmark.
