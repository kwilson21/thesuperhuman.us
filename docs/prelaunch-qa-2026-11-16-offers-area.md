# The software offers area converted to Effect: release gate

Date: November 16, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull requests, a stack that reaches `main` in one merge (`docs/plans/2026-11-effect-conversion.md`, "Rules this order
follows"):
- [#334](https://github.com/kwilson21/thesuperhuman.us/pull/334), `claude/offers-convert-1`, targets `main`: the command
  reader (Effect Schema, the Zod union frozen with its differential block), the two machines (`softwareRequest`,
  `offerVersion`), the rule files and the deposit decision with its LemmaScript contract.
- [#337](https://github.com/kwilson21/thesuperhuman.us/pull/337), `claude/offers-convert-2`, targets #334: the store
  (`src/server/offers-store.ts`), the services (`src/server/offers-services.ts`) and the answers
  (`src/server/offers-answers.ts`).
- [#341](https://github.com/kwilson21/thesuperhuman.us/pull/341), `claude/offers-convert-3`, targets #337: the flows,
  the route, the route tests, the fixtures re-recorded in a commit of their own, and this record.

The stack merges `main` at `f0709a25` (into #334 as `6c7263e2`, then up through #337 and #341), and again at `c27b8fe4`
(into #334 as `922df817`). Merged on 2026-11-16: #341 into #337 at 02:50:39 UTC as `a329c396` (head `ca6c48d7`), #337
into #334 at 02:54:31 UTC as `28261b62` (head `a329c396`), and #334 into `main` at 03:05:38 UTC as `a9f30919` (head
`922df817`), with the `conversion` label.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson (below). Implementation and the review passes were done with Claude Code; Codex reviewed each
pull request. Merge authorization: the owner, in conversation on 2026-11-15 ("Do the fixes and yes you can merge", for
this work's pull requests once reviews pass and CI is green).
Rollback revision: `5022d29c`, the revision of `main` before #334 merged; deploying it rolls the site back. To undo
the area in git, first revert the merge of [#342](https://github.com/kwilson21/thesuperhuman.us/pull/342) (this
record's merge facts and the plans marked merged, which edit files the area added or changed), then
`git revert -m 1 a9f30919`. On a copy of `main` with #342 merged, that sequence applied cleanly;
`git revert -m 1 a9f30919` alone stops with conflicts in both plans and in this record. A later change to those files
is reverted first the same way.

## Scope

One route, `POST /api/owner/requests/[id]/software` (the owner's six actions on a software request: fit, question,
decline, revoke, draft, send). Owner pages only, behind Cloudflare Access; no client-facing page, no migration, no
binding, no new secret. The seven golden corpora `owner-request-software-*` hold its behaviour. Its design is
`docs/plans/2026-11-offers-conversion.md`; its behaviour fixes F1 to F10 merged before it (#313, #314, #316, #331, with
the model in #317; records `docs/prelaunch-qa-2026-11-15-offers-model-and-fixes.md` and
`docs/prelaunch-qa-2026-11-15-offers-f10.md`).

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behaviour change in a
  conversion.
- Owner, 2026-11-14: an unexpected store failure answers 500 with a fixed sentence and never the error's text; a lost
  race or a stale version 409; 503 only for a missing binding or a known unavailable dependency.
- Owner, 2026-11-15: "Effect schema as our only validator no zod use from us"; "Do the fixes" (F1 to F10, all merged
  before this stack); stacked conversion PRs.
- Decided in the review of #306 (design, section 2 and 3): the four conditions only a guard checked are read first and
  refused by name; a refused guard is not retried; a UNIQUE failure that backs the draft rule's fact is read and decided
  again; question and decline save their after-email moves through the `@xstate/effect` bridge.
- **UNVERIFIED, accepted exception · The answer when the email's outcome never lands.** Not an owner decision yet:
  `settled`'s TimeoutError (no landing within 30 seconds) and ActorStoppedError (the machine stopped without one)
  answer the fixed 500 the route gives a defect ("The change could not be saved. Please try again."), as the design's
  section 5 says, and are logged once through `logUnexpected`, as every unexpected failure and every defect of a
  converted route is. Impact: neither can happen in the corpus (it answers every email at once), and live it needs the
  question's or decline's emails to stall past their own 10-second timeouts or the worker to stop the actor. If it did,
  the first batch is saved and the client email's outcome is unknown, yet the sentence asks for a retry where the
  after-email answers ask for a reload. Follow-up: the owner was asked on 2026-11-16, with the open wording of those
  after-email answers, whether this should also say to reload; a change is a behaviour fix in its own pull request.

## The conversion (the third PR)

- Flows, `src/server/flows/`: `offer-fit.ts` (`reviewSoftwareFit`), `offer-question.ts` (`askSoftwareQuestion`),
  `offer-decline.ts` (`declineSoftwareRequest`), `offer-revoke.ts` (`closeOfferLink`), `offer-draft.ts`
  (`saveOfferDraft`), `offer-send.ts` (`sendSoftwareOffer`), and what they share in `offer-request.ts`: the first read,
  the reads after a refused batch (`answerRefusedBatch`, which asks the refused-batch rule for the next fact, reads it and
  asks again), the client email through the request machine (`emailThroughMachine`), `MailNotConfigured`, and the
  failure after the email (`OffersStoreFailedAfterEmail`). Each flow calls only the store, the services and the pure
  rules, reads each rule's facts in the order the route always read them, and builds no response text.
- The clock and ids: `now` and `sendingSince` (`offerSendingSince`) are inputs, read at each point the route always read
  them (`now` after the front refusals and before the action's next read, once per draft try; `sendingSince` at each
  fresh-link read and each batch carrying G5); `crypto.randomUUID` only for a new draft version, once per try; the link
  token's hash before the link is built. The review of #341 found the draft reading `now` after its offers read, where
  the route read it before (a slow offers read moved the draft's time); fixed in `ad1a14d1`, with a story that pins it.
- Question and decline: the first batch, then `createEffectActor` restores `softwareRequest` at the stored status and
  sends QUESTION or DECLINE with the two emails; `asking` or `declining` sends the client email, then the owner's copy;
  `settled` waits 30 seconds for the landing. A refused or uncertain client email lands on the stored status and is
  MailRefused or MailUncertain (502); then the decline reads the offers left (F10, with `ResolveWrite.noOfferIn`'s
  list) and saves the landing (resolved) in its second batch, and the question records `question-sent`.
- Refused batches and the refusals of `REFUSED_BATCH_ANSWERS` (GuardRefused, SaveKeptChanging, AgreementSigned,
  AudioProjectExists, LinkNotRevoked, AttachmentNotUsable, AttachmentsUnreadable, MsaNotFound, StoredTermsUnreadable,
  OfferLeftAfterEmail) are answered by the refused-batch rules and their reads, per action, as listed there.
- The draft runs through `alwaysDecideAndSave`: the whole read and decision from the request on is its `facts`, so a
  version or open draft taken by another writer is read and decided again, three tries in all, as the route's loop did.
  The named attachments' rows and the closed archives are read only when the details are given and not null and name
  an attachment (only then does the batch carry G11); the send reads the closed archives for the pinned keys, which
  reads nothing when none is pinned.
- The send's pin is a flow step (`pinAgreement`): each attachment's metadata row, then its object, then its size, then
  its digest, read once (`sha256()` after the size, as the services review asked); the preflight's PacketNotReady is
  the `packetReady` refusal (DetailsIncomplete).
- Fixed answers by point, as the route chose them: OffersStoreFailed before any outside effect (`offersFailed`);
  OffersStoreFailedAfterEmail after a question's or decline's client email; OffersStoreFailedAfterDraft for a removed
  attachment's row that could not be put back; LinkCheckFailed for the send's live-link check, by whether the client
  email was accepted. Each logs its failure once through `logUnexpected` (the console lines in the corpus are
  byte-identical).
- What the old route answered otherwise, outside the corpus, as the design intends:
  - A defect inside an action (F2's kind) now answers the fixed 500 through `runRoute` and is logged once, redacted,
    through `logUnexpected`; the old route answered most of them through the lookups after a refused batch. For
    example, a `crypto.randomUUID` that throws while a new draft is saved answered 409 DraftChanged and now answers 500
    (`tests/api/software-offers-outages.test.ts`, "a defect answers the fixed sentence").
  - `settled`'s timeout or a stopped machine (question, decline) answers the fixed 500 and is logged once; the old route
    had no such wait.
  - A failing read that is new (a signed agreement, an audio project, a reissue's link row, the named attachments' rows,
    the closed archives, the reused MSA's row before a draft that confirms reuse) answers 500 with the fixed sentence and
    is logged, where the old route made no read there and went on to its batch.
- Route, `src/pages/api/owner/requests/[id]/software.ts` (1,165 lines to 242): the owner check (403), then
  `bindingsOrUnavailable(env, ["MUSIC_DB"])` (503 with the private header, before the body), `musicRequest`'s answers,
  the command reader's 400, and 404 for a missing or empty id; then `runRoute(services, program, offersDefect)` with
  every tag of each action mapped by `Effect.catchTags`. No catch-all, no Zod import. Services: `MusicDb` (and
  `AudioBucket` when `env.AUDIO` is set), `liveOfferMail(RESEND_API_KEY)` (or a Mail that dies if ever asked when the
  settings are missing, which no flow does), and `liveAgreementPreflight(env)`.

### Departures from the design, and why

- The flows are seven files (`offer-*.ts`, one per action and one shared), not one `software-offers.ts`: they mirror the
  rule files, and the send alone is 317 lines.
- `settled` (`src/server/machines/settled.ts`) turns a typed failure the machine's `onError` did not land into a defect
  (`Effect.orDie` on the original Cause; defects and interruptions keep their Cause). Without it the program's error
  type is `unknown`, and no route could map every tag. A new test holds it (`tests/server/machines-settled.test.ts`).
- `revokeFront` (`src/server/rules/offer-revoke.ts`) refuses RequestClosed before the link is read, as the route always
  did; `revokeLink` still checks it with the rest.
- Three route tests that raced every batch (`tests/api/software-offers.test.ts`) now race only a batch that writes:
  the store's deposit read is a batch of two reads (#337), which those hooks had raced first.
- `tests/server/offers-store.test.ts` held the store's SQL to the old route's corpus; after the re-record it holds the
  same three changed and five added texts to the converted route's corpus (in the commit after the re-record).

## Golden neutrality

Three runs at `b392d05c`, quoted as they printed: from `main` (`f0709a25`, which the stack now contains), across the
re-record commit (`d6e7f5a2`, the commit before it, to `05291d78`, the re-record), and from this PR's base, as CI
compares it.

```
$ node scripts/golden-neutral.mjs --all origin/main HEAD
golden:neutral: from origin/main (f0709a259223) to HEAD (b392d05c07b1)
owner-request-software-decline: 15 identical, 77 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-draft: 183 identical, 15 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-send: 40 identical, 91 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-signing: 0 identical, 101 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-question: 61 identical, 1 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
compared 80 fixtures and 9347 cases; 5 of 80 fixtures differ
golden:neutral: NEUTRAL

$ node scripts/golden-neutral.mjs --all d6e7f5a2 05291d78
golden:neutral: from d6e7f5a2 (d6e7f5a26c36) to 05291d78 (05291d782b45)
owner-request-software-decline: 15 identical, 77 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-draft: 183 identical, 15 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-send: 40 identical, 91 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-signing: 0 identical, 101 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-question: 61 identical, 1 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
compared 80 fixtures and 9347 cases; 5 of 80 fixtures differ
golden:neutral: NEUTRAL

$ node scripts/golden-neutral.mjs --all origin/claude/offers-convert-2 HEAD
golden:neutral: from origin/claude/offers-convert-2 (894ac43b4ec6) to HEAD (b392d05c07b1)
owner-request-software-decline: 15 identical, 77 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-draft: 183 identical, 15 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-send: 40 identical, 91 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-offer-signing: 0 identical, 101 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
owner-request-software-question: 61 identical, 1 neutral with D1 changes, 0 NOT neutral, 0 NOT COMPARABLE, 0 added, 0 removed, 0 renamed
compared 80 fixtures and 9347 cases; 5 of 80 fixtures differ
golden:neutral: NEUTRAL
```

`fit` and `revoke` are byte-identical; every other corpus is identical; no case was added, removed or renamed. The D1
statements that differ are the store's three changed texts (the deposit read, the withdraw's IN list, mark sent's status
filter), its five added reads (the rest of each invoice, in the deposit read's batch of two; a signed agreement; an
audio project; the named attachments' rows; the closed archives), `readMsaExists` before a draft that confirms reuse,
and the batches no longer run when a read refuses first. No response, Resend body, R2 call, console line, trigger-hit
marker, digest or table set differs.

## Evidence

Run at `b392d05c` (#341 after `main` at `f0709a25` was merged through the stack and the review's fixes; this record is
committed after it and changes documentation only), on Node 26.13.1.

- `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1 pnpm test`, after the build: `Test Files  379 passed (379)`,
  `Tests  14831 passed | 1 skipped (14832)`. (A first run before the rebuild failed only the client bundle test, which
  read the `dist/` built before `main`'s merge, where `src/lib/brief-board.ts` was not yet browser code.)
- `pnpm run lint`: no findings. `pnpm run format:check`: `Checked 983 files in 1543ms. No fixes applied.`
  `pnpm run copy:check`: `copy-check passed: no banned copy patterns found.`
- `pnpm run check`: `0 errors`, `0 warnings`, `18 hints` (none in this PR's files).
- `pnpm run verify:quint:all`: exit 0, 120 `ok` lines. No modelled rule changed, so the manual Apalache run was not
  repeated.
- `pnpm run build`: `[build] Complete!` (`publicist-gate passed: 84 entries checked.`); then
  `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: `Tests  27 passed (27)`.
- `golden:neutral`: NEUTRAL in all three runs above.
- New tests: `tests/flows/software-offers-stories.test.ts` (10 stories: what each flow reads, sends and writes, in
  order: revoke reads no link for a closed request; a refused revoke reads the link, then the window; a question
  reserves, emails the client, then the copy, then records; a decline with no mail settings reads no agreement or audio
  project and writes nothing; a refused decline email resolves nothing; a landed decline reads the offers left, then
  resolves; a draft whose version was taken makes a new id per try and saves version 2; with an offers read that takes
  five seconds, the draft's stored and answered time is the time before the read; an attachment's row, object and
  bytes are read in that order and the bytes once; an object of the wrong size is never read);
  `tests/api/software-offers-outages.test.ts`, "the converted route's own outages" (no `MUSIC_DB`: 503 before the body
  is read; a defect: the fixed 500, logged once with the address redacted, nothing written; a question's and a
  decline's client email that has not landed in 30 seconds: the fixed 500, a TimeoutError logged once, nothing saved
  after the email); `tests/server/machines-settled.test.ts` (a typed failure the machine did not land is a defect);
  `tests/helpers/offers-golden.test.ts` (the hook pattern reader fails on a quoted or computed `on`).

UNVERIFIED until checked:

- The six actions as the owner sees them in production (they need the owner's Access login and a software request).
- A client email through the real mail provider (the corpus records each Resend request body; no real email was sent).
- `settled`'s 30-second timeout in production (a route test drives it with fake timers).

## 1. Purpose and content

- **PASS · Changes, instructions and audience.** One owner route converted; no answer changes.
- **PASS, with exception · Approved decisions.** Quoted above. The exception: the answer when the email's outcome never
  lands is UNVERIFIED, released without the owner's confirmation (impact and follow-up under "Owner decisions").
- **N/A · Public copy, first screen, navigation.** No page changes.

## 2. Search and sharing

- **N/A.** No route, metadata or head change.

## 3. Accessibility and responsive behavior

- **N/A.** No markup change.

## 4. Performance and resilience

- **PASS · Queries.** Five added reads, each before the batch that re-checks it: the rest of each invoice (so the
  deposit read is now a batch of two statements), a signed agreement, an audio project, the named attachments' rows and
  the closed archives. `readMsaExists` now also runs before every draft that confirms an MSA's reuse (before, only after
  a FOREIGN KEY failure). One batch fewer for every batch a read now refuses before it runs.
- **PASS · Failures.** Every store, R2 and preflight failure answers its fixed sentence and is logged once; a defect
  answers the fixed 500 through `runRoute`.

## 5. Forms and sensitive flows

- **PASS · Server validation and approval gating.** The command is read with Effect Schema (held to the frozen Zod union
  by the differential test); the owner API stays behind Access.

## 6. Privacy, legal and measurement

- **N/A.** No new data. Inside the corpus the log lines are the route's own, byte for byte; outside it, a defect and the
  bridge's timeout or stop are newly logged, once each, through `logUnexpected`, which redacts addresses and never logs
  what was sent.

## 7. Release and final QA

- **PASS · Checks and neutrality.** See "Golden neutrality" and "Evidence".
- **N/A · Bindings, migrations.** None.
- **UNVERIFIED, accepted exception · The answer when the email's outcome never lands.** Released without the owner's
  confirmation; impact and follow-up under "Owner decisions".
- **PASS, with limits · Reviews.** The reviews of #334 and #337, and the re-review of the closed-archive fix, found no
  defect left; their comment corrections are in #341 ("Comments from the closed-archive re-review"). On #341, two
  independent reviews and Codex found no code defect, security problem or CLAUDE.md violation; one low behaviour point
  (the draft's clock read after its offers read) and the record and design corrections are fixed in their own commits.
  The last code change (the draft's clock read, `ad1a14d1`) had its own independent review after the merge, on
  `a9f30919`: the clock is read where the route read it, once per try (a probe logged one read before each offers read
  across one and three taken versions), no other draft step reads it, and the story fails on the previous flow and
  passed five runs in a row on a fake clock; it found nothing. Its limit: the story pins "before the offers read", not
  "after the front checks". CI on each final head: #341 `ca6c48d7`, #337 `a329c396` and #334 `922df817`, each with every
  `validate` lane, `neutrality` (the `conversion` label's golden check) and the Workers preview build succeeding.
  Before the last merge, `main` had moved to `5022d29c` (#326); the stack merged with it locally printed
  `golden:neutral: NEUTRAL` (80 fixtures, 9,365 cases, the same five software corpora neutral with D1 changes) and the
  offers, flow, server, rules and architecture tests passed (2,029), with `pnpm run check` 0 errors and lint clean.
- **PASS, with limits · Production revision and live check.** On `a9f30919`: the Workers build succeeded (03:11:41 UTC)
  and `validate` succeeded (03:08:55 UTC). Live check at 03:11:55 UTC: `https://thesuperhuman.us/` answered 200, and a
  POST to `https://thesuperhuman.us/api/owner/requests/r1/software` without an Access login answered 302 (to the Access
  login), so the owner API still fails closed. UNVERIFIED live: the six actions as the owner uses them; they need the
  owner's Access login and a real request, and none was made.

## 8. Private owner center

- **N/A** for the remaining items: no change to Access, caching, retention, studio, Stripe configuration or payments
  state.
