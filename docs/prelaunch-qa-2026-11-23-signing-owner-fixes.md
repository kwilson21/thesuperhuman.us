# Signing owner routes behaviour fixes: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#387](https://github.com/kwilson21/thesuperhuman.us/pull/387), merged at 10:37:49 UTC as `6f86f18b`
(head `ba26709c`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The 2026-11-14 decision (an unexpected database or store failure answers 500 with the route's
fixed sentence and never the error's own text; a lost race or a stale version 409; 503 only for a missing binding or a
known unavailable dependency) gives B1, B2, B3, B4 and B8. B3's answer for a missing or empty id is offers F6 (decided
2026-11-15): what an unknown id answers, at the point today's code answers it. B8 applies judgment call J1 of
`docs/plans/2026-11-signing-conversion.md` (#376), which the owner may overrule: the owner's downloads answer a ready
copy whose file is missing with a logged 500, not the 404 the visitor routes give (the alternative is 404 "Not found").
Section 8 of the plan, PR order item 4, third bullet, makes this the owner routes' fix, made on today's code before the
conversion so that the conversion changes no behaviour; no `conversion` label. The work was done with Claude Code.
Rollback revision: `f9c215e3`, the revision of `main` before the merge; or `git revert -m 1 6f86f18b`. No migration,
no binding.

## Scope

- **`POST /api/owner/requests/[id]/agreement` (B1, B2, B3).** A store failure answers 500 "The agreement changed or the
  operation failed. Reload before retrying." (the route's existing sentence), logged once through `logUnexpected`
  ("Owner request agreement"). The sent offer's read, which every action makes, threw (a bare 500); every other read,
  batch, bucket call, packet claim and copy or notice step answered the generic 409. Each database or bucket call is
  marked with `stored` (`StoreRejected`, `src/lib/reader-message.ts`): `countersignAgreements` marks its read and its
  batch, and the notices, the copies, the recovery and the packet are marked whole, since they reject only when one of
  their calls does. A rejection that another request or the stored data explains keeps today's 409 and the reads after
  it: a guard that raised and a unique index (`classifyFailure`), a foreign key (every row a batch here refers to was
  read just before it), a NOT NULL value (an offer with no client email snapshot) and a raise-only trigger (the cleanup
  lock on a closed archive, the immutability triggers). Any other rejection answers the 500 at once, with no read after
  it: abandon no longer reads the deposits again, and end no longer reads the MSA's use again, after a failed call. A
  refusal the code throws (a `ReaderMessage`, refused stored values, a date that does not exist) keeps the generic 409.
  Countersign's packet and copies after the commit stay best effort, with their `catch {}` and the 200.
- **B3 on that route.** A missing or empty id answers what an unknown id answers, after the body, with no read of the
  offer or the agreement: countersign's 409 "Signing is off or the offer changed.", abandon's 409 `{ok:false}`, the
  other actions' 404 `{ok:false}`. It answered 503. retry-artifact with no bucket answers 503 `{ok:false}` at the point
  `prepareAgreementArtifact` threw "Storage unavailable." (the generic 409): after the recovery write, the renderer's
  import and the MSA id lookup, before the claim. Countersign and retry-copy with no bucket keep their 200.
- **`PUT /api/owner/requests/[id]/agreement-attachments` (B1, B2, B3, B4).** A failed signing setting read, bucket put
  or batch answers 500 "The attachment could not be saved.", logged once ("Owner attachment upload"); the setting threw,
  the others answered 503. The object is deleted after a failed put or batch unless its row was saved, as before (a
  failed check keeps it). A batch whose guard raised is a refusal: the request is read after it and the upload answers
  404 `{ok:false}` for a request that is unknown or not a software request, and 409 "The attachment could not be
  saved." for one withdrawn or resolved (also when it was withdrawn just before the batch); both answered 503. A missing
  or empty id is an unknown request: the PDF checks and the put run, then the object is deleted and the upload answers
  404 `{ok:false}`; it answered 503. Bytes that pdf-lib cannot read answer 400 with today's sentence "The PDF could not
  be validated. Use a supported PDF or sign outside the website." (503); pdf-lib that cannot be loaded keeps the 503.
- **`GET /api/owner/requests/[id]/agreement-attachments` (B2, B3, B8).** No database or no bucket answers 503
  "Unavailable" before any read; it answered 404 "Not found" and threw. A failed query or bucket read answers 500
  "Unavailable", logged once ("Owner attachment"); they threw. A row whose object is gone answers that 500, logged as
  "The attachment's object is missing." (J1); it answered 503.
- **`GET /api/owner/agreements/[id]/file` (B2, B8).** `agreementDownload` (`src/lib/agreement-download.ts`) takes
  `{ unexpected }` from the route, as `completeAgreementLink` takes its failures, since `src/lib` imports no value from
  `src/server`. A failed read (the agreement, the artifact, the bucket, the bytes) answers 500 "Signed copy unavailable.
  Contact Kazon.", logged once ("Owner signed copy"); it threw. A ready copy whose object is gone answers that 500,
  logged as "The ready copy's object is missing." (J1); it answered 503. The integrity 503s stay.
- **`POST /api/owner/agreements`.** Unchanged: it already answers as the 2026-11-14 decision asks (plan, "The area
  today"), and no case of its eight corpora is listed.
- What the owner sees: the native forms show the answer's sentence on the agreement page, now with status 500 for a
  failure on the site's side; the attachment uploader shows the answer's `error` text (`src/scripts/software-offers.ts`),
  so a refused upload of a closed request still reads "The attachment could not be saved."; a 404 `{ok:false}` shows no
  text, as the 404 for signing off already does. The page sends only the request it shows, so an unknown or service
  request reaches the upload only by hand.
- **The 85 changed golden cases** (of 855 in the eleven corpora), re-recorded in a commit of their own (`ab10fdb9`,
  after the code in `5a593960`). In each, the answer changed, plus one `console.error` line where the route now logs; no
  Resend request, R2 operation, dump or digest changed, and every `trigger-hit` marker is the same except the two
  second triggers below. R is 500 `{ok:false, error:"The agreement changed or the operation failed. Reload before
  retrying."}` with the line "Owner request agreement failed unexpectedly: Error d1 unavailable" (a form post gets the
  page with status 500); G is the generic 409 with the same sentence.
  - `owner-request-agreement-wire` 2: "no id parameter", "an empty id parameter" (countersigns): 503 `{ok:false}` to 409
    "Signing is off or the offer changed.", with no read (B3).
  - `owner-request-agreement-countersign` 6: "outage: the offer lookup": a bare 500 to R (B2); "outage: the signing
    setting", "... the read of the agreements", "... the signing batch", "form: outage: the signing batch", and the first
    step of "outage: the batch, then the same request again": G to R (B1); the second step unchanged (200).
  - `owner-request-agreement-abandon` 8: "outage: the offer lookup": a bare 500 to R (B2); "outage: the read of the
    agreements", "... the first deposit check only", "... the abandon batch", "form: outage: the abandon batch", and the
    first step of "outage: the abandon batch, then the same request again": G to R, without the deposit recheck (B1);
    "outage: the abandon batch while a deposit appeared": 409 "Void the deposit invoice first, ..." to R, since the
    batch did not run and no guard saw the deposit (B1); "outage: the first deposit check and the recheck after it": a
    bare 500 to R, the recheck never made (B2).
  - `owner-request-agreement-end` 8: "outage: the offer lookup": a bare 500 to R (B2); "outage: the agreement lookup",
    "... the batch", "form: outage: the batch", "... the batch of an MSA with nothing reusing it", "... the open-offer
    check of an MSA", and the first step of "outage: the batch, then the same request again": G to R, without the
    open-offer recheck (B1); "outage: the batch of an MSA, and the recheck": a bare 500 to R, the recheck never made
    (B2).
  - `owner-request-agreement-hold` 5 and `owner-request-agreement-record-copy` 5: "outage: the offer lookup": a bare 500
    to R (B2); "outage: the agreement lookup", "... the batch", "form: outage: the batch", and the first step of
    "outage: the batch, then the same request again": G to R (B1).
  - `owner-request-agreement-retry-artifact` 12: "outage: the offer lookup": a bare 500 to R (B2); "outage: the agreement
    lookup", "... the MSA id lookup", "... the claim of the MSA packet", "... the claim of the SOW packet", "... the
    recovery update", "... the read of the artifact for the copies", "... the claim of a copy", "... recording a sent
    copy", "form: outage: the claim of the MSA packet", and "... the ready batch and the failed mark" (after the packet's
    own "Agreement artifact preparation failed" line): G to R (B1); "no storage bucket": G to 503 `{ok:false}` at the
    same point, nothing logged (B3).
  - `owner-request-agreement-retry-copy` 15: "outage: the offer lookup": a bare 500 to R (B2); "outage: the agreement
    lookup", "... resetting the deliveries", "... resetting the notifications", "... the notice lookup of the
    agreement", "... the claim of a notice", "... recording a sent notice", "... the artifact read", "... the signature
    lookup", "... the claim of the client copy", "... the claim of the contractor copy", "... recording the sent client
    copy", "form: outage: resetting the deliveries", and the first step of "... recording the sent client copy, then
    retrying": G to R (B1); "R2 get fails": G to R with the line "... Error r2 get failed" (B1).
  - `owner-agreement-attachments-put` 15: "the signing setting cannot be read": a bare 500 to 500 "The attachment could
    not be saved." with the line "Owner attachment upload failed unexpectedly: Error d1 down" (B2); "the bucket put
    fails", "the batch fails and the object is deleted", "the batch fails and the check fails too, so the object is
    kept", "the batch fails and the bucket delete fails": 503 to that 500, the same clean-up (B1); "an unknown request",
    "a service request", "an id that looks like SQL": 503 to 404 `{ok:false}`, with one read of the request after the
    refused batch (B4); "a withdrawn software request", "a resolved software request", "the request is withdrawn just
    before the batch" and the second step of "an attachment then the request is withdrawn then another upload": 503 to
    409 "The attachment could not be saved.", with the same read (B4); "no id param": 503 to 404 `{ok:false}`, the object
    still put and deleted and the batch no longer run (B3); "only the five-byte PDF header", "a PDF header over garbage":
    503 to 400 with the same sentence (B4).
  - `owner-agreement-attachments-get` 5: "no database is bound": 404 "Not found" to 503 "Unavailable"; "no bucket is
    bound": a bare 500 to 503 "Unavailable" before the query (B3); "the bucket read fails", "the database query fails": a
    bare 500 to 500 "Unavailable", logged (B2); "the stored object is missing": 503 to 500 "Unavailable", logged (B8).
  - `owner-agreement-file` 4: "the agreement query fails", "the artifact query fails", "the bucket read fails": a bare
    500 to 500 "Signed copy unavailable. Contact Kazon.", logged (B2); "the stored object is missing": 503 to that 500,
    logged (B8).
- **The two cases whose second trigger stops firing.** abandon "outage: the first deposit check and the recheck after
  it" and end "outage: the batch of an MSA, and the recheck" keep their names and their declared failures; the second
  (match 2) is listed in `optionalTriggers` with its reason, as `tests/golden/README.md` describes, and a comment above
  each says why.
- Unchanged on purpose: every refusal and race (the batch guards' 409s, countersign's unique index and NOT NULL 409s,
  hold's and record-copy's foreign key 409, the cleanup lock's 409s on end and hold, abandon's deposit sentence and end's
  open-offer sentence after a raised guard, an impossible end date), countersign's 200 whatever the packet and copies
  did, retry-copy with no bucket (200), the stale-attempt 409, the integrity 503s, every accepted upload (it runs exactly
  today's statements), and every `owner-agreements-*` case.
- Docs: the eleven corpora's header comments name the new answers and the log labels; `src/server/failure.ts` lists the
  owner request route's and the upload's refusals beside the others. The plan records no pull request states, so it is
  unchanged.

## Judgment calls

- **J1 (the owner's, may be overruled).** The owner's attachment and signed-copy downloads answer a ready copy whose
  object is gone with the logged 500, as the plan's B8 row says. The visitor routes keep their 404.
- **Refusals the database gives keep the 409 without a read for evidence.** A foreign key failure is a lost race
  because every row a batch of this route refers to is read just before it (the sign route's call, #384); a NOT NULL
  failure is stored data the batch copies (an offer with no client email snapshot, golden countersign "an offer with no
  client email snapshot"), which the conversion reads first as `RecipientMissing` with the same 409; the cleanup lock's
  and the immutability triggers' raises are guards, as the plan's store treats them (`GuardRefused`).
- **The upload reads the request after a refused batch.** B4's paragraph puts the read just before the batch; that
  would add a statement to every accepted upload (19 more `owner-agreement-attachments-put` cases and one
  `owner-agreements-access` case would change their statements). Read after a raised guard, as abandon reads the
  deposits again, only the listed cases change. The conversion may read it first: the difference is in D1 statements
  only, which `golden:neutral` allows a conversion.
- **A missing id on the upload** runs the PDF checks and the put, then deletes the object, with no batch and no read
  (offers F6 reads nothing for a missing id), and answers the unknown request's 404.
- **Whole calls marked as the store's.** The notices, the copies, the recovery and the packet are marked with `stored`
  as a whole, since each rejects only when one of its database or bucket calls does. A programming error inside one
  would now answer the 500 instead of the 409; the conversion answers a defect with the same 500.
- **A failed read after a refused batch** (abandon's deposits, end's MSA use, the upload's request) answers the route's
  500, logged; it threw before. No golden case holds it; `tests/api/signing-owner-outages.test.ts` does for abandon and
  the upload.
- **Log labels.** "Owner request agreement", "Owner attachment upload", "Owner attachment" and "Owner signed copy", in
  the style of "Owner agreements"; the conversion keeps them (plan, section 5). The missing objects are logged as "The
  attachment's object is missing." and "The ready copy's object is missing.", which name no key.
- **The downloads' 500 bodies and headers.** The attachment download's 500 is plain "Unavailable" with no headers, like
  its 503; the signed copy's 500 keeps the agreement headers its 503 had.

## Evidence and limits

- `pnpm run golden:neutral --all origin/main HEAD` compared 82 fixtures and 9,471 cases and reported NOT NEUTRAL in
  exactly the eleven corpora: `owner-agreement-attachments-get` 23 identical, 5 not neutral;
  `owner-agreement-attachments-put` 55 identical, 15 not neutral; `owner-agreement-file` 32 identical, 4 not neutral;
  `owner-request-agreement-abandon` 94 identical, 8 not neutral; `-countersign` 132 identical, 6 not neutral; `-end` 91
  identical, 8 not neutral; `-hold` 46 identical, 5 not neutral; `-record-copy` 63 identical, 5 not neutral;
  `-retry-artifact` 75 identical, 12 not neutral; `-retry-copy` 98 identical, 15 not neutral; `-wire` 61 identical, 2
  not neutral; none neutral with D1 changes, no case added, removed or renamed. The 85 are exactly the cases B1, B2,
  B3, B4 and B8 list for these corpora (countersign 5 + 1, abandon 6 + 2, end 6 + 2, hold 4 + 1, record-copy 4 + 1,
  retry-artifact 10 + 1 + 1, retry-copy 14 + 1, wire 2, upload 4 + 1 + 1 + 9, attachment download 2 + 2 + 1, signed copy
  3 + 1). Every other fixture is identical, the eight `owner-agreements-*` among them.
- At the code commit, `pnpm test` failed exactly the 85 changed golden cases (415 files; 15,695 passed, 3 skipped). Each
  re-recorded fixture is byte for byte the same as a second recording. At the re-record commit: `pnpm test` 415 files,
  15,780 passed, 3 skipped; `pnpm run check` 0 errors; lint and format clean; the eleven corpora pass with
  `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1` (866 tests).
- `tests/api/signing-owner-outages.test.ts` (new, 42 cases on the golden harness): 34 fail on the old routes; the 8 that
  pass pin answers that must not change (countersign's guard, unique index and NOT NULL 409s, abandon's deposit 409
  after a raised guard, end's cleanup lock, MSA reuse and impossible date 409s, the signed copy's integrity 503). The log
  line never carries the address in a database message (`logUnexpected` redacts it), and no answer carries an error's
  text. `tests/lib/software-agreements.test.ts` passes the failures to `agreementDownload` and expects the upload's
  failed batch to answer the 500 and log once.
- Reviews, CI, the deploy and the live check: see section 7.

## 1 to 4. Content, search, accessibility, performance

- **N/A.** No page changed.

## 5. Forms

- **PASS · The owner's agreement actions and uploads.** A failure on the site's side answers the route's sentence with
  status 500; every refusal keeps its sentence and status, except the upload's refusals, which B4 moves from 503 to 404
  `{ok:false}` and to 409 and 400 with today's sentences, and a missing id, which B3 answers as an unknown one.

## 6. Privacy

- **PASS · Logs.** Each fault is logged once through `logUnexpected`: the label, the error's name and its message with
  addresses redacted. No answer carries an error's text, and the missing-object lines name no key.

## 7. Release and final QA

- **PASS · Checks, rollback.** See above.
- **PASS · Reviews.** Codex's code and security reviews of `ba26709c` found nothing. An independent Claude Code pass
  found nothing blocking (the severity bar of CLAUDE.md applied: a large pull request): exactly the 85 cases changed,
  each only in its answer, one log line and the two second triggers now optional; the deposit refusal (A12) holds and
  no store failure lets an abandon or end proceed; no write was reordered or dropped; the three judgment calls are
  acceptable. Its notes, not changed: retry-artifact's renderer import is not marked as a store call, so a failed
  import still answers the generic 409 (the conversion makes it a defect); an upload whose request is deleted between
  the refused batch and the read answers 404 rather than 409 (both refusals, no golden case); the attachment GET still
  binds a missing id as `undefined` (unchanged, and Astro always supplies the segment).
- **PASS · CI.** On the head `ba26709c` before merge, all 20 check runs succeeded, the Workers preview build among them.
- **PASS · Production revision and live check.** After merge, on `6f86f18b`: the Workers build succeeded (10:40:52 UTC)
  and `validate` succeeded (10:41:16 UTC). Live check at 10:41:55 UTC: `https://thesuperhuman.us/` answered 200, and an
  owner route without sign-in answered 302 to Cloudflare Access, as before.
- **UNVERIFIED · The 500 answers live.** No database or bucket fault can be induced live; the answers are held by the
  tests and the golden corpora.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **PASS · The owner's answers.** Only the owner routes above change, as listed; the owner pages and their scripts are
  unchanged.
