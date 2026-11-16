# Effect stack, layers 1 and 2: contact form and resume requests release gate

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branches: `claude/effect-1-foundation` (layer 1, pull request #244, the foundation) and `claude/effect-2-contact` (layer 2, stacked on layer 1)
Pull requests: #244 for layer 1; layer 2 has no pull request yet when this record is written. Layer 2 contains layer 1 at `3fa54f8b`, which includes main's `085db0f3` (the security fix from pull request #245, merged to main as `1e7bb596` and live).
Target: production `https://thesuperhuman.us`
Reviewer: layer 2 was built by a Claude Sonnet subagent. An independent review ran a differential comparison of the old and converted routes on 13,500 generated requests (4,500 per route, three seeds) and found 0 differences, before the escaping change below; that run is not a review of the whole diff. Code, security and Greptile review of the layer 2 head are UNVERIFIED (see Delivery status). This record does not certify the checks listed as UNVERIFIED.
Rollback revision: re-check `origin/main` with `git fetch` before merge; this record does not name one.

## Scope

The back end is being converted, one complete area at a time, to the form in the sibling repository Tally: Effect for rules, Effect Schema as the one input validator, XState where a rule is states, and the `@xstate/effect` bridge where a move waits on outside work.

- Layer 1 (#244): the shared helpers in `src/server/` (edge readers, services, `runRoute`, the rule form, the guarded save, the machine helpers) and the tests that keep Effect and `src/server/**` out of the browser bundle. No route uses them there.
- Layer 2 (this record): the first converted area. `POST /api/contact`, `POST /api/resume-request` and `GET /api/resume-approve` now read their body with Effect Schema (`src/server/contact-input.ts`), run a flow, an Effect program that reads its facts through services and acts between decisions (`src/server/flows/contact.ts`, `guards.ts`, `resume.ts`; there is no pure rule to separate yet, so `src/server/rules/` has none) and map each named refusal to the answer the route always gave. `src/lib/validation.ts` is deleted. `src/lib/resend.ts` has one Resend call, `sendMail`, which the live `Mail` service wraps; the live `Turnstile` service wraps `verifyTurnstile`. `legacyBindingsOrDefect` provides a KV binding that is set and leaves out one that is not; only these three routes may use it (`tests/architecture/legacy-bindings.test.ts`). The three functions that sent whole emails (`sendContactEmails`, `sendResumeApprovalRequest`, `sendResumeDelivery`) are deleted; the routes use `sendMail` and the message builders.

The intent is no behavior change: the same status, headers and body for every request, and the same outside effects in the same order, with one deliberate exception: the approval pages escape the stored name, address and audience, as the fix in pull request #245 does (below). No page, copy, markup, style, migration, binding or secret change.

## Owner decisions

- Owner, in conversation, 2026-11-12: use Effect for rules, Effect Schema for input and XState with the bridge, matching Tally; convert one area at a time; no behavior change.
- Owner, in conversation, 2026-11-12: authorize Claude subagents to write code in this repository, tests first, with independent review.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in the layer 2 worktree and in scratch copies (below). No logs retained.

Golden corpus (`tests/golden/`, committed before any source changed, in commit `76754a8b`): 184 cases (76 + 67 + 41), 193 requests, then 189 cases and 198 requests after five approval cases with markup were added (below), one fixture per route in `tests/golden/fixtures/`. Each records, per request, the status, the response headers and the exact body (or that the handler rejected), and every outside effect in order: each KV read, write and delete with key, value and options, and each outgoing fetch with URL, method, headers, body and whether it had a timeout signal. Time and `crypto.randomUUID` are fixed, so the corpus cannot see when the time is read or when the id is made.

| Route | Cases | Requests | Handler rejects |
| --- | --- | --- | --- |
| `POST /api/contact` | 76 | 80 | 3 |
| `POST /api/resume-request` | 67 | 69 | 5 |
| `GET /api/resume-approve` | 46 (41 recorded first, 5 added) | 49 | 4 |

The cases cover valid requests; each field missing, empty, whitespace, too long and of the wrong type; bad email; Origin missing, wrong and preview forms; non-JSON, `null`, array, string, number and boolean bodies; Turnstile no, error status, unreadable, unreachable and secret unset; rate limit hit, unreadable count, store failing and store unbound; every Resend outcome (sent, 400, 500, unreachable, key unset, address unset, autoresponder failing); for approval, missing, empty, unknown, malformed, used-twice and expired links, a missing PDF, the legacy `dod` request, mail failure, delete failure and a store that is unbound.

Fixtures: `git diff 76754a8b HEAD -- tests/golden/fixtures/contact.json tests/golden/fixtures/resume-request.json` is empty. `resume-approve.json` was re-recorded once, after the merge of pull request #245, and only from main's route: the route as it was before the conversion, with the fix. Against the first recording, 40 of the 41 original cases are byte-identical; the five added cases have a name, address or audience with markup (`<img src=x onerror=alert(1)>`, `<svg/onload=alert(1)>@x.co`, `<b>dod</b>`, and `O'Neil & "Sons" <ops>`), and each of them differs from the unescaped route's recording by escaping of `& < > " '` alone, with the same status and the same outside effects. The one other change is `a stored request with no audience`: the unescaped route answered a 500 page printing `pdf:undefined`; main's fix calls `escapeHtml(undefined)`, which throws, so the handler rejects (an unanswered 500). The converted route does the same, and a request stored by the site always has an audience, so this is reachable only by writing the key by hand. All 189 cases pass against the converted routes. The existing route and library tests pass with their assertions unchanged except where a deleted function was called: the two validation test files call `readContactInput` and `readResumeRequestInput` in place of the deleted validators, and `tests/lib/resend.test.ts` and `resend-resume.test.ts` send through the routes' own `sendMail` and message builders (the contact tests through the contact flow), asserting the same request bodies and now also the URL, method and headers. Main's new tests in `tests/api/resume-approve.test.ts` pass against the converted route.

Other tests added: stories tests for the contact flow (9 situations) and the resume flows (5 for a request, 9 for an approval), tests for the live `Mail`, `Turnstile` and `legacyBindingsOrDefect`, and `sendMail`; two architecture tests, `tagged-errors.test.ts` (a `Data.TaggedError` declares no `name`, `message`, `stack` or `cause`, proven with fixtures) and `legacy-bindings.test.ts` (only the three routes use `legacyBindingsOrDefect`). The old contact validator is kept as the oracle for the 31 inputs in `tests/server/edge-equivalence.test.ts`.

Layer 2 tip:

- `pnpm run format:check`: no fixes applied (563 files).
- `pnpm run check`: 0 errors, 17 hints.
- `pnpm test`: 177 test files passed; 2,498 tests passed, 1 skipped.
- `pnpm run build`: `Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture`: 5 files, 58 tests passed.
- `node scripts/publicist/gate.mjs`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 64 findings, not above layer 1's 64 on this base.

Cost of Effect in the Worker, from `pnpm run build` with the `dist/_worker.js` files concatenated in sorted order:

| | Foundation (`3fa54f8b`) | Layer 2 before the review changes | Layer 2 now |
| --- | --- | --- | --- |
| raw | 7,708,916 bytes | 8,010,409 bytes (+301,493) | 8,002,000 bytes (+293,084) |
| gzip -9 | 1,903,050 bytes | 1,976,072 bytes (+73,022) | 1,973,975 bytes (+70,925) |

Against the earlier foundation base (`b370cbe2`) the first measurement was +301,670 bytes raw and about +73 KB gzip, with startup unchanged at about 65 ms locally (`wrangler check startup`, three runs each; not Cloudflare's numbers). Startup was not re-measured after the review changes. Removing `effect/Match` and the three dead senders took 8,409 bytes raw and 2,097 bytes gzip off. The client bundle test passes.

Where the conversion reproduces today's behavior on purpose (each of the first five is in the golden corpus, so a change to any of them fails a test):

- A deployment with no `RATE_LIMIT` or `RESUME_STORE` binding is not answered with a 503. The routes read the binding unchecked, so the request fails (Astro answers 500) at the first read, after the effects before it. `legacyBindingsOrDefect` and `runRoute` reproduce that, including the rate limit count and the Turnstile call that happen first on a resume request.
- A secret that is not set is sent on as it is: Turnstile receives `secret=undefined` and Resend receives `Bearer undefined`.
- A KV read, write or delete that fails rejects the handler (500), including a failed delete after the resume email has already gone.
- The rate limit counts a submission before the captcha check, so a failed captcha still uses the visitor's slot.
- The approval pages show the stored name, address and audience escaped, exactly as main's route does after the security fix from pull request #245 (merged to main as `1e7bb596`, live). The converted route escapes the same values in the same places; refusals carry facts and no HTML, and the route escapes when it builds the page. The fixture change is limited to escaping (above).
- Not observable and not covered by the corpus, because it freezes the clock and `crypto.randomUUID`: a resume request's time is read once at the start of the request (not again after the captcha check; the email never printed it), and its id is made before the guards run.

Known current behaviours, kept unchanged and worth fixing later:

- The resume email can be sent twice after a provider timeout, because no idempotency key is sent: the answer is `uncertain`, the request stays saved, and a second click sends again.
- A failed captcha or a failed send still uses the visitor's rate-limit slot.
- A delete that fails after the email has gone leaves the approval link reusable until it expires.
- A missing `RESUME_STORE` binding uses up the visitor's Turnstile token, since the captcha is checked before the first read of the store.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: repository `kwilson21/thesuperhuman.us`, two stacked layers, back-end refactor of three routes with no behavior change. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or navigation changed.

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no markup or style changed. The approval page's HTML is byte-identical to main's after the escaping fix, for all 46 recorded approval cases. `hallmark audit` not run because no page design changed.

### 4. Performance and resilience

- PASS, 4.2 Client code against the built site: `dist/_astro` has 190 files and 35 `.js` files in both builds, and the client bundle test passes.
- PASS, 4.3 Server cost measured: see the table above.
- N/A, 4.1, 4.4, 4.5 and 4.6: no image or client script changed.

### 5. Forms and sensitive flows

- PASS, 5.1 Server validation and bounds, 5.2 error and retry answers, 5.5 approval-gated flow intact: 189 recorded cases, 198 requests, identical status, headers, body and outside effects, including expired and reused links; the approval pages differ from the first recording only by escaping, as described above.
- UNVERIFIED, 5.3 and 5.4 in a real environment: no real browser, live Turnstile site key or delivered email was observed. Mocked Resend and Turnstile answers are not proof of delivery.
- N/A, 5.6 Confirmation page: no change.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no stored data, cookie, analytics, legal text or processor changed.

### 7. Release and final QA

- PASS, 7.1 Required checks: see Evidence and limits.
- UNVERIFIED, 7.2 Exact diff review on the pull request heads and independent code and security review: not done for layer 2. The differential run (13,500 requests, 0 differences) was against the code before the escaping change and is not that review.
- UNVERIFIED, 7.3 Production bindings, secrets, HTTPS, host routing and response headers (not deployed): no binding, secret or migration changed, but no deployed response was observed.
- PASS, 7.4 Rollback is the previous deployed revision; re-check `origin/main` with `git fetch` before merge.
- UNVERIFIED, 7.5 After authorized deployment, production revision, journeys, forms and monitoring: nothing deployed.
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section: the owner center, Access, migrations and payment settings are untouched.

## Delivery status and remaining gates

- UNVERIFIED: CI (`validate`) and Cloudflare Workers Builds on the heads of #244 and of the layer 2 pull request.
- UNVERIFIED: Greptile, Codex and independent Claude reviews of the layer 2 head (the pull request is #244 for the foundation; layer 2 has none yet).
- UNVERIFIED: the contact form, resume request and approval link in a real browser, with a live Turnstile site key and a delivered email.
- UNVERIFIED: live verification after deployment.

No deployment is authorized by this record.

Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

Built by a Claude Sonnet subagent. This record does not certify the checks listed as UNVERIFIED.
