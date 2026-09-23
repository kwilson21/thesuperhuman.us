# thesuperhuman.us

Personal site for Kazon Wilson · software engineer building with AI · independent work through The Superhuman Group LLC.

## Stack

- Astro 5 with the `@astrojs/cloudflare` adapter (deployed as a Worker with Static Assets)
- TypeScript
- Tailwind CSS
- Resend (transactional email + PDF delivery)
- Cloudflare Turnstile (spam protection)
- Cloudflare KV (rate limiting, resume-request approval tokens, private PDF storage)
- Vitest (unit tests)

## Development

```bash
npm install
npm run dev       # local Astro dev server on http://localhost:4321
npm test          # run Vitest unit tests
npm run check     # Astro type-check
npm run build     # production build into dist/
npm run preview   # serve the built Worker locally after npm run build
```

Local env vars live in `.dev.vars` (not committed). See `src/env.d.ts` for the full list.

## Deployment

Push to `main` → Cloudflare's git integration rebuilds and runs `wrangler deploy`.

### Configuration: secrets vs. vars

| Variable | Where it lives | Why |
| --- | --- | --- |
| `RESEND_API_KEY` | Dashboard secret | Sensitive |
| `TURNSTILE_SECRET_KEY` | Dashboard secret | Sensitive |
| `STRIPE_SECRET_KEY` | Dashboard secret | Stripe server credential |
| `STRIPE_WEBHOOK_SECRET` | Dashboard secret | Verifies `/api/stripe/webhook` payloads |
| `STRIPE_PAYMENTS_ENABLED` | `wrangler.jsonc` `vars` | Explicit invoice-creation gate; keep `false` until payment readiness passes |
| `AUDIO_CLIENT_PORTAL_ENABLED` | `wrangler.jsonc` `vars` | Keep `false` until the complete client portal and its privacy checks are ready |
| `AUDIO_CLIENT_CODE_KEY` | Dashboard secret | Random 32-byte or longer key used to protect short email sign-in codes |
| `CONTACT_TO_EMAIL` | `wrangler.jsonc` `vars` | Not sensitive |
| `CONTACT_FROM_EMAIL` | `wrangler.jsonc` `vars` (currently `noreply@notifs.thesuperhuman.us`, the verified Resend sending subdomain) | Not sensitive |
| `PUBLIC_TURNSTILE_SITE_KEY` | `wrangler.jsonc` `vars` | Public widget key, read by the server-rendered forms from the Worker runtime |

Update version-controlled vars by editing `wrangler.jsonc` and pushing. Update dashboard secrets in the Cloudflare Worker settings (Variables and Secrets → Secrets).

### Stripe invoice integration

Audio-service payments begin from a reviewed service request in `/owner/requests/<id>`. The owner records the accepted fixed-price offer, then creates a 50% booking invoice. Stripe emails and hosts the secure payment page. After Stripe confirms that payment through the signed webhook, the owner can create the remaining-balance invoice.

Apply `migrations/music/0003_audio_payments.sql` and `migrations/music/0004_stripe_reconciliation.sql` before deploying code that reads payment records. Register the production webhook URL as `https://thesuperhuman.us/api/stripe/webhook` and subscribe only to `invoice.sent`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, and `invoice.marked_uncollectible`. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.

Keep `STRIPE_PAYMENTS_ENABLED=false` until [Stripe invoicing readiness](docs/stripe-invoicing-readiness.md) passes. Disabling this variable stops new invoice creation while preserving owner status readback and signed webhook processing after the Worker is redeployed with the change.

### Audio client portal foundation

Apply `migrations/music/0005_audio_projects.sql` before deploying portal code. It creates one provisional project and audit entry with each new audio-service request, and backfills open service requests. The project references the existing request email instead of storing another copy. This migration alone adds no client access or file-delivery route. The [portal design](docs/superpowers/specs/2026-09-21-audio-client-portal-design.md) defines the later communication, authentication, and delivery gates.

The email-code access slice also requires `migrations/music/0006_audio_client_access.sql` and the `AUDIO_CLIENT_CODE_KEY` secret. The portal flag remains `false` until messaging, private file delivery, retention, and the full [prelaunch checklist](docs/prelaunch-checklist.md) are complete. Codes expire after 10 minutes and are single-use; client sessions expire after 14 days. The access routes never expose whether an email has a project.

The private message-thread slice requires `migrations/music/0007_audio_project_messages.sql` after 0006. It stores one immutable owner/client conversation per project, including who sent each message and when the other side read it. Clients can clarify files before approval and both sides can reply until the project is complete. Messages accept plain text and HTTPS links; the site never fetches or previews those links. Routine client messages appear in the owner request view without sending email. The portal flag stays `false` while update notifications, delivery, retention, and operations are unfinished.

Owner progress updates require `migrations/music/0008_audio_project_updates.sql` after 0007. Accepting a reviewed request sets an initial delivery date; later date moves require a reason and preserve the prior date in the timeline. Updates are saved before a minimal sign-in-link email is attempted. The owner view shows whether that email was sent, failed, or remains unconfirmed. A failed delivery can be retried; an unconfirmed delivery requires checking Resend first and confirming that it did not accept the email. The portal gate stays `false` until initial project invitations, private delivery, retention, and full operations checks are ready.

Project invitations require `migrations/music/0009_audio_project_invitations.sql` after 0008. When the portal is enabled, a new service request saves its provisional project first, then attempts a minimal sign-in-link email. The owner request view shows the delivery state and can send or retry an invitation for an existing project. An unconfirmed send requires checking Resend before another attempt. Neither the invitation nor its link authorizes access; clients still need their own email code. The portal gate stays `false` until private delivery, retention, and full operations checks are ready.

Private project audio requires `migrations/music/0010_audio_project_files.sql` after 0009. Only the authenticated studio route can read objects under `studio/projects/`; it rechecks session, project, publication, payment, and expiry for each request and uses private, non-cacheable responses. The public media routes reject that prefix. This slice supplies the read boundary and client player; the portal gate stays `false`.

Owner file upload requires `migrations/music/0011_audio_project_uploads.sql` after 0010. The owner request view uploads MP3 or WAV files to private R2 storage in 10 MiB parts, so a full-resolution file does not have to fit in one Worker request. Completed uploads remain private drafts until a separate owner publication action; an unfinished upload can be recovered if R2 completed it or discarded. The portal gate remains `false` until publication, revocation, retention, and operations checks are complete.

Owner publication requires `migrations/music/0012_audio_project_publication.sql` after 0011. A review can be published after the booking payment is confirmed; a final file requires confirmed balance payment. Publishing a new review or a final file hides earlier review versions. Publication advances the project stage, records an owner-authored timeline note, and queues the existing minimal sign-in-link email. The portal gate remains `false` until revocation, retention, and operations checks are complete.

File and project revocation require `migrations/music/0013_audio_project_revocation.sql` after 0012. Revoking a published file immediately blocks playback and sends a minimal sign-in-link notice attached to the owner's explanation in the timeline. Closing project access immediately hides the project, invalidates that client's current sessions and pending code, and records an audit event; it does not change Stripe invoices. The portal gate remains `false` until retention and operations checks are complete.

The forms read `Astro.locals.runtime.env.PUBLIC_TURNSTILE_SITE_KEY` first, with
`import.meta.env.PUBLIC_TURNSTILE_SITE_KEY` as a build-time fallback. Wrangler
runtime vars are not automatically Astro build-time variables. An empty runtime
key explicitly disables the forms and keeps their email alternatives visible.

### KV bindings

All three bindings point at the same physical KV namespace; key prefixes keep the data isolated.

| Binding | Keys stored |
| --- | --- |
| `RATE_LIMIT` | `rl:<ip>` for per-IP rate-limit windows |
| `RESUME_STORE` | `req:<uuid>` for pending resume-request approval tokens · `pdf:general` / `pdf:dod` for the binary resume PDFs · `doc:services-overview` for the one-page services PDF |
| `SESSION` | unused; satisfies the `@astrojs/cloudflare` adapter's default expectation. Astro sessions aren't used. |

Declared in `wrangler.jsonc` `kv_namespaces` with explicit namespace IDs.

### Uploading resumes to KV

Resume PDFs are **never** committed to this repo and **never** served from `public/`. They live exclusively in KV and are emailed to requesters only after you approve each request.

```bash
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:general --path "/path/to/KWilson_Resume_G_2026.pdf"
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:dod     --path "/path/to/KWilson_Resume_D_2026.pdf"
```

Re-run any of these whenever a resume changes.

### Rebuilding the services one-pager PDF

The services overviews share `src/layouts/ServiceSheet.astro` and `src/data/services.ts`. Software lives at `/services` (the existing `/services.html` redirects there); Audio lives at `/audio/services`. Both are readable on phones and have a Print / Save PDF action. Existing PDFs in KV are not updated by editing the pages.

For scripted export, start a local preview and specify its URL:

```bash
BASE_URL=http://127.0.0.1:4321 ./scripts/build-services-pdf.sh
BASE_URL=http://127.0.0.1:4321 ./scripts/build-services-pdf.sh --audio
```

These render to `/tmp/services-overview.pdf` and `/tmp/audio-services-overview.pdf`. `OUT` overrides the destination. Inspect the output before sharing; generated PDFs are not committed. The existing `--upload` option refreshes the software `doc:services-overview` key only when explicitly requested. Audio export is render-only and cannot overwrite that key.

### Security headers

`public/_headers` overrides Cloudflare's default `Permissions-Policy` with an explicit policy that doesn't reference Chrome-only features (which other browsers log as "Unrecognized feature" warnings). Also sets `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.

## Resume request flow

1. A visitor requests the general resume via the form on `/about` (name/email/company/note + Turnstile). New requests always use the general audience; stored legacy approvals retain their original audience.
2. `POST /api/resume-request` validates, rate-limits, and stores a single-use token in KV (`req:<uuid>`, 7-day TTL). It emails the operator (`CONTACT_TO_EMAIL`) with the request details and a one-click approval link.
3. The operator clicks the approval link. `GET /api/resume-approve?id=<uuid>` looks up the token, reads the matching PDF from KV (`pdf:<audience>`), emails it to the requester as an attachment, and deletes the token. Single-use; the link can't be replayed.
4. The approval link's "credential" is the UUID itself (~122 bits of entropy). Because delivery is bound to the requester's email stored in KV (not the URL), a leaked or intercepted link cannot redirect delivery elsewhere.

## Audio site

Audio is part of the personal site at `/audio/`. `audio.thesuperhuman.us` remains an alternate entry using the same repository, build and Worker. Its pages point to main-site `/audio` canonical URLs. Main-site and local-preview links stay within the site; legacy audio-host pages, inquiry APIs and file links retain their existing routing. No separate studio brand or deployment pipeline.

### R2 audio storage

Audio files are stored in the `superhuman-audio` R2 bucket, bound to the Worker as `AUDIO`. Create the bucket once:

```bash
npx wrangler r2 bucket create superhuman-audio
```

Upload a track (stores it at `tracks/<basename>` in the bucket):

```bash
npm run audio:upload path/to/track.mp3
```

### Audio tracks content collection

Track metadata lives in `src/content/audio-tracks/` as one YAML file per track. The schema is defined in `src/content/config.ts`. Add a YAML file, upload the corresponding MP3 to R2 via the upload script, and the track appears on the audio site automatically.

Notes are optional. The Selected audio section appears only when recordings exist; the page does not render empty players. Native audio controls and explicit user-initiated playback remain the baseline.

### Audio booking inquiries

Booking inquiries POST to `/api/audio-inquiry`. The endpoint uses the same Turnstile verification, KV rate limiting, and Resend delivery as the software-site contact form. Rate-limit keys use the `rl:audio:` KV prefix (vs. `rl:` for the software form) so the two forms track separate windows per IP.

### Operator prerequisites before serving audio.thesuperhuman.us traffic

See plan Task 24 for full detail. The short list:

1. Create the `superhuman-audio` R2 bucket (command above).
2. Bind `audio.thesuperhuman.us` to the existing Worker via the Cloudflare dashboard, using a Custom Domain or Workers Route. Match how `thesuperhuman.us` is already bound.
3. Add `audio.thesuperhuman.us` to the hostname allowlist of the existing Turnstile widget in the Cloudflare dashboard.

## Regenerating the OG image

The `/og-image.png` social-share card is rendered from `scripts/og.html` via headless Chrome at 1200×630.

```bash
./scripts/build-og.sh
```

Editing `scripts/og.html` updates the layout and copy. The card reuses the reviewed studio artwork at `src/assets/site/studio-v1.webp`; the renderer reads that local asset directly. Inspect the regenerated card before sharing.

## General contact

The local redesign keeps general contact at `/#contact`: required name, email and message (nonempty after trimming, at most 4000 characters), with optional company. `/api/contact` uses this same schema and preserves origin checks, Turnstile, rate limiting and Resend delivery. Project type, timeline and budget are no longer part of the general form. The structured Audio inquiry remains separate.

The three forms share pending, error, focus and receipt behavior in `src/scripts/form-submission.ts`. Without JavaScript or a configured public Turnstile key, submit remains disabled and a direct email alternative stays available. Resume receipt still means a request awaits approval, not that a PDF was sent.

## Pre-launch Definition of Done

Use [the pre-launch checklist](docs/prelaunch-checklist.md) before each website deployment. See [the readiness QA record](docs/prelaunch-qa-2026-09-15.md) for verified checks and remaining release work.

Regenerate browser icons from the existing brand SVG with `node scripts/build-icons.mjs`.
