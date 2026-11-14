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
pnpm run golden:neutral <fixture|--all> [<from> [<to>]] [--allow-renames <file>]
```

compares two revisions of a fixture (`<from>` defaults to `HEAD`, `<to>` to the working tree, `--all` runs every fixture)
and exits 0 only when every case that existed before is neutral. It prints the two commits it resolved, how many fixtures
and cases it compared, and refuses (exit 2) a fixture that exists in neither revision, a revision git cannot find, an
unknown flag, extra arguments, a malformed allow file, a run that compared no case, a record in a format it does not
understand (it knows formats 1 to 5; any other number, higher or not, on either side), and a format 4 or 5 record whose shape
is not complete (an outside effect without its `state` and sorted `touched`, a step without its `digest` and
`atResponse`, a missing `finalState` or change count, a `threw` that is not a message, a committed batch with no
`statements`, a name twice in `touched`): every case of both revisions is validated, added and removed ones included, and
recordings in formats 1 to 3 get no shape checks. A format 4 and a format 5 recording of the same case are NOT COMPARABLE
(exit 1, never NEUTRAL): the phase and the digest at the response mean something else, so re-record the earlier
revision's fixture with the later revision's harness before comparing. The message names the fixture, case, step or effect and the field,
and it is an error, never NEUTRAL, so a harness that stops recording a field cannot make every later comparison pass on
"missing against missing". For each case and each step,
these must be byte-identical before and after:

- the request, and the response: status, headers, every set-cookie value, and the body;
- what the step dumped of the databases, R2 and KV, and the final dump;
- the digests (see "Fixture format 4" below): a row count and SHA-256 of every table of both databases, and R2 and KV in
  full, after every step; both databases as they were when the response had been read; and both databases as they were at
  every outside effect, so a write to a table the case does not dump is seen, and so is the state that existed when each
  email or Stripe call went out;
- every effect that is not a D1 statement, in order, with its step and phase: outgoing HTTP (Stripe, Resend, Turnstile)
  with method, URL, headers and body, Workers AI calls, R2 and KV operations, `console.error` and `console.warn`,
  `waitUntil` registrations and how they settled, rate-limit calls, clock moves, interleave markers and trigger-hit
  markers (which operation and table an injected failure or interleave hit). Each outside effect carries the digest of
  both databases as they were when it happened.

Only the D1 entries may differ: SQL text, binds, how many statements, where the batches begin and end, and each
statement's result. The tool removes the D1 entries from both logs and requires what is left to be identical.

**Order against D1.** An email that was sent after the write and is now sent before it is a behaviour change, and the
digests catch it: each outside effect records the digest of both databases at that moment, so "mark as sent, then send"
and "send, then mark as sent" differ at the email even when the end state is the same. The digests cannot see a write that
changes nothing they hash (a same-value UPDATE) or a row that is inserted and deleted again (a lock held while an email
goes out), so each outside effect and the response also record the SET of tables whose rows had changed so far in the
step: table names only, no operation and no count. A table is in the set when a committed write changed a row of it,
whoever wrote it: the statement itself (taken when it reports a changed row, which includes a same-value UPDATE) or a
database trigger (found by comparing the digest of every table before and after each committed write). So a rule moved from
a trigger into code leaves the same state and the same set, and is neutral, when the trigger's write changes a row's
stored value. A trigger write that sets a value to what it already was, or changes a row and changes it back, leaves the
trigger's table OUT of the set (no digest moves, and the statement's own table is the other one), while the same write in
code puts it IN: that pair is reported NOT neutral, and so is the reverse move. It is a false alarm, in the safe direction:
the tool never calls such a pair neutral. SQLite also reports a foreign key cascade's write with no trigger name, so the
child table is counted as the statement's own table even when no child row changed (`ch.p REFERENCES p(id) ON DELETE
CASCADE`, then `DELETE FROM p WHERE id = 1` with no child rows gives `["ch", "p"]`); that only over-reports, the safe
direction, and no schema in this repository uses CASCADE or SET NULL today. What each mechanism catches:

- the step and final digests: any change to any table, R2 or KV by the end of a step or the case, including a write to a
  table the case does not dump, one more column set, a dropped background write, a changed AUTOINCREMENT counter or a
  changed KV expiry or metadata;
- the digests at every outside effect: a write that moved across an email, Stripe call, R2 or KV operation, AI call or
  console line, or a write that changed or was added before one;
- the digest at the response: a write that moved across the response boundary, even when the state at every effect is the
  same;
- the table sets at every effect and at the response: a same-value UPDATE moved across an effect, a lock row inserted and
  deleted again that moved wholly across an effect (it was held while the email went out, or no longer is), and a write
  to a table that moved across the response boundary, none of which change a digest;
- the trigger-hit markers: an injected failure or interleave that, after the conversion, hits another operation or table.

What is deliberately not compared, because a conversion may change it: the D1 statements themselves. So one UPDATE
replaced by a DELETE and an INSERT of the same row, an INSERT OR REPLACE, an upsert turned into an UPDATE, a statement
split into a read and a guarded write, and writes to different tables reordered between the same two effects are all
neutral: the state and the set of tables written at every effect are the same.

What is not seen, by design, and is a limit of this tool (besides the trigger case above): a write that changed no row, moved across an effect (it holds
no state and no table); an effect moved past a read only (a read changes nothing, so nothing differs at the effect);
where in time a write happened between two effects, or between the last effect and the end of the step; a write whose
effect on state is undone and whose table was already in the set; and the order of two writes to the same table between
the same two effects. A change count recorded as a number does not make a write that changes no row visible, because a
zero-row write is not a write to this tool.

Two more limits. A statement's own table comes from SQLite itself (the authorizer it calls while compiling the statement),
not from reading the SQL, so no spelling can hide it; the SQL text is read only to name what an injected failure or an
interleave hit (a write whose table cannot be read is an error there) and, with `GOLDEN_VERIFY_COUNTS`, to decide whether a
statement is a write (an unreadable one is taken as a write). And the digest cache relies on the fake D1 to report a
ROLLBACK or a failed statement: a harness hook that ran `ROLLBACK` on the raw handle after a mid-transaction digest would
leave the cache stale. `GOLDEN_VERIFY_DIGESTS`, which CI sets, computes every cached answer in full and fails on it.

**Cases.** An added case is listed and does not fail (it has no earlier record to compare). A removed case fails. A
renamed case is a removed case and an added one unless `--allow-renames` maps it (`{ "<fixture>": { "<old name>":
"<new name>" } }`). The map must be one to one: every source exists in the earlier revision and no longer exists in the
later one, every destination exists in the later revision and not in the earlier one, and no two sources share a
destination. A mapped pair is compared as one case and must itself be neutral. The rename file is checked in full
before anything runs, and a fixture named in it that is not compared is an error, in single-fixture and `--all` runs
alike.

The tool prints, per fixture, how many cases are identical, neutral with D1 changes, NOT neutral (each with the first
differing field and both values, shortened), NOT COMPARABLE, added, removed and renamed, then `golden:neutral: NEUTRAL`,
`golden:neutral: identical, N cases` or `NOT NEUTRAL`. Exit codes: 0 neutral, 1 not neutral (or not comparable), 2 usage
or read error. If a conversion needs a case's input changed, that is not a conversion: record
it as a fix.

**Fixture format 5** has the shape of format 4 below. What changed is the meaning of `phase` and of `atResponse` (see "What
is recorded"). `node scripts/golden-format-proof.mjs <from> [<to>]` proves the 4 to 5 re-record changed only the allowed
things: effects relabelled from `request` to `background` (never the other way), the digest `atResponse`, the `state` of
`waitUntil` entries, and the place of the lines a route writes itself among the effects; every other effect keeps its order,
content and state exactly.

The proof checks every changed digest at the response and every changed `waitUntil` state structurally, in each step that holds a relabel, from the later recording alone (the header of `scripts/golden-format-proof.mjs` lists the four rules and the limits). In short: the digest at the response, and its touched tables, equal those of the last request effect that carries a state, unless a request statement that changed rows is logged after it (then they are only bounded); a `waitUntil` entry that no request effect follows has the digest at the response as its state; the digest at the response differs from the end of the step exactly in the databases a relabelled statement wrote rows to (a hook that may have written is not checked either way); and the touched set at the response lies within the old recording's and within every later background effect's. The proof prints how many changed values each rule covers. What it does NOT prove is the value of the digest at the response: neither recording holds it, so that value is established by the snapshot tests in `tests/golden/harness/snapshot.test.ts`, which compute the expected digests from rows inserted by hand. Two more limits: the touched set at the end of a step is not recorded, and a same-value `UPDATE` changes no digest, so it would be rejected as a write that changed nothing (no real fixture has one).

**Fixture format 4.** Each case records `format: 4` (format 5 from the phase change on) and:

- on every outside effect (not a D1 statement or a harness marker), `state`: one SHA-256 per database as it was when the
  effect happened, and `touched`, the sorted names of the tables whose rows had changed so far in the step (by a
  committed statement, or by a trigger it fired). They are noted when the statement runs, and a batch's when it commits, so
  `state` and `touched` always describe the same instant, whatever order parallel calls settle in; a statement that fails
  part way (`UPDATE OR FAIL`) still notes the tables whose rows it changed, but only when a stored value changed (one whose
  only kept change wrote the same value notes nothing);
- after every step, `digest`: one SHA-256 per database, one for R2 and one for KV (with each key's expiry and metadata),
  and `atResponse`, the same as an effect's `state` taken when the response had been read, before any background work;
- at the end, `finalState`: for each database a digest over all its tables and, per table that holds rows, the row count
  and SHA-256 of its rows; R2 and KV in full;
- on every D1 statement, the real number of rows it changed (SQLite's `changes()`), whichever method ran it (`first`,
  `all`, `run`, `batch`), taken as the statement runs, so a call running beside another gets its own count;
- `trigger-hit` entries (see "Hooks for races and outages").

A table is read in primary key order (rowid order when it has none; `sqlite_sequence`, the AUTOINCREMENT counters, in name
order), starting with its column names, with every cell tagged from SQLite's `typeof()` (NULL, integer, real, text, blob;
an integer is read as text so a value above 2^53 keeps every digit). Two self-checks run in CI (`validate.yml` sets them for
`pnpm test`) and can be set locally: `GOLDEN_VERIFY_DIGESTS=1` computes every cached database digest in full as well, and
fails on a difference (the digest is not recomputed while SQLite's `total_changes()`, schema version and AUTOINCREMENT
counters have not moved); `GOLDEN_VERIFY_COUNTS=1` compares every RECORDED change count (the value written into the log, not an
intermediate one) with the difference in `total_changes()` measured around the statement, which is 0 for a read and exactly the count for a write on a table with no
trigger, foreign key action or REPLACE (on one that has them `total_changes()` also counts their writes, so the check is
that a row changed exactly when SQLite says rows changed); a count that was not measured is an error and never recorded
as 0. Both were run over every fixture when format 4 was recorded.
Formats cannot be compared with each other: the tool says NOT COMPARABLE and exits 1, because neutrality cannot be shown
across a format change. `node scripts/golden-format-proof.mjs <from> [<to>]` proves the format 3 to 4 re-record changed
only the allowed things (see its header): trigger-hit entries and the older digests are compared exactly, and a recorded
count may change only for a read that now says 0.

A recording from before format 4 (formats 1 to 3: no table sets, and in format 3 counts that could belong to another
statement) cannot show that an effect did not move across a write. So `golden:neutral` reports every case of such a
recording that has D1 entries and is not byte-identical as NOT COMPARABLE (exit 1, never NEUTRAL), whatever differs: a
changed response, a changed effect, or an email that moved across a write with its D1 entries unchanged. The tool still
prints where the first difference is. A case with no D1 entries at all (the older recorder's) is judged on what it records.

The three older recorder fixtures (contact, resume-request and resume-approve) stay on the older recorder. They use their
own record shape (`answers` and a flat effect list, without steps, effect kinds or digests) and have no D1 entries, so the
D1 rule above never applies to them. What `golden:neutral` can show for them: every response (status, headers, body) and
every KV operation and fetch, with its order, is identical between two revisions. What it cannot show: anything about a
database (these routes use KV and fetch only, so every state they change is a compared KV operation or fetch). Bringing
them onto this harness would rename every pre-existing field, so it cannot be shown to keep them.

**In CI.** The `Golden neutrality` workflow runs on every pull request, and again when a label is added or removed. It
compares the base branch tip (the first parent of the merge ref the job checks out) with the merge result, runs
`golden:neutral --all`, and writes the report to the job summary. It runs the BASE branch's copy of the tool and of every
local module the tool imports (a test derives that list from the tool's real import graph), extracted from the first parent, so a pull request cannot edit the tool and then pass with
it; it falls back to the pull request's own copy only when the base has none (the pull request that introduces the tool),
and prints which copy ran. Without the `conversion` label it only reports, since a behaviour fix changes fixtures on
purpose; it fails only on a usage or read error. A pull request that carries the `conversion` label fails unless every case
is neutral. The job also fails, labelled or not, when the tool did not run to completion (a module missing from the
extracted copy, a crash): it checks that the output ends in the tool's verdict line and that the line agrees with the exit
code, so a crash is never read as "not neutral".

Its limits, plainly: it is not a required status check unless the repository owner makes it one in the repository settings
(and a pull request can edit the workflow file itself, which only a required check from the base branch or a code owner
review prevents); it compares fixtures only, so a conversion's proof also needs the `validate` job green (the tests pass
against the recorded fixtures); a pull request with merge conflicts gets no run, because GitHub makes no merge ref for
it; and the label is applied by a person, so an unlabelled conversion is only reported.

**Fix and conversion are separate pull requests.** CI judges the whole pull request, so a behaviour fix and a conversion
never share one. Land the fix first: unlabelled, re-recorded in its own commit, with each changed case explained. Then
open the conversion with the `conversion` label, which must say NEUTRAL. There is no allowance for an effect whose state
differs: when a conversion changes the state at an effect for a harmless reason (an extra bookkeeping row before an email,
a write moved earlier), restructure the conversion so the state and the tables written at that effect are unchanged, or
land the change first as an explained fix and convert after it. The Golden neutrality summary of a fix lists exactly the
cases the fix is meant to change; reviewers read it. (A pull request that changes the fixture format has its own report
NOT COMPARABLE and is not a conversion.)

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

One ordered effect log per case. Each entry carries its `step` and a `phase`, which says **whether the response waited
for the effect**, not when it happened to start. `request`: the answer (status, headers and the whole body) could not have
been produced without the effect, or it cannot be told apart from work the answer waited for. `background`: the answer
had been produced and read while the effect had not yet begun (work handed to `ctx.waitUntil`, or left floating). The
digest `atResponse` is the state of the databases at that moment, so work the response did not wait for has not run in it.

**How the two phases are decided.** The harness uses a gate (`harness/settle.ts`, `EffectLog.start`). Every fake (fetch, D1,
KV, R2, AI, rate limits) waits at the gate before it does anything. The driver (`drive`) takes one real macrotask turn,
then looks at what waits. While the handler and the reading of its answer have not finished, whatever waits is released
as `request` and the loop goes round again. Once the answer has been read, whatever still waits, and whatever starts
later, is `background`, and runs after the digest `atResponse` is taken. A route that takes extra promise turns (an
`Effect.runPromise` wrapper, say) records the same phases and order. Entries are kept in the order the effects finish,
except that a line a route writes itself (`console`, `waitUntil`) sits after the effects released before it and before
those released after it. Work that is neither awaited nor handed to `waitUntil` is `background`, and still runs and is
recorded before the next step; in the last step of a case it is recorded before the case ends, the same as in any other step. A rejecting handler is answered "rejected", and what it deferred is `background`.

**Tracked work is delivered in the order it started.** Work that leaves the microtask queue takes a place in a delivery
order when it starts (`harness/sequencer.ts`), and the route receives its result only when the driver hands that place
over:

- WebCrypto `digest`, `sign`, `verify`, `encrypt`, `decrypt` and `deriveBits` (`harness/determinism.ts`, `trackAsyncWork`).
- `setImmediate`, which Effect's scheduler uses to yield (it reads the global each time it schedules). A `clearImmediate`
  gives its place back without a callback.

A result that finishes early waits behind the older work. The driver waits for the oldest place to finish, hands it over
at a driver turn, and only then looks at the gate and at timers. So what a route does next (which timer it creates, which
effect it starts) follows from the route's structure, not from which digest the machine finished first. That is what makes
a label the same on every run and under load. Two consequences are part of the rule:

- A `setImmediate` loop that waits for effects is released after `POLL_LIMIT` (100) yields in a row with effects at the
  gate and no threaded work undelivered: the route is waiting for those effects, so they are released as `request`. A
  route that yields fewer times (Effect yields every 2,048 operations, so a 3,000-step flow yields about once) keeps its
  deferred work `background`.
- The count is exact, so the threshold is the same on every machine. After a `waitUntil` write, 99 `setImmediate` yields
  leave the write `background`, and 100 or more make it `request` (`threads.test.ts`, "the yield threshold"). Effect
  yields every 2,048 operations, so an `Effect.forEach` of about 205,000 operations (100 times 2,048 is 204,800) after
  `waitUntil` makes the deferred write `request`. This is one more form of the known limit below: a route that keeps
  working after `waitUntil` may have its deferred work labelled `request`. Call `waitUntil` last.
- A route that yields more than `YIELD_LIMIT` (50,000) times in a row without an answer or an effect is a harness error.

**Faked route timers.** `setTimeout` is faked for every case. Under virtual timers (`vi.useFakeTimers`) the frozen clock
fires them. Otherwise a route's timer is queued, and the driver fires the next queued timer (in order of due time) only when
no tracked work is undelivered and nothing else can make progress. A timer never fires because real time has passed.

**Errors, not labels.** Two cases are real-time limits, and both are errors that name the case and step, never a label:
a handler that nothing can move (nothing in flight, nothing waiting, no timer queued) fails after `STUCK_MS` (2 seconds),
and tracked work that never finishes fails after `IN_FLIGHT_MS` (30 seconds). A harness error is not an answer: it is not
turned into a "rejected" response.

**Effect runtimes.** A conversion onto an Effect runtime records the same phases as the plain route for the yields
`phases.test.ts` covers ("macrotask yields change nothing"): `Effect.yieldNow`, a `setImmediate` yield, and the scheduler's
automatic yield after 2,048 operations (a 3,000-step flow, before the return and inside deferred work). `threads.test.ts`
pins a `setImmediate` yield at several sizes of work, and fails if that tracking is removed.

**Not observed.** A route that depends on one of these can record a different phase than it would in production:

- Blob and compressed stream answers. Node runs macrotasks inside the read of a Blob body or a `CompressionStream` output,
  and the harness cannot see them. Tracking the read as in flight holds the gate shut against a stream that reads an
  effect (the stream test in `phases.test.ts`), so this is a limit, and the phase of deferred work behind such an answer
  is NOT guaranteed. The tests for these answers assert only that the case terminates, the answer is recorded, and every
  effect is recorded once with a valid phase and the same content as a string answer. No current route is affected: the
  only route that streams its body (the file download, `src/pages/api/studio/projects/[id]/files/[fileId].ts`) never
  calls `waitUntil`, and no route returns a Blob or stream body and also calls `waitUntil`.
- `timers/promises` (`setImmediate` and `setTimeout` from `node:timers/promises`) go through Node's own timers, not the
  globals, so they are not tracked. No route uses them. The phase of deferred work behind such a yield is NOT guaranteed;
  the test (`phases.test.ts`, "timers/promises: terminates") asserts termination and one entry per effect only.
- Request bodies that a handler reads (`request.json()`, a stream body). Their reads are not tracked. The golden routes
  read string and JSON bodies; that they read without a macrotask has not been proven, so the stability of a phase after such
  a read rests on the repeated runs (the suite is run several times, see docs/verification.md), not on a guarantee.
- Key operations other than the cipher and digest calls: `importKey`, `exportKey`, `deriveKey`, `wrapKey` and `unwrapKey`
  are not wrapped. The harness's own `generateKey` fake calls `importKey`. A probe that imported and exported a key after
  `waitUntil` recorded the same phases, but a probe is not a proof.
- `MessageChannel` and `MessagePort`, and `setInterval`: no route in `src/` uses them, and the Effect scheduler on this
  path does not. `queueMicrotask` is a microtask and needs nothing. A new use must be wrapped before a route relies on it.

**Known limit.** A route that calls `waitUntil` and then keeps awaiting other work does not separate the deferred work from
the answer. Deferred work still undelivered while the awaited work runs is `request`, because the response is still
waiting. This is decided by the route's structure: how many awaited steps follow the `waitUntil` call, and the same in every
run (`threads.test.ts`, "work in both paths", records the same labels at every size and timer count). So call `waitUntil`
last, and keep the deferred work to one step. Work that is started and not awaited, while the route awaits something else,
is `request` for the same reason.

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
