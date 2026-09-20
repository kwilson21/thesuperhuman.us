# Owner insights design

**Date:** September 16, 2026  
**Status:** Approved architecture and visual direction. Implementation and deployment are not authorized by this document.

## Purpose

Kazon needs one private place to understand the website, respond to real people, and learn from promotions without operating several technical dashboards. The owner center must answer three questions:

1. What is happening?
2. Does anything need my attention?
3. What should I learn or decide?

The design assumes Kazon may open the owner center only while actively promoting a release or service. Routine activity must collect quietly. Email is reserved for failures or urgent conditions.

## Scope

The first owner center includes:

- an active campaign view;
- an ongoing owner ledger;
- individual purchase, merchandise, subscription and service requests;
- campaign history and lessons;
- release-update permissions;
- simple health and incident states;
- plain-language measurement definitions;
- visual guidance showing where to start and what to inspect next.

It does not include:

- an embedded AI chat;
- campaign email composition or delivery;
- release publishing controls;
- pricing or retention settings;
- automated marketing;
- a general website CMS;
- automatic code repair or deployment.

Campaign planning remains a guided Codex workflow. The owner center stores the approved campaign and its results.

## Architecture

The owner center remains part of the existing Astro and Cloudflare Worker application. It is not a separate service.

```text
Public website
├── Cloudflare Web Analytics: aggregate site traffic
├── D1: campaign definitions, music events and requests
└── existing release, portfolio and service content

Private /owner area
├── Cloudflare Access: one approved owner identity
├── shared server-side reporting functions
├── D1 request and campaign data
└── aggregate Cloudflare traffic data when a simple supported API exists
```

The implementation must follow `docs/coding-approach.md`: reuse existing helpers and bindings, prefer native platform features, and add no new service or dependency without a demonstrated requirement.

Cloudflare traffic data must not be duplicated merely to avoid linking to a deeper Cloudflare view. If an aggregate cannot be retrieved simply and safely, the owner center may link to the relevant Cloudflare dashboard or omit it.

## Information architecture

Stable private routes:

```text
/owner                         Today · ongoing Studio Ledger
/owner/requests                Combined private inbox
/owner/requests/<id>           Individual request
/owner/campaigns               Campaign archive
/owner/campaigns/<id>          Active Campaign Desk
/owner/audience                Release-update permissions
```

Every page shares this navigation:

```text
Today | Requests | Campaigns | Audience
```

An active campaign is reachable from Today through **Open Campaign Desk**. A Campaign Desk provides breadcrumbs and **Return to Today**. Both views read the same reporting functions and metric definitions.

## Two connected owner views

### Campaign Desk

The Campaign Desk is the promotion-first view. Old News is the first campaign.

It shows:

- campaign identity, dates and channels;
- promotion visits;
- release visits;
- playback starts;
- reported 30-second listens;
- reported completions;
- purchase and merchandise demand;
- approximate geographic interest;
- newest individual requests;
- direct, search, AI referral, campaign and other referral traffic.

The listening path is the primary evidence. Demand is the next area to inspect. Geography and discovery sources provide supporting context.

### Studio Ledger

Today is the combined view over time. It uses a reflective ledger structure rather than a dashboard grid.

It shows:

- what happened recently;
- an active-campaign summary;
- people waiting for an answer;
- short evidence-based observations;
- actionable attention states;
- broad discovery and geographic summaries.

It links directly to the full Campaign Desk when campaign detail is needed.

## Visual direction

The private area belongs to the existing website design system:

- continuous warm ivory paper;
- black ink and muted gray text;
- restrained terracotta accents;
- green used only for healthy state;
- classical editorial serif headings;
- clean small labels and annotations;
- hairline rules and aligned baselines;
- no generic dashboard cards, gradients, shadows, glass panels or sidebar;
- no dark monitoring-console treatment.

Campaign Desk and Studio Ledger remain distinct. They are connected views rather than a forced hybrid.

### Visual guidance

The owner is learning how to interpret the information. Pages guide attention before requiring explanation.

- Terracotta `01` identifies the first area to inspect.
- Terracotta `02` identifies the next useful area.
- Editorial indexes are unboxed and aligned with section headings.
- Actual analytics values remain black so guidance cannot be confused with data.
- One compact terracotta action is visually primary on each page.
- A small request count remains visible in navigation.
- New request rows use a small dot and restrained emphasis.
- Important path segments may use a heavier terracotta line and faint tonal wash.
- A small `?` reveals plain-language explanation on demand.
- No “Look here” annotation, tutorial banner or open explanatory paragraph appears by default.

The visual signal must always have accessible text. Color is never the only indication of state or order.

## Requests

One private inbox contains:

- song purchase requests;
- merchandise requests;
- audio-service requests;
- future-release permissions.

Statuses:

- New
- Reviewed
- Resolved
- Withdrawn

Initial owner actions:

- mark reviewed;
- mark resolved;
- reopen;
- add a short private note;
- open the related release, service or campaign;
- honor withdrawal or deletion.

Every state change receives a timestamped audit entry. The first version does not send marketing email, publish a release, change pricing or alter production configuration.

The owner page is the source of truth. Routine requests do not generate email. If a valid request cannot be stored, the visitor receives an honest retry message and Kazon receives an urgent alert.

## Audience permission

Request-specific contact and ongoing release updates are separate permissions.

- A purchase or merchandise request permits contact about that request.
- “Keep me updated about future Kazon releases” is a separate optional choice.
- Withdrawing future updates must not remove an active purchase request.
- Resolving a request must not change release-update permission.
- The first version records permission but does not provide campaign-email composition or sending.

## Campaigns

Each campaign preserves:

- promoted release or service;
- primary goal and secondary signals;
- start and end dates;
- tagged channels and creative variants;
- approved plan;
- results;
- a short retrospective;
- a lesson for the next campaign.

Old News is a learning campaign. Its primary goal is meaningful listening. Purchase interest, merchandise interest and reusable audience growth are secondary signals.

Campaign links use controlled campaign, channel and creative values. Arbitrary query text is not stored. Direct or unknown, search, AI referral, campaign, other referral and recognizable automated traffic remain separate categories. Automated traffic is excluded from visitor and listening totals.

## Measurement contract

| Metric | Meaning |
|---|---|
| Site visit | Aggregate visit reported by Cloudflare Web Analytics |
| Campaign visit | Visit arriving through a controlled tagged campaign link |
| Release visit | Visit to a release detail page |
| Playback start | Audio or lyric video began playing |
| Reported 30-second listen | Browser reports 30 accumulated seconds of playback with a valid server-side event sequence |
| Reported completion | Browser reports accumulated playback reaching at least 90 percent of media duration |
| Replay | New playthrough after completion or explicit restart |
| A/B comparison | Portfolio comparison use, excluded from release play counts |
| Purchase request | Validated request for digital, physical or either format |
| Merchandise request | Validated request for an available merchandise type |
| Update subscriber | Separate consent for future Kazon release updates |
| Service request | Validated audio-service submission stored successfully |

Playback reporting cannot prove that device volume was audible, the visitor was attentive, or two visits came from the same person. Owner copy uses **reported listens**, never certified or royalty-equivalent streams.

Audio and lyric-video switching continues the same playthrough on one page. Seeking does not count as listening time. A/B comparison activity remains separate.

## Geography

Two forms of geography remain visibly separate:

1. Approximate network location for listening activity.
2. Optional city or region supplied intentionally with a purchase or merchandise request.

At launch:

- no IP address or postal code is stored;
- country, region and city may be aggregated for listening activity;
- inferred geography is never attached to an individual request;
- city-level listening information is displayed only after at least five qualifying events;
- sparse groups are combined rather than exposed;
- location is always labeled approximate;
- the purchase and merchandise form explains why optional city or region is requested.

## Retention

- Raw playback events: 90 days.
- Detailed network location: deleted with raw events.
- Anonymous daily and campaign totals: retained.
- Active requests: retained while actionable.
- Resolved request contact information: deleted after 90 days.
- Release-update permission: retained until unsubscribe.
- Unconverted service inquiries: deleted one year after resolution.
- Explicit withdrawal or deletion: handled immediately.
- Audit history retains the action and time without retaining deleted personal content.

Automatic deletion must begin with a reviewed dry run that reports what would be aggregated and removed.

## Security

- Cloudflare Access protects the full `/owner` route family for one approved identity.
- The application verifies the authenticated identity at its own trust boundary.
- Private responses use `no-store` and cannot appear in public page output.
- No custom password, registration, invitation or role system is added.
- Sensitive request content never appears in analytics or error logs.
- Public inputs use the existing validation, origin, abuse-prevention and rate-limiting patterns unless an audit proves they are insufficient.
- Database changes are additive and tracked.
- The existing live D1 schema and migration ledger must be reconciled before managed migrations are introduced.

## Health and incidents

Routine activity appears only in the owner center. Email is reserved for:

- valid visitor requests that cannot be stored;
- sustained public-site failure;
- unavailable public release media;
- repeated failures that block real visitors;
- failed aggregation or retention work;
- authentication or owner-reporting failure;
- security or cost anomalies requiring action.

An incident page explains:

- what happened;
- whether visitor information is safe;
- what is affected;
- what was checked;
- what will happen automatically;
- the one next action available to Kazon.

Health views never expose raw logs, stack traces or internal secrets.

Before deployment, the implementation must document and test how to:

- restore the previous Worker version;
- hide Old News without deleting it;
- disable event collection;
- pause scheduled deletion;
- verify database recovery;
- confirm recovery from the visitor’s perspective.

## Mobile behavior

Mobile layouts are recomposed rather than scaled down.

- Campaign listening stages become a vertical path.
- Health and new requests remain visible near the top.
- Request rows use touch-friendly two-line layouts.
- Wide comparison tables become short ranked lists.
- Terracotta `01` and `02` remain editorial section indexes.
- The primary action remains visible without sticky overlays.
- Destructive or privacy-sensitive actions require clear confirmation.

## Deferred work

- Campaign email composition and sending.
- Commerce and Bandcamp links.
- Physical-edition fulfillment.
- Returning-listener recognition or cross-visit journeys.
- Postal-code collection.
- Read-only MCP insight tools.
- A maintenance agent that diagnoses incidents.
- Automatic merge and deployment of narrowly defined low-risk fixes.

Future maintenance-agent work must be event-driven, cost-capped, restricted by an explicit action allowlist, verified after deployment and able to stop rather than retry indefinitely. It is not a launch gate for this owner center.

## Design acceptance and implementation gate

The owner approved:

- the integrated owner-center architecture;
- Campaign Desk and Studio Ledger as connected views;
- individual request access;
- campaign planning through Codex;
- the measurement and retention model in this document;
- country, region and city collection under the stated limits;
- optional self-reported city or region for demand requests;
- the editorial visual system;
- terracotta `01` and `02` guidance indexes with optional explanations.

No production implementation, PR merge or deployment is authorized by this approval. After this document is reviewed, the next step is a separate implementation plan with small reviewable milestones and an explicit deployment gate.
