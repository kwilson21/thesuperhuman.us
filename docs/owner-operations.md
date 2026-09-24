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
- **Reopen** returns a resolved request to active review. If the request was declined before file approval, its provisional studio access was closed and does not reopen; ask the client to submit a new service request if the project resumes.
- **Withdraw** stops the request. Non-studio contact detail becomes eligible for immediate removal; a private studio project's content is reviewed after 30 days before its contact detail is removed.
- **Delete personal data** is performed by reviewed retention. It preserves the request category, status, dates, and audit trail while blanking contact fields and private notes. A service request stays out of retention while either payment installment is unfinished, so invoice recovery and file delivery remain possible.

## Private studio projects

When the portal is enabled, **Today** links to projects with unread client messages, failed progress-update emails, or a delivery date within two calendar days or already past due. Open the request from that list. Read and acknowledge client messages there; a response is optional when an update is enough. If an update email failed, check the saved update and retry it. If delivery needs more time, choose one of the documented reasons and give the client a revised date before the previous date passes. The project timeline preserves both dates.

An invitation marked **sending** is uncertain, not proof that Resend accepted it. Check Resend before selecting the explicit retry. A failed private upload remains a draft; discard it from the owner request and retry only after R2 cleanup succeeds. A storage failure must not be described to the client as a delivered file. Closing project access signs the client out of that project and blocks future file requests; it does not void or refund invoices.

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

If invoice creation fails, refresh the request before retrying. Stable Stripe idempotency keys prevent a retry from creating a second invoice, but the refreshed owner page is the clearest source for the next action. If a client with an unpaid invoice pays another way, open the invoice in Stripe and choose **Mark as paid**, not Void; the owner page shows this reminder while an invoice is unpaid. Handle refunds, disputes, voiding, and invoice corrections in Stripe. An uncollectible invoice remains associated because Stripe can later mark it paid; void it in Stripe before creating a replacement. The website stores operational status only.

**Paid another way.** When a client pays an installment outside Stripe (Zelle, Venmo, PayPal, Cash App, cash or bank transfer), record it in Book the work with **Record booking received** or **Record balance received**. Do this only after the money has arrived: it cannot be undone. With Stripe on, the form sits under **Paid another way?**; with Stripe off, it replaces the invoice button. The installment then shows **Paid outside Stripe**, and Activity records the method and any transaction ID. Enter an ID only, never a name or phone number, because audit notes outlive personal-data deletion. An installment that already has an invoice, or whose invoice creation is pending, cannot be recorded this way; resolve the invoice in Stripe first. Refunds for these payments happen outside the website too.

To stop new invoices, set `STRIPE_PAYMENTS_ENABLED=false` and deploy the reviewed configuration change. This does not erase payment history or disable signed status updates for invoices already sent.

## Retention

Raw playback is kept for 90 days. Daily human totals remain after cleanup, with sparse cities stored only as **Other locations**. City thresholds count distinct tab sessions, so replays in one tab do not increase the city toward visibility. Resolved purchase and merchandise contact data is removed after 90 days, resolved service contact data after one year, and non-studio withdrawn request contact data immediately unless an invoice exists, invoice creation is still reserved, or a paid booking still has a balance due. Studio contact data waits for its private-content cleanup and any live payment reconciliation.

Studio data has a separate first step. Codes and expired, revoked, or inactive sessions become eligible 30 days after they stop being useful. Access and project audit rows become eligible after two years. For a withdrawn or declined project without an active payment, private content is eligible 30 days after closure, even if work had already started. A project the client stopped after the last revision round counts the same way once you mark it resolved: its booking is kept and no balance is due, so nothing is left to collect. Delivered project content becomes eligible 30 days after the last final file's one-year access period, at least 30 days after the last project activity, and at least 30 days after any newer unpublished file upload. A revoked final follows the same expiry and activity rules. Pending multipart uploads block project cleanup until the owner discards them. This is manual cleanup; the published privacy notice must say so.

Revoking a project also signs out all studio sessions for that client's email. If the client has another active project, they can request a fresh sign-in code to reopen it.

A sign-in code locks after five incorrect entries. Someone who knows a client's email could exhaust those attempts or the three-codes-per-five-minutes issuance limit. The client can request a fresh code when the limit clears; check the access audit and email delivery if they report repeated lockouts.

Run studio cleanup at least monthly while the portal is in use:

1. Run `npm run studio:retention:preview -- --remote` and review `.private/studio-retention-review.html`. It contains counts and hashes, not client messages, email addresses, or R2 keys.
2. Apply the exact manifest with `npm run studio:retention:apply -- --remote` within 24 hours. The manifest records the database and R2 bucket from the selected Wrangler config (add `--config path` for another environment), and apply refuses to run against a different one. The command closes eligible project access before deleting private R2 objects. It then atomically clears project messages, updates, file metadata and old access records, and marks content removed.
3. If R2 deletion fails, access stays closed but database content remains for recovery. Fix storage access, generate a new preview, and retry; do not manually erase the project row or remove its payment references.
4. After studio cleanup, run the owner-retention preview and apply below to clear eligible request contact fields and Stripe references. A live or reconciling payment still blocks that step.

1. Run `npm run owner:retention:preview -- --remote`.
2. Open `.private/owner-retention-review.html`. Save any useful conclusions in the private development journal. The review must not contain names, email addresses, notes, IP addresses, or secrets.
3. Apply only the matching manifest: `npm run owner:retention:apply -- --remote`.
4. Run `npm run owner:health -- --remote` and confirm the retention check passes.

There is no scheduled deletion at launch. To pause retention, do not run an apply command. A preview never deletes data. Record each monthly run or reason it could not complete in the private operations journal; overdue cleanup is a launch or operations issue, not a silent exception.

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
