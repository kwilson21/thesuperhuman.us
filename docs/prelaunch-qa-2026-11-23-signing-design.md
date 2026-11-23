# Signing and agreements conversion design: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#376](https://github.com/kwilson21/thesuperhuman.us/pull/376), merged at 01:41:39 UTC as `9deca488`
(head `a5e9872f`).
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The order of `docs/plans/2026-11-effect-conversion.md` ("Go", 2026-11-15), in which this is
step 3, and "Proceed" (2026-11-22). The three questions this design asked, each answered with its recommendation (in
conversation, 2026-11-23): Q1 "The real reason" (a signing-link request that loses a race answers what the same request
would get a moment later, not the 30-second message); Q2 "Approve all three" (the draft, sign and verify-page
sentences for a failure on the site's side); Q3 "Success with receipt" (a failed read after the signatures commit
answers 200 with the receipt). J1 and J2 are judgment calls recorded in the design for the owner to overrule. The
design and its review passes were done with Claude Code; Codex reviewed the first head.
Rollback revision: `d6559823`, the revision of `main` before the merge; or `git revert -m 1 9deca488`. Docs only.

## Scope

- `docs/plans/2026-11-signing-conversion.md` (new): the design for converting the signing link, review, draft and sign
  routes, the owner's agreements and request agreement routes, the attachments and signed-copy downloads, and both
  verify pages: the machines, the rules, the flows, one store, the services, the behaviour fixes B1 to B8, the Quint and
  LemmaScript work, the golden corpora and the PR order.
- `docs/plans/2026-11-effect-conversion.md`: step 3 links the design.
- This record. No code changed; nothing deployed behaves differently.

## Evidence and limits

- Reviews, each finding verified against the code and the golden fixtures before it was fixed:
  - Codex's security review of the first head (`20897711`) found nothing. Its code review raised three points (the
    review GET's rule and flow, the refused email's cleanup kept in one batch, an optional bucket and mail for the
    best-effort steps), fixed in `a740118d`.
  - The first independent Claude Code pass raised eight (countersign's refusals, the abandon contract against A12, B3
    against offers F6, a missing-file answer that departs from an earlier call, retention's catches, the discount
    check's condition, two Quint points, and minor ones), fixed in `0e99112b`; the missing-file answer is recorded as
    J1 and the discount check's condition as J2.
  - The second pass raised six (the packet's own failure handling, a section 2 and 4 contradiction on UNIQUE failures,
    end's refusal order, B5's placement, citations, the null marker) and nits, fixed in `a4e7c8a3` and `77d55645`.
  - Three passes in a row each found something, so the severity bar in CLAUDE.md (owner decision, 2026-11-22) applied
    to the third: it found no blocking defect. Its six non-blocking points (a project start's retirement, where the
    certificate code runs, the review's 500 for text that is not JSON, the copies' failures, retry-artifact's 503
    placement, the verify-page outage cases) were small and certain and are fixed in the same commit as the owner's
    answers. One of its citation nits was checked and the design's citation kept (software-agreements.ts:243 is the
    sentence).
- CI on the head `a5e9872f` before merge: all 20 check runs succeeded, `validate`, `neutrality` and the Workers preview
  build among them.
- After merge, on `9deca488`: the Workers build succeeded (01:43:09 UTC) and `validate` succeeded (01:46:36 UTC). Live
  check at 01:46:58 UTC: `https://thesuperhuman.us/` answered 200, and `/agreements/verify?key=x` answered 401 with the
  expired page, as before.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **N/A.** Docs only.

## 7. Release and final QA

- **PASS · Checks, reviews, rollback.** See above.
- **PASS · Production revision and live check.** Deployed `9deca488`; the site answered 200.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
