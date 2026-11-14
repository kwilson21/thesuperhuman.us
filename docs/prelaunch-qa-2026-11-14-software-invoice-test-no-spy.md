# Software invoice test without a module spy: release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Target: production `https://thesuperhuman.us`
Reviewer: built with Claude Code and reviewed in independent AI review rounds; Greptile and Codex review on the pull request. Owner review: none yet. This record does not certify the checks listed as UNVERIFIED.
Branch: `claude/followup-spy` (pull request #278), built on the lint stack (#256 to #258, merged as `440b28ef`)
Rollback revision: the production revision when this reaches `main`; after that, its merge commit's first parent. Reverting the merge commit undoes only this change.

## Scope

Tests only. `tests/lib/software-projects.test.ts` no longer replaces `createSoftwareInvoice` with `vi.spyOn`; the real function runs against the Stripe stand-in (`tests/helpers/stripe-fetch.ts`, which gains two options, `refuseFirstInvoices` and `dueDate`, each with a helper test). Nothing under `src/` or `scripts/` changed.

One module spy remains: `tests/api/software-inquiry.test.ts` replaces `softwareBriefEmail` to make it throw before the email provider is called. No input the application can produce makes the real function throw, and an attempt to reach the same failure through stored data did not reproduce it on that path. Removing the spy needs a small production change (a way to pass the email builder in). That is left for the owner to decide.

## Owner decisions

- The owner approved a tests-only follow-up to remove the two module spies (approval relayed to the pull request author, 2026-11-14; not recorded here in the owner's own words). One test is rewritten here; the second spy is left for the owner's decision.

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1; no logs retained.

- What the test proved before and proves now: the first provider call fails, the route answers 502 and the invoice row stays `creating` with `allow_card` 1 and `attempt` 0; the retry reuses that reserved attempt even though it asks for no card. The new assertions read the two recorded Stripe requests (same idempotency key ending `:attempt-0:invoice`, same invoice id in metadata, both payment methods offered) and the database row.
- The failure is now a definite Stripe refusal (400) where the spy rejected with an uncertain error. A reviewer read the route and `src/lib/software-invoices.ts` and found both take the same path. A connection failure, which the Stripe SDK retries, is not covered by this test, as before.
- Mutations by the author and a reviewer, each restored afterwards: a fresh idempotency key on retry, and honouring the retry's `allow_card`, each make the test fail.
- `oxlint --deny-warnings` exit 0; `biome format .` no fixes; `astro check` 0 errors; `vitest run tests/lib/software-projects.test.ts tests/api/software-inquiry.test.ts tests/helpers`: 18 files, 248 tests passed, also in shuffled order. The full suite on this head, without a build: 298 files, 12,747 tests passed, 3 skipped. The build passed on the branch stacked above this one.
- One independent review round for correctness and one for repository rules: no blocker or should-fix item; nits applied.
- UNVERIFIED: `validate`, Greptile and Codex on the pull request. UNVERIFIED: no Stripe test-mode run; the test uses a stand-in for Stripe.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch and scope: see the header and Scope. UNVERIFIED, deployment authorization: the owner's approval covers the tests-only change; merging follows the owner's standing rule for a complete pull request, and this record does not authorize it.
- N/A, 1.2 to 1.5: no page, copy, media, link or route changed.

### 2. Search and sharing

- N/A, 2.1 to 2.7: no page, metadata, asset, route or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, 3.1 to 3.7 and `hallmark audit`: no markup, style or browser script changed.

### 4. Performance and resilience

- N/A, 4.1 to 4.6: no image, client code, dependency or rendered path changed.

### 5. Forms and sensitive flows

- N/A, 5.1 to 5.6: no route, form or flow changed; tests only.

### 6. Privacy, legal and measurement

- N/A, 6.1 to 6.6: nothing changed. The stand-in uses obviously fake keys and makes no network request.

### 7. Release and final QA

- PASS (local), 7.1 Required checks: see Evidence and limits.
- UNVERIFIED, 7.2 Diff review: independent review done locally; Greptile and Codex not yet read.
- N/A, 7.3 Production bindings, secrets, migrations, routing, cache and headers: none changed.
- UNVERIFIED, 7.4 Rollback version: fixed at merge time.
- UNVERIFIED, 7.5 Post-deployment verification: not deployed.
- PASS, 7.6 Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

### Software agreement signing

- N/A: no agreement, signing, template or retention code changed.

### 8. Private owner center

- N/A, 8.1 to 8.15: no owner center, payment, retention or studio code changed. The test covers a software invoice action with a stand-in for Stripe.

## Delivery status

Not merged. This record authorizes neither merge nor deployment.

Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.
