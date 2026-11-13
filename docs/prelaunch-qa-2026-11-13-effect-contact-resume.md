# Effect stack, layers 1 and 2: contact form and resume requests release gate

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branches: `claude/effect-1-foundation` (layer 1, pull request #244) and `claude/effect-2-contact` (layer 2, stacked on layer 1)
Pull requests: #244 for layer 1; layer 2 has no pull request yet when this record is written. Layer 2 is stacked on layer 1 at `b370cbe2`; the layer 1 branch has since gained three commits (`59587268`, `701aff37`, `82cb70b2`) that layer 2 has not been moved onto, and every measurement below uses `b370cbe2` as layer 1
Target: production `https://thesuperhuman.us`
Reviewer: layer 2 was built by a Claude Sonnet subagent; independent review is UNVERIFIED (see Delivery status). This record does not certify the checks listed as UNVERIFIED.
Rollback revision: re-check `origin/main` with `git fetch` before merge; this record does not name one.

## Scope

The back end is being converted, one complete area at a time, to the form in the sibling repository Tally: Effect for rules, Effect Schema as the one input validator, XState where a rule is states, and the `@xstate/effect` bridge where a move waits on outside work.

- Layer 1 (#244): the shared helpers in `src/server/` (edge readers, services, `runRoute`, the rule form, the guarded save, the machine helpers) and the tests that keep Effect and `src/server/**` out of the browser bundle. No route uses them there.
- Layer 2 (this record): the first converted area. `POST /api/contact`, `POST /api/resume-request` and `GET /api/resume-approve` now read their body with Effect Schema (`src/server/contact-input.ts`), run a rule that reads its facts through services (`src/server/rules/contact.ts`, `guards.ts`, `resume.ts`) and map each named refusal to the answer the route always gave. `src/lib/validation.ts` is deleted. `src/lib/resend.ts` has one Resend call, `sendMail`, which the live `Mail` service wraps; the live `Turnstile` service wraps `verifyTurnstile`. `bindingsOrDefect` provides a KV binding that is set and leaves out one that is not.

The intent is no behavior change: the same status, headers and body for every request, and the same outside effects in the same order. No page, copy, markup, style, migration, binding or secret change.

## Owner decisions

- Owner, in conversation, 2026-11-12: use Effect for rules, Effect Schema for input and XState with the bridge, matching Tally; convert one area at a time; no behavior change.
- Owner, in conversation, 2026-11-12: authorize Claude subagents to write code in this repository, tests first, with independent review.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in the layer 2 worktree and in scratch copies (below). No logs retained.

Golden corpus (`tests/golden/`, committed before any source changed, in commit `76754a8b`): 185 cases, 193 requests, one fixture per route in `tests/golden/fixtures/`. Each records, per request, the status, the response headers and the exact body (or that the handler rejected), and every outside effect in order: each KV read, write and delete with key, value and options, and each outgoing fetch with URL, method, headers, body and whether it had a timeout signal. Time and `crypto.randomUUID` are fixed.

| Route | Cases | Requests | Handler rejects |
| --- | --- | --- | --- |
| `POST /api/contact` | 76 | 80 | 3 |
| `POST /api/resume-request` | 67 | 69 | 5 |
| `GET /api/resume-approve` | 41 | 44 | 3 |

The cases cover valid requests; each field missing, empty, whitespace, too long and of the wrong type; bad email; Origin missing, wrong and preview forms; non-JSON, `null`, array, string, number and boolean bodies; Turnstile no, error status, unreadable, unreachable and secret unset; rate limit hit, unreadable count, store failing and store unbound; every Resend outcome (sent, 400, 500, unreachable, key unset, address unset, autoresponder failing); for approval, missing, empty, unknown, malformed, used-twice and expired links, a missing PDF, the legacy `dod` request, mail failure, delete failure and a store that is unbound.

Fixtures against the first commit: `git diff 76754a8b HEAD -- tests/golden/fixtures` is empty. All 185 cases pass against the converted routes. The existing route and library tests pass with their assertions unchanged; the two validation test files call `readContactInput` and `readResumeRequestInput` in place of the deleted `validateContactInput` and `validateResumeRequestInput`, with the same inputs and expectations.

Other tests added: stories tests for the contact rule (9 situations) and the resume rules (5 for a request, 9 for an approval), tests for the live `Mail`, `Turnstile` and `bindingsOrDefect`, and `sendMail`. The old contact validator is kept as the oracle for the 31 inputs in `tests/server/edge-equivalence.test.ts`.

Layer 2 tip:

- `pnpm run format:check`: no fixes applied (561 files).
- `pnpm run check`: 0 errors, 17 hints.
- `pnpm test`: 175 test files passed; 2,462 tests passed, 2 skipped (before this record was added).
- `pnpm run build`: `Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture`: 3 files, 37 tests passed.
- `node scripts/publicist/gate.mjs`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 64 findings, from 66 on layer 1 (`no-unknown-parameters` 21 to 19; the other four rules unchanged: `no-module-mocking` 25, `no-unsafe-dictionary-type` 10, `require-safety-comment-for-type-assertion` 7, `no-known-value-widening` 3).

Cost of Effect in the Worker, measured in scratch copies at same-length paths (layer 1 at `b370cbe2` and layer 2), each built with `pnpm run build`:

| | Layer 1 | Layer 2 |
| --- | --- | --- |
| `dist/_worker.js` files, concatenated in sorted order, raw | 7,692,062 bytes | 7,993,732 bytes (+301,670) |
| the same, gzip -9 | 1,902,304 bytes | 1,975,394 bytes (+73,090) |
| largest worker chunk | 1,887,801 bytes (`agreement-pdf`) | 1,887,801 bytes (same) |
| `dist/_astro` files, and `.js` files | 190, 35 | 190, 35 |
| `wrangler check startup` profile, three runs | 64.9, 66.4, 65.0 ms | 65.4, 65.3, 66.2 ms |

The new worker code is two chunks (`run`, 211,708 bytes, and `public-form`, 93,948 bytes) that hold Effect and Effect Schema, less the small `resend`, `resume-requests` and `validation` chunks they replace. The startup figures are local CPU profile durations from a `wrangler deploy --dry-run` bundle and are not Cloudflare's numbers; they show no difference beyond run-to-run noise. The client bundle test passes on both.

Where the conversion reproduces today's behavior on purpose (each is in the golden corpus, so a change to any of them fails a test):

- A deployment with no `RATE_LIMIT` or `RESUME_STORE` binding is not answered with a 503. The routes read the binding unchecked, so the request fails (Astro answers 500) at the first read, after the effects before it. `bindingsOrDefect` and `runRoute` reproduce that, including the rate limit count and the Turnstile call that happen first on a resume request.
- A secret that is not set is sent on as it is: Turnstile receives `secret=undefined` and Resend receives `Bearer undefined`.
- A KV read, write or delete that fails rejects the handler (500), including a failed delete after the resume email has already gone.
- The approval page prints the stored name and address without escaping them, as it did.
- The rate limit counts a submission before the captcha check, so a failed captcha still uses the visitor's slot.
- A resume request's stored time is read once at the start of the request, not again after the captcha check; the email never printed it.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: repository `kwilson21/thesuperhuman.us`, two stacked layers, back-end refactor of three routes with no behavior change. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or navigation changed.

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no markup or style changed. The approval page's HTML is byte-identical to the recorded one. `hallmark audit` not run because no page design changed.

### 4. Performance and resilience

- PASS, 4.2 Client code against the built site: `dist/_astro` has 190 files and 35 `.js` files in both builds, and the client bundle test passes.
- PASS, 4.3 Server cost measured: see the table above.
- N/A, 4.1, 4.4, 4.5 and 4.6: no image or client script changed.

### 5. Forms and sensitive flows

- PASS, 5.1 Server validation and bounds, 5.2 error and retry answers, 5.5 approval-gated flow intact: 185 recorded cases, 193 requests, identical status, headers, body and outside effects, including expired and reused links.
- UNVERIFIED, 5.3 and 5.4 in a real environment: no real browser, live Turnstile site key or delivered email was observed. Mocked Resend and Turnstile answers are not proof of delivery.
- N/A, 5.6 Confirmation page: no change.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no stored data, cookie, analytics, legal text or processor changed.

### 7. Release and final QA

- PASS, 7.1 Required checks: see Evidence and limits.
- UNVERIFIED, 7.2 Exact diff review on the pull request heads and independent code and security review: not done for layer 2.
- UNVERIFIED, 7.3 Production bindings, secrets, HTTPS, host routing and response headers (not deployed): no binding, secret or migration changed, but no deployed response was observed.
- PASS, 7.4 Rollback is the previous deployed revision; re-check `origin/main` with `git fetch` before merge.
- UNVERIFIED, 7.5 After authorized deployment, production revision, journeys, forms and monitoring: nothing deployed.
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section: the owner center, Access, migrations and payment settings are untouched.

## Delivery status and remaining gates

- UNVERIFIED: CI (`validate`) and Cloudflare Workers Builds on the heads of #244 and of the layer 2 pull request.
- UNVERIFIED: Greptile, Codex and independent Claude reviews of the layer 2 head.
- UNVERIFIED: the contact form, resume request and approval link in a real browser, with a live Turnstile site key and a delivered email.
- UNVERIFIED: live verification after deployment.

No deployment is authorized by this record.

Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

Built by a Claude Sonnet subagent. This record does not certify the checks listed as UNVERIFIED.
