# Effect stack, pull request 12 and the publication area: release gate

Two things are gated: branch A (behavior fixes to the publication routes) and branch B (the conversion of those routes to rules, flows and services).

Date: November 14, 2026
Repository: the personal website repository
Branches: A is `claude/effect-12-publication-fixes`, cut from `origin/main` at `3561a541` (the merge of #273); B is `claude/effect-12-publication`, cut from A.
Pull requests: not opened by the builder (the coordinator delivers).
Target: production
Reviewer: both branches were written by a Claude Sonnet 5.5 builder subagent working from a brief (tests first, per the owner's 2026-10-12 exception). Independent review is the coordinator's step; none has run on these heads. UNVERIFIED: Codex and Greptile review.
Rollback revision: for A, `3561a541`; for B, A's tip. Re-check `origin/main` with `git fetch` before merge. No deployed revision was observed by the builder.

## Scope

Routes: `POST` and `GET /api/work-feed` (the bearer-token receiver and the public feed), the OAuth and MCP route `/api/publication/[...path]` with its twin `/.well-known/[...path]` (OAuth metadata), and `/api/mcp-probe`. Database: `PUBLICATION_DB` (`publication_events`; `publication_outbox` is private and only a trigger writes it). The website pages that show a project's feed read the same journal through `websiteFeed`.

1. Branch A, behavior fixes:
   - An unexpected database failure on the work feed answered 503 through a catch-all (read and delivery). It now answers 500 with the route's fixed sentence ("Updates unavailable." and "Delivery pending. Retry the same event.") and never the error's text. A stored story that does not read as a publication, which also failed the read with 503, is a fault of the site's data and answers 500 the same way. A missing binding stays a deliberate 503.
   - The OAuth route turned every failure of the OAuth library (its KV namespace, a failed registration write) into 503 through a catch-all. It now answers 500 with its fixed sentence ("Publication connection unavailable."). A missing binding or secret stays 503.
   - The publication sign-in handler answered 400 ("Sign-in could not be completed...") for everything, so a visitor was told to start again when the fault was the site's. Now: a KV failure while the OAuth library looks up the client or stores the grant is 500; a cookie key that is not a usable key is 500; GitHub unreachable, answering 5xx or answering something that is not JSON during the code exchange or the user lookup is 503; a refusal of the request itself (unknown client, unregistered redirect, a bad cookie, a wrong nonce, GitHub refusing the code, a different GitHub account, an expired sign-in) stays 400. The 500 and 503 bodies use the route's existing sentence ("Publication connection unavailable."); no new copy. Review round 1 refined it: a non-JSON 4xx from GitHub other than 429 (an HTML refusal page) is GitHub refusing our request, so it answers 400 as a JSON refusal does; unreachable, 5xx, 429 and a non-JSON success stay 503.
   - A client id, authorization code or refresh token too long to be a KV key (KV refuses a key over 512 bytes, and the OAuth library builds keys from these values) made KV fail and the new mapping answer 500, where main answered 400 on `/authorize`. Any such value over 256 bytes is now replaced with a stub no credential equals before the request reaches the library, so the library refuses it with its own answer (`/authorize`: the existing 400; `/token`: `invalid_grant` 400 "Invalid authorization code format" or "Invalid token format", or `invalid_client` 401 "Client not found"; a Basic header over 1,024 characters likewise). The library's key construction was read: `client:<client id>`, `grant:<user id>:<grant id>` (both parts come from the code or refresh token a visitor sends) and `token:<user id>:<grant id>:<token id>` (an access token; the library already answers an over-long bearer token `invalid_token` 401 on its own).
2. Branch B, the conversion: no behavior change (shown by `golden:neutral`). Input is read with Effect Schema (`src/lib/publication/contract.ts`; the hand-written envelope validator is frozen and held to it by a differential test). Decisions are pure rules in `src/server/rules/` (`publication-commit.ts`, `publication-feed.ts`, `publication-access.ts`, `publication-token.ts`, `publication-login.ts`); the sequences are flows in `src/server/flows/`; storage is `src/server/publication-store.ts`; the OAuth grant store and GitHub are services (`src/server/publication-services.ts`). It adds the Quint model `verification/publication-journal.qnt`.

## Zod and the MCP SDK (the brief and CLAUDE.md differ)

The brief says Zod leaves the area completely. CLAUDE.md and AGENTS.md (owner decision) say Zod remains in `src/lib/publication/mcp.ts` and `src/pages/api/mcp-probe.ts` where the MCP SDK requires it. The SDK builds the tool list's JSON Schema and its `-32602` messages from Zod, and both are recorded byte for byte in the corpus, so the two tools' declared inputs stay Zod and nothing else does. Both files say so. The envelope the tool receives is read again as a publication by the Effect Schema reader before it is used, as before.

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; one area at a time; no behavior change in a conversion.
- Owner, 2026-11-14 (relayed in the task): fix every finding without asking, choosing the cautious behavior; an unexpected database, KV or R2 failure answers 500 with the route's fixed sentence; a lost race or stale version is 409; a missing binding or a known unavailable dependency is 503.
- The owner's private findings list has nothing for these routes. Every fix on A comes from reading the routes.

## Where the protocol wins over the standing rules (the builder's judgment, for the owner to confirm)

- MCP tools answer in the protocol's shape: HTTP 200 with a JSON-RPC result whose text holds `{status: ...}`. An unexpected failure is `unavailable` (read) or `pending` (delivery, retry the same envelope), as `docs/publication-agent-protocol.md` tells the agent. The 500 rule does not apply to a tool result; the HTTP answer is always 200. Unchanged on A and B.
- The OAuth library's own answers (`invalid_grant`, `invalid_client`, `invalid_request` and the rest, with their statuses and JSON) are produced by `@cloudflare/workers-oauth-provider` and pass through untouched. The site's code never turns one into another status.
- The work feed's `409 {"status":"conflict"}` (stale revision, event id reused, an entry that is not what the operation needs), `410 {"status":"withdrawn"}` and `400 {"status":"rejected"}` are the receiver's documented answers and are unchanged. After three guarded tries that all find the revision taken, the answer is the same 409 conflict.
- The probe has no fixed sentence, so a transport failure answers a bare 500 as it did when it threw; adding a sentence would be new copy.

## OAuth and bearer tokens

- The work feed's bearer token: compared as SHA-256 digests, every byte read (no early exit), the token and the header never logged or echoed; a header over 4096 characters, a missing or empty configured token and any other scheme are all `401 {"error":"Unauthorized."}`. The decision is `src/server/rules/publication-token.ts`; the hashing is the flow's.
- Authorization codes, access and refresh tokens, their hashes, expiry and one-time use live inside `@cloudflare/workers-oauth-provider` over `OAUTH_KV`; the site's code neither issues, stores nor compares them. Read in the library (version 1.2.3): a code is consumed by clearing the wrapped key in its grant record, and a second use revokes the grant (`invalid_grant`, "Authorization code already used"); a refresh rotates the token and keeps the previous one for one retry. KV has no compare-and-set. Reviewer's assessment (review round 1), confirmed in the library: the grant is read, checked and saved with a plain put, so a second exchange of the same code can succeed for up to about a minute (KV's propagation), and it requires the code, the PKCE verifier and the client credentials, so the loss is the reuse-revocation protection, not new access. Unchanged from main; not changed here. UNVERIFIED by the builder: the timing. The library's default `onError` logs request descriptions without secrets, also unchanged from main. Nothing in this area logs or echoes a code, token or secret: the sign-in handler's failures carry no text, and a defect is logged only through `logUnexpected`.
- The login cookie (AES-GCM under `PUBLICATION_COOKIE_KEY`) carries one sign-in's state; it is single-purpose, expires after ten minutes, is marked approved once, and a consent page cookie cannot approve twice. No change of who may call what.

## Changed corpus cases (branch A, from `pnpm run golden:neutral --all origin/main`)

| Fixture and case | Before | After | Why |
| --- | --- | --- | --- |
| work-feed: the read batch fails; a stored payload that is not JSON; one that is not a valid publication; a stored correction whose payload is a withdrawal | 503 `{"error":"Updates unavailable."}` | 500 same body | A store fault, or stored data this site did not write. |
| work-feed: the journal batch fails on a publish, a withdrawal, a correction; a failure and then a retry | 503 `{"error":"Delivery pending. Retry the same event."}` | 500 same body | A store failure. The retry case's second answer is unchanged. |
| publication-oauth: register, the KV write fails | 503 | 500, "Publication connection unavailable." | A KV failure. |
| publication-oauth: authorize, the client lookup fails; the cookie key has the wrong length; the cookie key is not base64 | 400 | 500, same sentence | The site's own fault, not the visitor's request. |
| publication-oauth: callback, the code exchange answers 500, answers HTML, cannot reach GitHub; the user lookup cannot be reached, answers HTML | 400 | 503, same sentence | GitHub is the unavailable dependency. |
| publication-oauth: callback, completing the grant fails in KV | 400 | 500, same sentence | A KV failure. |

Eighteen cases changed in the first round. Review round 1 added eight corpus cases and changed none: `authorize: a client id too long to be a key` (400), `token: a code too long to be a key` (400 `invalid_grant`), `token: a client id too long to be a key` (401 `invalid_client`), `refresh: a refresh token too long to be a key` (400 `invalid_grant`), `mcp: a bearer token too long to be a key` (401 `invalid_token`), and three GitHub cases: `callback: GitHub refuses the code exchange with an HTML 403` (400), `callback: GitHub rate-limits the code exchange with 429` (503), `callback: GitHub's user lookup answers an HTML 403` (400). Against `origin/main` A therefore reports the eighteen changed cases plus eight added. The MCP fixtures do not change on A otherwise.

## Changes on B that a reader should know (all shown neutral)

- The journal commit was one batch whose INSERT decided every outcome in its WHERE (revision, event id, entry state, operation). It is now: admit (an expected revision of the largest safe integer is rejected before anything is read); one batch that reads the project's latest revision, the event under the event id and the operations of the entry; the rule (`commitPublication`); one batch that inserts the row, erases the entry's content for a withdrawal, and reads the receipt back (the database stamps `published_at`). The table's constraints are the guard: the primary key on project and event id, and `UNIQUE (project_id, revision)`. Every accepted write takes the next revision (`expectedRevision + 1`, and the rule only writes when `expectedRevision` is the latest), so two writers that read the same latest revision aim at the same revision and one is refused; that index is the compare-and-set for every fact the rule read, a withdrawal and a repeated event id included. The loser reads again and decides again, three tries in all (`decideAndSave`), so a writer that lost to the same event answers duplicate and one that lost to a different event answers conflict or withdrawn. A retried withdrawal is not "nothing to do": it writes the erasure again, which changes no stored value, because the old journal did and the corpus's digests of touched tables record it.
- The feed's current entry and history were chosen by subqueries and a JOIN. They are now two pure rules over two plain reads (`publication-feed.ts`): the index read (one batch) takes the latest revision, the small columns of every event of the project (revision, entry id, operation, origin, publish time, and whether its text was erased: no text) and each publish event's day (`json_extract(payload,'$.occurredOn')`, a projection of one stored field, not a decision); `chooseFeed` picks the current entry and the history (newest day first, the later publish first on a tie, 100 at most, backfill history only); then the text of the picked events only is read by project and revision, in statements of at most 50 revisions (D1 allows 100 bound values), and `showFeed` reads each story and builds the answer. The bound: a request reads the small columns of every event of the project (a few hundred bytes each, no text) and at most 100 texts, plus the current entry's, whatever the journal holds. The earlier estimate of about 6 KB of text per event was wrong: the limits count UTF-16 units (a headline of 140, a summary of 1,000 and a technical detail of 4,000 are 5,140 units), and a unit can take up to 3 bytes in UTF-8, so an event's stored text can reach about 16 KB with its keys. A withdrawal that lands between the two reads erases a picked text; the rule treats an entry whose text is gone as withdrawn and leaves it out (a test drives that interleaving). Any shown story that does not read as a publication still makes the whole feed refuse, and a publish payload that is not JSON now fails the index read (`json_extract` raises), which answers the same 500. The latest revision is read as `MAX(revision)`, null for a project with no event, and the rules default it to 0; the corpus's failure patterns were changed to match the statement text and the answers did not change.
- `src/lib/publication/oauth.ts` moved to `src/server/publication-oauth.ts` (it needs the flows, and `src/lib` may not import `src/server`); both route files re-export it from there. `src/lib/publication/mcp.ts` stays where CLAUDE.md names it and takes the tools as an argument. `src/lib/publication/oauth-login.ts` keeps only the consent page, its stylesheet and the constants (its own test checks the page against `global.css`). `src/lib/publication/journal.ts` and `website.ts` are gone: `websiteFeed` is `src/server/publication-feed.ts` and the five building pages import it from there.
- One small shared reader of a request body to a limit, `src/server/bounded-body.ts`, serves the work feed and the OAuth route (the two had the same loop).

## File map

- Rules: `src/server/rules/publication-commit.ts`, `publication-feed.ts`, `publication-access.ts`, `publication-token.ts`, `publication-login.ts`.
- Flows: `src/server/flows/publication-commit.ts`, `publication-feed.ts`, `publication-tools.ts`, `publication-login.ts`, `work-feed.ts`.
- Store and services: `src/server/publication-store.ts`, `publication-services.ts` (the OAuth grant store and GitHub), `publication-cookie.ts` (the sealed login cookie), `publication-login.ts` (the handler), `publication-oauth.ts` (the route), `publication-feed.ts` (`websiteFeed`), `bounded-body.ts`.
- Shared: `src/server/digest.ts` (one SHA-256 helper, used by the commit hash, the token comparison, the consent style hash and the PKCE challenge; none existed in `src/server/` before), `src/server/publication-mcp.ts` (the tools as the transport calls them: one place that catches a defect, logs it through `logUnexpected` and answers the documented word).
- Routes: `src/pages/api/work-feed.ts`, `src/pages/api/publication/[...path].ts`, `src/pages/.well-known/[...path].ts`, `src/pages/api/mcp-probe.ts`.
- Left in `src/lib/publication/`: `contract.ts` (types and the Effect Schema reader, which accepts only an object's own enumerable members, as the old validator did), `canonical.ts`, `read.ts` (the feed's types, which the browser feed script imports as types), `mcp.ts` (Zod tool inputs and the transport; its `try/finally` is resource clean-up, closing the MCP server after the transport answers, not error handling, and `src/pages/api/mcp-probe.ts` has the same), `oauth-login.ts` (the consent page).
- Deleted: `src/lib/publication/delivery.ts` and its test. It was the agent-side delivery port (an outbox and a journal handed in); review round 1 asked whether anything outside `src/` uses it. Searched the whole repository (scripts, `.agents/`, `publicist/`, docs, README, CLAUDE.md, AGENTS.md): nothing imports it or tells an agent to, so it and `tests/lib/publication-delivery.test.ts` are deleted rather than converted, and the `PublicationJournal` and `CommitResult` port types in `contract.ts` went with it (the guarantees they described are kept as a comment on `Receipt`).
- Deleted tests, three for the conversion and one with `delivery.ts`: `tests/api/publication.test.ts` (two `vi.mock` calls; replaced by `tests/api/publication-outages.test.ts` on real SQLite and by the corpus), `tests/lib/publication-journal.test.ts` (the journal stories, replaced by `tests/flows/publication-commit-stories.test.ts`), `tests/lib/publication-contention.test.ts` (the competing writers, replaced by the "writers that get there first" stories in the same flow file and by the Quint model), and `tests/lib/publication-delivery.test.ts`.
- Frozen reference copy: `tests/fixtures/legacy-validators/publication-contract.ts`, with `tests/server/publication-differential.test.ts` (6,000 seeded inputs, zero differences). The exact-file list in `tests/architecture/legacy-validators.test.ts` now names seven files.
- Shared files touched, additively: `scripts/lib/quint-mutants.mjs` (one registry and one model entry), `tests/scripts/quint-run.test.ts` (the model list and a block for the new model), `tests/architecture/legacy-validators.test.ts` (one file name), `docs/verification.md` (one section). No shared helper in `src/server/` (`terms`, `run`, `guarded-save`, `services`, `failure`, `fields`) changed.

## SQL statements

| # | Statement | Where | Class |
| --- | --- | --- | --- |
| 1 | `SELECT MAX(revision) AS revision ... WHERE project_id=?1` | `readCommitFacts`, `readFeedIndex` | (a) plain read (the latest revision; null when there is none, which the rules read as 0) |
| 2 | `SELECT revision,published_at,payload_hash ... WHERE project_id=?1 AND event_id=?2` | `readCommitFacts` | (a) plain read |
| 3 | `SELECT operation ... WHERE project_id=?1 AND entry_id=?2` | `readCommitFacts` | (a) plain read |
| 4 | `INSERT INTO publication_events (...) VALUES (...)` | `insertEvent` | (b) write guarded by key and constraint: the primary key and `UNIQUE (project_id, revision)`; this is also the compare-and-set for the facts read in 1 to 3 |
| 5 | `UPDATE publication_events SET payload=NULL WHERE project_id=?1 AND entry_id=?2` | `insertEvent`, for a withdrawal | (b) write scoped by key; idempotent |
| 6 | `SELECT revision,published_at ... WHERE project_id=?1 AND event_id=?2` | `insertEvent`, last in the batch | (a) plain read (the receipt, stamped by the database) |
| 7 | `SELECT revision,entry_id,operation,origin,payload IS NULL AS erased,published_at ... WHERE project_id=?1 ORDER BY revision` | `readFeedIndex` | (a) plain read (small columns, no text) |
| 8 | `SELECT entry_id,json_extract(payload,'$.occurredOn') ... WHERE project_id=?1 AND operation='publish'` | `readFeedIndex` | (a) plain read (projects one stored field of each publish event; filters by kind, decides nothing) |
| 9 | `SELECT revision,payload ... WHERE project_id=?1 AND revision IN (...)` | `readFeedTexts`, at most 50 revisions a statement | (a) plain read by key |

There is no (c) and no (d): every decision that was in the old INSERT's WHERE, CASE or subqueries and in the feed's subqueries and JOIN is a rule. Statements 1 to 3 run in one batch; 4 to 6 in one batch; 1, 7 and 8 in one batch; the 9s in one batch. Triggers: `publication_outbox_withdraw` still writes (it clears the outbox text of a withdrawn entry; it is named in `src/server/rules/publication-commit.ts` and tracked in issue #242). No migration written or run.

## Model

`verification/publication-journal.qnt` (module `publication`, six properties, seven mutants, and one scripted run; `docs/verification.md`, "The publication-journal model"). The code's two reads are one step and its insert is one step with the two unique constraints as the guard; the mutant `SplitRead` reads them apart and breaks `retryNeverConflicts`; `NoRetry` breaks the same property; `NoRevisionKey`, `AnyRevision`, `NoWithdrawnRule`, `NoNewEntryRule` and `NoTargetRule` break the other five. A ghost flag is set from the real outcome and names no mutant. Review round 1 found that the first version of property 6 was false on the unchanged model (it compared a delivery's answer with the journal when the delivery judged, not when it read, so a correct conflict for a stale read was counted as wrong; random simulation missed it). The ghost now counts a conflict only when the same envelope was stored when the delivery made its last read, or when its insert last met a constraint; the trace is a scripted run (`staleReadTest`, run by `tests/scripts/publication-journal-trace.test.ts` with `quint test`), which fails on the old ghost and passes on the new. `NoRetry` (the insert meets the constraint, the delivery stops, the same envelope is stored) and `SplitRead` (the event id is read, another delivery stores the envelope, then the latest revision is read) still break the property; the other five properties are invariants over the stored events and have no read-time ghost. An ad hoc run of 300,000 samples of 25 steps finds no violation of the real design. The OAuth authorization code exchange is a read then a write inside the library; it is not modelled here (the library's code, KV).

## STOP items and judgment calls for the owner

- OWNER ITEM (not fixed, out of these routes): the OAuth library's one-time code and refresh rotation run over KV, which has no compare-and-set (see above). Whether to harden that is a decision about the library or the deployment.
- Judgment (builder's, to confirm): a sign-in whose grant store fails answers 500 where a client deleted between the consent page and the callback is also 500 (the library raises a plain error for it, not an `AuthorizationError`, so the two cannot be told apart); a visitor then starts again as the page says either way.
- Judgment: a non-text `access_token` in GitHub's answer is refused (400) where the old code would have sent it on to GitHub's user lookup, which would have refused it. The same outcome.
- Judgment: the OAuth route's body reader failing answers 500 with the same sentence (it was the catch-all's 503).
- Judgment: the feed's whole-journal read (see above).
- No new copy was needed.

## Review round 1 (independent Claude round on A `46e85258` and B `f3bf03b5`; no behaviour difference and no authorization regression found)

- A1, fixed on A and B: an over-long client id, code or refresh token reached KV and answered 500; now refused with the library's own answer (see Scope). Eight corpus cases added.
- A2, fixed on A and B: a non-JSON 4xx from GitHub other than 429 is a refusal (400); tested for the exchange and the user lookup, each with 403, 404 and 429.
- B1, fixed: property 6 of the model was false on the unchanged model (see Model); scripted run added; ghosts checked.
- B2, fixed: the feed read is bounded (see "Changes on B"); the record's size estimate corrected.
- B3, fixed: tool defects are caught once in `src/server/publication-mcp.ts`, logged through `logUnexpected` and answered `unavailable` or `pending`; tested with an incomplete service context.
- B4, fixed: `MAX(revision)` is read plainly and defaulted to 0 in the rule.
- B5, fixed: one SHA-256 helper, `src/server/digest.ts`.
- B6, fixed: `delivery.ts` and its test deleted (nothing outside `src/` uses it).
- B7, fixed: the reader accepts only own enumerable members; the differential covers non-plain objects, `__proto__` and `constructor` keys, deep nesting and strings past 20,000 characters, and fails on the old reader.
- B8, fixed: a test makes the withdrawal's erase fail after its insert and the trigger have run, and asserts the batch rolled back (the event and the outbox text are as before) and the tool answers `pending`; a retry then succeeds.
- B9, fixed: this record.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0. Results are filled in below from the last runs at each tip.

Branch A at `46e85258` (on `origin/main` at `3561a541`). The full suite ran on the commit before the last one, which only formats and spaces two files (`oauth-login.ts`, `publication-login.test.ts`); the touched tests, the format check, oxlint and `check` were rerun at the tip.

- `pnpm run format:check`: `Checked 757 files in 90ms. No fixes applied.`
- `pnpm run build`: completed.
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`: 293 test files, 12,694 tests passed, 1 skipped; `git status` unchanged by the run.
- `QUINT_JOBS=4 pnpm run verify:quint:all`: every line `ok`.
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 51 problems, the same as `origin/main` (counted from its output; the summary line was not printed in the builder's runs).
- `pnpm run check`: `Result (783 files): 0 errors, 0 warnings, 17 hints`.
- `pnpm run golden:neutral --all origin/main`: NOT NEUTRAL, on purpose: 2 of 77 fixtures differ (`work-feed`, `publication-oauth`), 18 cases, each explained above.

Branch B at the merge of A's tip (this record is committed after the results below):

- `pnpm run format:check`: `Checked 775 files in 86ms. No fixes applied.`
- `pnpm run build`: completed.
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`: 295 test files, 12,716 tests passed, 1 skipped; `git status` unchanged by the run.
- `pnpm run golden:neutral --all claude/effect-12-publication-fixes HEAD`: `publication-mcp` 42 identical, 18 neutral with D1 changes; `publication-token` 38 identical, 4 neutral with D1 changes; `work-feed` 126 identical, 110 neutral with D1 changes; 0 not neutral, 0 added, 0 removed, 0 renamed; compared 77 fixtures and 9,016 cases; `golden:neutral: NEUTRAL`. The fixtures are re-recorded in their own commit.
- `QUINT_JOBS=4 pnpm run verify:quint:all`: 52 lines, every one `ok`, with the new model; wall time about 47 s on a machine shared with two other builders (the music record's 44.7 s was on an idle one).
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 50 problems (51 on A). The pre-existing findings in this area that remain are the unknown-typed inputs of `canonical.ts`, `contract.ts` (`parsePublication`) and `delivery.ts`, which read what arrives; the two module mocks of `tests/api/publication.test.ts` are gone with that file.
- `pnpm run check`: `Result (801 files): 0 errors, 0 warnings, 17 hints`.
- Differential test against the frozen validator (`tests/fixtures/legacy-validators/publication-contract.ts`): 6,000 seeded inputs plus the fixed pool, zero differences, key order included.

Limits: the sign-in against a real GitHub and the real OAuth library on a deployed Worker were not run; the corpus drives the library on a fake KV. The consent page was not seen in a browser (its markup and policy are byte-identical in the corpus). UNVERIFIED: any live call (no live publication endpoint was called). The Quint model is checked by random simulation, not by Apalache.

## Checklist

- N/A, sections 1 to 4 and 6 to 8 of `docs/prelaunch-checklist.md`: no page, copy, asset, link, markup, style, cookie, analytics or owner screen changed.
- PASS, 5.1 Server input validation: the envelope reader accepts and refuses what the old validator did (zero differences over 6,000 seeded inputs) and the corpus passes neutral.
- PASS, 5.2 Failure paths on branch A: 500 with the fixed sentence for a store or KV failure, 503 for a missing binding or GitHub unavailable, 409 for a lost race; shown by `tests/api/publication-outages.test.ts`, `tests/lib/publication-login.test.ts` and the re-recorded corpus.
- UNVERIFIED, 7.3 and 7.5: production bindings, secrets and live behavior; nothing is deployed.

## Delivery status

Branch A: implemented yes, deployed no, verified live no. Branch B: implemented yes, deployed no, verified live no. Both branches were built by a Claude Sonnet 5.5 subagent. This record does not certify the checks listed as UNVERIFIED.
