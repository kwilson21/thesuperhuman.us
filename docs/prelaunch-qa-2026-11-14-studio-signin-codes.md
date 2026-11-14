# Studio sign-in codes bound to the browser release gate

Date: November 13, 2026 (the date this record was last written; the file name keeps the planned release date)
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

Four security rounds and two repo-rules rounds, each finding verified against the code and fixed with a test that failed first:

- Security round 1 (independent, head `ccf2779f`): no code must-fix. Five items: the retired table was no longer cleared by retention, owner health or access closure; a browser's earlier row for another address stayed live; two tabs at once create two codes; the guessing budget and the cookie scope needed stating; the code email's link contradicts the new note.
- Security round 2 (independent, head `233de829`): clean, with one note: the cleanup of the retired table ran after the revocation had committed and could report a failed revocation, so it became best effort with a fixed log line.
- Security round 3 (Codex at `233de829`, then two independent reviewers at `a90d6926`): Codex found decisions (which codes are live, the cap, project eligibility) made in SQL strings and a cap race that let a refused request overwrite the cookie of a code another request of the same browser had just emailed. The security reviewer found three ways to learn whether an address has a project, all from the rewrite: a request that issued nothing kept the browser's earlier code, entering a code made a different number of round trips depending on the row, and the attempt was counted on a code issued after it was read; also audit rows could be written for a project closed in between, and a stale comment. All fixed.
- Security round 4 (the security reviewer and Greptile, head `efb1ec3f`): a lost race on the code route answered 503 only when the target address had an open project, because the write replaced the browser's row only for the same address and two requests on one cookie for different addresses collided on the table's key. Fixed: the write replaces the row that holds the cookie value whatever its address, and the model now includes the key.
- Repo-rules round 1 (head `a90d6926`): the live-code predicate still decided inside a COUNT, the model did not cover the read-to-write gap, the "check your email" step had no screenshot, and this record was missing.
- Repo-rules round 2 (head `efb1ec3f`): the document's "no decisions in SQL" line was not exactly true for the expired-row sweep and the allowance clean-up, the guard did not use the rule's cap, the Hallmark audit had not been recorded, and this record's checklist items, ledger wording and date needed fixing.
- Greptile and Codex review the pull request head.

## Hallmark audit (`docs/design-standard.md`, "Auditing before review")

- Audited: `src/pages/studio/sign-in.astro`, the only UI file this pull request changes (one sentence added to an existing paragraph, with no new markup, style or token). `hallmark audit` is a verb of the vendored agent skill (`.agents/skills/hallmark/references/verbs/audit.md`), not a command line program, so it was run as that document describes: a read-only read of the page against `design.md` and the skill's named tells, with the mechanical gates (`pnpm run design:check`: passed, 6 gates, 12 allowlisted exceptions).
- Defects introduced by this pull request: none. The added sentence uses the page's existing `.studio-intro.small` style (muted ink on paper, 8.4:1), adds no colour, transition or font, and has no em-dash.
- Findings that are not this pull request's, listed and not changed (design choices for the owner): the page sets its form text in Inter, which `design.md` assigns to private UI (a recorded decision); one kicker eyebrow above the heading (the page's existing design); the corner picture's mask uses `#000` stops, which the standard treats as transparency, not colour (a false positive).
- Limits: a static read plus the mechanical gates. The rendered "check your email" step is captured by the CI Screenshots workflow (see section 3), and the Hallmark standard's own review of the renders is left to that run.
- Result: PASS, with limits.

## Evidence

- Local runs on macOS arm64, Node 26, pnpm, on the head recorded in the pull request: format, build, the client-bundle test, `pnpm test` twice with a clean `git status`, `QUINT_JOBS=4 pnpm run verify:quint:all`, the publicist gate, Oxlint at 53, `pnpm run check` with 0 errors and 17 hints. The pull request description carries the exact lines.
- `git diff ccf2779f HEAD -- migrations` is empty: migration 0027 is byte-identical to the file the owner approved.
- Golden fixtures re-recorded each in their own commit with a per-case comparison: `studio-code` and `studio-session` changed, plus the owner and sign-out fixtures when the table was renamed. Every existing case keeps its status, body and stored rows except the listed ones (session token values and one audit row order, and the case where a replaced code is no longer charged).
- The round-trip test records every database batch of a code request (for an address with a project, one without and a full one) and of an entry (no row, used, expired, exhausted, wrong, right) and asserts the same batch and statement counts in each.

## Migration ledger and deployment

- Production migration ledger, as observed by the operator on 2026-11-13: `pnpm exec wrangler d1 migrations list MUSIC_DB --remote` (read-only, nothing applied) listed exactly one pending migration, `0027_audio_client_signin_codes.sql`. This was not re-run by the author of this record.
- **UNVERIFIED · Re-list immediately before applying.** To be completed by the operator: list the ledger again and confirm that `0027_audio_client_signin_codes.sql` is still the only pending migration; stop and ask if anything else is pending. The README's earlier warning that 0022 to 0024 might still be pending was out of date and is corrected in this pull request.
- `apply` runs every pending migration in order, so only 0027 will be applied.
- Order: apply 0027 first, then merge (merging deploys production). Deploying the code first answers 503 to every code request and sign-in. The migration leaves `audio_client_codes` alone, so the code running before the deploy keeps working on the migrated database; codes pending at the deploy stop working and the client asks for a new one (they expire in 10 minutes).
- A follow-up migration, `0028`, drops `audio_client_codes` after this deploy is live ([issue 271](https://github.com/kwilson21/thesuperhuman.us/issues/271)). It is not part of this pull request, because applying it together with 0027 would break the code still running.

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

- **PASS, as observed by the operator · Reconcile the production MUSIC_DB migration ledger before applying any migration.** The operator listed it read-only on 2026-11-13 (see above) and it is to be listed again immediately before applying (UNVERIFIED above). Backup and recovery evidence is separate and is UNVERIFIED above.
- **PASS, locally; production UNVERIFIED · Studio-retention preview (`pnpm run studio:retention:preview`) and manifest inspection.** `scripts/studio-retention.mjs` changed (it also reviews and deletes the retired table). Run locally through the preview function against a seeded in-memory copy of `db/music.sql` (one closed project, two retired and two current codes, half of each older than 30 days): with the retired table present the review counts `projects: 1`, `codes: 1`, `retiredCodes: 1` (one old row each); with it dropped `retiredCodes: 0` and the rest equal. The review holds counts and source hashes only: no address, code hash or cookie value. The apply is covered by tests (`tests/scripts/studio-retention.test.ts`) in both states. **UNVERIFIED:** the preview against the production database and a reviewed manifest. To be completed by the operator.
- **PASS, locally; production UNVERIFIED · `pnpm run owner:health` against the target environment.** `scripts/owner-health.mjs` changed (it counts old rows of the retired table while it exists). Run locally through `ownerHealth` against the same seeded database: `schema: pass` with the table present and absent, and `studio-retention: attention: 3 studio retention items need review` with it present and 2 with it dropped (the rest pass). **UNVERIFIED:** `owner:health --remote` against production, which also reports a missing `audio_client_signin_codes` until 0027 is applied. To be completed by the operator after applying.
- **UNVERIFIED · Production bindings, secrets and migrations.** The change reads no new binding or secret (`AUDIO_CLIENT_CODE_KEY`, `MUSIC_DB`, Turnstile and Resend are unchanged). The operator confirms them against the target environment, together with the migration and backup steps in section 7.
- **PASS · Access closure.** Closing a client's access still deletes every sign-in code for the address, and best-effort clears the retired table.

## Status

- Implemented: yes (the head recorded in the pull request).
- Verified locally: yes, as listed under Evidence and above.
- Deployed: no. Merging deploys production, and the operator applies 0027 first.
- Verified live: no. See the UNVERIFIED items in section 7.

## Remaining work

- CI green on the pull request head with the pooled Quint step inside its budget; Greptile and Codex reviews on the head.
- The operator's UNVERIFIED items above, immediately before merge.
- The follow-up migration `0028` (drop `audio_client_codes`, [issue 271](https://github.com/kwilson21/thesuperhuman.us/issues/271)) after this deploy is live.
