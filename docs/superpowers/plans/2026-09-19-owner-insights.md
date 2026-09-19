# Owner Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, low-maintenance owner center that lets Kazon understand active promotion, review individual requests, preserve campaign lessons, and see urgent failures without operating several technical dashboards.

**Architecture:** Extend the existing Astro Cloudflare Worker and dedicated `MUSIC_DB`. Cloudflare Access protects `/owner`, the Worker validates the signed Access JWT, focused server-side helpers provide request and campaign read models, and the Astro pages render the approved Campaign Desk and Studio Ledger. Existing public music and service endpoints persist validated requests before reporting success. Cloudflare traffic data is queried read-only when configured and otherwise represented by a clear link to Cloudflare, so analytics availability never breaks the owner center.

**Tech Stack:** Astro 5, TypeScript, Cloudflare Workers, Cloudflare Access, D1/SQLite, Cloudflare GraphQL Analytics API, Zod, Vitest, existing CSS design tokens, `jose` for standards-compliant Access JWT verification.

**Spec:** `docs/superpowers/specs/2026-09-16-owner-insights-design.md`

## Global Constraints

- Keep the owner center in the existing Astro and Cloudflare Worker application.
- Reuse existing helpers, bindings, validation, Turnstile and rate limiting before adding code.
- Add no service, queue, CMS, custom password system, registration flow, invitation system or role system.
- Cloudflare Access protects all `/owner` routes for one approved identity; the application also verifies the signed `Cf-Access-Jwt-Assertion` JWT.
- Private responses use `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`.
- Never place request content, email addresses, private notes, JWTs or raw database errors in analytics or logs.
- Routine requests remain in the owner center. Email is reserved for valid requests that cannot be stored and other urgent failures defined in the spec.
- Raw playback events remain for 90 days. City-level listening aggregates require at least five qualifying events. No IP address or postal code is stored.
- Request-specific contact and future-release permission remain separate.
- User-facing owner copy uses “reported listens,” never certified or royalty-equivalent streams.
- Actual analytics values remain black; terracotta `01` and `02` guide attention and include accessible text.
- Preserve the warm editorial site language: ivory paper, black ink, muted gray, restrained terracotta, serif headings, hairline rules, no dashboard-card grid, gradients, shadows, glass panels or monitoring-console styling.
- No production implementation, PR merge or deployment follows automatically from completing these tasks. Deployment requires the repository prelaunch checklist and an explicit deployment decision.
- Before any D1 migration, reconcile the live schema and migration ledger. Never apply a migration based only on the repository snapshot.
- Node remains `>=22.13.0`. Run `npm test` for TypeScript logic and `npm run check` for Astro changes.

## File and PR Structure

### PR 1: Owner data and trust boundary

- `migrations/music/0001_music_schema.sql`: idempotent MUSIC_DB baseline plus campaign, request, consent, playback-sequence and audit schema.
- `migrations/publication/*.sql`: existing publication migrations moved without renaming into their database-specific directory.
- `src/lib/owner-access.ts`: validates Cloudflare Access JWT issuer, audience, signature and owner email.
- `src/lib/owner-model.ts`: shared owner types and database row conversion.
- `src/lib/owner-requests.ts`: request persistence, inbox queries and audited status changes.
- `src/lib/owner-campaigns.ts`: controlled campaign attribution and campaign queries.
- `src/lib/music-demand.ts`: accepts sequenced playback and controlled attribution; preserves existing exports.
- `src/lib/audio-intake.ts`: exposes the stored service-request shape without changing offer definitions.
- `src/pages/api/music-interest.ts`, `src/pages/api/music-event.ts`, `src/pages/api/audio-intake.ts`: store owner-facing records before returning success and alert only on urgent persistence failure.
- `src/middleware.ts`: enforces the authenticated owner trust boundary and private response headers.

### PR 2: Owner interface

- `src/layouts/OwnerLayout.astro`: private shell and persistent Today/Requests/Campaigns/Audience navigation.
- `src/styles/owner.css`: approved editorial owner-center system and responsive recomposition.
- `src/components/owner/AttentionIndex.astro`: accessible `01`/`02` guidance marker.
- `src/components/owner/MetricDefinition.astro`: compact `?` explanation disclosure.
- `src/components/owner/ListeningPath.astro`: listening sequence visualization.
- `src/components/owner/RequestList.astro`: touch-friendly request rows shared by Today, Campaign Desk and inbox.
- `src/pages/owner/*.astro`: Today, request inbox/detail, campaign archive/detail and audience pages.
- `src/pages/api/owner/requests/[id].ts`: same-origin audited request actions.
- `src/lib/owner-reporting.ts`: Studio Ledger and Campaign Desk read models.
- `src/lib/cloudflare-analytics.ts`: bounded, read-only traffic summary with an unavailable state.

### PR 3: Retention, incidents and launch evidence

- `scripts/owner-retention.mjs`: reviewed dry-run and exact-manifest apply for request contact and playback details.
- `scripts/owner-health.mjs`: read-only health report for storage, media, reporting and retention freshness.
- `scripts/music-retention.mjs`: delegates shared retention primitives without changing existing playback preservation guarantees.
- `docs/owner-operations.md`: plain-language access, campaign, request, incident, rollback and recovery runbook.
- `docs/prelaunch-checklist.md`: owner-center-specific checks linked from the reusable checklist.
- `package.json`: explicit preview/apply/health commands.

---

## PR 1: Owner data and trust boundary

### Task 1: Reconcile D1 and add the owner schema

**Files:**
- Create: `migrations/music/0001_music_schema.sql`
- Move: `migrations/0001_publication_journal.sql` to `migrations/publication/0001_publication_journal.sql`
- Move: `migrations/0002_publication_outbox.sql` to `migrations/publication/0002_publication_outbox.sql`
- Modify: `db/music.sql`
- Modify: `wrangler.jsonc`
- Create: `tests/lib/owner-schema.test.ts`
- Modify: `tests/__mocks__/cloudflare-workers.ts`

**Interfaces:**
- Produces tables `owner_campaigns`, `owner_campaign_tags`, `owner_requests`, `owner_request_audit`, `owner_audience_permissions`, `music_playback_events`, and `music_playback_daily`.
- Preserves `music_interest`, `music_events` and `music_event_daily` as legacy-compatible sources until their retained records age out.

- [ ] **Step 1: Record the live schema reconciliation before writing migration SQL**

Run read-only commands against production and save only schema names and migration identifiers, never rows containing personal data:

```bash
npx wrangler d1 migrations list MUSIC_DB --remote
npx wrangler d1 execute MUSIC_DB --remote --command "SELECT name,type FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name"
```

Expected: MUSIC_DB has the manually initialized music tables and an empty migration ledger; PUBLICATION_DB retains its applied publication migration filename. Configure a separate migration directory per binding, preserve publication filenames, and introduce an idempotent MUSIC_DB baseline so the first managed music migration records the existing schema safely.

- [ ] **Step 2: Write the failing schema test**

```ts
test('owner schema keeps consent, requests, audits, campaigns and raw playback separate', () => {
  const db = applyMusicSchema();
  for (const table of ['owner_campaigns','owner_campaign_tags','owner_requests','owner_request_audit','owner_audience_permissions','music_playback_events','music_playback_daily']) {
    expect(hasTable(db, table)).toBe(true);
  }
  expect(() => db.prepare("INSERT INTO owner_requests(id,kind,status,created_at,updated_at) VALUES ('1','unknown','new','now','now')").run()).toThrow();
  expect(() => db.prepare("INSERT INTO owner_audience_permissions(email,status,consent_version,granted_at) VALUES ('fan@example.com','subscribed','release-updates-v1','now')").run()).not.toThrow();
});
```

- [ ] **Step 3: Run the schema test and verify it fails**

Run: `npm test -- tests/lib/owner-schema.test.ts`

Expected: FAIL because the owner tables do not exist.

- [ ] **Step 4: Add the smallest additive schema**

Use explicit checks and indexes. Store bounded JSON only for service direction details and merchandise selections; keep fields used for sorting, filtering, retention and consent as columns.

```sql
CREATE TABLE IF NOT EXISTS owner_campaigns (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('release','service')),
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  secondary_signals TEXT NOT NULL DEFAULT '[]',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  approved_plan TEXT NOT NULL DEFAULT '',
  retrospective TEXT NOT NULL DEFAULT '',
  next_lesson TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','active','complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_campaign_tags (
  campaign_id TEXT NOT NULL REFERENCES owner_campaigns(id),
  channel TEXT NOT NULL,
  creative TEXT NOT NULL,
  PRIMARY KEY(campaign_id,channel,creative)
);
CREATE TABLE IF NOT EXISTS owner_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','merchandise','service','release-update')),
  release_id TEXT,
  service_id TEXT,
  campaign_id TEXT REFERENCES owner_campaigns(id),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  city_region TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK(status IN ('new','reviewed','resolved','withdrawn')),
  private_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  contact_delete_after TEXT
);
CREATE INDEX IF NOT EXISTS owner_requests_status_date ON owner_requests(status,created_at DESC);
CREATE TABLE IF NOT EXISTS owner_request_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES owner_requests(id),
  action TEXT NOT NULL CHECK(action IN ('created','reviewed','resolved','reopened','withdrawn','note-updated','personal-data-deleted')),
  actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_audience_permissions (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('subscribed','unsubscribed')),
  consent_version TEXT NOT NULL,
  source_request_id TEXT REFERENCES owner_requests(id),
  granted_at TEXT NOT NULL,
  withdrawn_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS music_playback_events (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  playthrough_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  medium TEXT NOT NULL CHECK(medium IN ('audio','video')),
  event TEXT NOT NULL CHECK(event IN ('start','progress','listen30','complete','replay')),
  accumulated_seconds INTEGER NOT NULL CHECK(accumulated_seconds >= 0),
  media_duration_seconds INTEGER NOT NULL CHECK(media_duration_seconds >= 0),
  campaign_id TEXT,
  channel TEXT,
  creative TEXT,
  traffic_class TEXT NOT NULL CHECK(traffic_class IN ('human','automated')),
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  UNIQUE(session_id,playthrough_id,sequence)
);
CREATE INDEX IF NOT EXISTS music_playback_events_date ON music_playback_events(occurred_at);
CREATE INDEX IF NOT EXISTS music_playback_events_campaign ON music_playback_events(campaign_id,occurred_at);
CREATE TABLE IF NOT EXISTS music_playback_daily (
  day TEXT NOT NULL,
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  medium TEXT NOT NULL,
  event TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  creative TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city)
);
```

- [ ] **Step 5: Run focused and full schema tests**

Run: `npm test -- tests/lib/owner-schema.test.ts tests/scripts/music-retention.test.ts`

Expected: PASS, including the existing lifetime playback preservation tests.

- [ ] **Step 6: Commit the reviewed schema**

```bash
git add migrations/music/0001_music_schema.sql migrations/publication db/music.sql wrangler.jsonc tests/lib/owner-schema.test.ts tests/__mocks__/cloudflare-workers.ts tests/lib/publication-journal.test.ts tests/lib/publication-contention.test.ts docs/publication-deployment.md
git commit -m "Add owner insights data model"
```

### Task 2: Verify Cloudflare Access at the application boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/env.d.ts`
- Create: `src/lib/owner-access.ts`
- Modify: `src/middleware.ts`
- Create: `tests/lib/owner-access.test.ts`
- Modify: `tests/middleware.test.ts`

**Interfaces:**
- Produces `verifyOwnerAccess(request: Request, env: Env): Promise<{ email: string } | null>`.
- Adds `OWNER_ACCESS_TEAM_DOMAIN`, `OWNER_ACCESS_AUD`, and `OWNER_EMAIL` secrets/configuration.
- Adds `owner?: { email: string }` to `App.Locals`.

- [ ] **Step 1: Write failing verification tests**

```ts
it('accepts only a signed token for the configured issuer, audience and owner email', async () => {
  const valid = await signedAccessRequest({ email: 'owner@example.com', aud: ['owner-aud'] });
  await expect(verifyOwnerAccess(valid.request, valid.env)).resolves.toEqual({ email: 'owner@example.com' });
  await expect(verifyOwnerAccess(valid.request, { ...valid.env, OWNER_EMAIL: 'other@example.com' })).resolves.toBeNull();
  await expect(verifyOwnerAccess(unsignedRequest(), valid.env)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/lib/owner-access.test.ts tests/middleware.test.ts`

Expected: FAIL because `verifyOwnerAccess` and owner middleware do not exist.

- [ ] **Step 3: Add `jose` and implement exact Access validation**

Use Cloudflare's documented `Cf-Access-Jwt-Assertion` header, remote JWKS, RS256 signature, issuer, application audience and verified owner email. Do not decode and trust an unsigned payload.

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

export async function verifyOwnerAccess(request: Request, env: Env) {
  const { OWNER_ACCESS_TEAM_DOMAIN: issuer, OWNER_ACCESS_AUD: audience, OWNER_EMAIL: ownerEmail } = env;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!issuer || !audience || !ownerEmail || !token) return null;
  try {
    const jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
    const { payload } = await jwtVerify(token, jwks, { issuer, audience, algorithms: ['RS256'] });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    return email === ownerEmail.toLowerCase() ? { email } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Protect every `/owner` request in middleware**

```ts
if (!context.isPrerendered && url.pathname.startsWith('/owner')) {
  const owner = await verifyOwnerAccess(request, context.locals.runtime.env);
  if (!owner) return new Response('Owner access required.', { status: 403, headers: ownerPrivateHeaders });
  context.locals.owner = owner;
  const response = await next();
  for (const [name, value] of Object.entries(ownerPrivateHeaders)) response.headers.set(name, value);
  return response;
}
```

Use `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, and a restrictive owner-page CSP that still permits the site's font origins. Do not add a local bypass to production code. UI development uses signed test fixtures and a separate local-only Wrangler configuration excluded by git.

- [ ] **Step 5: Run access, middleware and type checks**

Run: `npm test -- tests/lib/owner-access.test.ts tests/middleware.test.ts && npm run check`

Expected: PASS. Missing, expired, wrong-audience, wrong-issuer, wrong-email and invalid-signature tokens all return 403.

- [ ] **Step 6: Commit the trust boundary**

```bash
git add package.json package-lock.json src/env.d.ts src/lib/owner-access.ts src/middleware.ts tests/lib/owner-access.test.ts tests/middleware.test.ts
git commit -m "Protect owner routes with Cloudflare Access"
```

### Task 3: Persist and audit one unified request inbox

**Files:**
- Create: `src/lib/owner-model.ts`
- Create: `src/lib/owner-requests.ts`
- Modify: `src/lib/music-demand.ts`
- Modify: `src/lib/audio-intake.ts`
- Create: `tests/lib/owner-requests.test.ts`
- Modify: `tests/lib/music-demand.test.ts`
- Modify: `tests/lib/audio-intake.test.ts`

**Interfaces:**
- Produces `saveOwnerRequest(db, input, actor?)`, `listOwnerRequests(db, filter?)`, `getOwnerRequest(db, id)`, and `changeOwnerRequest(db, command)`.
- `OwnerRequestKind = 'purchase' | 'merchandise' | 'service' | 'release-update'`.
- `OwnerRequestStatus = 'new' | 'reviewed' | 'resolved' | 'withdrawn'`.
- Status changes and note changes always write `owner_request_audit` in the same `db.batch()` call.

- [ ] **Step 1: Write failing persistence and state-machine tests**

```ts
it('stores a request and audit together and only permits defined transitions', async () => {
  const created = await saveOwnerRequest(db, purchaseFixture);
  expect(created.status).toBe('new');
  await changeOwnerRequest(db, { id: created.id, action: 'review', actor: 'owner@example.com' });
  await changeOwnerRequest(db, { id: created.id, action: 'resolve', actor: 'owner@example.com' });
  await expect(changeOwnerRequest(db, { id: created.id, action: 'review', actor: 'owner@example.com' })).rejects.toThrow('Invalid request transition');
  expect(await auditActions(db, created.id)).toEqual(['created','reviewed','resolved']);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/lib/owner-requests.test.ts`

Expected: FAIL because the owner request helpers do not exist.

- [ ] **Step 3: Implement typed row conversion, bounded JSON and audited transitions**

```ts
export type RequestCommand =
  | { id: string; action: 'review' | 'resolve' | 'reopen' | 'withdraw'; actor: string }
  | { id: string; action: 'note'; actor: string; note: string };

const allowed = {
  new: ['review','resolve','withdraw'],
  reviewed: ['resolve','reopen','withdraw'],
  resolved: ['reopen','withdraw'],
  withdrawn: [],
} as const;
```

Use `crypto.randomUUID()`, prepared statements and `db.batch()` so the current row update and its audit entry succeed together. Keep private notes under 1,000 characters and never interpolate values into SQL.

- [ ] **Step 4: Extend purchase/merch validation without combining permissions**

Add optional `cityRegion` and optional `releaseUpdates` to `interestSchema`. Persist purchase or merchandise intent as its request kind, and create/update `owner_audience_permissions` only when the separate release-updates checkbox is true. Resolving the request must not change permission.

- [ ] **Step 5: Run request, demand and intake tests**

Run: `npm test -- tests/lib/owner-requests.test.ts tests/lib/music-demand.test.ts tests/lib/audio-intake.test.ts`

Expected: PASS, including separate consent, bounded location, valid transitions and audit creation.

- [ ] **Step 6: Commit the unified request domain**

```bash
git add src/lib/owner-model.ts src/lib/owner-requests.ts src/lib/music-demand.ts src/lib/audio-intake.ts tests/lib/owner-requests.test.ts tests/lib/music-demand.test.ts tests/lib/audio-intake.test.ts
git commit -m "Add audited owner request inbox"
```

### Task 4: Store public requests before confirming success

**Files:**
- Modify: `src/pages/api/music-interest.ts`
- Modify: `src/pages/api/audio-intake.ts`
- Create: `src/lib/owner-alerts.ts`
- Modify: `src/lib/audio-resend.ts`
- Modify: `tests/api/music-demand.test.ts`
- Modify: `tests/api/audio-intake.test.ts`
- Create: `tests/lib/owner-alerts.test.ts`

**Interfaces:**
- Produces `sendUrgentOwnerAlert(env, incident): Promise<void>` where `incident` contains only a category, request ID, route, occurrence time and safe failure code.
- Public endpoints return success only after D1 persistence.
- Alert failure does not change the honest visitor response and never triggers an automatic retry loop.

- [ ] **Step 1: Add failing endpoint tests**

```ts
it('does not confirm a valid request when owner storage fails', async () => {
  const response = await POST(context(validRequest, { dbFailure: true }));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false });
  expect(sendUrgentOwnerAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ category: 'request-storage' }));
});
```

- [ ] **Step 2: Run endpoint tests and verify failure**

Run: `npm test -- tests/api/music-demand.test.ts tests/api/audio-intake.test.ts tests/lib/owner-alerts.test.ts`

Expected: FAIL because audio intake emails routine details instead of writing the owner inbox, and storage alerts do not exist.

- [ ] **Step 3: Change both endpoints to validate, verify, rate-limit, persist, then respond**

For service intake, store the validated file-review request in D1. Stop sending the routine owner email. For music interest, keep `music_interest` compatibility while also writing the unified request and separate permission record in one D1 batch. If persistence fails, delete the consumed rate-limit key when safe, send one redacted urgent alert, and return the existing honest retry message.

- [ ] **Step 4: Run endpoint and regression tests**

Run: `npm test -- tests/api/music-demand.test.ts tests/api/audio-intake.test.ts tests/lib/owner-alerts.test.ts tests/lib/audio-resend.test.ts`

Expected: PASS. Tests assert that alert payloads contain no email, name, notes, file link or Turnstile token.

- [ ] **Step 5: Commit public request reliability**

```bash
git add src/pages/api/music-interest.ts src/pages/api/audio-intake.ts src/lib/owner-alerts.ts src/lib/audio-resend.ts tests/api/music-demand.test.ts tests/api/audio-intake.test.ts tests/lib/owner-alerts.test.ts
git commit -m "Persist owner requests before confirmation"
```

### Task 5: Add campaign attribution and trustworthy playback sequences

**Files:**
- Create: `src/lib/owner-campaigns.ts`
- Modify: `src/lib/music-demand.ts`
- Modify: `src/pages/api/music-event.ts`
- Modify: `src/scripts/music-playback.ts`
- Create: `tests/lib/owner-campaigns.test.ts`
- Modify: `tests/scripts/music-playback.test.ts`
- Modify: `tests/api/music-demand.test.ts`

**Interfaces:**
- Produces `resolveCampaignTag(db, { campaignId, channel, creative }): Promise<CampaignTag | null>`.
- Playback payload gains `playthroughId`, `sequence`, `accumulatedSeconds`, `mediaDurationSeconds`, and optional controlled attribution.
- Server accepts `listen30` only after the same playthrough's ordered start/progress sequence reaches 30 accumulated seconds, and `complete` only at 90 percent of duration.

- [ ] **Step 1: Write failing campaign and event-sequence tests**

```ts
it('rejects arbitrary tags and out-of-order reported listens', async () => {
  await expect(resolveCampaignTag(db, { campaignId: 'old-news', channel: 'social', creative: 'clip-a' })).resolves.toEqual(expect.anything());
  await expect(resolveCampaignTag(db, { campaignId: 'old-news', channel: 'anything', creative: 'free-text' })).resolves.toBeNull();
  expect((await event(context(listen30WithoutStart))).status).toBe(409);
  expect((await event(context(validOrderedListen30))).status).toBe(200);
});
```

- [ ] **Step 2: Run playback tests and verify they fail**

Run: `npm test -- tests/lib/owner-campaigns.test.ts tests/scripts/music-playback.test.ts tests/api/music-demand.test.ts`

Expected: FAIL because playback currently records only deduplicated `start` and `listen30` events.

- [ ] **Step 3: Implement controlled attribution and sequence validation**

Use campaign/tag database rows as the allowlist. Copy only country, region and city from `request.cf`; never copy `cf-connecting-ip`. Mark recognizable crawlers and bot-management results as `automated`. Insert prepared playback events with a unique event ID and reject duplicated or skipped sequence numbers.

- [ ] **Step 4: Update the browser player to report accumulated play time**

Count actual `timeupdate` deltas only while media is playing. Seeking changes the playhead without increasing accumulated listening. Switching audio/video keeps the same playthrough ID. An explicit restart after completion creates a new playthrough and reports `replay`.

- [ ] **Step 5: Run playback and API tests**

Run: `npm test -- tests/lib/owner-campaigns.test.ts tests/scripts/music-playback.test.ts tests/api/music-demand.test.ts tests/scripts/comparison-transport.test.ts`

Expected: PASS. A/B comparison remains excluded, seek jumps add no listening time, medium switching stays one playthrough, and automated traffic is excluded from human totals.

- [ ] **Step 6: Commit campaign measurement**

```bash
git add src/lib/owner-campaigns.ts src/lib/music-demand.ts src/pages/api/music-event.ts src/scripts/music-playback.ts tests/lib/owner-campaigns.test.ts tests/scripts/music-playback.test.ts tests/api/music-demand.test.ts
git commit -m "Measure controlled campaign listening"
```

### Task 6: Verify PR 1 as an independent foundation

**Files:**
- Modify: `docs/project-journal.md` through `scripts/development_journal.py`

- [ ] **Step 1: Run the complete foundation checks**

Run: `npm test && npm run check && npm run build`

Expected: all commands PASS. Asset QA runs through `prebuild`.

- [ ] **Step 2: Review the change for removable duplication**

Run: `git diff --stat codex/audio-intake...HEAD && git diff --check codex/audio-intake...HEAD`

Expected: no whitespace errors. Confirm public endpoints share request and alert helpers, no second database binding was added, and no sensitive fields enter alerts or logs.

- [ ] **Step 3: Record the checkpoint**

Use `python3 scripts/development_journal.py checkpoint` with the tested commands, schema-reconciliation evidence, limitations and PR dependency. Do not claim production schema application.

- [ ] **Step 4: Push and open PR 1**

Title: `Add the owner insights data and trust boundary`

Description: Explain that valid public requests now persist to one audited inbox, campaign playback uses controlled sequences, and `/owner` has a verified Cloudflare Access boundary. Include validation commands and state clearly that no migration was applied and nothing was deployed.

---

## PR 2: Owner interface

### Task 7: Build shared reporting read models

**Files:**
- Create: `src/lib/owner-reporting.ts`
- Create: `src/lib/cloudflare-analytics.ts`
- Create: `tests/lib/owner-reporting.test.ts`
- Create: `tests/lib/cloudflare-analytics.test.ts`
- Modify: `src/env.d.ts`

**Interfaces:**
- Produces `loadStudioLedger(db, now): Promise<StudioLedger>` and `loadCampaignDesk(db, campaignId, now): Promise<CampaignDesk | null>`.
- Produces `loadTrafficSummary(env, range): Promise<{ status: 'available'; summary: TrafficSummary } | { status: 'unavailable'; dashboardUrl: string }>`.
- Reporting functions return already-suppressed geographic rows; pages cannot accidentally render sparse city data.

- [ ] **Step 1: Write failing read-model tests using fixed fixtures**

```ts
it('orders attention first, suppresses sparse cities and excludes automated traffic', async () => {
  const ledger = await loadStudioLedger(seedOwnerDb(), new Date('2026-09-19T12:00:00Z'));
  expect(ledger.attention.newRequests).toBe(2);
  expect(ledger.geography.cities).toEqual([{ label: 'Nashville, Tennessee', reportedListens: 5 }]);
  expect(ledger.listening.reportedStarts).toBe(7);
});
```

- [ ] **Step 2: Run read-model tests and verify failure**

Run: `npm test -- tests/lib/owner-reporting.test.ts tests/lib/cloudflare-analytics.test.ts`

Expected: FAIL because the reporting modules do not exist.

- [ ] **Step 3: Implement explicit SQL summaries and geographic suppression**

Keep queries in `owner-reporting.ts`, return typed objects, and count city rows only when their qualifying human `listen30` or `complete` total is at least five. Combine suppressed rows as `Other locations` without exposing names.

- [ ] **Step 4: Add bounded Cloudflare analytics retrieval with a safe fallback**

Use `CLOUDFLARE_ANALYTICS_TOKEN` and `CLOUDFLARE_ZONE_ID` only when both exist. Query the official GraphQL endpoint with `requestSource: "eyeball"`, bounded dates and the production hostname. Return a configured Cloudflare dashboard URL on missing configuration, timeout, non-200 response or invalid shape. Never fail an owner page because analytics is unavailable; never persist the token or raw response.

- [ ] **Step 5: Run read-model tests**

Run: `npm test -- tests/lib/owner-reporting.test.ts tests/lib/cloudflare-analytics.test.ts`

Expected: PASS for available, unconfigured, timeout, malformed response, bot exclusion and sparse-city suppression cases.

- [ ] **Step 6: Commit reporting interfaces**

```bash
git add src/lib/owner-reporting.ts src/lib/cloudflare-analytics.ts src/env.d.ts tests/lib/owner-reporting.test.ts tests/lib/cloudflare-analytics.test.ts
git commit -m "Add owner reporting read models"
```

### Task 8: Build the editorial owner shell and Today page

**Files:**
- Create: `src/layouts/OwnerLayout.astro`
- Create: `src/styles/owner.css`
- Create: `src/components/owner/AttentionIndex.astro`
- Create: `src/components/owner/MetricDefinition.astro`
- Create: `src/components/owner/ListeningPath.astro`
- Create: `src/components/owner/RequestList.astro`
- Create: `src/pages/owner/index.astro`
- Create: `tests/lib/owner-pages.test.ts`

**Interfaces:**
- `OwnerLayout` consumes `title`, `current`, `newRequestCount`, and `ownerEmail`.
- `AttentionIndex` consumes `{ number: '01' | '02'; label: string }` and exposes visible accessible text.
- `RequestList` consumes already-sanitized `OwnerRequestSummary[]`.

- [ ] **Step 1: Write failing static page-contract tests**

```ts
it('renders the shared navigation, one primary action and accessible guidance', async () => {
  const html = await renderOwnerPage('/owner');
  expect(html).toContain('Today');
  expect(html).toContain('Requests');
  expect(html).toContain('Open Campaign Desk');
  expect(primaryActions(html)).toHaveLength(1);
  expect(accessibleSectionIndexes(html)).toEqual(['First area to inspect','Next useful area']);
});
```

- [ ] **Step 2: Run page-contract tests and verify failure**

Run: `npm test -- tests/lib/owner-pages.test.ts`

Expected: FAIL because the private layout and Today page do not exist.

- [ ] **Step 3: Implement the shared shell and visual primitives**

Use one continuous paper canvas, a top navigation, aligned editorial sections and existing `--paper`, `--ink`, `--muted`, `--rule`, and `--accent` tokens. The request count remains in navigation. The `?` component uses native `<details>` and a specific metric definition. Do not use a sidebar or card grid.

- [ ] **Step 4: Compose Today as the Studio Ledger**

Order content: page identity and health, `01` recent activity and people waiting, active campaign summary with the single primary `Open Campaign Desk` action, `02` evidence-based observations, then broad discovery and geography summaries. Render honest empty states instead of sample analytics.

- [ ] **Step 5: Verify desktop, mobile, keyboard and reduced motion**

Run: `npm run check && npm test -- tests/lib/owner-pages.test.ts`

Then use Playwright at 1440×1000 and 390×844 with signed test fixtures. Expected: no horizontal scroll, request rows become two-line touch targets, health and new requests stay near the top, focus order follows reading order, and `01`/`02` have text equivalents.

- [ ] **Step 6: Commit the owner shell and Today page**

```bash
git add src/layouts/OwnerLayout.astro src/styles/owner.css src/components/owner src/pages/owner/index.astro tests/lib/owner-pages.test.ts
git commit -m "Build the Studio Ledger owner view"
```

### Task 9: Build request, campaign and audience pages with audited actions

**Files:**
- Create: `src/pages/owner/requests/index.astro`
- Create: `src/pages/owner/requests/[id].astro`
- Create: `src/pages/owner/campaigns/index.astro`
- Create: `src/pages/owner/campaigns/[id].astro`
- Create: `src/pages/owner/audience.astro`
- Create: `src/pages/api/owner/requests/[id].ts`
- Create: `src/scripts/owner-request-actions.ts`
- Modify: `tests/lib/owner-pages.test.ts`
- Create: `tests/api/owner-requests.test.ts`

**Interfaces:**
- Owner request endpoint accepts `{ action: 'review' | 'resolve' | 'reopen' | 'withdraw' | 'note', note?: string }` and returns `{ ok: true, request: OwnerRequest }`.
- Campaign pages consume `CampaignDesk`; all metrics use shared definitions from `owner-reporting.ts`.

- [ ] **Step 1: Write failing route and action tests**

```ts
it('updates a request only for an authenticated owner and records the actor', async () => {
  expect((await POST(ownerContext({ action: 'review' }))).status).toBe(200);
  expect((await POST(anonymousContext({ action: 'review' }))).status).toBe(403);
  expect(await lastAuditActor(db)).toBe('owner@example.com');
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/api/owner-requests.test.ts tests/lib/owner-pages.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement the private inbox and detail page**

Inbox filters use fixed status/kind values. Detail shows contact data, self-reported city/region explicitly labeled as supplied by the requester, source links, private note, audit timeline and allowed actions. Withdrawal/deletion actions require a clear confirmation. Never place personal fields in URL parameters.

- [ ] **Step 4: Implement Campaign Desk and campaign archive**

Campaign Desk uses the vertical listening path as `01`, demand as `02`, then approximate geography, discovery categories and newest requests. Include breadcrumbs and `Return to Today`. Separate direct, search, AI referral, controlled campaign, other referral and recognizable automated traffic. Label browser-derived measures as reported.

- [ ] **Step 5: Implement the audience permission page**

Show subscribed/unsubscribed state, granted date, source request and withdrawal date. Provide withdrawal only; do not add campaign composition or sending.

- [ ] **Step 6: Run page, action, check and build validation**

Run: `npm test -- tests/api/owner-requests.test.ts tests/lib/owner-pages.test.ts && npm run check && npm run build`

Expected: PASS. Confirm every response in the `/owner` route family is `no-store`, owner mutations reject cross-origin submissions through existing middleware, and pages expose no private data in generated static output.

- [ ] **Step 7: Commit owner workflows**

```bash
git add src/pages/owner src/pages/api/owner src/scripts/owner-request-actions.ts tests/api/owner-requests.test.ts tests/lib/owner-pages.test.ts
git commit -m "Add owner request and campaign workflows"
```

### Task 10: Verify PR 2 as an independent interface milestone

- [ ] **Step 1: Run all automated checks**

Run: `npm test && npm run check && npm run build`

Expected: PASS.

- [ ] **Step 2: Run authenticated visual and privacy checks**

Verify Today, Requests, one request detail, Campaigns, Old News Campaign Desk and Audience at desktop/mobile widths. Also request each page without a valid Access JWT and confirm 403 with no private body content.

- [ ] **Step 3: Record the journal checkpoint**

Record exact tested routes, screenshots, privacy results and remaining operations work through `scripts/development_journal.py checkpoint`.

- [ ] **Step 4: Push and open stacked PR 2**

Base PR 2 on PR 1. Title: `Add the private owner insights interface`.

Description: Lead with the owner outcome and include the Today/Campaign Desk relationship, request actions, responsive verification, test commands and the explicit statement that deployment remains gated.

---

## PR 3: Retention, incidents and launch evidence

### Task 11: Extend reviewed retention to requests and sequenced playback

**Files:**
- Create: `scripts/owner-retention.mjs`
- Modify: `scripts/music-retention.mjs`
- Modify: `scripts/music-analytics.mjs`
- Create: `tests/scripts/owner-retention.test.ts`
- Modify: `tests/scripts/music-retention.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `previewOwnerRetention(database, environment, now)` and `applyOwnerRetention(database, review, environment, now)`.
- Preview manifest contains exact source hashes and aggregate summaries, never raw contact values.
- Apply accepts only the exact reviewed manifest and refuses changed sources, recent records, wrong environments and second application.

- [ ] **Step 1: Write failing retention tests**

```ts
test('preview is read-only and apply removes only eligible personal detail', async () => {
  const review = await previewOwnerRetention(database, 'Local test data', now);
  expect(review.requestContacts).toBe(1);
  expect(review.rawPlayback).toBe(3);
  expect(JSON.stringify(review)).not.toContain('fan@example.com');
  await applyOwnerRetention(database, review, 'Local test data', now);
  expect(await lifetimeCampaignTotals(database)).toEqual(beforeTotals);
  expect(await deletedRequest(database)).toMatchObject({ email: '', private_note: '', status: 'resolved' });
});
```

- [ ] **Step 2: Run retention tests and verify failure**

Run: `npm test -- tests/scripts/owner-retention.test.ts tests/scripts/music-retention.test.ts`

Expected: FAIL because owner retention does not exist.

- [ ] **Step 3: Implement dry-run and exact-manifest apply**

Aggregate playback by day, campaign, controlled tags, medium, event and approved geography before removing events older than 90 days. Blank resolved request contact fields 90 days after resolution, delete unconverted resolved service inquiry contact fields after one year, retain permission until unsubscribe, and honor explicit withdrawal immediately. Write `personal-data-deleted` audit rows without copied personal content.

- [ ] **Step 4: Add explicit operator commands**

```json
{
  "owner:retention:preview": "node scripts/owner-retention.mjs",
  "owner:retention:apply": "node scripts/owner-retention.mjs --apply .private/owner-retention-review.json"
}
```

Remote execution still requires explicit `--remote`. There is no timer in this task.

- [ ] **Step 5: Run retention and analytics regression tests**

Run: `npm test -- tests/scripts/owner-retention.test.ts tests/scripts/music-retention.test.ts`

Expected: PASS for changed-source rejection, wrong environment, double apply, partial failure, geography threshold, preserved totals and redacted manifests.

- [ ] **Step 6: Commit reviewed retention**

```bash
git add scripts/owner-retention.mjs scripts/music-retention.mjs scripts/music-analytics.mjs tests/scripts/owner-retention.test.ts tests/scripts/music-retention.test.ts package.json
git commit -m "Add reviewed owner data retention"
```

### Task 12: Add health reporting and an owner operations runbook

**Files:**
- Create: `scripts/owner-health.mjs`
- Create: `tests/scripts/owner-health.test.ts`
- Create: `docs/owner-operations.md`
- Modify: `docs/prelaunch-checklist.md`
- Modify: `package.json`

**Interfaces:**
- `owner-health.mjs` exits 0 only when required bindings/schema, public release media, owner reporting query and retention freshness checks pass.
- Health output contains status, safe check name, checked time and next operator action; it never prints raw rows or secrets.

- [ ] **Step 1: Write failing health-report tests**

```ts
it('reports actionable safe failures without private data', async () => {
  const report = await ownerHealth(failingFixture);
  expect(report.status).toBe('attention');
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'request-storage', next: expect.any(String) }));
  expect(JSON.stringify(report)).not.toContain('fan@example.com');
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- tests/scripts/owner-health.test.ts`

Expected: FAIL because the health report does not exist.

- [ ] **Step 3: Implement bounded, read-only health checks**

Check required env names without printing values, expected schema objects, a HEAD/range request for each public Old News media asset, a bounded owner summary query, and the latest successful retention audit time. Do not add automated repair.

- [ ] **Step 4: Write the owner operations runbook in decision order**

The runbook must explain:

1. How to open Today and what `01`, `02`, health and request count mean.
2. How to start and close a campaign using controlled channel/creative values.
3. How to review, resolve, reopen, withdraw and delete personal request data.
4. Which failures email Kazon and which routine events remain quiet.
5. How to preview retention, preserve private observations, apply the exact review and pause scheduled deletion.
6. How to restore the previous Worker version.
7. How to hide Old News without deleting it.
8. How to disable event collection.
9. How to verify database recovery in D1.
10. How to confirm recovery from the visitor's perspective.

Use short steps and screenshots only after the UI exists. Do not expose secrets or private request examples.

- [ ] **Step 5: Link exact launch checks from the prelaunch checklist**

Add an owner-center section requiring PASS, FAIL, UNVERIFIED or justified N/A for Access policy, signed-JWT verification, no-store headers, D1 schema/ledger reconciliation, request storage failure, alert redaction, traffic fallback, sparse geography, retention dry run, rollback, event-disable and live visitor recovery.

- [ ] **Step 6: Run documentation and health tests**

Run: `npm test -- tests/scripts/owner-health.test.ts && npm run check && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit operations evidence**

```bash
git add scripts/owner-health.mjs tests/scripts/owner-health.test.ts docs/owner-operations.md docs/prelaunch-checklist.md package.json
git commit -m "Document owner center operations and recovery"
```

### Task 13: Complete the deployment gate without deploying

**Files:**
- Modify: `docs/prelaunch-checklist.md` only if test evidence exposes a missing reusable check.
- Modify: private journal/checkpoint artifacts through the existing journal tool.

- [ ] **Step 1: Run the complete repository validation once**

Run: `npm test && npm run check && npm run build`

Expected: PASS.

- [ ] **Step 2: Produce a local retention preview and health report**

Run: `npm run owner:retention:preview && npm run owner:health`

Expected: both complete without modifying data. Inspect the private HTML/JSON artifacts and confirm they contain no request email, name, note, file link, JWT, IP address or secret.

- [ ] **Step 3: Exercise rollback and disable controls in a non-production environment**

Verify the documented commands for restoring the prior Worker version, hiding Old News, disabling music events and pausing retention. Record observed results; do not infer success from configuration alone.

- [ ] **Step 4: Complete every applicable prelaunch row**

Mark each owner-center and site-wide check PASS, FAIL, UNVERIFIED or justified N/A. Any FAIL or UNVERIFIED launch-critical item blocks deployment. Code completion does not change that result.

- [ ] **Step 5: Record the final implementation checkpoint**

Record exact commits, PR dependencies, tests, visual evidence, schema status, retained limitations and deployment-gate result through `scripts/development_journal.py checkpoint`.

- [ ] **Step 6: Push and open stacked PR 3**

Base PR 3 on PR 2. Title: `Add owner retention and launch controls`.

Description: State the exact retention rules, dry-run safety, health checks, rollback evidence and prelaunch result. Do not request or perform deployment from this PR.

## Final Integration and Deployment Decision

- [ ] Review the three PRs in dependency order and confirm each diff remains independently understandable.
- [ ] Rebase or merge the stack only after review; do not merge around a failing dependency.
- [ ] Re-run `npm test`, `npm run check` and `npm run build` at the final combined commit.
- [ ] Reconcile and apply the reviewed D1 migration separately from code deployment, with a verified backup/recovery path.
- [ ] Configure the Cloudflare Access application for `/owner*`, its single-owner allow policy, `OWNER_ACCESS_TEAM_DOMAIN`, `OWNER_ACCESS_AUD`, and `OWNER_EMAIL`.
- [ ] Configure the optional read-only analytics token and zone ID, or accept the explicit Cloudflare dashboard-link fallback.
- [ ] Ask for an explicit deployment decision only after the completed prelaunch checklist and concrete production change set are available for review.
- [ ] After an authorized deployment, verify signed owner access, unauthenticated rejection, public request success/failure behavior, Old News media, campaign reporting, no-store headers, Cloudflare fallback, and visitor-visible recovery from the live hostname.

## Self-Review Results

- **Spec coverage:** Every in-scope route, request type, permission rule, campaign field, measurement definition, geography constraint, retention rule, authentication control, incident expectation, mobile behavior and deployment control maps to a task above.
- **Deferred work preserved:** Email campaigns, commerce, fulfillment, cross-visit recognition, postal codes, MCP insight tools and automated maintenance remain outside all three PRs.
- **Architecture drift check:** The plan reuses Astro, `MUSIC_DB`, Resend, Turnstile, rate limiting, existing content and design tokens. The only dependency added is `jose`, justified by Cloudflare's documented requirement to verify Access JWT signatures rather than trusting headers or hand-rolling cryptography.
- **Privacy check:** Approximate network geography is aggregate-only; self-reported city/region stays on its request; IP/postal code are not stored; sparse cities are suppressed; alerts and manifests are redacted.
- **Placeholder scan:** No TBD/TODO or unspecified implementation step remains.
- **Type consistency:** Owner request statuses, kinds, action names, campaign tags, reporting return types and playback fields are consistent across schema, APIs, pages and tests.
