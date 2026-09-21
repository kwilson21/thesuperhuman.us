# Owner center operations

Use this page when a promotion is active or when the owner center says something needs attention. Routine requests stay in the owner center. Do not copy request details into logs, issues, or email.

## Start here

1. Open `/owner` through Cloudflare Access.
2. Follow `01` first. It identifies the action most likely to need attention.
3. Follow `02` for the next useful signal.
4. Open **Requests** when the new-request count is above zero. Open **Campaigns** when a promotion is active.
5. Run `npm run owner:health -- --remote` when the health line needs attention. Its report contains safe status and next actions only.

## Campaigns

Campaign planning is a guided Codex workflow. Before promotion begins, ask Codex to prepare one campaign record and its allowed channel and creative tags for review. Approve the exact name, dates, primary goal, secondary signals, links, and tags before any production write.

- Start: set the reviewed campaign to `active`, then test every tagged link once. Confirm the Campaign Desk attributes the test to the expected channel and creative.
- Close: set it to `complete`, add the short retrospective and next lesson, then confirm the combined Studio Ledger still includes its results.
- Keep channel and creative names from the approved campaign record. Do not accept arbitrary visitor-provided tags.

## Requests

Open a request from **Today**, **Campaigns**, or **Requests**. Each path reaches the same record.

- **Reviewed** means you have assessed it.
- **Resolved** means the next step is complete or the request will not proceed.
- **Reopen** returns a resolved request to active review.
- **Withdraw** stops the request and makes its contact detail eligible for immediate removal.
- **Delete personal data** is performed by reviewed retention. It preserves the request category, status, dates, and audit trail while blanking contact fields and private notes. A service request stays out of retention while either payment installment is unfinished, so invoice recovery and file delivery remain possible.

Routine purchase, merchandise, and service requests do not send email. They appear in the owner center. A redacted urgent email is sent only when a valid request cannot be stored. Treat repeated storage alerts, owner authentication failures, media failures, or retention failures as urgent.

Release-update subscriptions are deferred until a confirmed opt-in and self-service unsubscribe flow exists. The owner center does not display a subscription metric until that complete flow is built.

## Audio-service payments

1. Open the audio-service request and review its files, requested service, scope, and availability.
2. Send the client a written fixed-price offer outside the website.
3. After the client accepts that exact offer, enter the approved service and total price in **Payment** and check the acceptance confirmation.
4. Select **Create booking invoice**. Stripe emails the hosted invoice for 50% of the total.
5. Do not begin the 3–5 business-day delivery window until the owner page shows the booking invoice as **Paid**.
6. After the agreed work and revisions, select **Create balance invoice**.
7. Keep final downloadable files private until the balance shows **Paid**.

If invoice creation fails, refresh the request before retrying. Stable Stripe idempotency keys prevent a retry from creating a second invoice, but the refreshed owner page is the clearest source for the next action. Handle refunds, disputes, voiding, and invoice corrections in Stripe. An uncollectible invoice remains associated because Stripe can later mark it paid; void it in Stripe before creating a replacement. The website stores operational status only.

To stop new invoices, set `STRIPE_PAYMENTS_ENABLED=false` and deploy the reviewed configuration change. This does not erase payment history or disable signed status updates for invoices already sent.

## Retention

Raw playback is kept for 90 days. Daily human totals remain after cleanup, with sparse cities stored only as **Other locations**. City thresholds count distinct tab sessions, so replays in one tab do not increase the city toward visibility. Resolved purchase and merchandise contact data is removed after 90 days, resolved service contact data after one year, and withdrawn request contact data immediately unless an invoice exists or invoice creation is still reserved.

1. Run `npm run owner:retention:preview -- --remote`.
2. Open `.private/owner-retention-review.html`. Save any useful conclusions in the private development journal. The review must not contain names, email addresses, notes, IP addresses, or secrets.
3. Apply only the matching manifest: `npm run owner:retention:apply -- --remote`.
4. Run `npm run owner:health -- --remote` and confirm the retention check passes.

There is no scheduled deletion at launch. To pause retention, do not run the apply command. A preview never deletes data.

## Recovery controls

### Restore the previous Worker

1. Run `npx wrangler versions list` and identify the last known good version from the release record.
2. Review the target version and current database compatibility.
3. After explicit deployment approval, run `npx wrangler versions deploy <version-id>@100%`.
4. Recheck the public music page, one media range request, request submission, unsigned `/owner` rejection, signed owner access, and `npm run owner:health -- --remote`.

### Hide Old News

Set `visibility` to `draft` in the Old News release, recording, and portfolio example content records. Build and inspect the releases, detail, portfolio, and services pages before an approved deployment. After deployment, purge Cloudflare cache entries for `/music/file/*`, then confirm a previously cached media URL returns `404`. This hides discovery and streaming routes without deleting source assets or demand records.

### Disable playback events

Set `MUSIC_EVENTS_ENABLED` to `false`, build, and deploy only after approval. The event endpoint returns `204` while listening remains available. Set it back to `true` after the incident and verify a new controlled test event appears once.

### Recover MUSIC_DB

1. Stop retention and avoid request-status changes.
2. Inspect D1 backups and migration history. Record the intended recovery point and current Worker version.
3. Restore through Cloudflare's reviewed D1 recovery procedure. Never apply repository migrations until the restored schema and migration ledger agree.
4. Run owner health, then verify one test request can be stored and viewed without exposing its content in logs.
5. From a visitor session, confirm Old News streams, playback does not duplicate, the interest form gives an honest receipt, and a forced storage failure gives a retry response rather than false success.

## Incident record

Record the time, affected route, safe symptom, Worker version, database state, action taken, verification result, and remaining risk. Keep personal request content and credentials out of the incident record.
