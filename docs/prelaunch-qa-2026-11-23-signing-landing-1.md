# Signing conversion, landing 1 (readers, machines, rules, store and services): release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#408](https://github.com/kwilson21/thesuperhuman.us/pull/408), `claude/signing-conversion` into `main`,
with the `conversion` label. It holds parts 1 and 2 of the signing area's conversion to Effect
(`docs/plans/2026-11-signing-conversion.md`, section 8), built as 23 small pull requests that each merged into it after
their own review. Merge facts: recorded after the merge, in the next pull request.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson (below). The work was done with Claude Code; Codex reviewed each small pull request.
Rollback revision: the revision of `main` before the merge, or `git revert -m 1` of the merge. Nothing on the site calls
the new code yet, and the one change to running code (#418) is answer-for-answer the same, so a rollback changes no
answer.

## Scope

New code that nothing calls yet, for the signing and agreement routes to use in landings 2 and 3:

- **Part 1, readers, machines and rules** (#396 to #407, and #409's fixes): the Effect Schema readers of the four
  signing request bodies, with frozen Zod copies and differential tests; the `agreementDocument`, `agreementPacket` and
  `agreementMessage` machines; one rule file per row of plan section 2 under `src/server/rules/`; `abandonBlocked` with
  its LemmaScript contract; and tests that hold each kept SQL guard to its rule.
- **Part 2, store, services and answers** (#411 to #420): `src/server/agreement-store.ts` (one function per statement or
  batch), `src/server/agreement-services.ts` (mail key and attachments, the allowance's answer, the packet build and
  render, the PDF check), and each route's fixed answers in `src/lib/agreement-access.ts`.

The one change to code that runs today is #418. `countAllowance` (`src/server/studio-signin-store.ts`), shared by the
studio sign-in routes and the archive link, also answers the window start its upsert already returned. Its SQL is
unchanged. The archive link's flow reads `.allowed`, and its route maps a refusal it can never reach.

No page, migration, binding or secret changes.

## Owner decisions

- Owner, 2026-11-12: business logic out of SQL strings; Effect for rules and Effect Schema for input; one area at a
  time; a conversion changes no behaviour.
- Owner, 2026-11-14: an unexpected store failure answers 500 with the route's fixed sentence; a lost race or stale
  version 409; 503 only for a missing binding or a known unavailable dependency.
- Owner, 2026-11-15: "Effect schema as our only validator no zod use from us"; stacked conversion PRs.
- Owner, 2026-11-23, in conversation:
  - "#394 might be better if it was split into smaller PRs I'm worried that we have no way to review it properly":
    part 1 was split into twelve small PRs, and part 2 was built the same way.
  - Claude reviews each small PR and the owner checks the final one.
  - Then, as #408 grew: "One PR per small piece" for the owner's checks, landed with stacks ("Can you not take
    advantage of gh pr stacks to deal with multiple deploys?").
  - The two route switches land "Separately". So the conversion reaches `main` in three landings, one deploy each:
    this one; then the client routes; then the owner routes. Plan section 8 records it.

## Reviews

Each small PR had Codex's code and security reviews and a focused Claude Code review against today's code, and was
merged only with CI green. The pull requests, with what review found:

| PR | Piece | Code / tests (lines added) | Found and fixed |
|---|---|---|---|
| #396 | machines, open-for-signing rule | 388 / 655 | none |
| #397 | Effect Schema readers | 276 / 772 | none |
| #398 | link, redeem, draft rules | 744 / 1,491 | the draft route's second read of the values comes before the project and signed checks |
| #399 | review rule | 848 / 2,145 | none |
| #400 | signature rule | 678 / 1,233 | none |
| #401 | countersign, abandon, `abandonBlocked` | 726 / 1,819 | none |
| #402 | end, hold, record a copy | 377 / 904 | none |
| #403 | signed copy and emails rules | 439 / 1,269 | decide a party's signature, and that the agreement exists, before drawing an attempt id |
| #404 | owner upload and download | 384 / 692 | none |
| #405 | templates, contractor's details | 517 / 903 | none |
| #406 | retention, access cleanup | 1,297 / 1,307 | none |
| #407 | retention held to today's SQL | 0 / 1,681 | none |
| #409 | small fixes from the part 1 reviews | 9 / 31 | (the fixes) |
| #411 | a rejected batch's failure kind | 38 / 81 | none |
| #412 | link, redeem, draft store | 480 / 1,495 | description corrected (the event id is drawn in the store) |
| #413 | review and signature store | 601 / 1,924 | none |
| #414 | owner actions store | 670 / 1,679 | the sent offer chosen by the rule, not SQL (Codex); the MSA-use read named the wrong table for the golden tools (Claude) |
| #415 | signed copy and emails store | 597 / 1,425 | none |
| #416 | templates, settings, uploads, downloads store | 331 / 1,073 | none |
| #417 | retention store | 739 / 2,025 | the retention scan bounded: small columns for all, full rows for the 20 chosen (Codex and Claude) |
| #418 | the allowance's answer (running code) | 75 / 197 | description corrected (the full golden suite is the evidence) |
| #419 | mail, packet, PDF check services | 375 / 794 | none |
| #420 | fixed answers | 171 / 304 | a comment corrected |

The fixed pull requests were reviewed again on their new heads and found clean. Non-blocking notes are in #410 (part 1)
and #421 (part 2).

## Checks

On the integration branch's tree (identical to `claude/signing-store-10` at `c96d599b6`):

- `pnpm test`: 442 files, 16,602 passed, 3 skipped.
- `pnpm run check`: 0 errors.
- `pnpm run lint` and `pnpm run format:check`: clean.
- `pnpm run golden:neutral --all origin/main HEAD`: identical, 82 fixtures and 9,471 cases.
- On #418's branch, every golden corpus (`vitest run tests/golden`): 93 files, 9,842 passed. These record today's live
  answers, so they are what shows the sign-in routes and the archive link answer as before.
- Part 1's `pnpm run verify:quint:exhaustive` run is recorded in #394; the models did not change since.

## Applicable Definition of Done

### 1 to 4. Content, search, accessibility, performance

- **N/A.** No page or asset changes.

### 5. Forms and sensitive flows

- **PASS · No answer changes.** No route calls the new code. The studio sign-in and archive link routes use #418's
  `countAllowance` with unchanged SQL, and the full golden suite holds their answers.

### 6. Privacy, legal and measurement

- **N/A.** No change to what is stored, sent or measured.

### 7. Release and final QA

- **PASS · Checks and reviews.** Above.
- **UNVERIFIED · CI on #408's merge head.** To be recorded with the merge facts.
- **UNVERIFIED · Production revision and live check.** After merge: the Workers build of the merge revision, and a live
  check of `https://thesuperhuman.us/` and of the archive link route's answer to a request without a valid address,
  compared with its golden fixture.
- **N/A · Bindings, migrations.** None.

### 8. Private owner center

- **N/A.** No change.
