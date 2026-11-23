# Signing client routes behaviour fixes: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#384](https://github.com/kwilson21/thesuperhuman.us/pull/384), merged at 07:21:45 UTC as `a11a4fab`
(head `f021a4e2`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The 2026-11-14 decision (an unexpected database or store failure answers 500 with the route's
fixed sentence and never the error's own text; a lost race or a stale version 409; 503 only for a missing binding or a
known unavailable dependency) gives B1, B2 and B5. Q2 and Q3 of `docs/plans/2026-11-signing-conversion.md` (#376) were
answered in conversation on 2026-11-23: Q2 "Approve all three" (this pull request uses the draft's and the sign route's
sentences; the verify pages' is for their own pull request), Q3 "Success with receipt" (B6). Section 8 of the plan, PR
order item 4, first bullet, makes this the client routes' fix, made on today's code before the conversion so that the
conversion changes no behaviour; no `conversion` label. The work was done with Claude Code.
Rollback revision: `31e32124`, the revision of `main` before the merge; or `git revert -m 1 a11a4fab`. No migration,
no binding.

## Scope

- **`POST /api/offer/[token]/link` (B1, B5).** A read, allowance, batch, clean-up or update that fails, and an offer
  whose terms are not JSON, answers 500 "Agreement sign-in is temporarily unavailable." (the archive link's answer,
  agreement access fix 5), logged once through `logUnexpected` ("Agreement link"). It answered 503 and logged nothing.
  The link batch answers 429 "Wait at least 30 seconds before requesting another link." only when one of its guards
  raised (fix 6); `issueAgreementLink` takes the recogniser (`raisedByJsonGuard`) from the route, since `src/lib`
  imports no value from `src/server`. A code key under 32 characters still answers 503 where the first keyed hash
  failed it, after the signing setting, the offer and the recipient are read, now checked there with `codeKeyUsable`
  (as sign-in fix S1 did). The races of B7 (Q1) are unchanged: they still answer 429.
- **`POST /api/offer/[token]/draft` (B1, B2, B5).** A failed read, or a draft batch that failed for no guard, answers
  500 "Your details could not be saved. Try again in a moment." (Q2), logged once ("Agreement draft"). The reads threw
  (a bare 500) and the batch answered 409. A guard of the batch still answers 409 "Your details could not be saved.
  Check the fields and try again.". A JSON null body answers 403 "Reload and try again.", as the review route answers
  it; it threw.
- **`GET` and `POST /api/offer/[token]/review` (B2).** The reads before the details (and the download's reads) answer
  the route's existing logged 500 "The agreement could not be reviewed." (label "Agreement review", as before). They
  threw. A form post gets the 500 as its HTML page through `nativeAgreementRoute`, as every failure.
- **`POST /api/offer/[token]/sign` (B1, B2, B6).** A failed read, or a signing batch that failed for no guard, unique
  index or foreign key, answers 500 "Your signature could not be saved. Try again in a moment." (Q2), logged once
  ("Agreement signing"). They threw or answered 409 "The reviewed agreement changed. Reload and review it again.",
  which every refusal keeps. `signAgreements` marks its reads and its batch with `StoreRejected`
  (`src/lib/reader-message.ts`, shaped like `PreflightReadFailed`), so the route can tell a failed store from a refusal
  the code throws (refused stored values throw a `TypeError` or `FieldsRefused` and stay 409). B6: the read of the
  agreements after the batch commits is part of the notices step, whose failures are already ignored, so the client
  gets 200 with the receipt; the notices stay pending for the owner's retry-copy (or the client's repeat).
- What a visitor sees: the signing page script shows the answer's `error` text (`src/scripts/agreement-access.ts`), so a
  failure on the site's side now reads as Q2's sentence; a bare 500 had no JSON body to read.
- **The 60 changed golden cases** (of 1,339 in the four corpora), re-recorded in a commit of their own (`9ee16d2c`,
  after the code in `bffcb67c`). In each, only
  the answer changed, plus one `console.error` line where the route now logs; no statement, Resend request, dump, digest
  or `trigger-hit` changed, and every declared failure and interleave still fires.
  - `offer-link` 20 (json and form each): "the signing switch lookup fails", "the offer lookup fails", "the ip allowance
    batch fails", "the email allowance batch fails", "the name lookup fails after the link is stored", "the used_at
    update after a sent email fails", "the clean-up batch after a refused email fails", "the session lookup for the
    message fails": 503 to 500, same sentence (B1); "the link batch fails": 429 "Wait at least 30 seconds before
    requesting another link." to 500 "Agreement sign-in is temporarily unavailable." (B1, no guard raised); "an offer
    whose terms are not JSON stores the link and fails before the email": 503 to 500, logged as `SyntaxError` with no
    message (B5).
  - `offer-draft` 16: "the offer lookup fails", "the session lookup fails", "the live check of the session fails", "the
    signing switch lookup fails" (json, form values, form fields): a bare 500 (the handler threw) to 500 "Your details
    could not be saved. Try again in a moment." (B2); "the draft batch fails" (three formats): 409 "Your details could
    not be saved. Check the fields and try again." to that 500 (B1); "a JSON null body (the handler throws today)": a
    bare 500 to 403 "Reload and try again.", nothing logged (B5; the name is kept so the case compares as the same one).
  - `offer-review` 12: POST "the signing switch lookup fails", "the offer lookup fails", "the session lookup fails"
    (three formats each), GET "the agreements lookup fails", "the session lookup fails", "the signing lookup fails": a
    bare 500 to 500 "The agreement could not be reviewed.", logged (B2).
  - `offer-sign` 12: "outage: the offer lookup", "... the session lookup", "... the live offer check of the session",
    "... the signing setting", "form: outage: the offer lookup": a bare 500 to 500 "Your signature could not be saved.
    Try again in a moment." (B2); "outage: the first read of the agreements", "... the saved receipt lookup", "... the
    draft lookup", "... the signing batch", "form: outage: the signing batch", and the first step of "outage: the
    signing batch, then the same request again": 409 "The reviewed agreement changed. Reload and review it again." to
    that 500 (B1); "outage: the second read of the agreements, after the signatures committed": first step 409 to 200
    with the receipt, nothing logged, the notices left pending (B6); every second step unchanged.
- Unchanged on purpose: every guard and race case (among them the link's six "between the lookup and the batch" races
  and "signing already started: a project exists", which Q1's pull request changes, and the sign route's "the
  agreements are deleted before the batch"); "a code key under 32 characters"; the review's existing 409s and logged
  500s; `offer-link`'s "the consume batch fails", which the verify pages' pull request changes.
- Docs: the four corpora's header comments name the new answers and labels; `src/server/failure.ts` lists the signing
  route's races beside the review's. The plan records no pull request states, so it is unchanged.

## Judgment calls (the owner may overrule)

- **A foreign key failure of the signing batch is a lost race (409).** The first version of this fix answered it 500,
  which changed `offer-sign` "the agreements are deleted before the batch", a case no fix lists. Every row the batch
  refers to (the documents and their client) is read just before it, so the failure means another request deleted one
  since (another tab's review replaces the documents it reviewed); `signingBatchRejected` throws a `LostRace` for it
  without a read for more evidence, which would have added a statement to that case. The conversion must keep it so.
- **Log labels.** "Agreement link", "Agreement draft" and "Agreement signing", in the style of the review's "Agreement
  review"; the conversion keeps them (plan, section 5).
- **The download's 500 body.** The review's GET answers `{ok:false, error:"The agreement could not be reviewed."}` for
  a failed read; its other failures stay `{ok:false}`.

## Evidence and limits

- `pnpm run golden:neutral --all origin/main HEAD` compared 82 fixtures and 9,471 cases and reported NOT NEUTRAL in
  exactly the four corpora: `offer-draft` 384 identical, 16 not neutral; `offer-link` 226 identical, 20 not neutral;
  `offer-review` 413 identical, 12 not neutral; `offer-sign` 256 identical, 12 not neutral; no case added, removed or
  renamed. Every other fixture is identical.
- At the code commit, `pnpm test` failed exactly the 60 changed golden cases (412 files; 15,655 passed, 3 skipped);
  each fixture, re-recorded at the re-record commit, is byte for byte the same as a recording made earlier in the work.
  At the re-record commit: `pnpm test` 412 files, 15,715 passed, 3 skipped; `pnpm run check` 0 errors; lint and format
  clean; the four corpora pass with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1` (1,343 tests).
- `tests/api/signing-client-outages.test.ts` (new, 31 cases on the golden harness): 24 fail on the old routes; the 7
  that pass pin answers that must not change (the link batch's guard 429, the short code key's 503, the draft batch's
  guard 409, the signing batch's guard, foreign key and unique 409s, refused stored values). The log line never carries
  the address in a database message (`logUnexpected` redacts it).
- Reviews, CI, the deploy and the live check: see section 7.

## 1 to 4. Content, search, accessibility, performance

- **N/A.** No page changed.

## 5. Forms

- **PASS · The signing page's answers.** A failure on the site's side answers Q2's approved sentences (draft and sign),
  the link's existing sentence and the review's existing sentence; every refusal keeps its sentence and status.

## 6. Privacy

- **PASS · Logs.** Each fault is logged once through `logUnexpected`: the label, the error's name and its message with
  addresses redacted; a parser error's message is not logged. No answer carries an error's text.

## 7. Release and final QA

- **PASS · Checks, rollback.** See above.
- **PASS · Reviews.** Codex's code and security reviews of `f021a4e2` found nothing. An independent Claude Code pass
  found nothing blocking (the severity bar of CLAUDE.md applied: a large pull request): it confirmed the 60 cases and
  nothing else changed, that no answer or log line carries an error's text, and that the foreign key judgment call is
  sound, since every key in the signing batch points at rows read just before it. Its notes, not changed: B6's failed
  read is not logged (as Q3 decided); the foreign key test reads the message only, as the review's does; this record's
  pull request line (filled in here); "the used_at update after a sent email fails" answers 500 although the email
  went out (as B1 lists).
- **PASS · CI.** On the head `f021a4e2` before merge, all 20 check runs succeeded, the Workers preview build among
  them.
- **PASS · Production revision and live check.** After merge, on `a11a4fab`: the Workers build succeeded (07:23:26 UTC)
  and `validate` succeeded (07:25:34 UTC). Live check at 07:26:03 UTC: `https://thesuperhuman.us/` answered 200, and a
  link request with an empty JSON body answered 400 "Complete the security check.", the schema's answer before any
  read, as before.
- **UNVERIFIED · The 500 answers live.** No database fault can be induced live; the answers are held by the tests and
  the golden corpora.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
