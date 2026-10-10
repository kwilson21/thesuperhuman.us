# Work-first client project page release gate

Date: October 10, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: [#171](https://github.com/kwilson21/thesuperhuman.us/pull/171)
Branch: `codex/project-work-first`
Starting head: `96381aa09ab17f7daad20856ff896cac22c7758d`. Verified merge revision: `67e16e071b330fd546d6803c0a2f5d25104ba620`; this record is committed on top.
Target: production `https://thesuperhuman.us`, private `/studio/software/[id]`, review actions and owner update composer.
Reviewer: Jewls (Codex), local evidence collection for owner Kazon Wilson. This record does not certify independent current-head review.
Rollback revision: `28873a64f1b2ccaae33efba80a57ed4a4b011098`, current local `origin/main`.

Scope: work before review actions; browser-only Works/Not yet helper; explicit named-version acceptance; partial-delivery guard; change requests; direction, accepted, paid and handoff states; milestone-owned files and acceptance records; timeline/history; owner progress milestone validation. Existing signing fixes from PR #158 are preserved.

## Owner decisions and authorization

Owner, in conversation, 2026-10-09: P1 **"7. A"** on the decision image. It was the seventh answer in **"1. C with AI autocomplete would be incredible here. 2. A 3. A 4. A 5. A 6. A 7. A"**.

Owner, in conversation, 2026-10-10, deployment: **"proceed with fixing reviews until we are ready to merge everything then merge"** and **"keep going until everything is merged"**.

Authorization remains conditional on review, green CI and applicable deployment gates. This job merges main into the feature branch and records evidence; it does not merge the PR into main or deploy.

## Evidence and limits

Read repository instructions, coding approach, project-journal protocol, publication protocol, current prelaunch checklist, brief-conversation release-record format, the private P1 specification and bot1 through bot13 plus look1 rulings. Private source material and paths remain outside this record. Later rulings supersede earlier wording: invoices are due from delivery, paid invoices say Paid, handoff promises require acceptance, all non-current accepted milestones remain accessible, and progress belongs to the current milestone.

Merged local `origin/main` at `28873a64` with no conflicts. Git automatically combined `tests/pages/software-offer.test.ts`. Both parents and signing changes are retained. No fetch was performed. Git reported a sandbox denial for `packed-refs.lock`; the actual merge commit and feature branch HEAD were verified. Jolli's commit hook reported no memory generation because network access was unavailable.

**No migration in this PR.** Migrations 0021 through 0025 are already in production, per the supplied owner/orchestrator record. This job did not query the remote migration ledger or database. `db/music.sql` is byte-identical to `LC_ALL=C cat migrations/music/*.sql` (local `cmp` passed); the feature diff adds no schema or migration files.

Inspected the feature diff against main: 17 files, including page/components, review helper, milestone guards, message labels, owner composer, screenshot scenario and regression tests. No dependency or generated-image additions. Untracked `.jolli/` is excluded.

Checks at the merge revision:

- **PASS:** `npx vitest run tests/scripts/screenshots.test.ts`, 36 tests.
- **FAIL:** `npx vitest run`, 125 files passed, 1 failed; 1,390 tests passed, 1 failed, 1 skipped (1,392 total), one unhandled error. `tests/lib/audio-project-uploads.test.ts`, opaque local R2 part-tag integration, timed out after 15 seconds because sandbox localhost listening returned `listen EPERM: operation not permitted 127.0.0.1`. Wrangler log writing was also denied. Feature regressions passed, but the suite is not green.
- **PASS:** `npm run check`, 441 files, 0 errors, 0 warnings, 17 hints. Hints include retention-script properties, unused declarations, inline JSON-LD and deprecated autocomplete `keyCode`; content sync notes absent content collections.
- **PASS:** `npm run copy:check`.
- **PASS:** `npm run assets:check`, 36 production files match visual review records.
- **PASS:** merge diff whitespace check and schema concatenation comparison.

Viewed local `origin/screenshots` artifacts `pr-171/c8928bf/software-project-delivery-review-phone.png` and `software-project-handoff-desktop.png`. These historical captures show work-first structure and handoff links, but also pre-ruling duplicate checks, old invoice timing, stale next-update date and old timeline/handoff ordering. They do not validate the merge revision or final head. The updated scenario assertions pass locally; real CI capture and current-head CI conclusions were not retrieved. No browser capture, build, real email, payment, remote health, deployment or live verification was performed, following the bounded job/spec scope.

PASS below means the named local source/test evidence only. Unknowns are UNVERIFIED, not accepted exceptions. This record does not claim launch readiness.


## 1. Purpose and content

- **PASS · 1.1. Confirm the correct project, branch, local changes, site instructions, audience and deployment authorization.** Branch, instructions, audience and conditional owner authorization recorded above.

- **PASS · 1.2. Preserve approved design and truthful claims; remove placeholders and verify ownership/rights for media.** Approved work-first direction and later rulings reviewed; copy and asset checks pass; no media additions.

- **PASS · 1.3. For explanatory copy, explain who does what, what action they take, and the supported result or reason when visitors need that context; keep useful labels and personal or creative writing in their intended roles. For professional-claim or resume changes, record a private website/resume comparison of facts, metric scope, attribution and status, including intentional differences and the actual stored PDF version. N/A is appropriate when neither changes.** Copy describes client actions and explicit acceptance; no professional claims or resume change, so PDF parity is N/A.

- **UNVERIFIED · 1.4. The first screen explains who/what the site is for and offers a useful next step. Verify the CTA works at narrow and desktop sizes. A sticky CTA is optional, justified by the actual journey.** Rendered state regressions pass; final-head narrow and desktop CTA interaction remains pending.

- **UNVERIFIED · 1.5. Navigation, footer, contact route and important external links work. Never invent an address or expose a home address.** Timeline anchors and history navigation have regression coverage; live destinations and footer links not exercised.


## 2. Search and sharing

- **N/A · 2.1. Each indexable page has a descriptive, distinct title and meta description.** Private project page is not indexable; no public title changes.

- **N/A · 2.2. Absolute canonical URLs use the production HTTPS domain, match the sitemap and normalize duplicate host/path/query variants. Preserve query parameters only when they identify distinct indexable content.** No public canonical or route changes.

- **N/A · 2.3. Open Graph title, description, URL and reachable image are correct; inspect the image at sharing size. Include a social card type and suitable image description when applicable.** No sharing metadata or image changes.

- **N/A · 2.4. Branded SVG/raster favicon and Apple touch icon return the correct formats and remain legible at small sizes.** No icon changes.

- **UNVERIFIED · 2.5. robots.txt reflects intended indexing and links to the real sitemap. Sitemap includes public canonical routes, including server-rendered pages, and excludes redirects/errors/private routes.** Target private-route exclusion, robots and sitemap not checked live.

- **UNVERIFIED · 2.6. Preview environments cannot be accidentally indexed. Secrets and private data require access control, never robots.txt alone.** Existing authenticated private route retained; target preview indexing and access not exercised.

- **N/A · 2.7. Verify structured data when present. Do not invent ratings, credentials or organization details.** No structured data changes.


## 3. Accessibility and responsive behavior

- **PASS · 3.1. Semantic landmarks, page language, sensible heading order and one primary heading.** Page source and rendered tests cover state headings and work/action/history structure; full browser audit pending.

- **PASS · 3.2. Meaningful image alternatives; decorative images use empty alt text. Icon-only controls have names.** Existing image alt text retained; toggle groups have check names and aria-pressed state in source.

- **UNVERIFIED · 3.3. Keyboard access, visible focus, skip link, menus, dialogs and focus restoration work. No keyboard traps.** Helper/form tests pass; manual keyboard, focus restoration and traps not reviewed.

- **UNVERIFIED · 3.4. Inputs have labels, required/optional guidance, useful error associations and status announcements. Success and failure do not depend on color alone.** Required note, named checks and live status are present; manual screen-reader announcements pending.

- **UNVERIFIED · 3.5. Text/UI contrast, touch targets, 200% text zoom and reduced-motion behavior are checked. Use automated accessibility checks plus manual review.** No measured contrast, axe, zoom, touch-target or reduced-motion review.

- **UNVERIFIED · 3.6. Check at least 320px, typical phone, tablet and desktop widths, including long content and expanded menus/forms. No horizontal overflow or concealed controls.** Historical desktop/phone captures inspected; final 320px, phone, tablet, desktop and expanded-form QA pending.

- **UNVERIFIED · 3.7. Check Chromium and another supported browser, plus a real mobile device for critical interactions where available. Record limits.** No second-browser or real-device critical-flow test.


## 4. Performance and resilience

- **UNVERIFIED · 4.1. Images are appropriately sized/compressed, have intrinsic dimensions, and use responsive sources where beneficial. Prioritize the hero; lazy-load below-fold images.** No media additions and asset gate passes; dynamic client images and dimensions not measured at final head.

- **UNVERIFIED · 4.2. Avoid unnecessary client code, dependencies, embeds and font weights. Verify compression, caching and asset loading against the built site.** Existing components/tokens reused and no dependency added; built loading, compression and caching pending.

- **UNVERIFIED · 4.3. Measure representative pages with a repeatable mobile profile. Record LCP, CLS and INP when field data exists; lab results are not field evidence. Investigate LCP over 2.5s, CLS over 0.1 or INP over 200ms.** No repeatable mobile performance measurement or field data.

- **UNVERIFIED · 4.4. Async UI visibly loads and recovers from timeout, offline, malformed response and server error. Preserve user input and allow retry without duplicate submissions.** Review helper tests cover storage failure, selection sync and disabled-button restoration; full browser offline/timeout/retry matrix pending.

- **UNVERIFIED · 4.5. Test missing/unavailable audio, video and external resources where used; avoid autoplay surprises.** Preview and handoff links are source/fixture evidence; actual external availability not tested.

- **UNVERIFIED · 4.6. Useful branded 404 returns actual HTTP 404 on arbitrary missing paths. Verify redirects and their status codes. Server errors expose no secrets and leave a usable recovery path.** No target 404, redirect or HTTP recovery exercise.


## 5. Forms and sensitive flows (N/A if absent)

- **PASS · 5.1. Validate and bound input on the server. Verify origin/auth checks, abuse protection and rate limits.** Existing server acceptance/auth boundaries retained; progress guard rejects non-current milestones before email; local regression coverage passes.

- **UNVERIFIED · 5.2. Test empty/invalid input, invalid verification token, 429, 500, network failure, timeout, retry, pending button, success and duplicate-submit prevention.** Regression tests cover review payloads, partial acceptance and helper/form sync; full target failure and duplicate-submit matrix pending.

- **UNVERIFIED · 5.3. Provide an alternative when JavaScript or verification cannot load. Verify disabled/unavailable states.** Partial Accept stays disabled after request recovery in tests; manual no-JS/unavailable-verification fallback pending.

- **UNVERIFIED · 5.4. Confirm delivery/receipt in the intended environment using authorized test recipients. Mocked UI success is not proof of email delivery.** No authorized real email or target receipt test; fixtures are not delivery evidence.

- **UNVERIFIED · 5.5. Keep approval-gated flows intact. Check expired/reused links, permissions and sensitive file access.** Explicit acceptance, milestone-owned handoff and review guards covered locally; expired/reused access and sensitive downloads not exercised in target.

- **PASS · 5.6. Use an inline confirmation unless a separate thank-you page serves a real need. Protect its indexing if appropriate.** Existing inline status/decision record retained; no thank-you route added.


## 6. Privacy, legal and measurement

- **UNVERIFIED · 6.1. Inventory actual form data, storage, logs, external fonts/embeds, cookies, analytics and processors, including host-injected scripts.** Helper stores only per-review marks in browser localStorage and does not post them; server decisions still post selected checks/note. Actual target logs, scripts and processors not inventoried.

- **UNVERIFIED · 6.2. Where personal data is processed, publish an accessible, accurate privacy notice linked near collection and in the footer. Confirm purposes, recipients, retention, contact and applicable rights with the operator; do not invent retention periods or compliance claims.** Privacy route unchanged; operator confirmation that existing notice covers optional local helper storage pending.

- **UNVERIFIED · 6.3. Determine consent needs from actual technology, audience and jurisdiction. Add a cookie banner only when required, and verify reject/withdraw actually controls nonessential processing.** No analytics added; jurisdiction and consent assessment not performed.

- **N/A · 6.4. Terms, physical business address and additional legal disclosures depend on commerce, accounts, contributions, licensing and applicable rules. Do not add boilerplate just to tick a box.** No new commerce, contract template or business-address changes in feature diff.

- **N/A · 6.5. Analytics needs a concrete question and a privacy decision. N/A is valid. If enabled, verify events without collecting sensitive input or duplicating counts.** No analytics changes.

- **UNVERIFIED · 6.6. Confirm existing error logs/monitoring work, who receives actionable failures and how they respond. Configuration alone is not verified monitoring. Do not create new paid accounts or services by assumption.** No actual failure notification or operator response test.


## 7. Release and final QA

- **FAIL · 7.1. Run the project's required type, test, asset and build checks. Inspect warnings; record pre-existing exceptions.** Required checks detailed above: full suite blocked by local R2 sandbox failure. Build and green CI unverified.

- **UNVERIFIED · 7.2. Review the exact diff, dependencies, generated files and public artifacts. No secrets, private logs, unapproved claims or accidental unrelated changes.** Feature and merge diff inspected; no dependencies/images/migrations added. Independent final-head review and CI remain pending.

- **UNVERIFIED · 7.3. Verify production bindings/secrets, migrations/backups where applicable, HTTPS, host routing, cache behavior and response headers on dynamic as well as static responses.** No migration in PR; 0021 through 0025 already production per supplied record. Target flags, secrets, routing, headers and cache unchecked.

- **UNVERIFIED · 7.4. Preserve a rollback version and any required backup before deployment. Follow existing review and authorization rules.** Exact current-main rollback recorded; production backup and rollback rehearsal not performed.

- **UNVERIFIED · 7.5. After authorized deployment, verify the actual production revision, main journeys, sitemap/robots, metadata/OG/icons, missing page, forms and monitoring on every supported host.** No deployment; verify actual revision, private client states, permissions, downloads, supported hosts and common site QA after authorized deployment.

- **PASS · 7.6. Save a receipt and QA evidence. Report **implemented**, **verified locally**, **deployed**, and **verified live** separately. Reopen the checklist after material changes.** This local receipt distinguishes implemented/local-tested from deployed/live-verified and records remaining gates.


## 8. Private owner center (N/A if absent)

- **UNVERIFIED · 8.1. Cloudflare Access has one approved owner identity for both `/owner*` and `/api/owner*` (the owner pages post their actions to `/api/owner`, and without Access there every action returns 403); the Worker independently verifies the signed JWT issuer, audience, signature, and email. Unsigned and wrong-owner requests fail closed.** Existing owner authentication retained; target Access policies and signed JWT exercise pending.

- **UNVERIFIED · 8.2. Every owner response uses `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Private routes stay out of the sitemap.** Target private/no-store/noindex headers and sitemap exclusion unchecked.

- **UNVERIFIED · 8.3. Reconcile the production MUSIC_DB schema and migration ledger before applying any migration. Record backup and recovery evidence separately from local schema tests.** Local schema concatenation matches. Production 0021 through 0025 supplied as applied; ledger, backup and recovery not read back by this job.

- **UNVERIFIED · 8.4. Verify a valid request persists before success. Force storage failure and confirm the visitor receives an honest retry while the urgent email contains no request content or raw database error.** Local update/review regressions pass; actual storage failure and urgent-email receipt not exercised.

- **N/A · 8.5. Verify the Cloudflare traffic summary and its safe unavailable fallback. Confirm owner pages remain usable without the optional analytics token.** No traffic-summary changes.

- **N/A · 8.6. Confirm automated playback is excluded, campaign tags are controlled, and city rows below five qualifying human listens are combined under **Other locations**.** No playback/campaign changes.

- **N/A · 8.7. Preview retention and inspect the private manifest for contact data or secrets. Apply only an exact reviewed manifest in a non-production environment before production use.** No retention policy or manifest changes.

- **UNVERIFIED · 8.8. Before enabling the private studio, reconcile portal migrations `0005` through `0017`, then exercise email-code access, mobile and keyboard use, private audio playback, upload interruption, failed notice delivery, and project revocation in the target environment.** No studio activation change; existing target email-code, revocation and private downloads must be verified for changed client journey.

- **UNVERIFIED · 8.9. Confirm the launch scope with payments off. While `STRIPE_PAYMENTS_ENABLED=false`, no invoices are created. The owner collects each installment another way (Zelle, cash, and so on) and records it with **Record booking received** or **Record balance received** in Book the work. That marks the installment paid with no Stripe invoice, shows it as "Paid outside Stripe", and logs the method and reference in Activity. It is allowed only for an installment with no invoice and no pending invoice creation, and the balance only after the booking. A recorded installment can never be invoiced, and a Stripe invoice for it is held as unmatched rather than adopted.** No payment setting change; both payment modes and paid invoice copy covered locally. Target outside-Stripe lifecycle not exercised.

- **N/A · 8.10. Run the studio-retention preview and exact-manifest apply against a non-production project with a real private R2 object; verify access closes before deletion, a storage failure is retryable, and owner-request retention waits for studio cleanup.** No R2 retention change; unrelated local upload integration failure recorded above.

- **N/A · 8.11. Keep `STRIPE_PAYMENTS_ENABLED=false` until Stripe payments and payouts are active, migration `0003_audio_payments.sql` is reconciled, secrets are configured, and the test-mode booking and balance lifecycle passes.** No Stripe activation; existing flag preserved.

- **N/A · 8.12. Verify invalid Stripe signatures change no data, repeated webhook events apply once, repeated invoice actions create no duplicate invoice, and the balance action stays locked until the booking invoice is paid.** No webhook or invoice creation logic changes.

- **UNVERIFIED · 8.13. Confirm the owner Payment section exposes no Stripe secret, webhook secret, payment credential, or customer identifier in HTML or API responses.** Owner composer changed but payment section unchanged; final target HTML/API sensitive-data audit pending.

- **UNVERIFIED · 8.14. Exercise the documented previous-version rollback, Old News visibility, event-disable, retention-pause, D1 recovery, and visitor-recovery procedures without changing production.** No rollback, D1 or visitor-recovery rehearsal.

- **UNVERIFIED · 8.15. Run `owner:health` against the target environment. Resolve every attention result or record it as a launch-blocking UNVERIFIED item.** No target owner:health run.


## Software agreement signing

- **N/A · Signing.1. Record counsel review status for the templates and electronic consent.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.2. Owner verifies the registered-agent business address and contractor config.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.3. Preview seeded templates for one, two and three milestones in both payment modes.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.4. Verify the signing setting defaults off and the outside-site path still works.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.5. Verify scoped email authentication, revocation, stale hashes and MSA reuse confirmation.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.6. Exercise PDF rendering in the actual Workers runtime, including Unicode and attachments.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.7. Verify full text extraction, every document certificate, packet hashes and two retained copies.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.8. Test artifact failure and each recipient's uncertain email/retry separately.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **UNVERIFIED · Signing.9. Verify project-page and archive downloads, including closed project and redacted request.** Agreement links remain in What we agreed by source; project-page/archive downloads, closed projects and redacted requests not exercised in target.

- **N/A · Signing.10. Rehearse restoring agreement database records, templates, fonts and private storage, with hashes.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **N/A · Signing.11. Verify custom project retention and exclusion of open, held and actively reused agreements.** Signing behavior is inherited from merged PR #158; feature diff does not change this check. See docs/prelaunch-qa-2026-09-30-software-signing.md; its evidence is not recertified here.

- **UNVERIFIED · Signing.12. Review real CI screenshots, keyboard/no-JS behavior and overflow from 320 to 1280 pixels.** Historical CI captures reviewed as described above; current-head captures, keyboard/no-JS and 320 to 1280px overflow remain pending.


Remaining work: resolve or re-run the sandbox-blocked integration in a permitted environment; independent current-head review and green CI; final-head captures and applicable accessibility/responsive checks; target permission, privacy, delivery, monitoring and recovery verification; authorized PR merge/deployment and live receipt.
