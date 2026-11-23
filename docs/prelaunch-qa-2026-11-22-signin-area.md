# The studio sign-in area converted to Effect: release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull requests, a stack that reaches `main` in one merge (`docs/plans/2026-11-effect-conversion.md`, "Rules this order
follows"):
- [#368](https://github.com/kwilson21/thesuperhuman.us/pull/368), `claude/signin-convert-1`, targets `main`: the
  Effect Schema readers of the two request bodies and the address normalizer, the sign-in code machine, the rule files,
  and the area's store.
- [#370](https://github.com/kwilson21/thesuperhuman.us/pull/370), `claude/signin-convert-2`, targets #368: the
  services, the three flows, the three routes with their fixed answers, the agreement link's allowance, the deletions,
  and this record.

The stack merges `main` at `56f14759` (into #368 as `507aa44d`, then into #370 as `e4b37554`). Merged on 2026-11-22,
both with the `conversion` label: #370 into #368 at 23:15:45 UTC as `aafb3ef3` (head `763ced6a`), and #368 into `main`
at 23:19:37 UTC as `4330705d` (head `aafb3ef3`). `main` had moved to `93158d0d` (#363, one record document) since the
stack last merged it; the merge commit includes it. Target: production `https://thesuperhuman.us` Decisions: Kazon
Wilson (below). Implementation and its review passes were done with Claude Code; Codex reviewed #368 and #370. Rollback
revision: `93158d0d`, the revision of `main` before the stack merged; deploying it rolls the site back. In git, first
revert the merge of [#371](https://github.com/kwilson21/thesuperhuman.us/pull/371) (this record's merge facts and the
plans marked merged edit files the area added or changed), then `git revert -m 1 4330705d`. Tested on a copy of `main`
with #371 merged: both reverts applied cleanly and the tree then equals `93158d0d`; reverting `4330705d` alone stops
with conflicts in both plans and in this record.

## Scope

Three public routes: `POST /api/studio/code` (a visitor asks for an emailed eight-digit sign-in code),
`POST /api/studio/session` (the visitor enters it) and `POST /api/studio/sign-out`, and the allowance count the
converted agreement link route shares with them. No page changes, no migration, no binding, no new secret. The golden
corpora `studio-code`, `studio-session` and `studio-sign-out` hold the routes' behaviour, `agreements-link` the shared
allowance and the address normalizer, and `offer-link` the normalizer through `issueAgreementLink`.
`tests/api/studio-signin-noninterference.test.ts` holds the property that a request for one address changes nothing an
attacker who controls another can observe. The design is `docs/plans/2026-11-studio-signin-conversion.md` (#357); the
model extension merged as #360 and the behaviour fixes S1 to S3 as #367 (records
`docs/prelaunch-qa-2026-11-22-signin-model.md` and `docs/prelaunch-qa-2026-11-22-signin-fixes.md`).

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behaviour change in a
  conversion.
- Owner, 2026-11-14: an unexpected database or store failure answers 500 with the route's fixed sentence and never the
  error's text; a lost race or a stale version 409; 503 only for a missing binding or a known unavailable dependency.
  S1 and S2 (#367) follow from it.
- Owner, 2026-11-15: "Effect schema as our only validator no zod use from us"; stacked conversion PRs; the order of
  `docs/plans/2026-11-effect-conversion.md`, in which this is step 2.
- **An exception to the 409 rule, on the code and session routes.** Owner, 2026-11-22, in conversation: "Yes, record
  the exception." A lost race (a guard C1, C2, C4 or C5 that no longer holds at write time) keeps answering like a
  refusal: the generic 200 and the same cookie on a code request, the one 401 on an entry. A 409 would tell a stranger
  that the address had an open project and room for a code when the request read it, which the non-interference
  property forbids. The rule files `signin-issue.ts` and `signin-complete.ts` record it.
- **Decided after release · The expiry gap.** Asked of the owner on 2026-11-22 with #360; the owner answered "You
  decide" (in conversation, 2026-11-22), and Claude Code decided as recommended: keep the code as it is. An entry that
  read its code just before the code expired is accepted just after, in the gap between its clock reading (made before
  its two hashes and its read batch) and its write batch (`docs/verification.md`, "What the time alignment found (for
  the owner)"). The options were: keep the code as it is (the code was valid at the entry's clock reading, and the gap
  is milliseconds after a ten-minute life), or re-check expiry at write time, which needs a second clock reading that
  the non-interference test's clock guard fails on today. The conversion keeps today's behaviour, so it neither widens
  nor closes the gap; a change, if asked for, is a behaviour fix in its own pull request.

## The conversion

### #368: the readers, the machine, the rules and the store

- `src/server/signin-input.ts`: the two request bodies read with Effect Schema; `normalizeClientEmail`
  (`src/lib/client-portal.ts`) checks with Effect Schema and keeps its signature, so the agreement callers do not
  change. The Zod schemas are frozen in `tests/fixtures/legacy-validators/studio-signin.ts`, and
  `tests/server/validators-differential.test.ts` holds each reader to them (lengths counted in characters as Zod 4
  counted them, at and past each limit).
- `src/server/machines/signin-code.ts`: the code's moves (ISSUE, ENTER, DISCARD) from a state derived from its row
  (none, used, expired, locked, live), asked through `next()`; `tests/server/machines-signin-code.test.ts` holds it to
  the answers of the old `decideComplete` and `decideDiscard`.
- `src/server/rules/`: `signin-sweep.ts` (`sweepCodes`), `signin-issue.ts` (`issueCode`, refusing `NoOpenProject` and
  `AddressFull`), `signin-complete.ts` (`enterCode`, `NoCodeToTry`, `sameHash`), `signin-discard.ts` (`discardCode`,
  `NothingToDiscard`) and `studio-allowance.ts` (`takeAllowance`, `AllowanceSpent`), each with its table test in
  `tests/rules/`.
- `src/server/studio-signin-store.ts`: one function per statement or batch over `MusicDb`, every SQL text and batch
  shape byte for byte the old code's. A rejected statement is `StudioSigninStoreFailed` with the cause in `failure`; a
  raised guard is `GuardRefused`, never retried. The audio projects conversion (#365) had opened this file for the
  access closure's statements on the same tables, so the area keeps one store and one failure there.
  `tests/server/studio-signin-store.test.ts` holds every statement and batch to the three corpora.

### #370: the services, the flows, the routes and the deletions

- Services, `src/server/signin-services.ts`: `SigninKeys` (the code key's keyed hash and the plain hash, each
  `Effect.tryPromise`, and `usable`, which refuses a code key under 32 characters as `CodeKeyUnusable`; the code and
  session flows ask it before their first allowance, where the routes checked `codeKeyUsable`, so the 503 comes before
  any clock reading or statement, as before) and the area's `Mail` on `sendAudioMessage`, with the payload keys in the
  code route's order (from, to, subject, html, text), so Resend sees byte-identical requests. `MailRefused` discards
  the code, `MailUncertain` keeps it. Turnstile and the background are the shared `Turnstile` and `Background`.
- Flows, `src/server/flows/`: `signin-code.ts` (`requestCode`; `issueSigninCode`, `discardUndelivered` and the shared
  `useAllowance`), `signin-session.ts` (`signIn`; `enterSigninCode`) and `signin-sign-out.ts` (`signOut`). They keep the
  routes' round trips, batches and order; every clock reading at the same point (each allowance as it is counted, the
  issue once before its read, the entry once before its read, the discard after the email); the code drawn, then the
  browser's value, then (for a new browser with no code issued) a fresh value; the issue's write batch run for every
  answer, bound to do nothing on a refusal; a refused guard answered like a refusal and not retried; the delivery
  through `Background.defer`, with the email rendered inside it; the discard swallowing only its two refusals, so a
  store failure still reaches the fixed line "Studio code delivery or cleanup failed."; a defect in the delivery (the
  render, the send or the discard) caught with `Effect.catchDefect` and written as the same line, as the old route's
  `.catch` did for any rejection, so the background settles fulfilled and the visitor keeps the generic 200 and the
  cookie, with or without an execution context; a token made and hashed on every entry.
- Routes, `src/pages/api/studio/`: the portal flag's 404 first, `bindingsOrUnavailable(env, ["MUSIC_DB"])` with the
  route's secrets (code: Turnstile secret, code key, Resend key, from address; session: code key; sign-out: none),
  `musicRequest`, the readers, then `runRoute(services, program, { route, answer })` under the names the routes logged
  under, with every tag mapped by `Effect.catchTags`. No catch-all, no Zod import. `code.ts` 198 lines to 114,
  `session.ts` 123 to 81, `sign-out.ts` 41 to 48. The fixed answers are `src/lib/studio-signin.ts`, where each visitor
  sentence is written once; `NoOpenProject`, `AddressFull` and `NoCodeToTry` take their `say` from it.
- `liveAgreementAllowance(db, secret)` (`src/server/agreement-services.ts`) counts through `countAllowance` and
  `takeAllowance`, with its signature and its failure (`AgreementAllowanceFailed`, the same cause) kept.
- Deleted: `issueClientCode`, `discardUndeliveredCode`, `completeClientCode`, `takeStudioAllowance`,
  `revokeClientSession` (`src/lib/audio-client-access.ts`, 747 lines to 378), `src/lib/signin-code-rules.ts` and its
  test. Kept there: `reserveStudioAllowance` for its last caller, `issueAgreementLink` (step 3 deletes it), the cookie
  helpers, the session reads (steps 6 and 7), `listStudioSignInFailures` and `deleteRetiredCodes`. The code and session
  lifetimes moved to `src/lib/client-portal.ts`, which the flows and the cookies both read.
- Tests that called the deleted functions run the flows through `tests/helpers/studio-signin.ts`;
  `tests/flows/studio-signin-stories.test.ts` (14 stories) holds the order of clock readings and batches, a guard that
  no longer holds at the issue's write, a refused, an uncertain and a failed-discard email, a mail service that dies
  (with and without an execution context: the fixed line once, the generic 200 and the cookie), the token every entry
  makes, a short code key on both routes with no clock reading or statement before the refusal, sign-out, and the
  agreement allowance's statements. A render that throws is not reached by a story: the email is rendered by a module
  the flow imports, and the lint forbids module mocking; it is inside the same caught delivery.

### Departures from the design, and why

- `src/server/machines/next.ts` asks a trivial machine once as it loads. XState draws 16 random bytes the first time an
  actor is made in a process (its execution id prefix), which `next()` does; inside a request that draw moved every
  random value drawn after it. The golden harness seeds random values per case, so a case run alone (`vitest -t "ask,
  sign in, ask again at once"`) issued a different second code and failed, while the full run passed by test order. A
  test in `tests/server/machines-next.test.ts` fails without the warm-up. XState reads no clock there.
- The store is `src/server/studio-signin-store.ts` with the failure `StudioSigninStoreFailed`, not the design's
  `signin-store.ts` and `SigninStoreFailed` (one store per area; the design's section 4 now says so).
- A wrong code or a lost race fails the entry flow with `CodeNotAccepted` (the same sentence); a missing or malformed
  pending value and a code the machine refuses fail with `NoCodeToTry`. The route answers all of them with the one 401.
- The discard swallows its two refusals by name (`NothingToDiscard`, `GuardRefused`), where the design names only the
  guard; a store failure still reaches the background's fixed line.
- `useAllowance` lives in `signin-code.ts` and the session flow imports it, rather than a fourth flow file.
- Sign-out gets `liveSigninKeys(undefined)`: it asks only for the plain hash and needs no code key.
- The design has a short code key fail at the first keyed hash, inside the first allowance. That allowance reads the
  clock before its hash, while the routes checked `codeKeyUsable` before it, so the flows ask `SigninKeys.usable` first
  instead: the refusal comes at the routes' point, with no clock reading before it.

What the converted routes do otherwise, outside the corpora, with no input known to reach it: the guarded batches
decide that a guard raised with `raisedByJsonGuard` (`src/server/guarded-save.ts`), which matches "malformed JSON"
anywhere down the error's cause chain, where the old `guardRaised` read only the top-level message. D1 puts the text in
both, so every guard the corpora raise is matched the same way; only an error carrying the text in a cause and not in
its own message would be read differently (a guard refusal now, a store failure before), and no database call here
makes one. And the background discard reuses the nonce's and the code's hashes the issue made, where the old
`discardUndeliveredCode` hashed them again; a hash failing there, which printed the fixed line before, can no longer
happen, and no input is known to have reached it.

## Golden neutrality

Run on #370 at `e4b37554` (#370 with #368 and `main` at `56f14759` merged in), quoted as they printed:

```
$ node scripts/golden-neutral.mjs --all origin/main HEAD
golden:neutral: from origin/main (56f147596c62) to HEAD (e4b375540f2e)
compared 80 fixtures and 9370 cases; 0 of 80 fixtures differ
golden:neutral: identical, 9370 cases

$ node scripts/golden-neutral.mjs --all origin/claude/signin-convert-1 HEAD
golden:neutral: from origin/claude/signin-convert-1 (87762fe495f4) to HEAD (e4b375540f2e)
compared 80 fixtures and 9370 cases; 0 of 80 fixtures differ
golden:neutral: identical, 9370 cases
```

And on #368 at `87762fe4`, from `origin/main` (`56f14759`): `identical, 9370 cases`.

After the review fixes (the background delivery's defect caught, the code key checked before the first clock reading,
the store's header), on #370 at `520b2329` with #368 at `3502382a` merged in. `main` is now `93158d0d`, which adds only
a record document since `56f14759`:

```
$ pnpm run golden:neutral --all origin/main HEAD
golden:neutral: from origin/main (93158d0d4606) to HEAD (520b2329ca65)
compared 80 fixtures and 9370 cases; 0 of 80 fixtures differ
golden:neutral: identical, 9370 cases
```

No fixture was re-recorded: every case of every corpus is byte for byte the old routes' recording, the D1 statements
included.

## Evidence

Run at `e4b37554` (this record is committed after it and changes documentation only), on Node 26.13.1.

- `pnpm run build`: `[build] Complete!` (`publicist-gate passed: 84 entries checked.`); then
  `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: `Tests  27 passed (27)`.
- `pnpm test`, after the build: `Test Files  401 passed (401)`, `Tests  15175 passed | 1 skipped (15176)`.
- `tests/api/studio-signin-noninterference.test.ts`, unchanged, three runs: `Tests  30 passed (30)` each (131, 137 and
  138 seconds), its clock guard included.
- `pnpm run check`: `0 errors`, `0 warnings`, `16 hints` (none in these PRs' files). `pnpm run lint`: no findings.
  `pnpm run format`: `No fixes applied.` `pnpm run copy:check`: `copy-check passed: no banned copy patterns found.`
- `quint parse verification/signin-codes.qnt`: exit 0 (only its comments changed). No modelled rule changed, so the
  model runs and the manual Apalache run were not repeated.
- #368 at `87762fe4`: `pnpm test` `Test Files  401 passed (401)`, `Tests  15202 passed | 1 skipped (15203)`;
  `pnpm run check` 0 errors; lint and format clean.
- Single golden cases run alone (`vitest -t`): the sequence "ask, sign in, ask again at once, then the old code again",
  "Resend refuses the email (422): the code is discarded", the no-ctx case, the session corpus's "then the right code"
  cases and the sign-out corpus's real sign-ins pass.
- After the review fixes, at `520b2329`: `tests/flows/studio-signin-stories.test.ts`, `tests/golden/studio-*.test.ts`,
  `agreements-link`, `offer-link` and `tests/architecture`: `Test Files  21 passed (21)`,
  `Tests  1505 passed | 2 skipped (1507)` (the client-bundle test skips without a build); before the fixes, the new and
  tightened stories failed (the mail's defect answered 500 without a context and rejected `waitUntil` with one; the
  short key read the clock once). `tests/api/studio-*.test.ts`, run on the same code before its last comment and format
  edits: `Test Files  5 passed (5)`, `Tests  82 passed (82)`; the non-interference test once more:
  `Tests  30 passed (30)` (141 seconds), its clock guard included. `pnpm run check`: `0 errors`, `0 warnings`,
  `16 hints`. `pnpm run lint`: no findings. `pnpm run format`: `No fixes applied.` `pnpm run copy:check`: passed. The
  build and the full suite were not repeated.

UNVERIFIED until checked:

- A sign-in through the real mail provider and Turnstile in production (the corpora record each request body; no real
  email was sent and no live sign-in was attempted).
- The 503 for a code key under 32 characters in production (the corpora hold it; production's key is long enough).

## 1. Purpose and content

- **PASS · Changes, instructions and audience.** Three public routes converted; no answer in the corpora changes.
- **PASS · Approved decisions.** Quoted above, the 409 exception included. The expiry gap was decided after release
  (under "Owner decisions"): the conversion keeps today's behaviour, as decided.
- **N/A · Public copy, first screen, navigation.** No page changes; every sentence a visitor reads is byte-identical.

## 2. Search and sharing

- **N/A.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **N/A.** No markup change.

## 4. Performance and resilience

- **PASS · Queries.** The same statements, batches and order as before (the corpora are byte-identical, D1 included):
  three round trips per code request and two per entry whatever the address, one statement per sign-out.
- **PASS · Failures.** A store or hash failure answers the route's fixed 500 and is logged once through
  `logUnexpected`; a defect answers the same through `runRoute`; a short code key answers 503 before any clock reading
  or statement; the background discard's store failure and any defect in the background delivery write the fixed line.

## 5. Forms and sensitive flows

- **PASS · Server validation.** The bodies and the address are read with Effect Schema, held to the frozen Zod schemas
  by the differential test.
- **PASS · Sign-in protections.** The allowances, Turnstile, the code bound to the browser's pending value, the cap of
  six live codes, the five attempts and the one answer for every refusal are unchanged; the non-interference test passes
  unchanged.

## 6. Privacy, legal and measurement

- **N/A.** No new data. The log lines are the routes' own, byte for byte in the corpora; `logUnexpected` redacts
  addresses and never logs what was sent.

## 7. Release and final QA

- **PASS · Checks and neutrality.** See "Golden neutrality" and "Evidence".
- **N/A · Bindings, migrations.** None.
- **PASS, decided after release · The expiry gap.** Under "Owner decisions".
- **PASS · Reviews.** #368: Codex's code and security reviews found nothing; an independent review found a guard missing
  for a counted row whose count is null (the store now answers no count, refused as the old `Infinity` was) and a test
  gap (differential cases at the exact character limits), both fixed in `2aa90db6`; a review of the merge of `main` and
  the store's move into `studio-signin-store.ts` found two inaccurate comments, fixed in `3502382a`. #370: Codex's code
  and security reviews found nothing; an independent review found that a defect in the background delivery was no longer
  caught as today (fixed with `catchDefect` and the email built inside the deferred effect), that a short code key read
  the clock before its 503 (fixed: the key is asked first), and two unobservable differences now recorded above, fixed
  in `520b2329` and recorded in `567da5bb`. A review of those fixes found the store header still overclaimed for the
  access closure's statements and the record missed the discard's reuse of the issue's hashes, fixed in `098120f2` and
  `763ced6a`, which change comments and this record only and were checked against those two points. CI on each final
  head before its merge: #370 `763ced6a` and #368 `098120f2`, then #368 `aafb3ef3` after #370 merged into it, each with
  all 20 check runs succeeding, `neutrality` and the Workers preview build among them.
- **PASS, with limits · Post-merge CI.** On `4330705d`: the Workers build succeeded (23:21:08 UTC). `validate` failed
  at 23:22:57 UTC on one test, `tests/architecture/effect-imports.test.ts` > "never imports from the bare effect
  specifier", which walks and parses the whole repository and ran past vitest's 5 s default on a loaded shard; it had
  passed on #368's head, and it has timed out under load before (2026-11-15). The failed job was re-run once and passed
  (`tests (1)` 23:26:57 UTC, `validate` 23:27:03 UTC). #371 gives that test a 30 s limit.
- **PASS, with limits · Production revision and live check.** Deployed `4330705d`. Live check at 23:23:45 UTC:
  `https://thesuperhuman.us/` and `/studio/sign-in` answered 200; a same-origin POST to `/api/studio/code` with `{}`
  answered 400 "Enter your email and complete the security check.", and with an address that is not one answered 400
  "Enter a valid email address."; a POST to `/api/studio/session` with no pending cookie answered 401 with the one
  invalid-or-expired sentence; a POST to `/api/studio/sign-out` answered 200 and cleared the session cookie
  (`studio_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`). UNVERIFIED live: a real code email and
  sign-in (above).

## 8. Private owner center

- **N/A.** No change to Access, caching, retention, studio pages, Stripe configuration or payments state. The owner's
  list of failed code emails (`listStudioSignInFailures`) reads the same audit rows, whose action names do not change.
