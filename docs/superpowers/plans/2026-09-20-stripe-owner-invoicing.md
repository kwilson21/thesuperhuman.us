# Stripe Owner Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Kazon create and track the 50% booking invoice and remaining-balance invoice from an approved audio-service request while Stripe hosts payment and remains authoritative for money movement.

**Architecture:** Extend the existing Cloudflare Worker, owner request page, owner audit trail, and MUSIC_DB. A focused Stripe adapter uses Stripe's official server SDK, owner-only API routes create invoices with stable idempotency keys, and one public webhook route verifies Stripe signatures before updating payment projections. Production creation remains behind an explicit environment gate.

**Tech Stack:** Astro 5, TypeScript, Cloudflare Workers, D1, Stripe Invoicing, Stripe Node SDK, Vitest

**Spec:** `docs/superpowers/specs/2026-09-20-audio-payments-design.md`

## Global Constraints

- Clients submit usable shared-file links before any payment request.
- Kazon approves scope, fixed price, availability, and written-offer acceptance before creating a booking invoice.
- Booking payment is exactly 50% of the approved total; the balance is the remaining cents.
- Stripe hosts payment and remains authoritative for invoices, payments, refunds, disputes, and receipts.
- Never store payment credentials, secret keys, webhook secrets, or raw webhook bodies in D1 or logs.
- Production invoice creation requires `STRIPE_PAYMENTS_ENABLED=true` plus configured secrets.
- Do not add automated quoting, contracts, subscriptions, tax automation, embedded checkout, automatic reminders, or project-file delivery.
- Reuse existing owner access, D1, request audit, styling, and testing patterns.

---

### Task 1: Payment projection and migration

**Files:**
- Create: `migrations/music/0003_audio_payments.sql`
- Create: `src/lib/audio-payments.ts`
- Create: `tests/lib/audio-payments.test.ts`
- Modify: `tests/scripts/owner-health.test.ts`

**Interfaces:**
- Produces: `AudioPayment`, `getAudioPayment(db, requestId)`, `approveAudioPayment(db, input)`, `recordInvoice(db, input)`, and `applyStripeInvoiceEvent(db, input)`.
- Consumes: existing `owner_requests` and `owner_request_audit` rows.

- [ ] **Step 1: Write failing schema and model tests**

Test that only `service` requests can receive a payment record; the approved total is integer USD cents; deposit and balance sum to the total; one payment row exists per request; installment invoice IDs are unique; and repeated Stripe event IDs do not change state twice.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- tests/lib/audio-payments.test.ts tests/scripts/owner-health.test.ts`

Expected: FAIL because the migration and payment model do not exist.

- [ ] **Step 3: Add the minimal D1 schema**

Create `audio_payments` with request ID, approved service, total/deposit/balance cents, offer-accepted timestamp, Stripe customer ID, booking invoice fields, balance invoice fields, and timestamps. Create `stripe_webhook_events` with a unique Stripe event ID, event type, and processing timestamp. Extend the request-audit action check with payment approval, invoice creation, and payment-state actions.

- [ ] **Step 4: Implement the focused persistence functions**

Validate service request type, price bounds, exact installment arithmetic, allowed status transitions, optimistic concurrency, and idempotent event application. Store only Stripe identifiers, hosted invoice URL, amount, status, and timestamps.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/lib/audio-payments.test.ts tests/scripts/owner-health.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/music/0003_audio_payments.sql src/lib/audio-payments.ts tests/lib/audio-payments.test.ts tests/scripts/owner-health.test.ts
git commit -m "feat: add audio payment records"
```

### Task 2: Stripe adapter and invoice lifecycle

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/env.d.ts`
- Create: `src/lib/stripe-invoicing.ts`
- Create: `tests/lib/stripe-invoicing.test.ts`

**Interfaces:**
- Produces: `stripeAvailable(env)`, `createBookingInvoice(env, request, payment)`, `createBalanceInvoice(env, request, payment)`, and `verifyStripeWebhook(env, rawBody, signature)`.
- Consumes: `AudioPayment`, owner request name/email, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PAYMENTS_ENABLED`.

- [ ] **Step 1: Install the official Stripe SDK**

Run: `npm install stripe`

Expected: `stripe` is added as a production dependency with the exact resolved version recorded in `package-lock.json`.

- [ ] **Step 2: Write failing adapter tests**

Use a fake Stripe client at the adapter boundary. Assert that disabled configuration fails closed, customer creation uses the request email, invoices use `send_invoice`, each invoice has the correct installment amount and description, metadata contains request ID and installment, and every create call receives the stable idempotency key `audio-request:<requestId>:<installment>`.

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npm test -- tests/lib/stripe-invoicing.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: Implement the adapter**

Create or reuse the stored Stripe customer, create a draft invoice, attach one USD invoice item to that invoice, finalize it, and send it. Return only the fields needed by `recordInvoice`. Verify webhooks with Stripe's async Web Crypto signature helper against the untouched request body.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/lib/stripe-invoicing.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/env.d.ts src/lib/stripe-invoicing.ts tests/lib/stripe-invoicing.test.ts
git commit -m "feat: add Stripe invoice adapter"
```

### Task 3: Owner-only invoice actions

**Files:**
- Create: `src/pages/api/owner/requests/[id]/payment.ts`
- Create: `tests/api/owner-payment.test.ts`

**Interfaces:**
- Consumes: owner identity, `approveAudioPayment`, `createBookingInvoice`, `createBalanceInvoice`, and `recordInvoice`.
- Produces: `POST` actions `approve`, `create-booking-invoice`, and `create-balance-invoice` returning the current payment projection.

- [ ] **Step 1: Write failing API tests**

Cover missing owner identity, missing bindings, non-service requests, invalid currency input, missing offer acceptance, duplicate action retries, balance creation before a paid booking invoice, disabled Stripe configuration, Stripe failure, and successful booking/balance creation.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/api/owner-payment.test.ts`

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Implement the smallest owner endpoint**

Parse commands with Zod, require `locals.owner`, read the service request, approve the exact fixed price in cents, and call the Stripe adapter only after persisted prerequisites pass. Return `private, no-store` responses and avoid returning any Stripe secret or customer details.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/api/owner-payment.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/owner/requests/[id]/payment.ts tests/api/owner-payment.test.ts
git commit -m "feat: add owner invoice actions"
```

### Task 4: Signed Stripe webhook

**Files:**
- Create: `src/pages/api/stripe/webhook.ts`
- Create: `tests/api/stripe-webhook.test.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `verifyStripeWebhook` and `applyStripeInvoiceEvent`.
- Produces: a public Stripe webhook that accepts only verified invoice events carrying this site's request metadata.

- [ ] **Step 1: Write failing webhook tests**

Assert rejection for missing or invalid signatures, no D1 mutation on rejection, safe acknowledgement of unrelated events, idempotent repeated event IDs, and correct state changes for `invoice.sent`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, and `invoice.marked_uncollectible`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/api/stripe-webhook.test.ts tests/middleware.test.ts`

Expected: FAIL because the webhook route does not exist.

- [ ] **Step 3: Implement the webhook and route boundary**

Read `request.text()` exactly once, verify `stripe-signature`, reject invalid input with 400, map only supported invoice events, and write the event marker and payment update atomically. Keep the webhook outside Cloudflare Access while leaving owner routes protected.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/api/stripe-webhook.test.ts tests/middleware.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/stripe/webhook.ts src/middleware.ts tests/api/stripe-webhook.test.ts tests/middleware.test.ts
git commit -m "feat: process signed Stripe invoice events"
```

### Task 5: Owner payment interface

**Files:**
- Modify: `src/pages/owner/requests/[id].astro`
- Create: `src/components/owner/AudioPaymentPanel.astro`
- Create: `src/scripts/owner-payment-actions.ts`
- Modify: `src/styles/owner.css`
- Modify: `tests/lib/owner-pages.test.ts`

**Interfaces:**
- Consumes: `getAudioPayment`, `stripeAvailable`, and the owner payment API.
- Produces: a service-request-only Payment section with approval, booking invoice, balance invoice, statuses, and Stripe-hosted invoice links.

- [ ] **Step 1: Write failing page-structure tests**

Assert that payment controls render only for service requests, price entry uses dollars but submits integer cents, offer acceptance is explicit, booking creation stays unavailable before approval, balance creation stays unavailable before booking payment, and status text does not imply payment before a webhook confirms it.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/lib/owner-pages.test.ts`

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Build the panel with existing owner styles**

Use the current owner section hierarchy, buttons, inline status region, and responsive grid. Show a clear next action, fixed-price summary, invoice state, and external Stripe link. Do not expose the Stripe customer ID or webhook details.

- [ ] **Step 4: Add progressive enhancement**

Submit payment actions with `fetch`, disable only the active action, report actionable errors, and reload the payment projection after success. Preserve a usable server-rendered status view if JavaScript fails.

- [ ] **Step 5: Run page and type checks**

Run: `npm test -- tests/lib/owner-pages.test.ts && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/owner/requests/[id].astro src/components/owner/AudioPaymentPanel.astro src/scripts/owner-payment-actions.ts src/styles/owner.css tests/lib/owner-pages.test.ts
git commit -m "feat: add owner payment controls"
```

### Task 6: Operations, test-mode proof, and release gate

**Files:**
- Modify: `README.md`
- Modify: `docs/owner-operations.md`
- Modify: `docs/prelaunch-checklist.md`
- Modify: `docs/superpowers/specs/2026-09-20-audio-payments-design.md`
- Create: `docs/stripe-invoicing-readiness.md`

**Interfaces:**
- Consumes: the complete integration and Stripe test-mode configuration.
- Produces: exact secret setup, webhook registration, test lifecycle, rollback, and production-enable instructions.

- [ ] **Step 1: Document configuration without secret values**

Document `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PAYMENTS_ENABLED`; the production webhook URL; test-mode setup; D1 migration order; and how to disable invoice creation without disabling status readback.

- [ ] **Step 2: Run repository verification**

Run: `npm test && npm run check && npm run build && npm run assets:check && git diff --check`

Expected: all commands PASS.

- [ ] **Step 3: Apply the migration to a non-production database and run a test-mode lifecycle**

Create a service request fixture, approve a fixed price, create and pay the booking invoice with a Stripe test card, confirm the webhook projects `paid`, create and pay the balance, and confirm the owner page shows both paid without storing payment credentials.

- [ ] **Step 4: Exercise failures**

Send an invalid webhook signature, replay a valid event, retry invoice creation, and disable `STRIPE_PAYMENTS_ENABLED`. Confirm no unauthorized mutation, duplicate invoice, duplicate event application, or optimistic paid state occurs.

- [ ] **Step 5: Record readiness evidence**

Mark every item PASS, FAIL, UNVERIFIED, or justified N/A. Keep production invoice creation disabled while Stripe payouts are paused or any required gate remains unresolved.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/owner-operations.md docs/prelaunch-checklist.md docs/superpowers/specs/2026-09-20-audio-payments-design.md docs/stripe-invoicing-readiness.md
git commit -m "docs: add Stripe invoicing operations"
```

## Self-review

- Spec coverage: owner approval, 50% booking invoice, remaining balance, hosted payment, signed webhook, idempotency, failure behavior, configuration gate, and deferred scope are each assigned to a task.
- Placeholder scan: no TBD, TODO, or unspecified implementation step remains.
- Type consistency: Tasks 2 through 5 consume the payment types and functions produced in Task 1; webhook and owner endpoints use the same projection.
- Scope: payment orchestration stays inside the existing Worker and D1. Stripe remains the financial system of record.
