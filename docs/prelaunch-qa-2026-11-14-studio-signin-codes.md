# Studio sign-in codes bound to the browser release gate

Date: November 14, 2026 (the date this record was last written; the file name keeps the planned release date)
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/fix-signin-codes`, merged with `origin/main` (a merge commit, never a rebase)
Head described by this record: `bfd7980f`, the commit before this record's own final edit; the pull request description carries the final head. Every command result below was observed on that head (the merged `origin/main` at `f4c96c4c`, PR 270, is in it).
Pull request: [#268](https://github.com/kwilson21/thesuperhuman.us/pull/268)
Target: production `https://thesuperhuman.us`. The studio sign-in routes are `/api/studio/code` and `/api/studio/session`.
Reviewers: Claude Haiku 5.5 subagents wrote the code, tests first (this revision was written by a Claude Sonnet 5.5 subagent under the same instruction); independent reviews are listed under Reviews. Greptile and Codex review the pull request.
Rollback revision: `origin/main` before this branch merges. Re-check `git rev-parse origin/main` at merge time. Migration 0027 only adds a table and a rollback does not need it dropped; the old code keeps working against the migrated database.

## Scope

- The problem: sign-in codes were kept one row per email address, so anyone who knew a client's address could use up the client's attempts and allowances or replace the code the client had just been sent. A code now belongs to the browser that asked for it.
- A code request sets a pending sign-in cookie (`__Host-studio_pending`, Path `/`, Secure, HttpOnly, SameSite=Lax, 10 minutes over https; `studio_pending` on `/api/studio` on plain-http localhost). A code is accepted only with that cookie, from the row it was issued to. A successful sign-in does not clear the cookie (a browser that holds codes for two addresses needs it for the second sign-in); it expires by its Max-Age, which each code request resets. A used code cannot be used again.
- Each code is its own row (migration 0027, a new table), keyed by the cookie value and the address: `PRIMARY KEY (nonce_hash, email)`. At most 6 live codes per address; the email allowance (3 per five minutes) is unchanged. A browser that asks again for the same address replaces its own code in place. Asking for a different address leaves the earlier code alone: a request for an address reads, writes and deletes only the rows of that address, so what a stranger can see of another address does not depend on that address's state. There is no cap per cookie value; the rows one browser can create are bounded by the per-address limits, the captcha and the per-IP allowance (see `docs/verification.md`).
- The decisions are pure functions (`src/lib/signin-code-rules.ts`) and SQL keeps only guards. Issuing a code and entering one each make the same round trips with the same statements for every address and code state.
- The code email loses its "Open the sign-in page" link. The sign-in page and the email note gain the approved sentences listed under Owner decisions.
- The retired `audio_client_codes` table is still cleared by retention, owner health and access closure (best effort) until a later migration drops it (0028, [issue 271](https://github.com/kwilson21/thesuperhuman.us/issues/271)).
- A Quint model, `verification/signin-codes.qnt` (13 properties, 19 mutants that each fail), runs in the pooled CI step; `docs/verification.md` describes it and classifies every statement of the sign-in code path.
- A route-level enumeration test, `tests/api/studio-signin-noninterference.test.ts`, checks that a request for one address changes nothing an attacker can observe of another. A sample runs in `pnpm test`; the full set runs only with `SIGNIN_EXHAUSTIVE=1` and is not run in CI.
- The screenshot scenario `software-project` gains a step that shows the "check your email" form at both sizes.
- No change to Stripe, invoices, the owner pages or any other route.

## Owner decisions

- 2026-11-13: "Sentences are fine, remove the link, apply the migration." The three sentences, approved as written:
  - Sign-in page: "We sent an eight-digit code. It expires in 10 minutes. Enter it in this browser."
  - Code email note: "This code expires in 10 minutes. Enter it in the browser where you asked for it. If you didn’t ask for it, you can ignore this email."
  - Refusal: "That code is invalid or expired. Enter it in the browser where you asked for it, or request a new one here."
- 2026-11-13: remove the "Open the sign-in page" link from the sign-in code email (done; the invitation, update, review and handoff emails keep their links).
- 2026-11-13: apply migration `0027_audio_client_signin_codes.sql` to production. That approval was for the earlier file; the file changed afterwards (see Evidence and "Before merge" step 3).
- Recorded without a separate owner decision (a design consequence): the studio routes keep answering 503 for a database error, and the code route answers the generic 200 after a lost race. A 409 or a 500 there would show that an address has a project, and the studio area is not converted to the Effect form yet.

## Reviews

One line per round; each finding was verified against the code and fixed with a test that failed first.

- S1 (security, `ccf2779f`): design sound; the retired table was no longer cleaned by retention, owner health or access closure; the guessing budget and cookie scope needed stating; the code email link contradicted the new note.
- S2 (security, `233de829`): clean; the cleanup of the retired table ran after the revocation had committed and could report a failed revocation, so it became best effort with a fixed log line.
- S3 (security, `a90d6926`): a refused request no longer deleted the browser's earlier code, and code entry took a different number of database round trips depending on the code's state; both revealed whether an address has a project. Also: audit rows could be written for a project closed in between, and an attempt was counted on a code issued after it was read.
- S4 (security, `efb1ec3f`): a lost race on a shared cookie answered 503 only for an address with a project.
- S5 (security, `51838541`, re-run at `09fd9f37`): two concurrent requests on one cookie made the client's own code work or fail depending on the other address; and the expired-row sweep could delete a fresh code.
- S6 (security, `93ad0f77`, after the redesign to one row per cookie and address): clean on non-interference (its own harness: about 3,300 sampled orderings across 46 scenarios and one exhaustive set of 1,680, no difference; a mutation to delete by cookie alone made 10 of 20 differ). It left one functional bug, handled in this round (the pending cookie was cleared on success), and test and model coverage items.
- R1 (repo rules, `a90d6926`): which codes are live was decided inside a SQL count; no release record.
- R2 (repo rules, `efb1ec3f`): no decision in SQL after the fix; release record and Hallmark audit gaps.
- R3 (repo rules, `93ad0f77`): no decision in SQL; stale documentation and record gaps.
- Two bot findings changed the code: decisions inside an INSERT (Codex), and the pending cookie cleared on a successful sign-in, so a browser with two addresses could use only one (Greptile 4571328627; fixed in this round: the cookie is no longer cleared, and the tests now carry cookies as a browser does).
- Round 7 (the redesign that S6 reviewed) and why: rows had been keyed by the cookie value alone, and a request deleted or replaced the browser's row whatever its address. A stranger that sent one cookie value with requests for two addresses could learn from its own answers and from whether its first code survived whether the second address had a project. Rows are now keyed by `(nonce_hash, email)` and every statement of a request for address T touches only T's rows.

## Evidence

All commands were run on macOS arm64, Node 26, pnpm, on the head named in the header, with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1` on the test runs.

- `pnpm run format:check`: `Checked 750 files in 97ms. No fixes applied.`
- `pnpm run build`: `[build] Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: `Tests  27 passed (27)`
- `pnpm test`, run twice, `git status` clean after each (only the untracked `.jolli/` of the local hook): `Test Files  293 passed (293), Tests  12699 passed | 1 skipped (12700), 87.9 s`; `Test Files  293 passed (293), Tests  12699 passed | 1 skipped (12700), 91.3 s`
- `SIGNIN_EXHAUSTIVE=1 pnpm exec vitest run tests/api/studio-signin-noninterference.test.ts`: `Tests  23 passed (23), 11 min 39 s (698 s wall; another session was running tests on the same machine)`
- `QUINT_JOBS=4 pnpm run verify:quint:all`: `57 ok lines and no FAIL, 1:17.52 wall (QUINT_JOBS=4); signin pass run 9.5 s; the signin mutants 0.7 to 4.7 s each`
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: `53 errors` (the baseline is 53)
- `git diff 93ad0f77 HEAD -- migrations`: empty (migration 0027 is unchanged since the head the security review passed)
- `pnpm run check` (last): `Result (776 files): 0 errors, 0 warnings, 17 hints`
- **Migration 0027 was changed in place after the owner's 2026-11-13 approval, and he must be told before it is applied.** The primary key changed from `nonce_hash` to `(nonce_hash, email)` (round 7). The file was changed in place because it had not been applied anywhere, and `db/music.sql` is regenerated from the migrations (`tests/architecture/music-schema-copy.test.ts` checks they are equal). **UNVERIFIED:** the owner has not yet been told or approved the changed file; the operator applies it only after he has.
- Final table: `audio_client_signin_codes(nonce_hash, email, code_hash, attempts CHECK 0..5, created_at, expires_at, used_at, session_token_hash, PRIMARY KEY (nonce_hash, email))` with an index on `(email, expires_at)`.
- Golden fixtures. Main's format 4 fixtures were taken in the merge (`4a98d29e`) and the ones this branch changes were re-recorded on the merged code in their own commits (`studio-code`, `studio-session`, then the other 72 whose only differences from main are digests: the music schema gained a table). `pnpm run golden:neutral --all origin/main HEAD` reports `compared 77 fixtures and 9010 cases; 74 of 77 fixtures differ` and `NOT NEUTRAL`, as expected for a behaviour change. By a comparison that removes digests, the dump of the renamed code table and all D1 entries, only `studio-code` and `studio-session` differ in any response, cookie, body or non-D1 effect; the pull request description lists those cases with a reason each.
- The enumeration test `tests/api/studio-signin-noninterference.test.ts` runs every interleaving of the batch steps of two and of three concurrent requests, on one cookie and on two, once for each target state (open, closed only, withdrawn only, none, full), for a client and for a stranger as the attacker, and asserts that what the attacker can observe is identical across target states: each answer's status, body and cookie, the emails to the attacker's addresses, whether each of the attacker's own codes works afterwards, and the state it owns or can affect (its code rows with attempts, used and expired, its sessions, the audit entries of its own projects, and the allowance counters other than those keyed by the target). It also races a request with the attacker's own entry, the target's own client signing in, a revocation, the retention sweep and the passing of time. A browser is a cookie jar. A deterministic sample (42 of 1,680 three-request orderings, 70 of 560 for the target's-client race) runs in `pnpm test`; the full set runs only with `SIGNIN_EXHAUSTIVE=1` and is not run in CI. The first version of this test, on `09fd9f37`, found 9 of 20 orderings of two requests on one cookie observable by the target.
- The round-trip test records every database batch of a code request (for an address with a project, one without and a full one) and of an entry (no row, used, expired, exhausted, wrong, right) and asserts the same batch and statement counts in each.

2026-11-14: merged with `origin/main` at `3561a541` (the music conversion) in a merge commit `28d860c1`. Conflicts were only in `scripts/lib/quint-mutants.mjs`, `tests/scripts/quint-run.test.ts` and the two music golden fixtures, where main's versions were taken and then re-recorded. The golden corpus was re-recorded on the merge in its own commit `7aa75263`; only `music-event` and `music-interest` needed it. `pnpm run golden:neutral --all origin/main HEAD` reports `compared 77 fixtures and 9012 cases; 74 of 77 fixtures differ` and `NOT NEUTRAL`: 8,418 cases differ only in digests because the music schema has one more table; 323 differ only in the dump of the retired `audio_client_codes` table; responses differ only in `studio-code` (the pending cookie) and `studio-session` (the refusal sentence). `pnpm test` with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1` after the merge: `Test Files  298 passed (298)`, `Tests  12821 passed | 1 skipped (12822)`.

## Migration ledger and deployment

- **UNVERIFIED · Production migration ledger.** The operator observed on 2026-11-13 (read-only: `pnpm exec wrangler d1 migrations list MUSIC_DB --remote`) exactly one pending migration, `0027_audio_client_signin_codes.sql`. That was not re-run by the author of this record and is UNVERIFIED until the operator re-lists it immediately before applying (step 1 below).
- `apply` runs every pending migration in order, so only 0027 will be applied, if the ledger is as observed.
- Order: apply 0027 first, then merge (merging deploys production). Deploying the code first answers 503 to every code request and sign-in. The migration leaves `audio_client_codes` alone, so the code running before the deploy keeps working on the migrated database; codes pending at the deploy stop working and the client asks for a new one (they expire in 10 minutes).
- A follow-up migration, `0028`, drops `audio_client_codes` after this deploy is live ([issue 271](https://github.com/kwilson21/thesuperhuman.us/issues/271)). It is not part of this pull request, because applying it together with 0027 would break the code still running.

## Before merge (operator, in order)

1. **UNVERIFIED.** Re-list the production migration ledger (`pnpm exec wrangler d1 migrations list MUSIC_DB --remote`, read-only) and paste the output here. Stop and ask if anything other than `0027_audio_client_signin_codes.sql` is pending.
2. **UNVERIFIED.** Record backup evidence before any change: the database's point-in-time restore marker.
3. **UNVERIFIED.** Tell the owner that migration 0027 changed after his approval of 2026-11-13 (the key is now cookie hash plus address) and get his go-ahead.
4. **UNVERIFIED.** Apply `0027_audio_client_signin_codes.sql` from the final committed file (`pnpm exec wrangler d1 migrations apply MUSIC_DB --remote`) and record the result.
5. **UNVERIFIED.** Confirm the table exists with the new key: `PRAGMA table_info(audio_client_signin_codes)` shows primary-key position 1 on `nonce_hash` and 2 on `email` (and `pnpm run owner:health --remote` reports no missing table).
6. Merge (this deploys production).
7. **UNVERIFIED.** Live verification: the sign-in page sentence, a same-browser sign-in, a refusal from another browser, and no link in the code email. The sign-in needs a real client account, so these stay UNVERIFIED until the operator has one.
8. **UNVERIFIED.** The studio-retention preview (`pnpm run studio:retention:preview`) and `pnpm run owner:health --remote` against production; the retention manifest is reviewed before any apply.
9. Open the follow-up for [issue 271](https://github.com/kwilson21/thesuperhuman.us/issues/271) (drop `audio_client_codes`, migration 0028).

## Hallmark audit (`docs/design-standard.md`, "Auditing before review")

What it was: a static read of the one changed page, `src/pages/studio/sign-in.astro` (one sentence added to an existing paragraph, with no new markup, style or token), against `design.md` and the vendored skill's named tells, plus the mechanical gates (`pnpm run design:check`: passed, 6 gates, 12 allowlisted exceptions, observed in an earlier round of this branch and not re-run for this record, so it is UNVERIFIED on the current head). `hallmark audit` is a verb of the vendored agent skill (`.agents/skills/hallmark/references/verbs/audit.md`), not a command line program. The rendered check waits for the CI Screenshots workflow.

Block for the pull request description:

> **Hallmark audit (static read of `studio/sign-in.astro` against `design.md`, plus `design:check`; the rendered check waits for CI's screenshots)**
> - Defects introduced by this pull request: none. The added sentence uses the existing `.studio-intro.small` style (muted ink on paper, 8.4:1), adds no colour, transition or font, and has no em-dash.
> - Design choices for the owner (not this pull request's, not changed): the page sets its form text in Inter, which `design.md` assigns to private UI (a recorded decision); one kicker eyebrow above the heading (the page's existing design).
> - False positives: the corner picture's mask uses `#000` stops, which the standard treats as transparency, not colour.

- Result: PASS for defects introduced, with the limits above (static read; rendered check pending).

## 1. Purpose and content

- **PASS · Project, branch, changes, instructions and audience.** `git branch --show-current`: `claude/fix-signin-codes`. `git merge-base --is-ancestor origin/main HEAD`: exit 0 (`origin/main` is `f4c96c4c5f0a731d4e297fa62c11af440b4e4a5d`). `git diff origin/main --stat | tail -1`: `124 files changed, 5433 insertions(+), 273 deletions(-)` (most of them golden fixtures). Deployment authorization: the owner approved the sentences and applying 0027 on 2026-11-13, for the earlier migration file (see "Before merge" step 3); merging is a separate step.
- **PASS · Truthful claims and copy.** The three sentences are the owner's. `git diff origin/main -U0 | grep '^+' | grep -v '^+++' | grep -cP '\x{2014}'`: `0` (no em-dash in any added line). No professional claim changes.
- **N/A · First screen and navigation.** The sign-in page gains one sentence; nothing else on the first screen changes.

## 2. Search and sharing

- **N/A.** No route, metadata or head change. The sign-in page is already `noindex`.

## 3. Accessibility and responsive behavior

- **UNVERIFIED · Copy and layout, rendered.** One sentence is added to an existing paragraph on the sign-in page. The screenshot scenario `software-project` captures the "check your email" step at 1280x800 and 390x844 in the CI Screenshots workflow; it was not run locally and no image has been looked at for this record.
- **UNVERIFIED · 320 px.** The checklist asks for at least 320 px. 390 px was looked at statically (the sentence adds a line to a paragraph) and nothing was captured at 320 px; this stays UNVERIFIED until CI captures it or someone looks at it.

## 4. Performance and resilience

- **PASS · Resilience.** `pnpm exec vitest run tests/api/studio-signin-binding.test.ts`: `Tests  32 passed (32)`, including a database error answering 503 with a fixed sentence, a lost race answered like a refusal, and two requests on one cookie interleaved at every batch. The enumeration test (Evidence) covers two and three concurrent requests.
- **UNVERIFIED · Measured performance.** Not measured. A code request makes three database round trips and an entry two.

## 5. Forms and sensitive flows

- **PASS · Sign-in flow.** `tests/api/studio-signin-binding.test.ts` (32 passed), `tests/lib/audio-client-signin-binding.test.ts` (10 passed) and `tests/lib/signin-code-rules.test.ts` (39 passed): a different browser with the right code is refused; guesses without the cookie change nothing; a stranger's requests and guesses cannot lock the client out; expiry, reuse, the live-code and email limits; cookie attributes and tampering; one browser signs in to both of its addresses, one session each, and a used code is refused again.
- **PASS · No enumeration.** The enumeration test (23 tests, `SIGNIN_EXHAUSTIVE=1`, 11 min 39 s) asserts that an attacker sees the same answers, cookies, emails, code results and its own rows, sessions, audit entries and allowance counters whatever the target address's state; the round-trip tests assert the same database round trips and statements for an address with a project, one without and a full one.
- **UNVERIFIED · Live sign-in.** Request a code in a real browser, sign in from the same browser, and try the code from another browser. This needs a real client account and a deployed build ("Before merge" step 7).

## 6. Privacy, legal and measurement

- **PASS · Data stored.** `migrations/music/0027_audio_client_signin_codes.sql` stores `nonce_hash`, `code_hash` and `session_token_hash`, never the code or the cookie value; the pending cookie holds a random value only. No new processor, analytics or storage beyond the table in 0027 (`git diff origin/main --stat -- package.json pnpm-lock.yaml` is empty).
- **UNVERIFIED · Cookie inventory and privacy notice.** The checklist asks to inventory cookies and keep the privacy notice accurate. The new `__Host-studio_pending` cookie (10 minutes, used only to complete sign-in) is not described in `src/pages/privacy.astro`, which says only that the studio stores "a short-lived session cookie". That page was not changed. Pending the owner's decision on a replacement sentence (proposed in the report that accompanies this record).
- **N/A · Consent banner.** The cookie is strictly necessary for sign-in and short lived, so a consent banner is not needed; this does not remove the privacy notice item above.

## 7. Release and final QA

- **PASS · Checks.** See Evidence: format, build, bundle test, `pnpm test` twice, the exhaustive run, the Quint run, the publicist gate, Oxlint and `pnpm run check` with their result lines.
- **PASS · Diff review.** `git diff origin/main --stat -- package.json pnpm-lock.yaml` is empty (no dependency change); `git diff 93ad0f77 HEAD -- migrations` is empty; `git status --short` shows only the untracked `.jolli/` of the local hook; no secret, key or `.dev.vars` is in the diff (a path check, not a secret scan: UNVERIFIED as a scan).
- **PASS · Rollback version.** `origin/main` is `f4c96c4c5f0a731d4e297fa62c11af440b4e4a5d` (observed with `git rev-parse origin/main` on 2026-11-14); re-check it at merge time.
- **UNVERIFIED · Backup, migration, post-apply check and live verification.** All in "Before merge", steps 1 to 9.

## 8. Private owner center

- **UNVERIFIED · Reconcile the production MUSIC_DB migration ledger.** See "Migration ledger and deployment" and "Before merge", step 1.
- **PASS, locally; production UNVERIFIED · Studio retention.** `tests/scripts/studio-retention.test.ts`: `Tests  33 passed (33)` (reviews and deletes both codes tables, by key, in both states of the retired table). **UNVERIFIED:** the preview against the production database and a reviewed manifest ("Before merge" step 8).
- **PASS, locally; production UNVERIFIED · `owner:health`.** `tests/scripts/owner-health.test.ts`: `Tests  23 passed (23)` (the schema check and the old-code count with the retired table present and dropped). **UNVERIFIED:** `owner:health --remote` against production, which also reports a missing `audio_client_signin_codes` until 0027 is applied.
- **UNVERIFIED · Production bindings and secrets.** The change reads no new binding or secret (`AUDIO_CLIENT_CODE_KEY`, `MUSIC_DB`, Turnstile and Resend are unchanged in the diff); the operator confirms them against the target environment.
- **PASS · Access closure.** `tests/lib/audio-project-revocation.test.ts`: `Tests  9 passed (9)`: closing a client's access deletes every sign-in code for the address, another address keeps its code, and the retired table is cleared best effort.

## Status

- Implemented: yes (the head named in the header).
- Verified locally: yes, as quoted under Evidence and above.
- Deployed: no. Merging deploys production, and the operator applies 0027 first.
- Verified live: no. See "Before merge".

## Remaining work

- CI green on the pull request head with the pooled Quint step inside its budget; Greptile and Codex reviews on the head; the CI screenshots at 390 px and, if captured, 320 px.
- The owner's decision on the privacy notice sentence.
- The operator's "Before merge" list.
- The follow-up migration `0028` (drop `audio_client_codes`, [issue 271](https://github.com/kwilson21/thesuperhuman.us/issues/271)) after this deploy is live.
