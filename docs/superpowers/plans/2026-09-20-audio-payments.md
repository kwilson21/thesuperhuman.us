# Audio Payments Implementation Plan

> **Superseded:** This is the initial dashboard-only payment plan. The current implementation
> plan is [`2026-09-20-stripe-owner-invoicing.md`](./2026-09-20-stripe-owner-invoicing.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved audio-service projects bookable through secure Stripe invoices while preserving file approval before payment.

**Architecture:** Historical dashboard-only proposal. The Astro site now uses the successor plan above.

**Tech Stack:** Stripe Dashboard and Invoicing, Astro 5, TypeScript, Vitest, Cloudflare Workers

**Spec:** `docs/superpowers/specs/2026-09-20-audio-payments-design.md`

## Global Constraints

- Customer-facing invoice identity is `The Superhuman Group LLC`.
- Invoice service descriptions identify `Audio services by Kazon`.
- Clients approve the files, scope, fixed project price, and offer before receiving an invoice.
- The booking invoice is 50% of the approved project price; the remaining balance is invoiced before final file delivery.
- Do not collect payment while Stripe payouts are paused.
- Do not add Stripe keys, API calls, webhooks, embedded checkout, subscriptions, or local payment state.
- Do not store card, bank, identity-verification, customer, or invoice data in the website or repository.
- Preserve current service prices, revision allowances, 3–5 business-day first-delivery promise, and file-approval-first intake.
- Do not add a dependency.
- Production deployment remains gated by `docs/prelaunch-checklist.md`.

## File map

- `src/pages/audio/start.astro`: explain what happens after intake and when booking occurs.
- `src/pages/audio/services.astro`: identify Stripe invoicing as the secure payment method.
- `tests/lib/audio-payment-copy.test.ts`: pin the approved payment sequence and absence of embedded Stripe checkout.
- `.private/development/journal/`: record Stripe review, sandbox proof, website verification, and deployment state through the existing journal command. Never commit this directory.

---

### Task 1: Restore Stripe payout eligibility

**Files:**
- No repository files change.
- Record evidence privately with `python3 scripts/development_journal.py checkpoint`.

**Interfaces:**
- Consumes: the Stripe account, the public website, and verified public social profiles.
- Produces: a submitted Stripe business-information review and an observed account status.

- [ ] **Step 1: Reopen the overdue Stripe task**

In Stripe Dashboard, open **Settings → Business → Account status → Provide information about what you're selling**. Confirm the task still says payouts are paused and capture only the status, task title, and timestamp in the private journal. Do not copy identity or banking data.

- [ ] **Step 2: Enter the approved public business evidence**

Use these exact values:

```text
Website URL
https://thesuperhuman.us/audio/services

Social media URLs
https://www.youtube.com/@KazonTheOne
https://soundcloud.com/kazontheone

Additional business information
The Superhuman Group LLC provides fixed-price audio mixing, mastering, production, and recording services under the customer-facing description “Audio services by Kazon.” Clients submit files for review before receiving a project-specific written offer. After the client approves the scope and fixed price, a 50% Stripe invoice books the work. The remaining balance is invoiced before final files are delivered. The website does not sell restricted goods, subscriptions, downloads, or financial services.
```

Before submission, read the three populated fields back from the page. If Stripe requests any new fact, document, owner identity, tax number, bank detail, or category choice, stop at that field and ask Kazon to complete it. Do not infer an answer.

- [ ] **Step 3: Submit and read back the review state**

Submit once. Return to Account status and record the observed state as `Submitted`, `In review`, `Complete`, or the exact failure shown. A submitted review is progress, not restored payouts.

- [ ] **Step 4: Verify capability state**

Refresh Account status. This task passes only when both `Payments` and `Payouts` are listed as active and there is no overdue business-information task. If review remains pending, checkpoint the exact pending state and pause live invoicing while continuing sandbox and website work.

---

### Task 2: Configure and prove manual Stripe invoicing

**Files:**
- No repository files change.
- Record evidence privately with `python3 scripts/development_journal.py checkpoint`.

**Interfaces:**
- Consumes: approved invoice identity and Stripe Dashboard sandbox.
- Produces: reviewed live invoice defaults and a paid sandbox invoice that proves the two-invoice workflow.

- [ ] **Step 1: Review customer-facing business settings**

In live-mode settings, confirm or set:

```text
Public business name: The Superhuman Group LLC
Website: https://thesuperhuman.us/audio/services
Support email: kazon.wilson@thesuperhuman.us
Statement descriptor: SUPERHUMAN AUDIO
Default currency: USD
```

Do not change the legal entity, tax identity, payout bank, owner identity, or business address. If Stripe requires a value not listed here, stop and ask Kazon.

- [ ] **Step 2: Review invoice presentation and delivery**

Use the existing Stripe branding when it already represents The Superhuman Group LLC. If no branding exists, set the accent color to `#AE5534`; do not upload a new logo or invent an address. Enable Stripe's invoice email delivery and successful-payment receipt email. Keep the hosted invoice page enabled.

- [ ] **Step 3: Limit the initial payment methods**

For invoices, enable card and Link. Leave financing methods, buy-now-pay-later methods, and bank debits disabled for the first version. This avoids financing disclosures and delayed bank-payment behavior while the service is new.

- [ ] **Step 4: Create a sandbox customer**

Switch to a Stripe sandbox. Create:

```text
Name: Audio Payment Test
Email: kazon.wilson@thesuperhuman.us
Description: Internal test customer for the Audio services by Kazon invoice workflow.
```

Search first and reuse the sandbox customer if it already exists.

- [ ] **Step 5: Create the 50% sandbox deposit invoice**

Create a one-time invoice with `Send invoice` collection and:

```text
Line item: Audio services by Kazon · Test song · 50% booking payment
Quantity: 1
Amount: $100.00 USD
Memo: Test invoice only. This books the approved audio project after file and scope review.
Footer: Remaining balance is due before final downloadable files are delivered.
Due: 7 days after invoice is sent
```

Review the draft total of `$100.00`, then send it in the sandbox. Do not create or send a live invoice.

- [ ] **Step 6: Prove hosted payment and receipt behavior**

Open the sandbox hosted invoice page. Pay with Stripe's standard successful test card `4242 4242 4242 4242`, any future expiry, any three-digit CVC, and any valid postal code. Verify the invoice changes from `open` to `paid` and that the customer timeline records the payment. Record the invoice's sandbox identity privately; do not commit it.

- [ ] **Step 7: Prove the remaining-balance invoice**

Create a second `$100.00 USD` sandbox invoice for the same customer:

```text
Line item: Audio services by Kazon · Test song · Remaining balance
Memo: Test invoice only. Final downloadable files are delivered after this balance is paid.
Due: On receipt
```

Verify the hosted invoice page renders the correct customer, service, amount, business identity, and payment methods. Void the second test invoice after the visual check so it cannot be mistaken for an outstanding test obligation.

---

### Task 3: Make the website payment sequence explicit

**Files:**
- Create: `tests/lib/audio-payment-copy.test.ts`
- Modify: `src/pages/audio/start.astro`
- Modify: `src/pages/audio/services.astro`

**Interfaces:**
- Consumes: existing static page copy and the approved Stripe invoice sequence.
- Produces: user-facing payment guidance with no embedded payment integration.

- [ ] **Step 1: Write the failing copy contract test**

Create `tests/lib/audio-payment-copy.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('audio payment copy', () => {
  it('explains secure invoicing after offer approval', () => {
    const start = read('src/pages/audio/start.astro');
    const services = read('src/pages/audio/services.astro');

    expect(start).toContain('a secure Stripe invoice books the project');
    expect(start).toContain('Nothing is booked until the deposit invoice is paid.');
    expect(services).toContain('You pay through a secure Stripe invoice.');
    expect(services).toContain('Balance before final files.');
  });

  it('does not embed a generic checkout or load Stripe client code', () => {
    const pages = `${read('src/pages/audio/start.astro')}\n${read('src/pages/audio/services.astro')}`;
    expect(pages).not.toContain('buy.stripe.com');
    expect(pages).not.toContain('js.stripe.com');
    expect(pages).not.toContain('STRIPE_SECRET');
  });
});
```

- [ ] **Step 2: Run the focused test and observe the intended failure**

Run:

```bash
npx vitest run tests/lib/audio-payment-copy.test.ts
```

Expected: the first test fails because the approved Stripe invoice wording is absent; the boundary test passes.

- [ ] **Step 3: Update the intake page**

In `src/pages/audio/start.astro`:

1. Change the page description to:

```text
Choose your service, share your recording and send it to Kazon for review. Payment comes only after you approve the offer.
```

2. Change the reassurance beneath the form to:

```text
No payment now. After file review, you’ll receive a written offer. If you approve it, a secure Stripe invoice books the project.
```

3. Replace the success-state ordered list and closing sentence with:

```astro
<ol class="intake-next-steps">
  <li>I’ll listen and check the files.</li>
  <li>You’ll receive an offer or a request for clarification.</li>
  <li>You approve the scope and fixed project price.</li>
  <li>A secure Stripe invoice for 50% books the project.</li>
</ol>
<p>No payment has been taken. Nothing is booked until the deposit invoice is paid.</p>
```

Preserve the existing form, endpoint, availability logic, and styling.

- [ ] **Step 4: Update the services payment disclosure**

In `src/pages/audio/services.astro`, replace only the payment paragraph with:

```astro
<p>50% to book after file review and your approval of the offer. You pay through a secure Stripe invoice. Balance before final files. Additional scope is quoted for approval; delivery errors do not consume revisions.</p>
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npx vitest run tests/lib/audio-payment-copy.test.ts
```

Expected: both tests pass.

- [ ] **Step 6: Run repository validation**

Run:

```bash
npm test
npm run check
npm run build
git diff --check
```

Expected: all commands exit 0. Treat any baseline failure separately and do not claim this change passed until the focused test and affected-page build pass.

- [ ] **Step 7: Commit the website change**

```bash
git add tests/lib/audio-payment-copy.test.ts src/pages/audio/start.astro src/pages/audio/services.astro
git commit -m "Clarify Stripe invoice booking flow"
```

---

### Task 4: Review, publish, and verify the payment guidance

**Files:**
- Modify only the existing private development journal through its script.
- Do not add deployment receipts or private Stripe evidence to the public repository.

**Interfaces:**
- Consumes: Tasks 1–3, repository review workflow, and `docs/prelaunch-checklist.md`.
- Produces: a reviewable PR and, after authorized merge/deployment, verified production guidance.

- [ ] **Step 1: Review the exact branch diff**

Run:

```bash
git diff github/main...HEAD --check
git diff --stat github/main...HEAD
git diff github/main...HEAD -- docs/superpowers/specs/2026-09-20-audio-payments-design.md docs/superpowers/plans/2026-09-20-audio-payments.md tests/lib/audio-payment-copy.test.ts src/pages/audio/start.astro src/pages/audio/services.astro
```

Confirm the branch contains only the approved design, plan, copy contract, and two page edits. Confirm it contains no Stripe customer data, invoice IDs, hosted invoice URLs, account-review documents, secrets, personal addresses, or test card data outside this plan's standard Stripe test number.

- [ ] **Step 2: Perform responsive visitor QA**

Run the local site and inspect `/audio/services` and `/audio/start` at 390×844 and 1440×900. Verify that the payment language is readable, the intake steps still work, the success state remains accessible, and there is no horizontal overflow.

- [ ] **Step 3: Complete the applicable prelaunch checklist**

Record PASS, FAIL, UNVERIFIED, or justified N/A for the exact payment-copy change. Required evidence includes repository tests, built pages, responsive inspection, unchanged form security, absence of payment secrets, and the current Stripe payout status. A pending Stripe review is a launch blocker for accepting payment, even if the explanatory website copy is technically deployable.

- [ ] **Step 4: Push and open the PR**

Push `codex/audio-payments-design` to `github` and open a PR against `main`. The PR description must state:

```text
Audio clients currently see a deposit requirement without a defined payment method. This change explains the approved file-review-first Stripe invoice flow: clients approve scope and price, pay 50% to book, and pay the balance before final files. No checkout, Stripe API key, webhook, or payment state is added to the website.

Validation: npm test; npm run check; npm run build; responsive review of /audio/services and /audio/start.
```

Attach the PR to the Codex task. Address CI and Greptile findings before merge.

- [ ] **Step 5: Merge and verify production only after the launch gate passes**

After Stripe payouts are active, the PR is green, and the applicable prelaunch checks have no unresolved failure or unknown, merge through the normal GitHub workflow. Verify production `/audio/services` and `/audio/start` show the approved wording and that the intake form still stores a real authorized test request before displaying success. Remove the test request through the existing owner workflow if it should not remain.

- [ ] **Step 6: Record the operational handoff**

Append a private development-journal checkpoint containing:

- Stripe review status and payout capability readback;
- sandbox deposit and remaining-balance invoice results;
- PR and merge commit;
- production page and intake evidence;
- the manual operating sequence: approve offer, send deposit invoice, begin after payment, send balance invoice, release final files after payment.

Report Stripe configuration, local verification, deployment, and live verification as separate states.
