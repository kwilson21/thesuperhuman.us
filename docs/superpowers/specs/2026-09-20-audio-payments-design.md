# Audio payment design

**Date:** September 20, 2026  
**Status:** Approved website integration design pending implementation
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

## Website integration

The public service and intake pages explain the same sequence in plain language:

- no payment at submission;
- file review and written offer first;
- secure Stripe invoice after approval;
- 50% booking payment;
- remaining balance before final files.

The successful intake state tells the client to expect file review and an emailed offer. It does not display a generic payment link because price and scope have not been approved yet.

The first version adds a Payment section to each audio-service request in the private owner center. Kazon records the approved service, fixed total price, and confirmation that the client accepted the written offer. The website then creates and sends a Stripe-hosted invoice for the 50% booking payment.

Stripe emails and hosts the secure payment page. A signed webhook updates the private owner page when an invoice is sent, paid, payment fails, or is voided. After the booking invoice is paid, the owner page can create the remaining-balance invoice. Final downloadable files remain withheld until the balance is paid.

The written offer remains manual in this version. The website does not add automated quoting, contracts, a client portal, or project-file delivery. The owner explicitly confirms acceptance before the first invoice can be created.

The Payment section shows:

- approved service and total fixed price;
- offer-acceptance confirmation;
- booking and balance amounts;
- booking and balance invoice status;
- a link to the relevant Stripe invoice;
- one action to create each invoice when its prerequisites are satisfied.

## Boundaries and security

- Stripe collects and stores payment credentials. The website never receives card or bank details.
- Stripe API and webhook secrets remain encrypted Cloudflare Worker secrets and never appear in source, D1, logs, or owner-page HTML.
- D1 stores only Stripe customer and invoice identifiers, installment amounts, statuses, and event timestamps needed for the owner workflow.
- No client-facing payment link exists until Kazon approves that specific project.
- The website remains the source for service scope, intake, and the owner's operational view. Stripe remains authoritative for invoices, payments, refunds, disputes, and receipts.
- Only public business URLs and the approved service description are submitted in Stripe's business review. Private credentials and personal addresses are never copied into repository files or chat.
- Webhook signatures are verified against the raw request body before any state is changed.
- Stripe event IDs are recorded so repeated delivery is safe.
- Invoice-creation requests use stable idempotency keys so retries cannot create duplicate invoices.
- Production invoice creation stays disabled until Stripe payments and payouts are active and the test-mode workflow passes.

## Failure handling

- If Stripe review is incomplete, payouts remain paused, or the website payment gate is disabled, invoice creation is unavailable.
- If an invoice is unpaid, the project is not booked and work does not begin.
- If the final invoice is unpaid, preserve the project files but do not release final downloadable files.
- Refunds, disputes, and invoice corrections are handled in Stripe. The owner page links to Stripe without copying sensitive payment data.
- A Stripe API or webhook failure leaves the request intact, shows an actionable failure to the owner, and creates no optimistic paid state.

## Verification

Before launch:

1. Stripe reports payouts and payments active with no overdue verification task.
2. Stripe business identity, branding, customer emails, and invoice defaults are reviewed.
3. A Stripe test-mode invoice proves the deposit and balance workflow without a real charge.
4. Repeated invoice actions and repeated webhook events prove idempotent behavior.
5. Invalid webhook signatures prove that D1 remains unchanged.
6. Website copy, intake success state, and the private Payment section render correctly on desktop and mobile.
7. Repository checks pass for every changed file.
8. Production deployment remains separately gated by the repository prelaunch checklist.

## Deferred work

Automated quoting, offer email composition, automatic reminders, contracts, tax automation, subscriptions, embedded checkout, project-file delivery, and a client portal are deferred until real booking volume justifies them.
