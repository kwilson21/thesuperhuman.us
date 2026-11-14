# Effect stack, agreement access: the archive link and the signed-copy downloads (release gate)

Two branches are gated: branch A (behavior fixes to the three routes, merged into B) and branch B (the conversion of the three routes to rules, stores, flows and services). Branch B copies the pilot's shape (`docs/prelaunch-qa-2026-11-14-music-area.md`).

Date: November 14, 2026
Repository: the personal website repository
Routes: `POST /api/agreements/link` (a client asks for a link to their signed agreements by email), `GET /api/agreements/[id]/file` (download of a signed copy by a verified visitor), `GET /api/agreements/attachments/[id]` (download of an attachment of the offer a signing session is signing).
Branches: A is `claude/effect-13-agreement-access-fixes`, cut from `origin/main` at `3561a541`; B is `claude/effect-13-agreement-access`, cut from A and merged with A's tip (the merge commit is on B). Nothing is pushed.
Builder: a Claude Haiku 5.5 builder subagent, working from the shared brief (tests first). Independent review of branch A (round 1) found no authorization or non-disclosure regression; its findings are fixed on A and listed below.
Target: production
Rollback revision: A's parent on `origin/main` is `3561a541`; for A, `3561a541` (the fixes are behavior changes, see below); for B, A's tip.

## Scope

Branch A, behavior fixes (each with its failing corpus case or test, then a fixture-only re-record):

1. A verified visitor's download of a signed copy: the reads run in one fixed order, whatever the id. Before, a studio session's project lookup ran only when the agreement existed, and the reuse check ran only for a signing session of another offer, so an unknown id and someone else's agreement differed in the statements they ran. Now the same statements run. Statements and answers are otherwise unchanged; the recorded effects show the extra reads.
2. A missing stored object answers 404 "Not found" (it answered 503 "Unavailable"). This is the not-found answer an unknown id gets, so a verified visitor cannot tell the two apart. It is a change of answer; see Judgment calls.
3. A failed bucket read (it threw) and a failed database read answer 500 with the route's existing sentence (file: "Signed copy unavailable. Contact Kazon."; attachment: "Unavailable"). They used to be uncaught, so Astro answered a bare 500.
4. Attachment: a missing bucket binding and a missing database binding answer 503 with the agreement headers before any read. The 404 answers carry the agreement headers.
5. Archive link: an unexpected failure (a database, allowance or mail call that threw) answers 500 with the route's sentence "Agreement sign-in is temporarily unavailable.", logged through `logUnexpected` without the error's text. It answered 503.
6. Archive link: a failed link batch answers 429 "Wait at least 30 seconds before requesting another link." only when the guard itself raised. Any other batch failure answers 500. The guard recogniser moved to `src/lib/guard-error.ts` so the shared module can use it; `src/server/guarded-save.ts` re-exports it. The signing path (the offer route) is unchanged.
7. Archive link: a code key under 32 characters answers the same 503 as a missing key, before any read. This applies to the archive path only. Applying it to the signing path would change the offer link corpus (cases "a code key under 32 characters (json)" and "(form)" in `tests/golden/offer-link.test.ts`: the signing settings read and the offer read would no longer run), so it is left for the offer area to decide.
8. `agreementJson` takes a typed body (`{ ok: boolean }`) in place of `unknown`. Type only; it clears the Oxlint finding at `src/lib/agreement-access.ts`.

Branch B, the conversion:

- The archive link's body is read by an Effect Schema reader (`src/server/agreement-input.ts`). The frozen Zod copy is `tests/fixtures/legacy-validators/agreement-link.ts`; `tests/server/agreement-link-input.test.ts` runs 2000 seeded bodies (plus non-object bodies) through both and holds them to the same accept and refuse, and to the same values when accepted. The architecture test that counts the frozen copies now counts seven.
- Rules (pure): `src/server/rules/agreement-link.ts` (canonical origin, configuration, the archive decision "nothing to do or issue", the mail words), `src/server/rules/agreement-download.ts` (who may download a signed copy), `src/server/rules/agreement-attachment.ts` (which attachment a signing session may download).
- Stores: `src/server/agreement-store.ts`. Flows: `src/server/flows/agreement-link.ts`, `agreement-download.ts`, `agreement-attachment.ts`. Routes are thin, on `runRoute(services, program, { route, answer })`, with every typed failure mapped by `catchTags`.
- Services: `src/server/agreement-services.ts` (`AgreementMail`, `AgreementAllowance`), added to `src/server/services.ts`'s `Turnstile` and `MusicDb`/`AudioBucket` as before. Outside calls that reject are defects: the route logs them through `logUnexpected` and answers its fixed sentence.
- The route-level non-interference test is `tests/server/agreement-download-routes.test.ts`. It checks the status, headers, body and the sequence of statements (query and arguments, with clock readings normalised) and bucket calls for an unknown id and for another client's agreement, a signing session's other offer, and a studio project's agreement; and for the attachment route, an unknown attachment and another request's.
- The Quint model is `verification/agreement-link.qnt` (issue: cooldown, executed lookup, the guarded batch; redeem: once, before expiry). Five mutants, one per property; each breaks the property named for it (`scripts/lib/quint-mutants.mjs`).
- The old download module `src/lib/agreement-download.ts` keeps only the owner's path. Its visitor branch is no longer called by a route and is left for the owner area's conversion (see Follow-up).

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behavior change in a conversion.
- Owner, 2026-11-14 (as relayed in the task): an unexpected database error answers 500 with the route's fixed sentence; a real lost race or stale version stays 409; a deliberate 503 for a missing binding or a known unavailable dependency stays.
- Judgment calls made by the builder, to confirm: (a) a missing stored object answers 404, as the brief directs (before it was 503); (b) the 500 answers reuse each route's existing sentence, so no new copy was written; (c) the archive link's code-key check is archive-only, for the reason in item 7; (d) the attachment's 404s now carry the agreement headers; (e) a bucket read that throws logs nothing on the file route, as before, but logs through `logUnexpected` on the attachment route, as before.

## Stop items for the owner (not fixed)

- The link request does not yet answer identically for every address; a fix needs an owner decision about a new email.
- A terminated agreement stays downloadable; whether it should stop is an owner decision.
- A failed `used_at` update after the mail has gone out answers 500. What the client then experiences: they see the 500 sentence, although the email arrived. The link in that email still works: its row was stored with the batch and is unused and unexpired, and the redeem on the verify page still accepts it. A second request within 30 seconds is answered with the cooldown's 429, and after that a new link is sent. Older unused links for the address are not consumed when the update fails, so they remain usable until they expire.
- `src/lib/audio-client-access.ts` `normalizeClientEmail` still reads with Zod (the studio area uses it). The archive link calls it. It stays shared.
- `src/lib/agreement-request.ts` and `agreementJson` stay shared with the offer and owner routes.

## Known statement classes (the route's SQL)

Classes: (a) plain read, (b) write guarded by a key or constraint, (c) compare-and-set write, (d) a decision kept in SQL. Class (d) is listed as kept, not as moved: moving them changes the statements, and the fixtures are neutral only while the statements are unchanged.

| Statement | Where | Class |
|---|---|---|
| cooldown upsert `... ON CONFLICT(key) DO UPDATE ... WHERE window_start<=? RETURNING key` | `takeCooldown` | (c) |
| executed-agreement lookup `JOIN software_agreement_clients ... status='executed'` | `hasExecutedAgreement` | (a), with a status filter (d) |
| link batch guard `SELECT CASE WHEN NOT EXISTS(...) ... json_extract(...)` | `storeArchiveLink` | (b) (the guard) |
| link insert, issue event | `storeArchiveLink` | (b) (inside the guarded batch) |
| typed name for the greeting | `signerName` | (a) |
| `UPDATE software_agreement_links SET used_at=? WHERE id=?` | `markLinkUsed` | (b) keyed |
| older unused links consumed `... used_at IS NULL AND id<>? AND issued_at<=?` | `consumeOlderArchiveLinks` | (c) |
| session lookups (archive, signing) with `expires_at>?` and `revoked_at IS NULL` | `agreementSession` in `src/lib/agreement-access.ts` (shared) | (a), with filters (d) |
| studio identity `FROM audio_client_sessions ... expires_at>?` | `studioEmail` | (a), with filters (d) |
| studio project list | `clientSoftwareProjectsForSession` (shared, studio area) | (a) |
| executed agreement for download `status='executed' AND archive_closed_at IS NULL` | `executedAgreement` | (a), with filters (d) |
| reuse check `software_offers WHERE id=? AND reused_msa_id=?` | `offerReusesAgreement` | (a) |
| project's agreement and linked master | `projectAgreementId`, `linkedMsaId` | (a) |
| ready signed copy | `readySignedCopy` | (a) |
| attachment pin `... EXISTS(SELECT 1 FROM json_each(o.agreement_details_json, ...) WHERE json_extract(...)=a.object_key ...)` | `pinnedAttachment` | (d): the pin check is a subquery in SQL |

## Verification

Results are recorded at the tips listed under Evidence. Oxlint: 50 findings on branch B (51 on `origin/main`); none in the files this area converted. Remaining findings in `src/lib/agreement-request.ts`, `agreement-draft.ts`, `agreement-draft-fields.ts` and `software-agreements.ts` belong to the owner and offer areas.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in the agreement worktree. Logs are not retained.

Branch A tip `8832acd6` (the merge into B is `ce852098`):

- `pnpm run format:check`: clean (757 files). `pnpm run build`: complete. Client bundle test: 27 passed.
- Full `pnpm test`: 292 files passed; 12683 tests passed, 1 skipped (12684).
- `golden:neutral --all origin/main HEAD`: 3 of 77 fixtures differ on purpose (the file, attachment and link corpora); NOT NEUTRAL, as expected.
- `verify:quint:all`: exit 0. `publicist:gate`: passed, 84 entries checked.
- Oxlint: 50 findings (51 on `origin/main`).
- `pnpm run check`: "Result (783 files): 0 errors, 0 warnings, 17 hints", exit 0.

Branch B tip `ee2b94fa` (the record commit follows it):

- `pnpm run format:check`: clean (768 files). `pnpm run build`: complete. Client bundle test: 27 passed.
- Full `pnpm test`: 293 files passed; 12690 tests passed, 1 skipped (12691).
- `golden:neutral --all claude/effect-13-agreement-access-fixes HEAD`: "compared 77 fixtures and 9016 cases; 0 of 77 fixtures differ" and "golden:neutral: identical, 9016 cases".
- `verify:quint:all`: exit 0 (the new `agreementLink` model and its five mutants included). `publicist:gate`: passed, 84 entries checked.
- Oxlint: 50 findings. `pnpm run check`: "Result (794 files): 0 errors, 0 warnings, 17 hints", exit 0.

The one skipped test is "renders the real v1 agreements and embeds exact signing evidence" in `tests/lib/agreement-pdf.test.ts`. It is gated on the private file `.private/signing/templates.json`, which is absent here. UNVERIFIED for the private templates. The template test in `tests/lib/software-agreements.test.ts` returns without checking when `AGREEMENT_PRIVATE_TEMPLATES` is unset, so it passes without checking anything. UNVERIFIED.

Parity test: `tests/server/agreement-download-routes.test.ts` passes on B. The statement-parity case for a signing session and for a studio session fails on `origin/main`'s module (checked on the module before the route moved); the archive-session case passed on `origin/main` as well and was removed (an archive session reads the same statements for an unknown id and another client's agreement on the old code, so it proved nothing).

## Checklist

- Visitor downloads: the reads do not depend on the id (`tests/server/agreement-download-routes.test.ts`).
- Link: the cooldown, the lookup and the guarded batch run in the same order as before (the corpus is neutral).
- Errors: every unexpected failure is 500 with a fixed sentence, logged without its text; the only 503s are missing bindings and the signed copy's integrity failure.
- Input: the archive link body is read by Effect Schema, and the differential test holds it to the Zod copy.

## Follow-up

- Remove the visitor branch and the archive branch of `src/lib/agreement-download.ts` and `src/lib/agreement-access.ts` when the owner and offer areas convert; they are unused by the agreement routes now.
- Move the class (d) SQL filters and the attachment pin check into rules when a statement change is allowed.
- The download route still has its own 500 path without a log line for a bucket read that throws, as before. Whether it should log is the owner's call.
