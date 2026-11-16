# Software invoice test without a module spy: release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Target: production `https://thesuperhuman.us`
Reviewer: built with Claude Code and reviewed in independent AI review rounds; Greptile and Codex review on the pull request. Owner review: none yet. This record does not certify the checks listed as UNVERIFIED.
Branch: `claude/followup-spy` (pull request #278), built on the lint stack (#256 to #258, merged as `440b28ef`)
Rollback revision: `a2bde456`, the first parent of the merge commit `6822a848`. Reverting that merge commit undoes only this change.

## Scope

Tests only. `tests/lib/software-projects.test.ts` no longer replaces `createSoftwareInvoice` with `vi.spyOn`; the real function runs against the Stripe stand-in (`tests/helpers/stripe-fetch.ts`, which gains two options, `refuseFirstInvoices` and `dueDate`, each with a helper test). Nothing under `src/` or `scripts/` changed.

Updated after `main` moved: the other module spy this follow-up was meant to remove, on `softwareBriefEmail` in `tests/api/software-inquiry.test.ts`, is already gone on `main` (pull request #322 converted the brief copy area). After merging `main`, no test under `tests/` replaces a function on one of this repository's modules with `vi.spyOn`.

## Owner decisions

- The owner approved a tests-only follow-up to remove the two module spies (approval relayed to the pull request author, 2026-11-14; not recorded here in the owner's own words). One test is rewritten here; the second spy was removed on `main` by #322.

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1; no logs retained.

- What the test proved before and proves now: the first provider call fails, the route answers 502 and the invoice row stays `creating` with `allow_card` 1 and `attempt` 0; the retry reuses that reserved attempt even though it asks for no card. The new assertions read the two recorded Stripe requests (same idempotency key ending `:attempt-0:invoice`, same invoice id in metadata, both payment methods offered) and the database row.
- The failure is now a definite Stripe refusal (400) where the spy rejected with an uncertain error. A reviewer read the route and `src/lib/software-invoices.ts` and found both take the same path. A connection failure, which the Stripe SDK retries, is not covered by this test, as before.
- Mutations by the author and a reviewer, each restored afterwards: a fresh idempotency key on retry, and honouring the retry's `allow_card`, each make the test fail.
- `oxlint --deny-warnings` exit 0; `biome format .` no fixes; `astro check` 0 errors; `vitest run tests/lib/software-projects.test.ts tests/api/software-inquiry.test.ts tests/helpers`: 18 files, 248 tests passed, also in shuffled order. The full suite on this head, without a build: 298 files, 12,747 tests passed, 3 skipped. The build passed on the branch stacked above this one.
- One independent review round for correctness and one for repository rules: no blocker or should-fix item; nits applied.
- `validate` passed on the final head and Codex found nothing. UNVERIFIED: no Stripe test-mode run; the test uses a stand-in for Stripe.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch and scope: see the header and Scope. PASS, deployment authorization: merged under the owner's standing rule for a complete pull request; it changes tests only.
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
- PASS, 7.2 Diff review: independent review locally, and Codex's code and security reviews of the final head found nothing; no review thread was open at merge. Greptile reviewed only the first head, because its reviews on this repository are paused.
- N/A, 7.3 Production bindings, secrets, migrations, routing, cache and headers: none changed.
- PASS, 7.4 Rollback version: `a2bde456`, the first parent of the merge commit `6822a848`.
- UNVERIFIED, 7.5 Post-deployment verification, apart from what "Merge and deployment" lists: no journey, form, owner center or payment action was exercised live.
- PASS, 7.6 Implemented: yes. Verified locally: yes. Deployed: yes (`6822a848`). Verified live: two pages answer 200; nothing else.

### Software agreement signing

- N/A: no agreement, signing, template or retention code changed.

### 8. Private owner center

- N/A, 8.1 to 8.15: no owner center, payment, retention or studio code changed. The test covers a software invoice action with a stand-in for Stripe.

## Merge and deployment (added after the merge)

- Merged 2026-11-16 UTC as merge commit `6822a848`, whose first parent is `a2bde456`.
- Before the merge, read on the final head: every check passed, including `validate`, and Codex's code and security reviews had no finding.
- Production build: this merge commit got no build check of its own, because another pull request merged to `main` straight after. The Workers Builds check on the next `main` commit, `9eecc5e2`, which contains this merge, completed with success, and `validate` passed on that commit.
- After the merges, `https://thesuperhuman.us/` and `https://audio.thesuperhuman.us/` each answered 200. No other live check was made.
- Rollback: revert the merge commit `6822a848` to undo only this change.

## Delivery status

Current state: Implemented: yes. Verified locally: yes. Deployed: yes (`6822a848`). Verified live: two pages answer 200; nothing else.
