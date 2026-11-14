# Payment route answers 502 for a Stripe failure by error type: release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Target: production `https://thesuperhuman.us`
Reviewer: built with Claude Code and reviewed in independent AI review rounds; Greptile and Codex review on the pull request. Owner review: none yet. This record does not certify the checks listed as UNVERIFIED.
Branch: `claude/followup-stripe` (pull request #279), stacked on `claude/followup-spy` (pull request #278)
Rollback revision: the production revision when this reaches `main`; after that, its merge commit's first parent. Reverting the merge commit undoes only this change.

## Scope

A behaviour change in one route. `src/pages/api/owner/requests/[id]/payment.ts` answered 502 for a failed Stripe invoice action only when the error message contained "Stripe" or "hosted payment URL", and 409 otherwise. Many real Stripe refusals do not contain that word, so they were answered as a 409 conflict. The route now answers 502 when the error is a Stripe SDK error or one of this code's own Stripe provider errors, raised for an unusable response or when invoicing is unavailable (`isStripeProviderFailure` and `StripeProviderError` in `src/lib/stripe-invoicing.ts`), and 409 otherwise. Response bodies are unchanged (`{"ok": false}`). The same catch serves the create and the replace actions for booking and balance invoices. No other route, the webhook, software invoices, text, migration, binding or dependency changed. Besides the route and the library, the change touches tests, the Stripe stand-in, one re-recorded fixture and the explanatory comment at the top of `tests/golden/owner-request-payment.test.ts`.

Live on merge: `wrangler.jsonc` sets `STRIPE_PAYMENTS_ENABLED` to `"true"`. Whether the Stripe secrets are set in production was not checked here (UNVERIFIED). If they are, this status change takes effect for real invoice actions as soon as it is deployed.

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

- The owner approved building this fix and has not yet seen the table above (approval relayed to the pull request author, 2026-11-14; not recorded here in the owner's own words). Merge needs the owner's own yes after seeing it.

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1; no logs retained.

- Tests first: three new cases in `tests/api/owner-payment.test.ts` (invalid request, API error and authentication failure whose messages do not name Stripe) failed on the old code with "expected 409 to be 502" and pass now. Three more (connection failure, unusable send, a site-raised conflict stays 409) pass before and after and pin the other rows. Each failure case asserts no invoice was recorded.
- Golden corpus: `tests/golden/fixtures/owner-request-payment.json.gz` was re-recorded in its own commit. 21 of 221 cases change, each only in the first step's response status, 409 to 502; bodies, headers, database statements, outgoing requests, logs and rows are unchanged. The commit message and the pull request list the cases. No other fixture changed.
- Top of this branch: `oxlint --deny-warnings` exit 0; `biome format .` no fixes; `astro check` 0 errors; `pnpm run build` complete; `pnpm test` 298 files, 12,758 tests passed, 1 skipped; `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture` 135 passed.
- One independent review round for correctness and security and one for repository rules: no blocker or should-fix item. The correctness review enumerated every error that can reach the changed line and found the only status change is the intended one, apart from the lowercase case noted above.
- UNVERIFIED: `validate`, Greptile and Codex on the pull request. UNVERIFIED: the built Worker bundle was not inspected for the Stripe error class check; the server code already relies on the same check elsewhere.
- UNVERIFIED: no Stripe test-mode run. The statuses come from tests with a stand-in for Stripe and from the recorded corpus.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch and scope: see the header and Scope. Deployment authorization: see Owner decisions.
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
- UNVERIFIED, 7.2 Diff review: independent review done locally; Greptile and Codex not yet read.
- UNVERIFIED, 7.3 Production bindings, secrets, migrations, routing, cache and headers: none changed; not observed live.
- UNVERIFIED, 7.4 Rollback version: fixed at merge time.
- UNVERIFIED, 7.5 Post-deployment verification: not deployed.
- PASS, 7.6 Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

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

## Delivery status

Not merged. Depends on pull request #278. This record authorizes neither merge nor deployment; this change waits for the owner's own yes.

Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.
