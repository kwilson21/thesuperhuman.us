# Website pre-launch checklist / Definition of Done

Use before every new website launch and every deployment that changes public behavior. Copy into the new project's docs and link it from that project's AGENTS.md and README. Keep one checklist, adapting it to the site's actual features. Reuse existing layouts, components, validation, hosting and monitoring.

## Release record

Record project/repository, revision or exact working-copy diff, target environment and domains, date, reviewer, scope, evidence links, rollback version, and remaining work.

Every item receives **PASS**, **FAIL**, **UNVERIFIED**, or **N/A with a reason**. PASS needs observed evidence. Unknown is not N/A. Resolve applicable failures and unknowns before claiming launch-ready; record any owner-accepted exception explicitly with its impact and follow-up. Do not turn a test result into a deployment claim.

## 1. Purpose and content

- [ ] Confirm the correct project, branch, local changes, site instructions, audience and deployment authorization.
- [ ] Preserve approved design and truthful claims; remove placeholders and verify ownership/rights for media.
- [ ] The first screen explains who/what the site is for and offers a useful next step. Verify the CTA works at narrow and desktop sizes. A sticky CTA is optional, justified by the actual journey.
- [ ] Navigation, footer, contact route and important external links work. Never invent an address or expose a home address.

## 2. Search and sharing

- [ ] Each indexable page has a descriptive, distinct title and meta description.
- [ ] Absolute canonical URLs use the production HTTPS domain, match the sitemap and normalize duplicate host/path/query variants. Preserve query parameters only when they identify distinct indexable content.
- [ ] Open Graph title, description, URL and reachable image are correct; inspect the image at sharing size. Include a social card type and suitable image description when applicable.
- [ ] Branded SVG/raster favicon and Apple touch icon return the correct formats and remain legible at small sizes.
- [ ] robots.txt reflects intended indexing and links to the real sitemap. Sitemap includes public canonical routes, including server-rendered pages, and excludes redirects/errors/private routes.
- [ ] Preview environments cannot be accidentally indexed. Secrets and private data require access control, never robots.txt alone.
- [ ] Verify structured data when present. Do not invent ratings, credentials or organization details.

## 3. Accessibility and responsive behavior

- [ ] Semantic landmarks, page language, sensible heading order and one primary heading.
- [ ] Meaningful image alternatives; decorative images use empty alt text. Icon-only controls have names.
- [ ] Keyboard access, visible focus, skip link, menus, dialogs and focus restoration work. No keyboard traps.
- [ ] Inputs have labels, required/optional guidance, useful error associations and status announcements. Success and failure do not depend on color alone.
- [ ] Text/UI contrast, touch targets, 200% text zoom and reduced-motion behavior are checked. Use automated accessibility checks plus manual review.
- [ ] Check at least 320px, typical phone, tablet and desktop widths, including long content and expanded menus/forms. No horizontal overflow or concealed controls.
- [ ] Check Chromium and another supported browser, plus a real mobile device for critical interactions where available. Record limits.

## 4. Performance and resilience

- [ ] Images are appropriately sized/compressed, have intrinsic dimensions, and use responsive sources where beneficial. Prioritize the hero; lazy-load below-fold images.
- [ ] Avoid unnecessary client code, dependencies, embeds and font weights. Verify compression, caching and asset loading against the built site.
- [ ] Measure representative pages with a repeatable mobile profile. Record LCP, CLS and INP when field data exists; lab results are not field evidence. Investigate LCP over 2.5s, CLS over 0.1 or INP over 200ms.
- [ ] Async UI visibly loads and recovers from timeout, offline, malformed response and server error. Preserve user input and allow retry without duplicate submissions.
- [ ] Test missing/unavailable audio, video and external resources where used; avoid autoplay surprises.
- [ ] Useful branded 404 returns actual HTTP 404 on arbitrary missing paths. Verify redirects and their status codes. Server errors expose no secrets and leave a usable recovery path.

## 5. Forms and sensitive flows (N/A if absent)

- [ ] Validate and bound input on the server. Verify origin/auth checks, abuse protection and rate limits.
- [ ] Test empty/invalid input, invalid verification token, 429, 500, network failure, timeout, retry, pending button, success and duplicate-submit prevention.
- [ ] Provide an alternative when JavaScript or verification cannot load. Verify disabled/unavailable states.
- [ ] Confirm delivery/receipt in the intended environment using authorized test recipients. Mocked UI success is not proof of email delivery.
- [ ] Keep approval-gated flows intact. Check expired/reused links, permissions and sensitive file access.
- [ ] Use an inline confirmation unless a separate thank-you page serves a real need. Protect its indexing if appropriate.

## 6. Privacy, legal and measurement

- [ ] Inventory actual form data, storage, logs, external fonts/embeds, cookies, analytics and processors, including host-injected scripts.
- [ ] Where personal data is processed, publish an accessible, accurate privacy notice linked near collection and in the footer. Confirm purposes, recipients, retention, contact and applicable rights with the operator; do not invent retention periods or compliance claims.
- [ ] Determine consent needs from actual technology, audience and jurisdiction. Add a cookie banner only when required, and verify reject/withdraw actually controls nonessential processing.
- [ ] Terms, physical business address and additional legal disclosures depend on commerce, accounts, contributions, licensing and applicable rules. Do not add boilerplate just to tick a box.
- [ ] Analytics needs a concrete question and a privacy decision. N/A is valid. If enabled, verify events without collecting sensitive input or duplicating counts.
- [ ] Confirm existing error logs/monitoring work, who receives actionable failures and how they respond. Configuration alone is not verified monitoring. Do not create new paid accounts or services by assumption.

## 7. Release and final QA

- [ ] Run the project's required type, test, asset and build checks. Inspect warnings; record pre-existing exceptions.
- [ ] Review the exact diff, dependencies, generated files and public artifacts. No secrets, private logs, unapproved claims or accidental unrelated changes.
- [ ] Verify production bindings/secrets, migrations/backups where applicable, HTTPS, host routing, cache behavior and response headers on dynamic as well as static responses.
- [ ] Preserve a rollback version and any required backup before deployment. Follow existing review and authorization rules.
- [ ] After authorized deployment, verify the actual production revision, main journeys, sitemap/robots, metadata/OG/icons, missing page, forms and monitoring on every supported host.
- [ ] Save a receipt and QA evidence. Report **implemented**, **verified locally**, **deployed**, and **verified live** separately. Reopen the checklist after material changes.

## 8. Private owner center (N/A if absent)

- [ ] Cloudflare Access has one approved owner identity for `/owner*`; the Worker independently verifies the signed JWT issuer, audience, signature, and email. Unsigned and wrong-owner requests fail closed.
- [ ] Every owner response uses `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Private routes stay out of the sitemap.
- [ ] Reconcile the production MUSIC_DB schema and migration ledger before applying any migration. Record backup and recovery evidence separately from local schema tests.
- [ ] Verify a valid request persists before success. Force storage failure and confirm the visitor receives an honest retry while the urgent email contains no request content or raw database error.
- [ ] Verify the Cloudflare traffic summary and its safe unavailable fallback. Confirm owner pages remain usable without the optional analytics token.
- [ ] Confirm automated playback is excluded, campaign tags are controlled, and city rows below five qualifying human listens are combined under **Other locations**.
- [ ] Preview retention and inspect the private manifest for contact data or secrets. Apply only an exact reviewed manifest in a non-production environment before production use.
- [ ] Before enabling the private studio, reconcile portal migrations `0005` through `0014`, then exercise email-code access, mobile and keyboard use, private audio playback, upload interruption, failed notice delivery, and project revocation in the target environment.
- [ ] Run the studio-retention preview and exact-manifest apply against a non-production project with a real private R2 object; verify access closes before deletion, a storage failure is retryable, and owner-request retention waits for studio cleanup.
- [ ] Keep `STRIPE_PAYMENTS_ENABLED=false` until Stripe payments and payouts are active, migration `0003_audio_payments.sql` is reconciled, secrets are configured, and the test-mode booking and balance lifecycle passes.
- [ ] Verify invalid Stripe signatures change no data, repeated webhook events apply once, repeated invoice actions create no duplicate invoice, and the balance action stays locked until the booking invoice is paid.
- [ ] Confirm the owner Payment section exposes no Stripe secret, webhook secret, payment credential, or customer identifier in HTML or API responses.
- [ ] Exercise the documented previous-version rollback, Old News visibility, event-disable, retention-pause, D1 recovery, and visitor-recovery procedures without changing production.
- [ ] Run `owner:health` against the target environment. Resolve every attention result or record it as a launch-blocking UNVERIFIED item.

## Reference guidance

- [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Web Vitals](https://web.dev/articles/vitals)
- [W3C accessibility quick reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [ICO privacy notice guidance](https://ico.org.uk/for-organisations/advice-for-small-organisations/privacy-notices-and-cookies/cookies-and-privacy-notices-in-detail/)

Reference guidance informs checks; it does not establish which jurisdiction applies to a particular site.
