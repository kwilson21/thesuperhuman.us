# Audio payment design

**Date:** September 20, 2026  
**Status:** Approved design pending implementation plan  
**Owner:** The Superhuman Group LLC  
**Customer-facing service:** Audio services by Kazon

## Outcome

Clients can move from a reviewed audio-service request to a secure payment without a call or a custom checkout. Kazon retains control over file suitability, scope, price, and availability before asking for money.

## Payment flow

1. The client submits the existing Start Your Song form with a shared-file link.
2. Kazon reviews the files, confirms the service, fixed project price, delivery window, and any special scope.
3. The client receives the written offer and approves it.
4. Kazon creates and sends a Stripe invoice for 50% of the approved project price.
5. Payment of that invoice books the project. The 3–5 business-day first-delivery window begins after usable files and booking payment are present.
6. Kazon completes the agreed work and revisions.
7. Kazon sends a second Stripe invoice for the remaining balance.
8. Final downloadable files are delivered after the balance is paid.

Custom projects follow the same sequence with their reviewed price and timeline. No subscription, automatic threshold, cart, or instant purchase is introduced.

## Stripe configuration

Stripe Invoicing supplies the hosted payment page, receipts, invoice history, and payment records. The Stripe account uses **The Superhuman Group LLC** as the business identity and describes invoice items as audio services by Kazon.

Before accepting bookings, complete Stripe's outstanding business review with:

- Website: `https://thesuperhuman.us/audio/services`
- YouTube: `https://www.youtube.com/@KazonTheOne`
- SoundCloud: `https://soundcloud.com/kazontheone`
- Business description: fixed-price audio mixing, mastering, production, and recording services. Clients submit files for review before receiving a project-specific offer. A 50% invoice books approved work; the balance is due before final file delivery.

Payout capability must return to active status before the payment flow is considered operational. Do not collect a client payment while payouts remain paused.

Invoices use USD, card and other ordinary Stripe-hosted methods enabled for the account, and Stripe's standard hosted invoice page. Each invoice identifies the song or project, agreed service, installment, and due timing. Invoice descriptions do not claim ownership of client material.

## Website changes

The public service and intake pages explain the same sequence in plain language:

- no payment at submission;
- file review and written offer first;
- secure Stripe invoice after approval;
- 50% booking payment;
- remaining balance before final files.

The successful intake state tells the client to expect file review and an emailed offer. It does not display a generic payment link because price and scope have not been approved yet.

The first version adds no embedded Stripe checkout and no payment controls to the owner page. Kazon opens Stripe from the owner request and creates the two invoices manually. The existing private note can hold a non-sensitive operational reminder such as `Deposit invoice sent`; it must not contain card, bank, or identity data.

## Boundaries and security

- Stripe collects and stores payment credentials. The website never receives card or bank details.
- No Stripe secret key, webhook, customer ID, invoice ID, or payment status is stored in the website for this version.
- No client-facing payment link exists until Kazon approves that specific project.
- The website remains the source for service scope and intake; Stripe remains the source for invoices, payments, refunds, and receipts.
- Only public business URLs and the approved service description are submitted in Stripe's business review. Private credentials and personal addresses are never copied into repository files or chat.

## Failure handling

- If Stripe review is incomplete or payouts remain paused, do not invoice clients. Reply that booking will open after payment processing is ready.
- If an invoice is unpaid, the project is not booked and work does not begin.
- If the final invoice is unpaid, preserve the project files but do not release final downloadable files.
- Refunds, disputes, failed payments, and invoice corrections are handled in Stripe and documented in the private request note without copying sensitive payment data.

## Verification

Before launch:

1. Stripe reports payouts and payments active with no overdue verification task.
2. Stripe business identity, branding, customer emails, and invoice defaults are reviewed.
3. A Stripe test-mode invoice proves the deposit and balance workflow without a real charge.
4. Website copy and intake success state render correctly on desktop and mobile.
5. Repository checks pass for every changed file.
6. Production deployment remains separately gated by the repository prelaunch checklist.

## Deferred work

Automated invoice creation, webhooks, owner-page payment state, automatic reminders, contracts, tax automation, subscriptions, and website checkout are deferred until real booking volume shows that manual invoicing is a burden.
