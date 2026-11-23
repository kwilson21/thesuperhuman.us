# Signing decisions out of SQL behaviour fixes: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: to be filled in when it is opened. Merge facts are recorded after the merge, in the next pull request.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. Q1 of `docs/plans/2026-11-signing-conversion.md` (#376) was answered in conversation on
2026-11-23, "The real reason": when the offer stops being signable between the signing link's read and its batch, the
request answers what the same request would get a moment later, with today's sentences (404 "Website signing is off."
when signing is off, otherwise 404 "This offer is unavailable for signing."), and "another request issues a link
between the lookup and the batch" keeps its 429. B7's review re-decision applies the rule settled in earlier areas and
in `CLAUDE.md`: a UNIQUE constraint that backs a rule's fact is read and decided again, three tries in all, as offers F7
(decided 2026-11-15) did. Section 8 of the plan, PR order item 4, fourth bullet ("decisions out of SQL"), makes this
the last of the four fixes, made on today's code before the conversion so that the conversion changes no behaviour; no
`conversion` label. The work was done with Claude Code.
Rollback revision: the revision of `main` before the merge, or `git revert -m 1` of the merge commit. No migration, no
binding.

## Scope

- **`POST /api/offer/[token]/link` (B7, Q1).** The link batch runs as it always has. When one of its two guards raises,
  `issueAgreementLink` (`src/lib/agreement-access.ts`) reads what they re-check, as plain rows: the offer with its
  request, its link for the token, the signing setting and a project (the conditions of `liveSigningGuard`), and the
  recipient's signing links of the offer (the 30-second guard's). It decides (`linkRefused`): signing off is 404
  "Website signing is off.", an offer no longer open for signing (no longer sent, its link revoked or replaced, its
  recipient changed, its request withdrawn or resolved, a project started) is 404 "This offer is unavailable for
  signing.", a link issued in the last 30 seconds is 429 "Wait at least 30 seconds before requesting another link.".
  When none of it holds any more, the batch runs again (`storeSigningLink`): three batches in all, each with the first
  `at` (as the archive link keeps its instant) and its own link id and key; a guard that raises on the third is the 429,
  as before, with no read after it. Before, every raised guard answered the 429. A batch that commits reads nothing
  more, so a request whose guard never raises makes exactly today's statements. Every check before the batch keeps its
  order, and a batch failure that is not a guard, or a failed read after one, answers the route's 500 (#384). Neither
  new read matches a hook pattern of the corpora that request a link (the offer read's text also matches
  `owner-request-invoices`' `FIRST_OFFER_READ`, a corpus that never requests a link).
- **`POST /api/offer/[token]/review` (B7).** `reviewAgreements` (`src/lib/software-agreements.ts`) runs its reads, its
  decision and its batch (`reviewOnce`) up to three times. A batch that fails on the one pending MSA per client and
  template (`software_agreements_pending_msa`, recognised by its columns in the message), or with a foreign key failure
  on the evidence `otherRequestChangedClient` reads after it (unchanged: a row with the client's natural key under
  another id, or the earlier client row gone), is read and decided again from the first read. A third such failure
  answers as before, 409 "The agreement could not be reviewed.". The draft batch before it runs once. Any other failure
  answers as before: the other unique index and the guards 409, a foreign key failure with no evidence the logged 500.
- **The 23 changed golden cases** (of 671 in `offer-link` and `offer-review`), re-recorded in a commit of their own
  (`afd7510d`, after the code in `c14d3d04`). In each, the answer changed and the D1 statements gained the new reads
  (and the re-decisions); no console line, Resend request, R2 or KV operation or `trigger-hit` changed, and every
  declared interleave still fires on the batch it names.
  - `offer-link` 14 (json and form each; a form post gets its HTML page with the same status and sentence): "the
    request is withdrawn between the lookup and the batch", "the request is resolved ...", "the offer link is revoked
    ...", "the owner starts the project ...", "the offer is superseded ...": 429 "Wait at least 30 seconds before
    requesting another link." to 404 "This offer is unavailable for signing."; "signing is switched off between the
    lookup and the batch": 429 to 404 "Website signing is off."; "signing already started: a project exists": 429 to
    404 "This offer is unavailable for signing." (Q1). Each keeps today's batches, its link batch rolled back as before,
    and gains the two reads after it.
  - `offer-review` 9 (json, form values, form fields each): "the same legal party is created by another tab before the
    review batch": 409 "The agreement could not be reviewed." to 200 `{ok:true, documents, reused_msa:null}` (a form
    post: 303 to `?review=1`), the documents naming the other tab's client, which the step's dump and digest now hold;
    "another offer's MSA for the party appears before the review batch" and "another offer's MSA for the same party is
    inserted after the pending check": 409 "The agreement could not be reviewed." to 409 "Another offer has a pending
    MSA for this party. Ask Kazon to resolve it." (B7).
- **D1 statements only (6 `offer-link` cases, neutral):** "a link issued 20 seconds ago blocks the batch", the second
  request of "two requests back to back are refused the second time" and "another request issues a link between the
  lookup and the batch" (json and form each). Their guard raises as before and the two reads after it find the recent
  link: the same 429. Every other case is byte for byte today's; `offer-draft`, `offer-verify-page` and
  `agreements-verify-page`, whose steps request a link, are unchanged.
- Unchanged on purpose: every other answer of both routes, the order of every check before the link batch (the signing
  setting, the offer, the recipient, the code key, both allowances, Turnstile, the receipt's session), the guards
  themselves, the link's 500 for a batch failure that is no guard, the review's other unique index
  (`software_agreements_sow_offer`, which backs no fact the review reads and cannot fire after its guards), the review's
  guards, and every case of every other corpus.
- Docs: the `offer-link` and `offer-review` header comments say the link reads and decides after a raised guard, and
  that the review reads and decides again; `src/server/failure.ts` lists the link's guards and the review's
  re-decisions, and no longer lists the client's unique key among the review's 409s (the client row is written with
  `INSERT OR IGNORE`, so that key never raises). The plan records no pull request states, so it is unchanged.

## Judgment calls (the owner may overrule)

- **The link reads after a raised guard, not before every batch.** Q1 and the plan put the read before the batch, as
  the conversion will. Read before, every link request that reaches the batch would gain two reads (191 cases in five
  corpora, `offer-draft`, `offer-verify-page` and `agreements-verify-page` among them). Read after a raised guard, as
  #387 read the upload's request after a refused batch, the answers are the same and only the cases whose guard raises
  change. The conversion may read first: the difference is in D1 statements only, which `golden:neutral` allows a
  conversion. After the third raise the 429 is answered with no read, as the conversion's `SaveKeptChanging` will.
- **Each batch of the link draws its own id and key** and keeps the first `at`, as the archive link's save does; the
  review's tries each read the clock and draw their ids where the code always has, as offers F7's draft did. No golden
  case runs a second link batch; the review's "same legal party" case shows the second try's ids.
- **A failed read after a raised guard** answers the link's 500, logged once ("Agreement link"), as every failed read
  of the route does. No golden case holds it; `tests/api/signing-decisions.test.ts` does.
- **The pending MSA's unique index is recognised by its columns** ("UNIQUE constraint failed:
  software_agreements.client_id, software_agreements.template_id", which is how SQLite names a column index), as
  `publishTemplate` recognises its label's. Only that index and the client's foreign key evidence are read and decided
  again.
- **The link decides in the order a moment later's request would:** signing off, then an offer no longer open, then the
  30 seconds. The recipient is compared exactly, as the guard does; the send stores the snapshot trimmed and lowercased
  (`src/server/rules/offer-pin.ts`), as `normalizeClientEmail` reads it.

## Evidence and limits

- `pnpm run golden:neutral --all f9c215e38 HEAD` (this branch's base) compared 82 fixtures and 9,471 cases and reported
  NOT NEUTRAL in exactly the 23 cases above: `offer-link` 226 identical, 6 neutral with D1 changes, 14 not neutral;
  `offer-review` 416 identical, 9 not neutral; no case added, removed or renamed. Every other fixture is identical, and
  `git diff --stat f9c215e3 HEAD -- tests/golden/fixtures` lists only `offer-link` and `offer-review`. `origin/main`
  moved to `6f86f18b` (#387) during the work; against it the eleven owner corpora also differ, by #387's own changes,
  and `git merge-tree` with it is clean.
- At the code commit, `pnpm test` failed exactly the 29 golden cases that the re-record changes (415 files; 15,729
  passed, 3 skipped). Each re-recorded fixture is byte for byte the same as a second recording. At the re-record commit:
  `pnpm test` 415 files, 15,758 passed, 3 skipped; `pnpm run check` 0 errors; lint and format clean; `offer-link`,
  `offer-review` and the three unchanged corpora that request a link pass with `GOLDEN_VERIFY_DIGESTS=1
  GOLDEN_VERIFY_COUNTS=1` (1,177 tests).
- `tests/api/signing-decisions.test.ts` (new, 20 cases on the golden harness): 18 fail on the old code; the 2 that pass
  pin what must not change (a batch that commits reads nothing more; a foreign key failure with no evidence of a race
  is not retried and stays the logged 500). It also holds the third raise of the link's guard to the 429 with two reads
  and three batches, a failed read after a raise to the 500, and the third failure of each review fact to the 409 after
  three batches. `tests/security/review-race.test.ts` expects
  200 when another tab creates the same legal party first, and the pending MSA's sentence when another offer's MSA
  appears.
- PENDING: reviews of the pull request, CI on its head, and the deploy and live check after merge.

## 1 to 4. Content, search, accessibility, performance

- **N/A.** No page changed.

## 5. Forms

- **PASS · The signing page's answers.** A link request whose offer stops being signable answers the real reason with
  today's sentences, and a review whose party or pending MSA another request changed answers what it then reads; every
  other answer keeps its sentence and status.

## 6. Privacy

- **PASS · Logs and answers.** Nothing new is logged, and no answer carries an error's text.

## 7. Release and final QA

- **PASS · Checks, rollback.** See above.
- **PENDING · Reviews, CI, production revision and live check.**
- **UNVERIFIED · The races live.** A race between a read and its batch cannot be induced live; the answers are held by
  the tests and the golden corpora.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
