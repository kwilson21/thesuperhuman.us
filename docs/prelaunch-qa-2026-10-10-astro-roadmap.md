# Astro migration roadmap release gate

Date: October 10, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `codex/astro-migration-roadmap`
Starting head: `5e3ac1edaf6bd9cc92319611c3272730fbf170f2`, matching the local `origin/main` ref.
PR branch commit chain: `5e3ac1ed` -> the documentation commit that last touches this file, identifiable with `git log -1 -- docs/prelaunch-qa-2026-10-10-astro-roadmap.md`.
Merge method and record revision: this chain is preserved on `main` only by a merge-commit merge, the method planned for this PR and used for recent PRs #157, #158, #165, #171 and #172. A squash or rebase merge would not preserve these hashes; if either were used, the deployed revision would have to be identified by the PR number and its merge commit instead, and this record would need a note saying so. A commit cannot embed its own hash; the final handoff supplies the exact hash.
Target: production `https://thesuperhuman.us`
Reviewer: Codex (gpt-6.1-sol), local evidence collection for owner Kazon Wilson. This record does not certify independent current-head review.
Rollback revision: `5e3ac1edaf6bd9cc92319611c3272730fbf170f2` = current production per the caller's observation on 2026-10-10 at about 17:40 UTC. Workers Builds completed with success, and `npm run owner:health -- --remote --post-deploy` reported 9 of 9 PASS. This offline run did not independently verify that observation.

Scope: documentation-only. No code, dependency, public copy, page, asset, route or migration change. The roadmap prose is repository documentation, not rendered site copy. A merge still triggers a production build of identical site output; deployment and live verification remain UNVERIFIED until after merge, checked with Workers Builds and `npm run owner:health -- --remote --post-deploy`.

## Owner decisions and authorization

On 2026-10-10, the owner requested the Astro 5 to 7 migration in the existing Deferred maintenance section of `docs/website-system-plan.md`. It is proposed and not scheduled. Leave Dependabot PR #138 open as a placeholder. The owner closed PR #140 (TypeScript 7); per the owner, Dependabot will not raise it again until reopened. TypeScript 7 stays deferred until the Astro checker supports it and can follow the migration. The Tailwind path requires an owner decision.

Authorized: these two documentation files, local checks and one local commit. No push, fetch or network access. No merge or deployment performed. Current-head CI, independent Codex review and Greptile review remain UNVERIFIED. No release exception is accepted here.

## Evidence and limits

Read repository instructions, coding approach, publication protocol, project journal, prelaunch checklist and the existing Wrangler release-record structure. Journal status succeeded. Checkpoint writing failed with `Operation not permitted` on the private journal lock; no checkpoint was saved. No cloud backup was attempted. Existing untracked `.jolli/` is excluded.

Local `package.json` specifies Astro `^5.1.0`, Cloudflare adapter `^12.5.0`, Tailwind integration `^5.1.4`, Tailwind `^3.4.17`, sitemap `^3.7.4`, checker `^0.9.10` and TypeScript `^5.7.2`. Installed Tailwind integration 5.1.5 accepts Astro 3, 4 or 5, not 7. Installed checker 0.9.10 accepts TypeScript 5 or 6, not 7. `astro.config.mjs` uses the Tailwind and sitemap integrations, `imageService: 'compile'` and platform proxy development access. `wrangler.jsonc` points to `./dist/_worker.js/index.js`. The installed adapter runtime type exposes env, cf, caches and ctx. These are migration planning surfaces, not changes made here.

`grep -rn "locals.runtime" src tests | wc -l` returned 147 matching lines. `grep -rl "locals.runtime" src tests | wc -l` returned 85 files, recorded as about 85 files in the roadmap. The references span pages, API routes, middleware, libraries and tests. Current `vitest.config.ts` uses the Node environment and mocks; Workers-runtime development and testing is a proposed migration requirement, not a description of today's full test suite.

The owner supplied PR #138's placeholder/install-failure assessment and the absence of an Astro 7 Tailwind integration release. The local integration peer range supports the compatibility concern, but this repo cannot establish registry-wide availability, current Astro 7 adapter APIs/defaults or the remote PR's install result. Those upstream details remain UNVERIFIED in this offline run and must be re-checked when planning the migration. Supported-release maintenance and later toolchain updates are owner-provided intent. No database migration is expected from this framework work; that expectation must be re-checked against the implementation diff.

Local checks: `npm run copy:check` PASS; `git diff --check` PASS. Diff review against local `origin/main` confirms exactly the roadmap and this record, with no rendered source or behavior change. No dependency install, build, type check, test suite, screenshot capture or remote health command was run for this documentation-only change. Commit hooks are disabled for the local commit to preserve the offline boundary.


## 1. Purpose and content

- **PASS · 1.1. Confirm the correct project, branch, local changes, site instructions, audience and deployment authorization.** Confirmed repository, branch, starting head, instructions and the owner-authorized docs-only scope. Deployment is not authorized by this task.

- **PASS · 1.2. Preserve approved design and truthful claims; remove placeholders and verify ownership/rights for media.** Only the approved maintenance proposal and release record are added; no media, design or rendered claims change.

- **N/A · 1.3. For explanatory copy, explain who does what, what action they take, and the supported result or reason when visitors need that context; keep useful labels and personal or creative writing in their intended roles. For professional-claim or resume changes, record a private website/resume comparison of facts, metric scope, attribution and status, including intentional differences and the actual stored PDF version. N/A is appropriate when neither changes.** no rendered page or behavior changed.

- **N/A · 1.4. The first screen explains who/what the site is for and offers a useful next step. Verify the CTA works at narrow and desktop sizes. A sticky CTA is optional, justified by the actual journey.** no rendered page or behavior changed.

- **N/A · 1.5. Navigation, footer, contact route and important external links work. Never invent an address or expose a home address.** no rendered page or behavior changed.


## 2. Search and sharing

- **N/A · 2.1. Each indexable page has a descriptive, distinct title and meta description.** no rendered page or behavior changed.

- **N/A · 2.2. Absolute canonical URLs use the production HTTPS domain, match the sitemap and normalize duplicate host/path/query variants. Preserve query parameters only when they identify distinct indexable content.** no rendered page or behavior changed.

- **N/A · 2.3. Open Graph title, description, URL and reachable image are correct; inspect the image at sharing size. Include a social card type and suitable image description when applicable.** no rendered page or behavior changed.

- **N/A · 2.4. Branded SVG/raster favicon and Apple touch icon return the correct formats and remain legible at small sizes.** no rendered page or behavior changed.

- **N/A · 2.5. robots.txt reflects intended indexing and links to the real sitemap. Sitemap includes public canonical routes, including server-rendered pages, and excludes redirects/errors/private routes.** no rendered page or behavior changed.

- **N/A · 2.6. Preview environments cannot be accidentally indexed. Secrets and private data require access control, never robots.txt alone.** no rendered page or behavior changed.

- **N/A · 2.7. Verify structured data when present. Do not invent ratings, credentials or organization details.** no rendered page or behavior changed.


## 3. Accessibility and responsive behavior

- **N/A · 3.1. Semantic landmarks, page language, sensible heading order and one primary heading.** no rendered page or behavior changed.

- **N/A · 3.2. Meaningful image alternatives; decorative images use empty alt text. Icon-only controls have names.** no rendered page or behavior changed.

- **N/A · 3.3. Keyboard access, visible focus, skip link, menus, dialogs and focus restoration work. No keyboard traps.** no rendered page or behavior changed.

- **N/A · 3.4. Inputs have labels, required/optional guidance, useful error associations and status announcements. Success and failure do not depend on color alone.** no rendered page or behavior changed.

- **N/A · 3.5. Text/UI contrast, touch targets, 200% text zoom and reduced-motion behavior are checked. Use automated accessibility checks plus manual review.** no rendered page or behavior changed.

- **N/A · 3.6. Check at least 320px, typical phone, tablet and desktop widths, including long content and expanded menus/forms. No horizontal overflow or concealed controls.** no rendered page or behavior changed.

- **N/A · 3.7. Check Chromium and another supported browser, plus a real mobile device for critical interactions where available. Record limits.** no rendered page or behavior changed.


## 4. Performance and resilience

- **N/A · 4.1. Images are appropriately sized/compressed, have intrinsic dimensions, and use responsive sources where beneficial. Prioritize the hero; lazy-load below-fold images.** no rendered page or behavior changed.

- **N/A · 4.2. Avoid unnecessary client code, dependencies, embeds and font weights. Verify compression, caching and asset loading against the built site.** no rendered page or behavior changed.

- **N/A · 4.3. Measure representative pages with a repeatable mobile profile. Record LCP, CLS and INP when field data exists; lab results are not field evidence. Investigate LCP over 2.5s, CLS over 0.1 or INP over 200ms.** no rendered page or behavior changed.

- **N/A · 4.4. Async UI visibly loads and recovers from timeout, offline, malformed response and server error. Preserve user input and allow retry without duplicate submissions.** no rendered page or behavior changed.

- **N/A · 4.5. Test missing/unavailable audio, video and external resources where used; avoid autoplay surprises.** no rendered page or behavior changed.

- **N/A · 4.6. Useful branded 404 returns actual HTTP 404 on arbitrary missing paths. Verify redirects and their status codes. Server errors expose no secrets and leave a usable recovery path.** no rendered page or behavior changed.


## 5. Forms and sensitive flows (N/A if absent)

- **N/A · 5.1. Validate and bound input on the server. Verify origin/auth checks, abuse protection and rate limits.** no rendered page or behavior changed.

- **N/A · 5.2. Test empty/invalid input, invalid verification token, 429, 500, network failure, timeout, retry, pending button, success and duplicate-submit prevention.** no rendered page or behavior changed.

- **N/A · 5.3. Provide an alternative when JavaScript or verification cannot load. Verify disabled/unavailable states.** no rendered page or behavior changed.

- **N/A · 5.4. Confirm delivery/receipt in the intended environment using authorized test recipients. Mocked UI success is not proof of email delivery.** no rendered page or behavior changed.

- **N/A · 5.5. Keep approval-gated flows intact. Check expired/reused links, permissions and sensitive file access.** no rendered page or behavior changed.

- **N/A · 5.6. Use an inline confirmation unless a separate thank-you page serves a real need. Protect its indexing if appropriate.** no rendered page or behavior changed.


## 6. Privacy, legal and measurement

- **N/A · 6.1. Inventory actual form data, storage, logs, external fonts/embeds, cookies, analytics and processors, including host-injected scripts.** no rendered page or behavior changed.

- **N/A · 6.2. Where personal data is processed, publish an accessible, accurate privacy notice linked near collection and in the footer. Confirm purposes, recipients, retention, contact and applicable rights with the operator; do not invent retention periods or compliance claims.** no rendered page or behavior changed.

- **N/A · 6.3. Determine consent needs from actual technology, audience and jurisdiction. Add a cookie banner only when required, and verify reject/withdraw actually controls nonessential processing.** no rendered page or behavior changed.

- **N/A · 6.4. Terms, physical business address and additional legal disclosures depend on commerce, accounts, contributions, licensing and applicable rules. Do not add boilerplate just to tick a box.** no rendered page or behavior changed.

- **N/A · 6.5. Analytics needs a concrete question and a privacy decision. N/A is valid. If enabled, verify events without collecting sensitive input or duplicating counts.** no rendered page or behavior changed.

- **UNVERIFIED · 6.6. Confirm existing error logs/monitoring work, who receives actionable failures and how they respond. Configuration alone is not verified monitoring. Do not create new paid accounts or services by assumption.** No target-environment monitoring or health query performed. Caller baseline evidence does not certify a future deployment.


## 7. Release and final QA

- **PASS · 7.1. Run the project's required type, test, asset and build checks. Inspect warnings; record pre-existing exceptions.** Required docs-only copy and diff checks pass. Astro and TypeScript changes are absent; type, test, asset and build checks are N/A for this local documentation scope. CI remains UNVERIFIED.

- **PASS · 7.2. Review the exact diff, dependencies, generated files and public artifacts. No secrets, private logs, unapproved claims or accidental unrelated changes.** Local exact diff reviewed: only the two requested docs files, no dependencies, generated files or restricted detail added. Independent current-head review remains UNVERIFIED.

- **UNVERIFIED · 7.3. Verify production bindings/secrets, migrations/backups where applicable, HTTPS, host routing, cache behavior and response headers on dynamic as well as static responses.** No production query performed. No binding or migration change; verify the production build and health after merge.

- **UNVERIFIED · 7.4. Preserve a rollback version and any required backup before deployment. Follow existing review and authorization rules.** Rollback revision `5e3ac1edaf6bd9cc92319611c3272730fbf170f2` is recorded from caller evidence. Local Git resolves it; production availability, current-head review and merge authorization remain unverified. No data change requires a new backup.

- **UNVERIFIED · 7.5. After authorized deployment, verify the actual production revision, main journeys, sitemap/robots, metadata/OG/icons, missing page, forms and monitoring on every supported host.** No merge or deployment performed. Check Workers Builds and `npm run owner:health -- --remote --post-deploy` after merge.

- **PASS · 7.6. Save a receipt and QA evidence. Report **implemented**, **verified locally**, **deployed**, and **verified live** separately. Reopen the checklist after material changes.** This release record separates implementation, local verification, deployment and live verification; reopen after material changes.


## 8. Private owner center (N/A if absent)

- **N/A · 8.1. Cloudflare Access has one approved owner identity for both `/owner*` and `/api/owner*` (the owner pages post their actions to `/api/owner`, and without Access there every action returns 403); the Worker independently verifies the signed JWT issuer, audience, signature, and email. Unsigned and wrong-owner requests fail closed.** no rendered page or behavior changed.

- **N/A · 8.2. Every owner response uses `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Private routes stay out of the sitemap.** no rendered page or behavior changed.

- **N/A · 8.3. Reconcile the production MUSIC_DB schema and migration ledger before applying any migration. Record backup and recovery evidence separately from local schema tests.** no rendered page or behavior changed.

- **N/A · 8.4. Verify a valid request persists before success. Force storage failure and confirm the visitor receives an honest retry while the urgent email contains no request content or raw database error.** no rendered page or behavior changed.

- **N/A · 8.5. Verify the Cloudflare traffic summary and its safe unavailable fallback. Confirm owner pages remain usable without the optional analytics token.** no rendered page or behavior changed.

- **N/A · 8.6. Confirm automated playback is excluded, campaign tags are controlled, and city rows below five qualifying human listens are combined under **Other locations**.** no rendered page or behavior changed.

- **N/A · 8.7. Preview retention and inspect the private manifest for contact data or secrets. Apply only an exact reviewed manifest in a non-production environment before production use.** no rendered page or behavior changed.

- **N/A · 8.8. Before enabling the private studio, reconcile portal migrations `0005` through `0017`, then exercise email-code access, mobile and keyboard use, private audio playback, upload interruption, failed notice delivery, and project revocation in the target environment.** no rendered page or behavior changed.

- **N/A · 8.9. Confirm the launch scope with payments off. While `STRIPE_PAYMENTS_ENABLED=false`, no invoices are created. The owner collects each installment another way (Zelle, cash, and so on) and records it with **Record booking received** or **Record balance received** in Book the work. That marks the installment paid with no Stripe invoice, shows it as "Paid outside Stripe", and logs the method and reference in Activity. It is allowed only for an installment with no invoice and no pending invoice creation, and the balance only after the booking. A recorded installment can never be invoiced, and a Stripe invoice for it is held as unmatched rather than adopted.** no rendered page or behavior changed.

- **N/A · 8.10. Run the studio-retention preview and exact-manifest apply against a non-production project with a real private R2 object; verify access closes before deletion, a storage failure is retryable, and owner-request retention waits for studio cleanup.** no rendered page or behavior changed.

- **N/A · 8.11. Keep `STRIPE_PAYMENTS_ENABLED=false` until Stripe payments and payouts are active, migration `0003_audio_payments.sql` is reconciled, secrets are configured, and the test-mode booking and balance lifecycle passes.** no rendered page or behavior changed.

- **N/A · 8.12. Verify invalid Stripe signatures change no data, repeated webhook events apply once, repeated invoice actions create no duplicate invoice, and the balance action stays locked until the booking invoice is paid.** no rendered page or behavior changed.

- **N/A · 8.13. Confirm the owner Payment section exposes no Stripe secret, webhook secret, payment credential, or customer identifier in HTML or API responses.** no rendered page or behavior changed.

- **N/A · 8.14. Exercise the documented previous-version rollback, Old News visibility, event-disable, retention-pause, D1 recovery, and visitor-recovery procedures without changing production.** no rendered page or behavior changed.

- **UNVERIFIED · 8.15. Run `owner:health` against the target environment. Resolve every attention result or record it as a launch-blocking UNVERIFIED item.** No target-environment monitoring or health query performed. Caller baseline evidence does not certify a future deployment.


## Software agreement signing

- **N/A · Agreement.1. Record counsel review status for the templates and electronic consent.** no rendered page or behavior changed.

- **N/A · Agreement.2. Owner verifies the registered-agent business address and contractor config.** no rendered page or behavior changed.

- **N/A · Agreement.3. Preview seeded templates for one, two and three milestones in both payment modes.** no rendered page or behavior changed.

- **N/A · Agreement.4. Verify the signing setting defaults off and the outside-site path still works.** no rendered page or behavior changed.

- **N/A · Agreement.5. Verify scoped email authentication, revocation, stale hashes and MSA reuse confirmation.** no rendered page or behavior changed.

- **N/A · Agreement.6. Exercise PDF rendering in the actual Workers runtime, including Unicode and attachments.** no rendered page or behavior changed.

- **N/A · Agreement.7. Verify full text extraction, every document certificate, packet hashes and two retained copies.** no rendered page or behavior changed.

- **N/A · Agreement.8. Test artifact failure and each recipient's uncertain email/retry separately.** no rendered page or behavior changed.

- **N/A · Agreement.9. Verify project-page and archive downloads, including closed project and redacted request.** no rendered page or behavior changed.

- **N/A · Agreement.10. Rehearse restoring agreement database records, templates, fonts and private storage, with hashes.** no rendered page or behavior changed.

- **N/A · Agreement.11. Verify custom project retention and exclusion of open, held and actively reused agreements.** no rendered page or behavior changed.

- **N/A · Agreement.12. Review real CI screenshots, keyboard/no-JS behavior and overflow from 320 to 1280 pixels.** no rendered page or behavior changed.

## Delivery status and remaining gates

- **Implemented:** Roadmap bullet and this release record only. The Astro migration is proposed, not implemented or scheduled.
- **Verified locally:** Repository configuration and installed peer ranges inspected; runtime-reference count checked; copy check and diff whitespace check pass; exactly two docs files differ from local origin/main.
- **Deployed:** UNVERIFIED. No push or merge performed.
- **Verified live:** UNVERIFIED. No network access performed; the caller's production baseline is separately attributed above.

Before a future merge, require green current-head CI, Codex and Greptile review under the repository review rules, and deployment authorization. After merge, verify Workers Builds and run `npm run owner:health -- --remote --post-deploy`. The framework migration requires its own plan, release records, runtime verification and UI screenshots.
