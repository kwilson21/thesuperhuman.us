# Studio sign-in codes bound to the browser release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/fix-signin-codes`, merged with `origin/main` (a merge commit, never a rebase)
Commits: see the pull request; the final head is recorded in the pull request description.
Pull request: [#268](https://github.com/kwilson21/thesuperhuman.us/pull/268)
Target: production `https://thesuperhuman.us`. The studio sign-in routes are `/api/studio/code` and `/api/studio/session`.
Reviewers: Claude Haiku 5.5 subagents wrote the code, tests first (this revision was written by a Claude Sonnet 5.5 subagent under the same instruction); independent reviews are listed under Reviews. Greptile and Codex review the pull request.
Rollback revision: `origin/main` before this branch merges. Re-check `git rev-parse origin/main` at merge time. Migration 0027 only adds a table and a rollback does not need it dropped; the old code keeps working against the migrated database.

## Scope

- The problem: sign-in codes were kept one row per email address, so anyone who knew a client's address could use up the client's attempts and allowances or replace the code the client had just been sent. A code now belongs to the browser that asked for it.
- A code request sets a pending sign-in cookie (`__Host-studio_pending`, Path `/`, Secure, HttpOnly, SameSite=Lax, 10 minutes over https; `studio_pending` on `/api/studio` on plain-http localhost). A code is accepted only with that cookie, from the row it was issued to.
- Each code is its own row (migration 0027, a new table). At most 6 live codes per address; the email allowance (3 per five minutes) is unchanged. A browser that asks again replaces its own code in place; asking for a different address always deletes the earlier code.
- The decisions are pure functions (`src/lib/signin-code-rules.ts`) and SQL keeps only guards. Issuing a code and entering one each make the same round trips with the same statements for every address and code state.
- The code email loses its "Open the sign-in page" link. The sign-in page and the email note gain the approved sentences listed under Owner decisions.
- The retired `audio_client_codes` table is still cleared by retention, owner health and access closure (best effort) until a later migration drops it.
- A Quint model, `verification/signin-codes.qnt`, with 17 mutants that fail, runs in the pooled CI step; `docs/verification.md` describes it and classifies every statement of the sign-in code path.
- The screenshot scenario `software-project` gains a step that shows the "check your email" form at both sizes.
- No change to Stripe, invoices, the owner pages or any other route.

## Owner decisions

- 2026-11-13: "Sentences are fine, remove the link, apply the migration." The three sentences, approved as written:
  - Sign-in page: "We sent an eight-digit code. It expires in 10 minutes. Enter it in this browser."
  - Code email note: "This code expires in 10 minutes. Enter it in the browser where you asked for it. If you didn’t ask for it, you can ignore this email."
  - Refusal: "That code is invalid or expired. Enter it in the browser where you asked for it, or request a new one here."
- 2026-11-13: remove the "Open the sign-in page" link from the sign-in code email (done; the invitation, update, review and handoff emails keep their links).
- 2026-11-13: apply migration `0027_audio_client_signin_codes.sql` to production. The operator applies it, from the final committed file, immediately before merge.
- Recorded without a separate owner decision (a design consequence): the studio routes keep answering 503 for a database error, and the code route answers the generic 200 after a lost race. A 409 or a 500 there would show that an address has a project, and the studio area is not converted to the Effect form yet.

## Reviews

- Round 1 (security, independent, head `ccf2779f`): no code must-fix. Five items: the retired table was no longer cleared by retention, owner health or access closure; a browser's earlier row for another address stayed live; two tabs at once create two codes; the guessing budget and the cookie scope needed stating; the code email's link contradicts the new note.
- Round 2 (security, independent, head `233de829`): clean, with one note: the cleanup of the retired table ran after the revocation had committed and could report a failed revocation, so it became best effort with a fixed log line.
- Round 3 (Codex at `233de829`, then two independent reviewers at `a90d6926`):
  - Codex found two things: decisions (which codes are live, the cap, project eligibility) were made in SQL strings, and a cap race let a refused request overwrite the cookie of a code another request of the same browser had just emailed. Both were fixed (pure decision functions; the cookie value the browser sent is returned whatever the outcome), with the model extended to two-step requests.
  - The security reviewer found three ways to learn whether an address has a project, all from the rewrite: a request that issued nothing kept the browser's earlier code, entering a code made a different number of round trips depending on the row, and the attempt was counted on a code issued after it was read; also audit rows could be written for a project closed in between, and a stale code route comment.
- Repo-rules round (same head): the live-code predicate still decided inside the COUNT, the model did not cover the read-to-write gap, the "check your email" step had no screenshot, and this record was missing. This revision fixes each.
- Each finding was verified against the code and fixed with a test that failed first. Greptile and Codex review the pull request head.

## Evidence

- Local runs on macOS arm64, Node 26, pnpm, on the head recorded in the pull request: format, build, the client-bundle test, `pnpm test` twice with a clean `git status`, `QUINT_JOBS=4 pnpm run verify:quint:all`, the publicist gate, Oxlint at 53, `pnpm run check` with 0 errors and 17 hints. The pull request description carries the exact lines.
- `git diff ccf2779f HEAD -- migrations` is empty: migration 0027 is byte-identical to the file the owner approved.
- Golden fixtures re-recorded each in their own commit with a per-case comparison: `studio-code` and `studio-session` changed, plus the owner and sign-out fixtures when the table was renamed. Every existing case keeps its status, body and stored rows except the listed ones (session token values and one audit row order, and the case where a replaced code is no longer charged).
- The round-trip test records every database batch of a code request (for an address with a project, one without and a full one) and of an entry (no row, used, expired, exhausted, wrong, right) and asserts the same batch and statement counts in each.

## Migration ledger and deployment

- Production migration ledger, listed read-only on 2026-11-13 (command `pnpm exec wrangler d1 migrations list MUSIC_DB --remote`, nothing applied): exactly one pending migration, `0027_audio_client_signin_codes.sql`. The README's earlier warning that 0022 to 0024 might still be pending was out of date and is corrected in this pull request.
- `apply` runs every pending migration in order, so only 0027 will be applied.
- Order: apply 0027 first, then merge (merging deploys production). Deploying the code first answers 503 to every code request and sign-in. The migration leaves `audio_client_codes` alone, so the code running before the deploy keeps working on the migrated database; codes pending at the deploy stop working and the client asks for a new one (they expire in 10 minutes).
- A follow-up migration, `0028`, drops `audio_client_codes` after this deploy is live. It is not part of this pull request, because applying it together with 0027 would break the code still running.

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** One branch from `origin/main`, merged, with the scope above. Deployment authorization: the owner approved applying 0027 and the sentences (2026-11-13); merging is a separate step.
- **PASS · Truthful claims and copy.** The three sentences are the owner's, unchanged. No professional claim changes. No em-dashes in the added copy.
- **N/A · First screen and navigation.** The sign-in page gains one sentence.

## 2. Search and sharing

- **N/A.** No route, metadata or head change. The sign-in page is already `noindex`.

## 3. Accessibility and responsive behavior

- **PASS, with limits · Copy and layout.** One sentence is added to an existing paragraph on the sign-in page. The screenshot scenario captures the "check your email" step at 1280x800 and 390x844; the CI Screenshots workflow runs it and its images are in the pull request description.
- **UNVERIFIED · The scenario run.** The scenario was not run locally (it needs the screenshot environment). CI runs it.

## 4. Performance and resilience

- **PASS · Resilience.** A database error answers 503 with a fixed sentence, as before. A lost race is answered like a refusal. Two requests from one browser at once are accepted (both emailed, the later code opens), and are covered by tests.
- **UNVERIFIED · Measured performance.** Not measured. A code request now makes three database round trips, and an entry two.

## 5. Forms and sensitive flows

- **PASS · Sign-in flow.** Tests cover: a different browser with the right code is refused; guesses without the cookie change nothing; a stranger's requests and guesses cannot lock the client out; expiry, reuse, the live-code and email limits; cookie attributes and tampering; races at the route level with real interleaving.
- **PASS · No enumeration.** The answer, cookie value and database round trips do not depend on whether an address has a project (tests record them for three cases).
- **UNVERIFIED · Live sign-in.** Request a code in a real browser, sign in from the same browser, and try the code from another browser. To be completed by the operator after the deploy.

## 6. Privacy, legal and measurement

- **PASS · Data.** The pending cookie holds a random value only. Rows store hashes, never the code or the value. No new processor, analytics or storage beyond the table in 0027.
- **N/A · Consent and cookies banner.** The cookie is strictly necessary for sign-in and short lived.

## 7. Release and final QA

- **PASS · Checks.** See Evidence.
- **PASS · Diff review.** `git diff --stat origin/main` lists the scope above; no secrets, no dependency changes, no generated files committed.
- **UNVERIFIED · Backup evidence.** To be completed by the operator immediately before merge: the database's point-in-time restore marker, recorded before applying the migration. Not recorded here.
- **UNVERIFIED · Applying migration 0027.** To be completed by the operator immediately before merge: apply `0027_audio_client_signin_codes.sql` to production from the final committed file, and record the result.
- **UNVERIFIED · Post-apply check.** To be completed by the operator immediately before merge: confirm that `audio_client_signin_codes` exists, for example with `pnpm run owner:health --remote`, which reports a missing required table.
- **UNVERIFIED · Live verification after deploy.** To be completed by the operator: a sign-in from the same browser, a refusal from another browser, the code email (no link), and the sign-in page sentence.
- **PASS · Rollback version.** See the header. Re-check `origin/main` at merge time.

## 8. Private owner center

- **PASS · Reconcile the production MUSIC_DB migration ledger before applying any migration.** Done read-only on 2026-11-13 (see above). Backup and recovery evidence is separate and is UNVERIFIED above.
- **PASS · Access closure.** Closing a client's access still deletes every sign-in code for the address, and best-effort clears the retired table.

## Remaining work

- CI green on the pull request head with the pooled Quint step inside its budget; Greptile and Codex reviews on the head.
- The operator's UNVERIFIED items above, immediately before merge.
- The follow-up migration `0028` (drop `audio_client_codes`) after this deploy is live.
