# Stripe invoicing readiness

**Status:** NOT READY FOR LIVE PAYMENT

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
- PASS: Voided and uncollectible invoices can be replaced while prior attempts remain identifiable.
- PASS: Owner retention removes Stripe customer IDs and hosted invoice URLs with eligible request contact data after both invoice installments reach a terminal state.
- PASS: Stripe API failure leaves invoice state uncreated.
- PASS: Production configuration keeps `STRIPE_PAYMENTS_ENABLED=false`.

## Known recovery boundary

Stripe idempotency keys are a short retry safeguard, not permanent invoice identity. The site reserves an installment before contacting Stripe and does not offer another creation attempt until the invoice is recorded or the reservation is manually reconciled. If Stripe sends an invoice but the website fails before recording it, a signed webhook can restore the missing local projection. An invoice that cannot be adopted safely is stored in `stripe_unmatched_events`, and owner health reports that queue for reconciliation. Live enablement remains blocked until test mode proves the recovery and reconciliation paths.

Run `npm run owner:stripe:reconcile` to list unresolved events. After comparing the request and invoice in Stripe, record the outcome with `npm run owner:stripe:reconcile -- --resolve-event EVENT_ID "resolution"`. If Stripe confirms that no invoice exists for a reserved creation, clear only that reservation with `npm run owner:stripe:reconcile -- --clear-reservation REQUEST_ID booking|balance "Stripe check and reason"`. The reservation prevents a later click from creating a second payable invoice when a prior request had an ambiguous result.

## Required before deployment

- UNVERIFIED: Review and approve the complete branch and migration.
- UNVERIFIED: Back up production MUSIC_DB and reconcile the migration ledger.
- UNVERIFIED: Apply `0003_audio_payments.sql` and `0004_stripe_reconciliation.sql` to the intended non-production database first.
- UNVERIFIED: Configure a Stripe test secret and test webhook signing secret in the intended preview Worker.
- UNVERIFIED: Register the preview webhook for the five supported invoice events.
- UNVERIFIED: Render and review the owner Payment section on desktop and mobile.
- UNVERIFIED: Complete the repository prelaunch checklist.

## Test-mode lifecycle

- UNVERIFIED: Submit or create a non-production audio service request.
- UNVERIFIED: Record an accepted $200 fixed-price offer.
- UNVERIFIED: Create one $100 booking invoice and confirm a retry creates no duplicate.
- UNVERIFIED: Pay the test invoice and confirm the owner page changes to **Paid** from the webhook.
- UNVERIFIED: Create one $100 balance invoice only after the booking payment.
- UNVERIFIED: Pay the balance and confirm both installments show **Paid**.
- UNVERIFIED: Send an invalid signature and confirm no payment record changes.
- UNVERIFIED: Replay a valid event and confirm one event-ledger row.
- UNVERIFIED: Simulate a sent invoice whose D1 recording fails and confirm its signed webhook restores the missing invoice projection.
- UNVERIFIED: Deliver an invoice event whose request is missing or whose installment slot is occupied; confirm it appears in owner health and reconcile it before retrying invoice creation.
- UNVERIFIED: Void a test invoice and confirm the owner can create exactly one replacement.
- UNVERIFIED: Run retention against an eligible service request and confirm customer IDs and hosted invoice URLs are cleared.
- UNVERIFIED: Disable invoice creation and confirm status readback remains available.

## Live enablement

- PENDING: Stripe business review is complete.
- PENDING: Stripe payments and payouts are active with no overdue requirement.
- PENDING: Production `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured through Cloudflare secrets.
- PENDING: Production webhook registration and signed delivery are verified.
- PENDING: Production MUSIC_DB migration and readback pass.
- PENDING: Owner authorizes changing `STRIPE_PAYMENTS_ENABLED` to `true` and deploying that exact configuration.

## Rollback

Set `STRIPE_PAYMENTS_ENABLED=false` and deploy the reviewed configuration change to stop new invoice creation. Keep the webhook route and payment records available so invoices already sent continue to report their state. Use Stripe for voids, refunds, disputes, and corrections.
