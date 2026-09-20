# Owner center launch readiness

**Review date:** September 19, 2026  
**Target:** thesuperhuman.us production  
**Scope:** stacked owner data, interface, retention, health, and Old News measurement changes  
**Deployment decision:** blocked. Nothing in this review authorizes a migration or deployment.

| Gate | Result | Evidence or next action |
| --- | --- | --- |
| Repository tests | FAIL | 287 tests pass on Node 22.19. The nine publication-journal tests also fail on the unchanged PR 2 head with Node SQLite `column index out of range`; fix or rerun with the CI runtime before merge. Owner-focused tests pass. |
| Astro check and build | PASS | `astro check` reports zero errors; the Cloudflare build completes. Existing content-loader and inline-script hints remain. |
| Owner access policy | UNVERIFIED | JWT verification and fail-closed middleware pass locally. The production Cloudflare Access application, one-owner allow policy, secrets, and signed live response have not been verified. |
| Private response headers | PASS locally | Middleware tests cover no-store and noindex behavior. Live headers remain part of post-deploy verification. |
| MUSIC_DB schema and ledger | UNVERIFIED | The additive migrations and idempotent combined schema pass locally. Reconcile the production schema, migration ledger, and recovery point before applying either owner migration. |
| Request storage failure | PASS locally | Tests confirm success follows storage and urgent alerts are redacted. Live D1 and authorized email delivery remain unverified. |
| Traffic analytics fallback | PASS locally | Typed query and unavailable-state tests pass. Production token or dashboard fallback remains an operator configuration choice. |
| Playback integrity and sparse geography | PASS locally | Sequence, automated-traffic exclusion, retained totals, and five-listen city suppression tests pass. |
| Retention preview | PASS locally | The empty local preview generated matching private HTML and JSON. A scan found no email, request detail, private note, session ID, playthrough ID, JWT, IP address, or secret. No apply was performed. |
| Retention freshness | UNVERIFIED | Health correctly reports that no successful retention apply is recorded. Apply an exact reviewed manifest only after schema reconciliation. |
| Old News public media | FAIL for current live site | One-byte checks for master, mix, and video all failed. Keep the release hidden until the stacked code, R2 objects, routes, and permissions are verified together. |
| Event-disable control | PASS locally | The API returns `204` and stores nothing when `MUSIC_EVENTS_ENABLED=false`; playback remains independent. Non-production deployment exercise remains unverified. |
| Rollback and recovery | UNVERIFIED | Wrangler confirms the previous-version deployment command exists. No non-production Worker target was available to exercise rollback, release hiding, or D1 recovery. |
| Owner interface | PASS locally | The stacked UI was previously checked across six owner routes at desktop and mobile widths, including unsigned rejection. Production access remains unverified. |

## Required before a deployment decision

1. Resolve the publication-journal runtime failure or verify the exact supported CI Node runtime passes the complete suite.
2. Reconcile production D1 schema, migration ledger, and recovery point without applying changes.
3. Configure and verify the single-owner Cloudflare Access policy and required secrets.
4. Confirm all three Old News objects and streaming routes in a protected preview environment.
5. Exercise event disable, release hiding, previous-version rollback, and visitor recovery in that preview environment.
6. Re-run the complete checklist and present the exact migration and deployment change set for explicit approval.
