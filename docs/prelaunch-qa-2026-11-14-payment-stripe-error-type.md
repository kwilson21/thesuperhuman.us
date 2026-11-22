# Payment route answers 502 for a Stripe failure by error type: release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Target: production `https://thesuperhuman.us`
Reviewer: built with Claude Code and reviewed in independent AI review rounds; Greptile and Codex review on the pull request. Owner review: the before and after table was shown to the owner before the merge (see Owner decisions); no other owner review. This record does not certify the checks listed as UNVERIFIED.
Branch: `claude/followup-stripe` (pull request #279), which was stacked on #278; both are merged to `main`
Rollback: revert the merge commit `85cf0d39` (first parent `6822a848`) to undo only this change. That first parent was not built or deployed on its own; production before these three merges was `6c30c5d7`.

## Scope

A behaviour change in one route. `src/pages/api/owner/requests/[id]/payment.ts` answered 502 for a failed Stripe invoice action only when the error message contained "Stripe" or "hosted payment URL", and 409 otherwise. Many real Stripe refusals do not contain that word, so they were answered as a 409 conflict. The route now answers 502 when the error is a Stripe SDK error or one of this code's own Stripe provider errors, raised for an unusable response or when invoicing is unavailable (`isStripeProviderFailure` and `StripeProviderError` in `src/lib/stripe-invoicing.ts`), and 409 otherwise. Response bodies are unchanged (`{"ok": false}`). The same catch serves the create and the replace actions for booking and balance invoices. No other route, the webhook, software invoices, text, migration, binding or dependency changed. Besides the route and the library, the change touches tests, the Stripe stand-in, one re-recorded fixture and the explanatory comment at the top of `tests/golden/owner-request-payment.test.ts`.

Live since deployment: `wrangler.jsonc` sets `STRIPE_PAYMENTS_ENABLED` to `"true"`. Whether the Stripe secrets are set in production was not checked here (UNVERIFIED). If they are, the new statuses apply to real invoice actions now.

| Stripe refusal or failure | Before | After |
| --- | --- | --- |
| Bad request (400) whose message does not say "Stripe" | 409 | 502 |
| Bad request (400) whose message says "Stripe" | 502 | 502 |
| Wrong API key (401) | 409 | 502 |
| Rate limited (429) | 409 | 502 |
| Idempotency conflict | 409 | 502 |
| Stripe server error (500) whose message does not say "Stripe" | 409 | 502 |
| Stripe server error (500) whose message says "Stripe" (from reading the code, not a recorded case) | 502 | 502 |
| Stripe unreachable (connection dropped) | 502 | 502 |
| Request timeout (from reading the SDK, not a recorded case) | 409 | 502 |
| Invoice returned as a draft, or with no or a non-https link | 502 | 502 |
| Stripe payments off or not configured | 503 | 503 |
| Stripe sent the invoice but saving it failed | 503 | 503 |
| A site-raised state conflict, or a retry blocked by the reservation | 409 | 409 |

A reviewer read the owner page's script (`src/scripts/owner-payment-actions.ts`): it shows the same message for 409 and 502 and never retries on its own. After any failure the reservation row stays set and idempotency keys include the attempt count, so a 502 cannot lead to a second invoice. On a replace action the refusal can arrive after the old invoice was already voided and the replacement recorded as reserved (the recorded case "replace booking: Stripe refuses after the replacement was recorded"); that sequence is unchanged apart from its status, 409 before and 502 now.

Two things for the owner to know. An idempotency conflict and an invalid request such as "Invoice is already finalized" are Stripe refusals that read like conflicts; they now answer 502 with the rest. And the old match ignored case, so a non-Stripe error whose message happened to contain lowercase "stripe" (for example a database error naming a `stripe_` column) answered 502 and now answers 409; no such case was reproduced.

## Owner decisions

- The owner approved building this fix (approval relayed to the pull request author, 2026-11-14), and, after being shown the table above, approved merging once the checks were clean (2026-11-15).

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1; no logs retained.

- Tests first: three new cases in `tests/api/owner-payment.test.ts` (invalid request, API error and authentication failure whose messages do not name Stripe) failed on the old code with "expected 409 to be 502" and pass now. Three more (connection failure, unusable send, a site-raised conflict stays 409) pass before and after and pin the other rows. Each failure case asserts no invoice was recorded.
- Golden corpus: `tests/golden/fixtures/owner-request-payment.json.gz` was re-recorded in its own commit. 21 of 221 cases change, each only in the first step's response status, 409 to 502; bodies, headers, database statements, outgoing requests, logs and rows are unchanged. The commit message and the pull request list the cases. No other fixture changed. After `main` re-recorded its fixtures in a newer format, `main` was merged in, its fixture taken, and the same change re-recorded on top in a commit of its own: again 21 of 221 cases, each only the first step's status.
- Top of this branch, after merging `main` at `6c30c5d7`, run without a build: `oxlint --deny-warnings` exit 0; `biome format .` no fixes; `astro check` 0 errors; the full test suite passed except one test, `tests/scripts/publication-journal-trace.test.ts`, which starts an external model run and fails the same way in every scratch checkout used here, including one with documentation changes only, while passing in a normal checkout of `main`. It is treated as a local setup limit; `validate` in CI is the check. Before that merge, the build, the full suite and the built-bundle tests passed on this branch.
- One independent review round for correctness and security and one for repository rules: no blocker or should-fix item. The correctness review enumerated every error that can reach the changed line and found the only status change is the intended one, apart from the lowercase case noted above.
- `validate` and all six test lanes passed on the final head, and Codex found nothing. The one test that failed in the scratch checkout was not looked up individually in the CI logs. UNVERIFIED: the built Worker bundle was not inspected for the Stripe error class check; the server code already relies on the same check elsewhere.
- UNVERIFIED: no Stripe test-mode run. The statuses come from tests with a stand-in for Stripe and from the recorded corpus.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch and scope: see the header and Scope. PASS, deployment authorization: after being shown the before and after table, the owner approved merging once the checks were clean (2026-11-15).
- N/A, 1.2 to 1.5: no page, copy, media, link or route changed.

### 2. Search and sharing

- N/A, 2.1 to 2.7: no page, metadata, asset, route or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, 3.1 to 3.7 and `hallmark audit`: no markup, style or browser script changed.

### 4. Performance and resilience

- N/A, 4.1 to 4.6: no image, client code, dependency or rendered path changed.

### 5. Forms and sensitive flows

- N/A, 5.1 Server validation, origin, auth, abuse protection and rate limits: unchanged; the route's owner check and input reading are untouched and their existing tests pass.
- PASS (local tests only), 5.2 Server statuses for Stripe failures, including rate limit and server error: see the table. UNVERIFIED, 5.2 timeout (read from the SDK, not run), the pending button, retry and duplicate submit in a browser.
- N/A, 5.3, 5.4 and 5.6: no page, delivery or confirmation changed.
- PASS (local tests only), 5.5 Approval-gated flows intact.

### 6. Privacy, legal and measurement

- N/A, 6.1 to 6.5: nothing collected, stored or sent changed. No response or log line includes Stripe's message, a customer identifier or a key.
- UNVERIFIED, 6.6 Monitoring: unchanged and not observed. Whether any 5xx alerting or `owner:health` treats a 502 from this route differently from a 409 was not checked; more failures now answer 502.

### 7. Release and final QA

- PASS (local), 7.1 Required checks: see Evidence and limits.
- PASS, 7.2 Diff review: independent review locally, and Codex's code and security reviews of the final head found nothing; no review thread was open at merge. Greptile reviewed only the first head, because its reviews on this repository are paused.
- UNVERIFIED, 7.3 Production bindings, secrets, migrations, routing, cache and headers: none changed; not observed live.
- PASS (tried without committing), 7.4 Rollback: a git revert of the merge commit `85cf0d39` applies to the code, tests and fixture; see "Merge and deployment". Production before the three merges was `6c30c5d7`.
- UNVERIFIED, 7.5 Post-deployment verification, apart from what "Merge and deployment" lists: no journey, form, owner center or payment action was exercised live.
- PASS, 7.6 Implemented: yes. Verified locally: yes. Deployed: yes, as part of `9eecc5e2` (which contains `85cf0d39`). Verified live: two pages answer 200; the payment route's new statuses are not observed live.

### Software agreement signing

- N/A: no agreement, signing, template or retention code changed.

### 8. Private owner center

- N/A, 8.1, 8.3 to 8.8 and 8.10: no Access, migration, analytics, retention or studio code changed.
- PASS (local, by reading the code), 8.2 Owner response headers: the changed line keeps the route's `cache-control: private, no-store` headers, and the middleware's `x-robots-tag` is untouched.
- N/A, 8.9 Launch scope with payments off: the flag's handling is unchanged; with payments off the route still answers 503 before any Stripe call.
- UNVERIFIED, 8.11 Keep payments off until the Stripe test-mode lifecycle passes: `wrangler.jsonc` has the flag set to `"true"` already, and no test-mode booking and balance lifecycle was run for this change.
- UNVERIFIED, 8.14 Rollback procedures and 8.15 `owner:health` on the target: not run.
- PASS (local tests only), 8.12 Repeated invoice actions create no duplicate invoice: the reservation and idempotency behaviour is unchanged and the recorded "stuck reservation" sequence differs only in its first status. UNVERIFIED in Stripe test mode.
- PASS (local, by review), 8.13 No Stripe secret or customer identifier in responses: every body on the changed path is `{"ok": false}`.

## Merge and deployment (added after the merge)

- Merged 2026-11-16 at about 01:22 UTC (the evening of 2026-11-15, US Eastern) as merge commit `85cf0d39`, whose first parent is `6822a848`.
- Before the merge, read on the final head: every check passed, including `validate`, and Codex's code and security reviews had no finding.
- This is the one behaviour change of the three: from this deployment the owner payment route answers 502 for the Stripe refusals listed in the table. No invoice action was exercised live and no Stripe test-mode run was made, so the new statuses are unobserved in production.
- Production build: this merge commit got no Workers Builds (production build) check of its own, because another pull request merged to `main` straight after. The Workers Builds check on the next `main` commit, `9eecc5e2`, which contains this merge, completed with success, and `validate` passed on that commit.
- Checked by a plain HTTP request on 2026-11-16 at about 01:35 UTC, after `9eecc5e2` built: `https://thesuperhuman.us/` and `https://audio.thesuperhuman.us/` each answered 200. No other live check was made.
- Rollback: `git revert -m 1 85cf0d39` undoes only this change. Tried without committing after this record update: the route, the library, the tests and the fixture revert cleanly, and the revert stops only on this record, which was edited since and is kept by hand. The reverted state was not built or tested.

## Delivery status

Current state: Implemented: yes. Verified locally: yes. Deployed: yes, as part of `9eecc5e2` (which contains `85cf0d39`). Verified live: two pages answer 200; the payment route's new statuses are not observed live.
