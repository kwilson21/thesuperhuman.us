# Site-wide public navigation prediction

## Scope and maintenance

The shared BaseLayout installs one navigation adapter per native document. No
page-specific link attributes or duplicated prefetch handlers are required. The
existing Foresight package and three-document lifetime budget remain unchanged.

`scripts/navigation-inventory.mjs` derives the shipped browser-only path inventory
from real page files and the same `publicReleasePages` content filter used by the
sitemap. Public preview releases remain public; private and hidden releases are
not included. Content slugs are added only when their implementing route exists.
Generation runs before development/start/build; tests reject stale output.

New ordinary static documents are discovered automatically under Astro's verified
static output mode. New server-rendered or parameterized pages fail the inventory
check until classified at the single `SERVER_PAGES` review point. Review their
GET handlers, imports, middleware, cache policy and authentication before adding
a classification. Do not infer safety from a URL or a page title. Reserved private
and endpoint namespaces are excluded before static inference. Changing output
mode requires review rather than silently broadening the policy.

The current inventory has 22 public sources and 15 safe destinations. Public
sources include dedicated software/audio intake pages and five no-store project
feed pages. Those seven pages are never speculative destinations: intake can
initialize security state, and feeds explicitly refuse caching. General public
HTML may contain a form; fetching its document does not submit or execute it.

Private owner/studio/offer/agreement routes, API/discovery/file endpoints, redirect
aliases and error pages never participate. No media asset, form submission,
mutation, AI invocation, analytics event or unknown URL is predicted. The browser
receives only public source/target paths, not the classification implementation.

## Host and link semantics

The main, www and audio hosts are supported. The same `rewritePathForHost` used by
middleware maps audio-host paths to their canonical route identities, while the
actual request remains same-origin. Cross-origin URLs, query-bearing destinations,
credentials, downloads, other browsing targets and same-document fragments are
excluded. Cross-document hashes are removed only from the speculative request;
the original link and its native fragment navigation are untouched. Both speculative
transports set `no-referrer`, so source query strings are not forwarded as
referrers. This preserves public tracking/referral URL navigation coverage.

## Lifecycle and state model

The adapter is mounted once per full-page document, not a client-side router.
A single filtered MutationObserver reconciles inserted, replaced and removed
links. Registration is deduplicated; obsolete callbacks revalidate eligibility.
It disconnects and unregisters on pagehide, then restores on pageshow without
resetting the document's budget. Exhausting the budget also unregisters links and
disconnects observation; pageshow cannot reactivate an exhausted document. The disposer also removes lifecycle listeners.

Statechart (XState-style): `inactive -> active -> paused -> active`, with
`active -> exhausted` after three unique document reservations. Private/off initialization stays inactive. Constrained networks suppress
speculative requests, but do not prevent manager loading or registration. Every request checks current
source, destination, connection, visibility and budget again. Reservations happen
synchronously before async work; failure does not refund them. Disposed is final.
This extends an existing read-only prediction adapter, not a new authoritative
write/money protocol; no new Quint or LemmaScript model is introduced.

## Verification and release

- PASS: focused inventory, URL-policy and fake-DOM adapter tests, including new
  links, deduplication, removal, fragment preservation and bfcache budget limits.
- PASS: production build, Astro check (zero errors/warnings, 16 hints), full lint
  and formatting; exact emitted client manifest plus final navigation tests
  passed 59 checks. Source-graph plus warmed model harness passed another 86 checks; current-head CI remains a separate gate.
- UNVERIFIED: a clean full-suite run on the final head. Initial full run passed
  13,906 tests with five failures: three timeouts, one R2 assertion and a missing
  model executable on PATH. Sequential isolated reruns passed all navigation,
  PDF/R2 and import-scan checks (279 tests); the model CLI passed its trace after
  correcting PATH, and the warmed harness subsequently passed; its first retry exceeded the existing timeout.
  No test timeout or backend behavior was changed to hide these failures.
- UNVERIFIED: new site-wide browser/audio-host QA, independent exact-head review,
  CI screenshots and live deployment. The earlier bounded rollout's browser
  evidence does not establish this expanded release or an iPhone speed benefit.
- PASS: purpose/content, SEO/sharing, visual design and native navigation markup
  remain unchanged. There are no new controls or style changes.
- PASS: privacy scope excludes authenticated/per-recipient documents, query
  strings and form submission. No new service, dependency or analytics collection.
- N/A: new form processing, legal agreement, payment or owner-center behavior.
- UNVERIFIED: performance advantage on real visitor devices; speculative requests
  are bounded overhead, not a promise of faster navigation.

Release only with green CI and independent exact-head review. The coordinator
owns browser/live checks and the final prelaunch record. Roll back by reverting
this isolated change, or disable `DEFAULT_PREFETCH_ENABLED` in the shared pure
policy. `?prefetch=off` remains a per-document comparison switch; diagnostics stay
query-only and ordinary visitors see no panel.
