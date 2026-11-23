# Signing verify pages behaviour fixes: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: to be filled in when it is opened. Merge facts are recorded after the merge, in the next pull request.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson. The 2026-11-14 decision (an unexpected database or store failure answers 500 with the route's
fixed sentence and never the error's own text; a lost race or a stale version 409; 503 only for a missing binding or a
known unavailable dependency) gives B1, B2 and B5. Q2 of `docs/plans/2026-11-signing-conversion.md` (#376) was answered
in conversation on 2026-11-23, "Approve all three": this pull request uses the verify pages' text (heading "This link
could not be opened.", text "Something went wrong on my side. Try the link again in a few minutes."). Section 8 of the
plan, PR order item 4, second bullet, makes this the verify pages' fix, made on today's code before the conversion so
that the conversion changes no behaviour; no `conversion` label. The work was done with Claude Code.
Rollback revision: the revision of `main` before the merge, or `git revert -m 1` of the merge commit. No migration, no
binding.

## Scope

- **`completeAgreementLink` (`src/lib/agreement-access.ts`), the redeem both pages call (B1, B2).** A failed link read,
  a live check on a GET that failed for no guard, and a consume batch that failed for no guard answer 500
  `{ok:false, error:"This link could not be opened."}`, logged once through the caller's `unexpected`. The link read
  threw (the pages' bare 500); the live check and the batch answered 401, the expired page, whatever failed. A guard
  that raised still answers 401: the GET's live check (A1), and in the batch A5 (another request used the link) and A1
  (the offer no longer open for signing). The batch's ids and session token are new, so nothing else in it can lose a
  race. The function takes `RedeemFailures` (`{ isGuard, unexpected }`) from the page, since `src/lib` imports no value
  from `src/server`; the pages pass `raisedByJsonGuard` and `logUnexpected`. Every refusal, the 404 for another host,
  the 200 that leaves the link unused, the 303 with the cookie, and every statement and its order are unchanged.
- **`src/pages/offer/[token]/verify.astro` and `src/pages/agreements/verify.astro` (B1, B2, B5, Q2).** A 500 from the
  redeem, and on the signing page a failed read of the offer (which threw), render Q2's failure page with status 500,
  `Referrer-Policy: no-referrer` and `Cache-Control: no-store`: the expired page's structure (`AgreementLayout`,
  `page-title`, `page-lede`), the owner's approved heading and text, and no "Send a new link" button, since the emailed
  link still works. Each failure is logged once, never shown: "Agreement verify" (the signing page) and "Archive
  verify" (the archive page). A POST whose body is not a form (`formData()` refuses it with a `TypeError`: JSON, plain
  text) reads as one with no key and answers what that answers: 401 and the expired page (404 from another host). It
  threw, a bare 500.
- **Kept as the plan says.** Terms that are not JSON on the signing page still fail the body before its first byte: the
  parse stays in the layout's slot ("terms that are not JSON: the body fails before its first byte", unchanged).
- **The 18 changed golden cases** (of 538 in the four corpora), re-recorded in a commit of their own (`55dcb228`,
  after the code in `0909205e`). In each, only the answer changed, plus one `console.error` line where the page now
  logs; no statement, Resend request, dump, digest or `trigger-hit` changed, and every declared failure and interleave
  still fires. F is the failure page with status 500 and the line "<label> failed unexpectedly: Error <the injected
  message>"; E is the expired page with status 401, nothing logged.
  - `offer-verify-page` 8: "outage: the link read on a GET: the page throws", "outage: the link read on a POST: the page
    throws", "outage: the offer read on a GET: the page throws": a bare 500 (the page threw) to F (B2); "outage: the
    GET's live check: the expired page": E to F (B1); "outage: the POST's batch (the session insert): the expired page,
    the link left unused" and "... (the event insert) ...": step 1 E to F (B1), step 2 (the GET, 200) unchanged; "a POST
    whose body is JSON, not a form: the page throws", "a POST of plain text: the page throws": a bare 500 to E (B5).
  - `agreements-verify-page` 6: the two link-read outages: a bare 500 to F (B2); the two POST-batch outages: step 1 E to
    F (B1), step 2 unchanged; the two bodies that are not a form: a bare 500 to E (B5).
  - `offer-link` 2 and `agreements-link` 2: "the consume batch fails" (json, form), the `follow` step that records
    `completeAgreementLink`'s own Response: 401 `{ok:false, error:"This link has expired."}` to 500
    `{ok:false, error:"This link could not be opened."}` with the line ("Agreement verify", "Archive verify") (B1).
  - The changed cases keep their names, which say what they answered before, so the fixtures compare them as the same
    cases; a comment above them says so.
- Unchanged on purpose: every refusal and race (a key that names no live link, A1 on the GET and in the batch, A5's
  "another tab consumes the link between the POST's read and its batch", the signing page's four batch races), the 404s
  for another host, the 200s that leave the link unused, the 303s with the cookie, and the terms that are not JSON.
- Docs: the four corpora's header comments name the failure page, its labels, the 401 for a body that is not a form
  and the consume batch's 500; `src/server/failure.ts` lists the redeem's races beside the signing route's. The plan
  records no pull request states, so it is unchanged.
- Screenshots: the software-signing scenario (`scripts/screenshots/scenarios/software-signing.mjs`) captures the failure
  page of both verify pages at both sizes (`software-signing-link-failed-*.png`, `software-signing-archive-link-failed-*.png`).
  A store failure is made by renaming the links table for one capture and back after it, so the page's read of the link
  fails as a database outage would (a GET; see "Found while working" for why not the Continue form's POST).
  `tests/scripts/screenshots.test.ts` holds the scenario to that: four failed landings with status 500, each between
  the rename and the rename back.

## Judgment calls (the owner may overrule)

- **Log labels.** "Agreement verify" and "Archive verify", in the style of "Agreement link" and "Agreement review"; the
  conversion keeps them (plan, section 5).
- **No button on the failure page.** The expired page's "Send a new link" is left off: the emailed link is still
  unused, and the approved text tells the visitor to try it again. The audit's alternatives below include adding one.
- **The redeem's 500 body.** `{ok:false, error:"This link could not be opened."}`, the failure page's heading, as the
  401's body is the expired page's heading. Only the golden corpora's direct callers see it; the pages render by status.
- **Only a `TypeError` from `formData()` reads as no key.** That is how the Fetch standard refuses a body that is not
  a form; any other error still throws.

## Found while working (not changed here)

- **The verify pages' Continue form is refused by the middleware in a browser.** The pages and `AgreementLayout` set
  `Referrer-Policy: no-referrer`, so under the Fetch standard the form's POST carries `Origin: null`, and the
  middleware's cross-site form check (`src/middleware.ts`, the `formLike` check) answers 403 "Cross-site POST form
  submissions are forbidden" before the page runs. Seen locally with Playwright's Chromium on the screenshots preview: the
  GET shows "Your agreement is ready.", and Continue answers that 403. No corpus runs middleware, and no screenshot
  scenario posts the form, so nothing caught it. It predates this pull request and is outside its lists; it needs its
  own fix (for example a referrer policy on the form that still sends the origin, or a same-origin check that accepts
  this form), decided separately.

## Hallmark audit

Run read-only (`docs/design-standard.md`) on both verify pages in the states this pull request changes (the failure
page) and the expired page beside it, at 1280 x 800 and 390 x 844, with `design.md` read first.

- **Defects: none.** No overflow at 320, 375, 390, 414, 768 or 1280 px; ink text 18.2:1 and the accent kicker and
  button 4.78:1 on the paper; headings roman, Libron, `text-wrap: balance`; the lede at the prose measure; the
  expired page's button 44 px tall on one line; no em dashes or straight quotes in the new copy; tokens and classes
  only from the existing system.
- **Design choices (to the owner, unchanged).**
  - The copy bans "Something went wrong" and asks an error to name what broke (`references/copy.md`). The text is the
    owner's approved Q2 wording. Option A (recommended): keep it as approved; the site cannot tell the visitor which
    part failed, and the instruction is the useful part. Option B: name the cause, "The site's database did not
    answer, so this link could not be checked. Try it again in a few minutes."; more specific, but it names an
    internal part. Option C: say the link is still good, "Something went wrong on my side, and the link was not used.
    Try it again in a few minutes."; it answers the worry a one-time link raises, at one more clause.
  - An error state should offer one next action (`references/interaction-and-states.md`, empty states). Option A
    (recommended): no button, as built; the emailed link is the action and the text says when. Option B: a "Try the
    link again" button that reloads the page with the same key; one tap instead of returning to the email, but the
    key is then written into the page (the ready page already does that in its form). Option C: the expired page's
    "Send a new link"; always available, but it suggests the link is spent when it is not.
- **False positives.** "Missing system reference" (no Hallmark stamp): pages here carry no stamp by design
  (`docs/design-standard.md`).
- **Outside the changed states (noted only).** The layout's skip link reads "Skip to agreement" on pages that hold no
  agreement (the expired and failure pages); the archive's ready page labels its button "Continue". Both predate this
  pull request.

## Evidence and limits

- `pnpm run golden:neutral --all origin/main HEAD` compared 82 fixtures and 9,471 cases and reported NOT NEUTRAL in
  exactly the four corpora: `agreements-link` 189 identical, 2 not neutral; `agreements-verify-page` 34 identical, 6 not
  neutral; `offer-link` 244 identical, 2 not neutral; `offer-verify-page` 53 identical, 8 not neutral; no case added,
  removed or renamed. Every other fixture is identical.
- At the code commit, `pnpm test` failed exactly the 18 changed golden cases (413 files; 15,717 passed, 3 skipped). Each
  re-recorded fixture is byte for byte the same as a second recording. At the re-record commit: `pnpm test` 413 files,
  15,735 passed, 3 skipped; `pnpm run check` 0 errors; lint and format clean; the four corpora pass with
  `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1` (542 tests).
- `tests/pages/signing-verify-outages.test.ts` (new, 20 cases on the golden harness, both pages rendered by Astro's
  container): 16 fail on the old code; the 4 that pass pin answers that must not change (the consume batch's guard 401
  on each page, the GET's live check refusing, the batch's live check refusing after the offer is superseded). The
  failure page never carries the error's text, and the log line never carries the address in a database message
  (`logUnexpected` redacts it).
- Screenshots: rendered locally from the screenshots preview, both pages' failure and expired states at 1280 x 800 and
  390 x 844 (device scale 2), and looked at; see the pull request. The whole capture pipeline also ran locally
  (`SCREENSHOTS_FULL=1 pnpm run screenshots` against the preview): exit 0, 58 page images and all 20 scenarios, the
  four new failure captures among them, each answering 500 with the failure page.
- PENDING: reviews of the pull request, CI and the Screenshots workflow on its head, and the deploy and live check after
  merge.

## 1. Content

- **PASS · The failure page.** Q2's approved heading and text, exactly; no em dashes; no new claims.

## 2 to 4. Search, accessibility, performance

- **PASS · Accessibility.** One `h1`, the layout's skip link and landmarks, contrast above (Hallmark audit).
- **N/A · Search, performance.** The pages are `noindex` and unchanged in size beyond two short lines.

## 5. Forms

- **PASS · The verify pages' answers.** A failure on the site's side answers the failure page with status 500; every
  refusal keeps the expired page and its status; a POST whose body is not a form answers as a POST with no key.
- **FOUND · The Continue form's POST** is refused by the middleware in a browser (see "Found while working").

## 6. Privacy

- **PASS · Logs.** Each fault is logged once through `logUnexpected`: the label, the error's name and its message with
  addresses redacted. No answer carries an error's text.

## 7. Release and final QA

- **PASS · Checks, rollback.** See above.
- **PENDING · Reviews, CI, production revision and live check.**
- **UNVERIFIED · The 500 answers live.** No database fault can be induced live; the answers are held by the tests, the
  golden corpora and the local screenshots.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
