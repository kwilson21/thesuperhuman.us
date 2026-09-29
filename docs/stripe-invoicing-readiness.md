# Stripe invoicing readiness

**Status:** Production activation prepared September 29, 2026; deployment and first real invoice remain separate verification steps.

This record separates completed implementation checks from Stripe account state, test-mode proof, deployment, and live verification. Do not enable production invoice creation while any required item is FAIL or UNVERIFIED.

## Implementation

- PASS: Fixed project terms are stored separately from visitor intake.
- PASS: Booking and balance cents sum exactly to the approved total.
- PASS: Stable idempotency keys protect immediate customer, invoice, invoice-item, finalize, and send retries.
- PASS: Balance invoice creation requires a Stripe-confirmed paid booking invoice.
- PASS: Webhooks require a valid Stripe signature over the raw request body.
- PASS: Replayed Stripe event IDs apply once.
- PASS: Out-of-order events cannot move a paid installment backward.
- PASS: A signed audio invoice event can restore a missing invoice projection when its request slot is empty; conflicts and invalid request references are retained for owner reconciliation.
- PASS: A voided invoice can be replaced while prior attempts remain identifiable. An uncollectible invoice stays associated until it is voided in Stripe.
- PASS: Owner retention removes Stripe customer IDs and hosted invoice URLs with eligible request contact data after both installments are paid or voided, or when no invoice remains due and neither installment has an active creation reservation.
- PASS: Stripe API failure leaves invoice state uncreated.
- PASS: Invoice creation remains gated by `STRIPE_PAYMENTS_ENABLED` and both encrypted secrets; disabling the flag preserves webhook processing.

## Known recovery boundary

Stripe idempotency keys are a short retry safeguard, not permanent invoice identity. The site reserves an installment before contacting Stripe and does not offer another creation attempt until the invoice is recorded or the reservation is manually reconciled. If Stripe sends an invoice but the website fails before recording it, a signed webhook can restore the missing local projection. An invoice that cannot be adopted safely is stored in `stripe_unmatched_events`, and owner health reports that queue for reconciliation. Live enablement remains blocked until test mode proves the recovery and reconciliation paths.

Run `npm run owner:stripe:reconcile` to list unresolved events. After comparing the request and invoice in Stripe, record the outcome with `npm run owner:stripe:reconcile -- --resolve-event EVENT_ID "resolution"`. If Stripe confirms that no invoice exists for a reserved creation, clear only that reservation with `npm run owner:stripe:reconcile -- --clear-reservation REQUEST_ID booking|balance "Stripe check and reason"`. The reservation prevents a later click from creating a second payable invoice when a prior request had an ambiguous result.

## Activation evidence (September 29, 2026)

- PASS: Owner authorized production activation and a restricted invoicing credential.
- PASS: Stripe Dashboard reports Payments and Payouts Active, with no active account tasks (September 28 readback).
- PASS: Production has both encrypted Stripe secret bindings. Credential values are not stored in this repository.
- PASS: The production invoice webhook is enabled for `invoice.sent`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, and `invoice.marked_uncollectible`.
- PASS: A metadata-free configuration probe signed with the production webhook secret returned HTTP 200; an invalid signature returned HTTP 400. The probe created no customer invoice and did not update payment records. It was locally generated, not a Stripe-originated delivery.
- PASS: Production payment schema and migration ledger through 0018 were reconciled. No migration accompanies this activation.
- PASS: Production owner health passes all seven checks. The reviewed retention manifest contained zero contacts and zero playback rows; its completed run removed no data.
- PASS: Production database export saved privately before activation. Preserve the pre-activation Worker version, which has both secrets and invoice creation disabled, for rollback.
- PASS: At base revision `73a0325`, 597 tests passed in 100 files; Astro check reported zero errors and warnings; the production build, asset and copy checks passed. Existing Astro hints and dependency audit findings are unchanged by this configuration-only release.
- PENDING: Review and CI for the activation revision, deployment, and production flag readback.

## Test-mode lifecycle evidence

The September 21 sandbox run exercised booking and balance payment, signed webhooks, replay deduplication, missing invoice projection recovery, conflict reconciliation, void replacement, uncollectible gating, and retention. September 28 readback confirmed both installments paid on the lifecycle request, terminal invoice state, no unresolved events or creation reservations, and a completed retention run. The invoice helper and webhook route are unchanged since that sandbox run. These are historical end-to-end checks, not a newly repeated September 29 lifecycle.

Current regression tests cover invoice idempotency, payment ordering, webhook signature handling, recovery, manual payments, and retention. Production's first real invoice and Stripe-originated event delivery remain untested: no customer was billed as part of activation. Observe the first authorized booking invoice and its event delivery before treating real-money collection as verified.

## Release scope

This release enables the existing owner-controlled invoice actions. It adds a factual Stripe processor disclosure to the existing privacy notice. It adds no checkout, prices, payment methods, dependencies, database migration, or portal access changes. Existing accepted terms, booking-before-balance enforcement, and manual-payment protections still apply. The private release checklist records the applicable deployment checks and unchanged-surface exclusions.

## Rollback

Set `STRIPE_PAYMENTS_ENABLED=false` and deploy the reviewed configuration change to stop new invoice creation. Keep the webhook route and payment records available so invoices already sent continue to report their state. Use Stripe for voids, refunds, disputes, and corrections.
