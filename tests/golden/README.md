# Golden corpus

A golden corpus proves that a route behaves the same after it is converted to Effect. It is a table of requests run
against the route as it is now. For each request the test records the status, headers, exact body and every outside
effect the route makes, in order. The record is saved as a compressed JSON fixture (`tests/golden/fixtures/<route>.json.gz`) and committed. After the conversion the same test
must pass with the fixture untouched.

Three older routes (contact, resume-request, resume-approve) use `recorder.ts`. Everything else uses `harness/`. The
worked example is `owner-request-status.test.ts` (POST /api/owner/requests/[id]); copy its shape.

## The rule

A fixture is recorded from the OLD code and never edited to make a conversion pass. If a converted route differs from its
fixture, the route is wrong. The one exception is a real bug fix agreed with the owner, made on the old code first, then
re-recorded in its own commit that says so.

Re-record only with `UPDATE_GOLDEN=1`, and only one file at a time:

```
UPDATE_GOLDEN=1 pnpm exec vitest run tests/golden/<route>.test.ts
```

A plain `pnpm test` compares and never writes. Always `git diff` the fixtures after re-recording, and check the other
golden fixtures did not change.

## Reviewing a fixture change

A fixture is gzip-compressed (`.json.gz`, marked `binary` in `.gitattributes`), so GitHub and `git diff` show only that
the file changed. Compression is deterministic (fixed level, no timestamp, no name), so re-recording unchanged behaviour
leaves the file byte for byte the same, and any byte change in the file is a change in what was recorded. Read it with:

```
pnpm run golden:diff <fixture> [<from> [<to>]]   # differing cases between two git revisions
pnpm run golden:show <fixture> [<case name>]     # list the cases of a fixture, or print one in full
```

`golden:diff` defaults to `HEAD` against the working tree; `<from>` and `<to>` are any revisions, for example
`golden:diff contact origin/main HEAD`. It prints each added, removed or changed case with the path of every difference
and the two values. Paste its output in the PR description of an intended fixture change. A failing comparison in a test
prints the differing case in the same way (name, first differing path, expected and actual).

## Adding a corpus

1. List the route's response branches (every `return`, every `throw`, every status) and the branches of the library
   functions it calls. Write the list as a comment at the top of the test, mapping each branch to the cases that reach it.
2. Write `tests/golden/<route>.test.ts` with a `cases: Case[]` table and `defineCorpus("<route>", HANDLER, cases)`.
3. Run it once with `UPDATE_GOLDEN=1`, read every recorded case (status, body, effects) and check it reached the branch
   you meant. Commit the fixture.
4. Run it twice more without `UPDATE_GOLDEN`. It must pass.

Minimums: at least 25 cases for a simple route, at least 40 for a stateful, payment or signing route. Together the cases
must cover every response branch in the handler. Include: not owner (403), missing bindings (503), malformed and invalid
bodies (400), unknown id (404), each state a transition can start from, stale `expectedUpdatedAt`, lost races, outages of
each binding the route uses, and multi-step sequences.

## The case table

```ts
const cases: Case[] = [
	{
		name: "review a new request",            // unique within the area; it is the fixture key
		music: { seed: { owner_requests: [rows.ownerRequest("r1", { status: "new" })] } },
		steps: [
			{
				as: asOwner(),                     // asVisitor(), asClient(email), asClientCookie(token)
				path: "/api/owner/requests/r1",
				params: { id: "r1" },
				json: { action: "review" },        // or body: "{bad" for raw text
				advanceMs: 60_000,                 // move the clock before this request
				dump: { music: ["owner_requests", "owner_request_audit"] },
			},
		],
	},
];
```

Case members: `music`, `publication` (`{ seed?, missing? }`), `r2` (`seed`, `uploads`, `fails`, `missing`), `kv` (`RATE_LIMIT`,
`RESUME_STORE`, `OAUTH_KV`: `seed`, `fails`, `missing`), `fetches` (a responder; use `byHost`), `ai` (scripted answers),
`rateLimits`, `env` and `omit` (add or remove env text members), `noContext` (no `ctx`), `interleave` and `failures` (see
below), `setup` (code that seeds, off the record) and `final` (what to dump after the last step).

Step members: `as`, `handler` (a different handler for this step, to cross routes), `method` (default POST), `path`, `params`,
`json` or `body`, `headers`, `advanceMs`, `before` (a labelled hook that runs just before the request) and `dump`.

Seed rows by table, with `seed: { table: [{ column: value }] }`. `harness/rows.ts` has builders with fixed defaults for an
owner request, a software offer, link, project and invoice, and a signed agreement with its template and client. Add to
it when a second corpus needs another table, rather than writing the defaults again. Databases get the real schema
(`db/music.sql`, and `migrations/publication`), and foreign keys are enforced.

## What is recorded

One ordered effect log per case. Each entry carries its `step` and a `phase`: `request` while the handler runs and
until its response body is read, `background` after (work handed to `ctx.waitUntil` that is still running, awaited
before the case ends). "Background" means what can be observed: work a route starts before it returns shows as `request`.

- D1: each executed statement (`first`, `all`, `run`) with the SQL exactly as prepared, bound arguments, database, and
  result shape (row count, `meta.changes`, or the error). A `batch` is one entry with its statements in order and
  `committed`, `rolled-back` or `injected-failure`. Bytes arguments are recorded as length and SHA-256.
- R2: `get`, `head`, `put`, `delete`, `list`, `createMultipartUpload`, `resumeMultipartUpload`, `uploadPart`, `complete`,
  `abort`, with keys, options and body length and SHA-256. Never raw bytes.
- KV: `get` (text, `json`, `arrayBuffer`, `stream`), `put`, `delete`, `list`. A key put with `expirationTtl` or `expiration`
  (or seeded as `{ value, expirationTtl }`) reads as absent once the frozen clock passes it, and leaves `list` and the dump.
- `console.error` and `console.warn` calls (not printed), in order, with each argument recorded; an Error as `Name: message`.
- Outgoing `fetch` (Stripe, Resend, Turnstile and others): URL, method, headers, exact body text, whether it had an abort
  signal, and what the script answered.
- Workers AI `env.AI.run` (model, input), rate-limit `limit()` calls, `ctx.waitUntil` registrations and how each settled.
- Clock moves from `advanceMs` or `world.advance`.
- Per step: status, all headers sorted, every `set-cookie` value in order, and the body. A text body is recorded in
  full; a binary body as length and SHA-256. Streams are read to the end. A handler that throws is `rejected`.
- With `dump` or `final`: the rows of the tables you name, in insertion order, and R2 and KV contents.

The test run pins `TZ=UTC` (`test.env` in `vitest.config.ts`), as production Workers run, so a date string with no zone is read the same on every machine. `harness/zone.test.ts` checks the pin.

Time and randomness are fixed per case: `Date`, `performance.now`, `crypto.randomUUID` (a hex counter),
`crypto.getRandomValues` and `Math.random` (seeded). Two runs write identical fixtures.

## More of what a case can say

- A step's `path`, `json`, `body` and `headers` may be functions of what is recorded so far:
  ``path: (prior) => `/x/${prior.answerJson(0).id}` ``, or read `prior.effects` (a sign-in code from a recorded email).
  The resolved value is what the fixture holds.
- `body` may be text, a `Uint8Array`, `generatedBody(size, byteAt?)` or a `ReadableStream`. Bytes, and text over 64 KB
  (a JSON body counts), are recorded as length and SHA-256.
- `origin` (on the case or a step) sets the scheme and host: `"http://localhost:4321"`, `"https://audio.thesuperhuman.us"`.
- R2: `uploads: { id: { key, parts: { 1: "text" } } }` seeds a started multipart upload with uploaded parts. An upload
  that no longer exists fails with R2's error 10024 (the text `multipartUploadGone` matches). `vanishAfterHead: [key]` removes
  an object right after a `head`, so the next `get` finds nothing.
- Workers AI: `aiNever()` and `aiAfter(ms, value)`. A case with either runs `setTimeout` on the frozen clock (or set
  `virtualTimers: true`): while the handler waits, the runner moves the clock to the next timer and records the move as an
  `advance`, so a route's own timeout is recorded without waiting for it.
- `crypto.subtle.generateKey` answers a fixed key (AES and HMAC; another type fails with its name).
- `astro:content` resolves, in all tests, to `tests/helpers/astro-content.ts`, which reads the real collections.

## What is redacted

In outgoing requests the `authorization`, `stripe-signature` and `cookie` header values are written as `[redacted]`
(the header is still recorded, so a missing one shows). `user-agent`, `x-stripe-client-user-agent`,
`x-stripe-client-telemetry` and `stripe-version` are written as `[machine-specific]` because the Stripe SDK sets them
from its own version and the machine. Everything else, including `idempotency-key` and the form-encoded or JSON body,
is exact.

## Stripe

`stripeClient(env)` builds the SDK with `Stripe.createFetchHttpClient()`, which uses the global `fetch` present when the
client is built. The harness stubs the global `fetch`, so the real SDK runs and its requests are recorded and answered by
your script (`fetches: byHost({ stripe: json(200, { id: "cus_1" }) })`). No module mock is needed. Note the SDK retries
a 5xx or a network error twice with real waits (about one second); the retries are recorded as extra fetches. For a
webhook, `signStripeWebhook(payload, secret, at?)` makes a valid `stripe-signature` for the frozen clock.

## Hooks for races and outages

`interleave: [{ on: /UPDATE owner_requests SET status/, label, run: (sqlite) => sqlite.exec("...") }]` runs raw SQL on the
database just before the n-th statement (or batch containing a statement) that matches. Use it for a branch only a race
reaches, such as a row changing between a pre-check and the batch. `failures: [{ on: /.../, message }]` makes the n-th
matching statement or batch throw without running. Both are written into the log, so the fixture shows them. R2 and KV
`fails` make a named operation reject.

## Signing in a client

`asClient("a@example.test")` runs the real studio sign-in before that client's first step: it calls
`POST /api/studio/code`, reads the code from the email Resend is asked to send, calls `POST /api/studio/session` and keeps
the `studio_session` cookie. It is off the record, but its database writes (code, session, audit, allowance rows) are real.
The email needs an active project in the seed (a `service` owner request gets one automatically). Each distinct client
signs in with values of its own, so two clients in one case get two sessions. The sign-in does not fire `failures` or
`interleave` hooks and does not count their matches.

## What a corpus cannot capture yet

Middleware (Cloudflare Access verification, security headers, the agreement host check) is not run; `asOwner()` sets
`locals.owner` as middleware would. `first("column")`, `raw()` and `exec()` on D1 throw so a route that uses them is
noticed. A `FormData` fetch body throws. Cookies set through Astro's `context.cookies` are not modelled (no API route
uses them). Effects that interleave between a route's background work and its response are ordered by one deterministic
run, not by real concurrency.
