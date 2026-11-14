# Golden corpus

A golden corpus proves that a route behaves the same after it is converted to Effect. It is a table of requests run
against the route as it is now. For each request the test records the status, headers, exact body and every outside
effect the route makes, in order. The record is saved as a compressed JSON fixture (`tests/golden/fixtures/<route>.json.gz`) and committed. After the conversion the same test
must pass with the fixture untouched, or, when the conversion only changes D1 statements, with a fixture that
`pnpm run golden:neutral` shows is neutral (see "A conversion is neutral when").

Three older routes (contact, resume-request, resume-approve) use `recorder.ts`. Everything else uses `harness/`. The
worked example is `owner-request-status.test.ts` (POST /api/owner/requests/[id]); copy its shape.

## The rule

A fixture is recorded from the OLD code, and a converted route that differs from it is wrong unless one of two things is
true. Each is its own commit.

1. A behaviour FIX agreed with the owner. Make it on the old code first, then re-record in a commit that says so, with a
   per-case explanation of every case whose outcome changed.
2. A behaviour-NEUTRAL conversion (a rule moved out of SQL into TypeScript, with SQL keeping only the compare-and-set
   guard). Its D1 statements change, so the fixture changes, and the re-record is allowed only when
   `pnpm run golden:neutral` passes between the fixture before the commit and the fixture after it. Re-record in a commit
   of its own that holds no fix and no other change, and paste the tool's output in the PR description.

Never edit a fixture by hand, and never re-record to make a failing test pass when the tool says the change is not
neutral: the route is wrong.

Re-record only with `UPDATE_GOLDEN=1`, and only one file at a time:

```
UPDATE_GOLDEN=1 pnpm exec vitest run tests/golden/<route>.test.ts
```

A plain `pnpm test` compares and never writes. Always `git diff` the fixtures after re-recording, and check the other
golden fixtures did not change.

## A conversion is neutral when

```
pnpm run golden:neutral <fixture|--all> [<from> [<to>]] [--allow-renames <file>] [--allow-positions <file>]
```

compares two revisions of a fixture (`<from>` defaults to `HEAD`, `<to>` to the working tree, `--all` runs every fixture)
and exits 0 only when every case that existed before is neutral. It prints the two commits it resolved, how many fixtures
and cases it compared, and refuses (exit 2) a fixture that exists in neither revision, a revision git cannot find, an
unknown flag, extra arguments, a malformed allow file, and a run that compared no case. For each case and each step,
these must be byte-identical before and after:

- the request, and the response: status, headers, every set-cookie value, and the body;
- what the step dumped of the databases, R2 and KV, and the final dump;
- the digests (see "Fixture format 2" below): after every step and at the end, a row count and SHA-256 of every table of
  both databases, and the contents of R2 and KV, so a write to a table the case does not dump is seen;
- every effect that is not a D1 statement, in order, with its step and phase: outgoing HTTP (Stripe, Resend, Turnstile)
  with method, URL, headers and body, Workers AI calls, R2 and KV operations, `console.error` and `console.warn`,
  `waitUntil` registrations and how they settled, rate-limit calls, clock moves, interleave markers and trigger-hit
  markers (which operation and table an injected failure or interleave hit).

Only the D1 entries may differ: SQL text, binds, how many statements, where the batches begin and end, and each
statement's result. The tool removes the D1 entries from both logs and requires what is left to be identical.

**Order against D1.** An email that was sent after the write and is now sent before it is a behaviour change, so the
tool checks what state existed when each outside effect happened. Only a committed write that changed at least one row
counts: a read, a write that changed no row, a statement that threw and a batch that did not commit are ignored, so a
conversion may split one statement into a read and a guarded write. Each such write is read as (operation, table, phase),
for example `UPDATE owner_requests request`. Two checks follow, and a difference in either FAILS the run:

1. For every outside effect, the writes that came before it in its step, as a multiset: which tables had been changed, by
   which operation, in which phase, and how many times, but not in what order, so writes to different tables that sit
   between the same two effects may be reordered. (`--ordered` makes the order count too; on every re-record in this
   repository's history it gave the same result.)
2. For every step, all its writes with their phase, so a write that moved across the response boundary (from `request` to
   `background` or back) is caught.

A failure is listed with the effect it concerns (`step 0: fetch POST https://api.resend.com/emails #1`, numbered when an
effect repeats; the per-step check is `step 0: writes by phase`). It passes only when that exact effect is named, with a
reason, in the file given to `--allow-positions`: `{ "<fixture>": { "<case name, after the conversion>": { "<effect>":
"<reason>" } } }`. One entry covers one effect. What this does not see: a write that changed no row, the order of writes
within one effect's window, what the written values were (the digests see that), and a write whose SQL the reader cannot
attribute to a table (that is an error, not a pass).

**Cases.** An added case is listed and does not fail (it has no earlier record to compare). A removed case fails. A
renamed case is a removed case and an added one unless `--allow-renames` maps it (`{ "<fixture>": { "<old name>":
"<new name>" } }`). The map must be one to one: every source exists in the earlier revision and no longer exists in the
later one, every destination exists in the later revision and not in the earlier one, and no two sources share a
destination. A mapped pair is compared as one case and must itself be neutral. Both allow files are checked in full
before anything runs: a fixture or case or effect named in either that matches nothing actually compared is an error or a
failure, in single-fixture and `--all` runs alike, so an allowance cannot go stale.

The tool prints, per fixture, how many cases are identical, neutral with D1 changes, NOT neutral (each with the first
differing field and both values, shortened), NOT COMPARABLE, added, removed and renamed, then `golden:neutral: NEUTRAL`,
`golden:neutral: identical, N cases` or `NOT NEUTRAL`. Exit codes: 0 neutral, 1 not neutral (or not comparable), 2 usage
or read error. Judgement calls: a write is recognised from the SQL text (its first keyword, or the statement a `WITH`
ends in) and attributed to its table (INSERT INTO, UPDATE, DELETE FROM); a write run through `first()` or `all()` (with
RETURNING) counts when it returned a row. If a conversion needs a case's input changed, that is not a conversion: record
it as a fix.

**Fixture format 2.** Each case records `format: 2`, a `digest` after every step (one SHA-256 per database, one for R2 and
one for KV), and at the end a `finalState`: for each database a digest over all its tables and, per table that holds rows,
the row count and SHA-256 of its rows (read in primary key order, or rowid order for a table without one, all columns,
with a type tag for NULL, numbers, text and blobs); R2 and KV in full (keys with size and digest). A fixture from before
format 2 (no `format` field) cannot be compared with a format 2 one: the digests exist on one side only, so the tool says
NOT COMPARABLE and exits 1, because neutrality cannot be shown across the change. The three older recorder fixtures
(contact, resume-request and resume-approve) have no database and stay as they are. `pnpm exec node
scripts/golden-format-proof.mjs <from> [<to>]` proves a format change only added fields.

**In CI.** On a pull request, the `validate` workflow runs `golden:neutral --all` between the merge base and the head and
writes the result to the job summary. It never fails the job for a result that is not neutral, because a behaviour fix
legitimately changes fixtures, but it fails on a usage or read error (exit 2). Reviewers read that summary: a conversion
pull request's summary must say NEUTRAL, and a fix's must list exactly the cases the fix is meant to change.

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

A declared trigger that never fires fails the case, when recording and when checking, with a message naming it and its
pattern (`d1 failure on /UPDATE .../ (seen 0 times, declared 1)`). A trigger that fires more often than declared: an `nth`
trigger fires once, on its n-th match, so it cannot; R2, KV, fetch and AI failures fire on every matching call by design.
A control that proves a statement is never reached lists its trigger in `mustNotFire: [{ trigger, reason }]`, and the case
fails if it does fire. The triggers are: each `failures` and `interleave`
entry (which must match `nth` times), each R2 and KV `fails` entry, each `byHost` fetch answer that throws, and each AI
answer that throws or never answers (a hand-written responder declares nothing). Without this a conversion that changes
the SQL a hook matches would leave a case recording the happy path under the name of an outage or a race. A trigger
that may legitimately stay quiet is listed in the case's `optionalTriggers: [{ trigger: "<the text the failure message
prints>", reason: "..." }]`; an entry with no reason, or one that matches no trigger, fails too. Each time a D1 failure
or interleave fires, the log gets a `trigger-hit` entry naming the operation, table and access (read or write) of the
statement it hit, never its SQL, so after a conversion a trigger that hits a different table or a read shows up as a
non-neutral difference. Work done off the record (sign-in, `setup`, hooks) never counts as a firing.

Every generated case has a 20 second time limit (`CASE_TIMEOUT_MS`, set once in `defineCorpus`), because cases that render
PDFs come close to the 5 second default when several suites run at once.

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
