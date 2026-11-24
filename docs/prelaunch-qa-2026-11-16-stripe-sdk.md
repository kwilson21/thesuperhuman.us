# Stripe SDK 23, existing invoice API contract

Scope: update Stripe Node 22.6.2 to 23.1.0, not the external API contract.
The old SDK used `2026-08-26.dahlia`; the new SDK defaults to
`2026-10-28.endive`. Both invoice adapters now use the supported per-request
`RequestOptions.apiVersion` override to retain Dahlia on all ten reviewed SDK network call sites.
No casts, type suppression, account changes, feature activation, new webhook
endpoint or real transaction. Existing idempotency keys and golden fixtures stay
unchanged. Main integration includes #343, #346, #348 and #349.

## Compatibility evidence

- One factory and ten network call sites: customer creation, invoice creation,
  invoice-item creation, finalization and send in each audio/software adapter.
  All use the shared typed options helper. The only other client operation is
  local signature verification, which makes no HTTP request and does not change
  the configured webhook endpoint's snapshot API version.
- The SDK's public `RequestOptions.apiVersion` is a string. Its constructor's
  version option is latest-version-only; no suppression is used to bypass that.
- Compared 27 consumed request/response fields in the installed old/new generated
  declarations. Their signatures and optionality are unchanged. The shared
  endpoint/response subset does not use the removed Endive fields.
- New wire-level tests run both adapters through the real SDK against local fake
  fetch. All six requests (including an invoice-create 503 retry) must retain
  the exact Dahlia header, the existing explicit idempotency keys, a stable key
  on retry and distinct keys between operations.
- An architecture regression scans runtime JS/TS/JSX/TSX/MTS/CTS/MJS/CJS sources and compiler-converted
  Astro frontmatter, server template expressions and scripts, inventorying SDK constructors/consumers and all ten
  calls, rejecting unpinned calls and client aliases that leave that inventory.
  Static asset globs use the existing source-graph resolver; runtime-module
  matches and unresolved glob patterns are rejected. String-named factory
  import/re-export aliases are rejected too. Canonical shared module resolution
  covers alias dot segments; local executable imports outside the scanned src
  boundary and escaping CommonJS loader values are rejected. New SDK use requires updating this
  scoped guard and its wire tests. This is
  a source-level SDK regression guard, not a general sandbox or network security
  boundary. Static Stripe API hostname literals are rejected to catch common
  direct REST transports, including constants, URL/Request constructors and
  template prefixes and literal-only concatenation/template folding. Package
  imports-map names are inspected as well as resolved files. Arbitrarily assembled
  runtime destinations are not proven safe by this syntax check. Known static
  limitations: TypeScript `as`/`satisfies`/non-null wrappers are not folded;
  percent-encoded or Unicode-dot URL hostnames are not canonicalized; npm package
  aliases are not resolved to their installed package identity. These forms are
  not part of the reviewed production Stripe integration. The current manifest
  has no package imports map or npm aliases; the only runtime SDK imports are
  the reviewed invoice factory and error classifier. No direct Stripe REST
  transport was found. Introducing any alternative transport or package identity
  requires a new contract review; this test is not proof that future code cannot
  bypass the reviewed integration.
- Stripe 23 draws transport UUIDs eagerly. The golden harness separates that
  test-only entropy from application IDs and restores it after each case; the
  real SDK and fetch behavior still run. No recorded fixtures were rewritten.

## Deployment checklist disposition

- Scope, ownership and rollback: PASS. Dependency-only SDK upgrade plus contract
  preservation; rollback is the previous main revision. No data migrations.
- Content, SEO, responsive design, accessibility, media and legal copy: N/A,
  unchanged by this server-only dependency scope.
- Forms/sensitive flows: local regressions cover invoice and signed-webhook
  behavior, idempotency and retries. No live transaction or delivery claimed.
- Privacy/security: no credentials or customer records used; dummy test inputs
  only. No external settings, accounts or webhook registrations changed.
- Performance/client bundles: final-head CI build and browser-boundary checks
  remain required; no intentional browser dependency change.
- Quality/release: focused tests and independent review are recorded in the PR;
  final exact-head CI must be green before merge.
- External verification: UNVERIFIED. Stripe connector requires reauthentication;
  no sandbox or live API check was performed. This SDK-only upgrade retains the
  already-used API version, rather than claiming an Endive migration pass.
- Post-deploy smoke/monitoring: pending merge; verify the deployment separately.

A future Endive API migration still needs authorized sandbox invoice and webhook
verification. Read-only requests or fake responses cannot prove create/finalize/
send behavior. See [Stripe versioning](https://docs.stripe.com/api/versioning),
[SDK upgrade guidance](https://docs.stripe.com/upgrades) and
[webhook versioning](https://docs.stripe.com/webhooks/versioning).
