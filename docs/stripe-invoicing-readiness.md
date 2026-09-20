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
- PASS: Recognized audio invoice events without a matching recorded invoice return a retryable response instead of being discarded.
- PASS: Voided and uncollectible invoices can be replaced while prior attempts remain identifiable.
- PASS: Owner retention removes Stripe customer IDs and hosted invoice URLs with eligible request contact data.
- PASS: Stripe API failure leaves invoice state uncreated.
- PASS: Production configuration keeps `STRIPE_PAYMENTS_ENABLED=false`.

## Known recovery boundary

Stripe idempotency keys are a short retry safeguard, not permanent invoice identity. If Stripe sends an invoice but the website fails before recording it, the signed webhook remains retryable so the event is not silently lost. Do not retry invoice creation after 24 hours until the request is reconciled against the Stripe dashboard; a later retry can create a second payable invoice. Live enablement remains blocked until test mode proves this failure path and its owner recovery steps.

## Required before deployment

- UNVERIFIED: Review and approve the complete branch and migration.
- UNVERIFIED: Back up production MUSIC_DB and reconcile the migration ledger.
- UNVERIFIED: Apply `0003_audio_payments.sql` to the intended non-production database first.
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
- UNVERIFIED: Simulate a sent invoice whose D1 recording fails, confirm its webhook retries, and reconcile it before any retry outside the 24-hour idempotency window.
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
