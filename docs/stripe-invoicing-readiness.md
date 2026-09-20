# Stripe invoicing readiness

**Status:** NOT READY FOR LIVE PAYMENT

This record separates completed implementation checks from Stripe account state, test-mode proof, deployment, and live verification. Do not enable production invoice creation while any required item is FAIL or UNVERIFIED.

## Implementation

- PASS: Fixed project terms are stored separately from visitor intake.
- PASS: Booking and balance cents sum exactly to the approved total.
- PASS: Stable idempotency keys protect customer, invoice, invoice-item, finalize, and send operations.
- PASS: Balance invoice creation requires a Stripe-confirmed paid booking invoice.
- PASS: Webhooks require a valid Stripe signature over the raw request body.
- PASS: Replayed Stripe event IDs apply once.
- PASS: Stripe API failure leaves invoice state uncreated.
- PASS: Production configuration keeps `STRIPE_PAYMENTS_ENABLED=false`.

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
