# thesuperhuman.us

Personal site for Kazon Wilson · software engineer building useful software · independent work through The Superhuman Group LLC.

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

Dependabot opens dependency update PRs every Monday: one grouped PR for npm minor and patch updates, one for Astro major upgrades, a separate PR for each other npm major and for each `wrangler` or OAuth provider update, and one grouped PR for GitHub Actions.

## Deployment

Push to `main` → Cloudflare's git integration rebuilds and runs `wrangler deploy`.

### Configuration: secrets vs. vars

| Variable | Where it lives | Why |
| --- | --- | --- |
| `RESEND_API_KEY` | Dashboard secret | Sensitive |
| `TURNSTILE_SECRET_KEY` | Dashboard secret | Sensitive |
| `STRIPE_SECRET_KEY` | Dashboard secret | Stripe server credential |
| `STRIPE_WEBHOOK_SECRET` | Dashboard secret | Verifies `/api/stripe/webhook` payloads |
| `STRIPE_PAYMENTS_ENABLED` | `wrangler.jsonc` `vars` | Explicit invoice-creation gate; `true` in production since the September 29, 2026 activation, set `false` to roll back |
| `AUDIO_CLIENT_PORTAL_ENABLED` | `wrangler.jsonc` `vars` | `true` in production now that the client portal and its privacy checks have passed; set `false` to roll back |
| `AUDIO_CLIENT_CODE_KEY` | Dashboard secret | Random 32-byte or longer key used to protect short email sign-in codes |
| `CONTACT_TO_EMAIL` | `wrangler.jsonc` `vars` | Not sensitive |
| `CONTACT_FROM_EMAIL` | `wrangler.jsonc` `vars` (currently `noreply@notifs.thesuperhuman.us`, the verified Resend sending subdomain) | Not sensitive |
| `PUBLIC_TURNSTILE_SITE_KEY` | `wrangler.jsonc` `vars` | Public widget key, read by the server-rendered forms from the Worker runtime |

Update version-controlled vars by editing `wrangler.jsonc` and pushing. Update dashboard secrets in the Cloudflare Worker settings (Variables and Secrets → Secrets).

### Stripe invoice integration

Audio-service payments begin from a reviewed service request in `/owner/requests/<id>`. The owner records the accepted fixed-price offer, then creates a 50% booking invoice. Stripe emails and hosts the secure payment page. After Stripe confirms that payment through the signed webhook, the owner can create the remaining-balance invoice.

Apply `migrations/music/0003_audio_payments.sql` and `migrations/music/0004_stripe_reconciliation.sql` before deploying code that reads payment records. Register the production webhook URL as `https://thesuperhuman.us/api/stripe/webhook` and subscribe only to `invoice.sent`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, and `invoice.marked_uncollectible`. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.

`STRIPE_PAYMENTS_ENABLED` is `true` in production, following the September 29, 2026 activation recorded in [Stripe invoicing readiness](docs/stripe-invoicing-readiness.md). To roll back, set it to `false` and redeploy: this stops new invoice creation while preserving owner status readback and signed webhook processing.

### Audio client portal foundation

Apply `migrations/music/0005_audio_projects.sql` before deploying portal code. It creates one provisional project and audit entry with each new audio-service request, and backfills open service requests. The project references the existing request email instead of storing another copy. This migration alone adds no client access or file-delivery route. The [portal design](docs/superpowers/specs/2026-09-21-audio-client-portal-design.md) defines the later communication, authentication, and delivery gates.

The email-code access slice also requires `migrations/music/0006_audio_client_access.sql` and the `AUDIO_CLIENT_CODE_KEY` secret. Codes expire after 10 minutes and are single-use; client sessions expire after 14 days. The access routes never expose whether an email has a project.

The private message-thread slice requires `migrations/music/0007_audio_project_messages.sql` after 0006. It stores one immutable owner/client conversation per project, including who sent each message and when the other side read it. Clients can clarify files before approval and both sides can reply until the project is complete. Messages accept plain text and HTTPS links; the site never fetches or previews those links. Routine client messages appear in the owner request view without sending email.

Owner progress updates require `migrations/music/0008_audio_project_updates.sql` after 0007. Accepting a reviewed request sets an initial delivery date; later date moves require a reason and preserve the prior date in the timeline. Updates are saved before a minimal sign-in-link email is attempted. The owner view shows whether that email was sent, failed, or remains unconfirmed. A failed delivery can be retried; an unconfirmed delivery requires checking Resend first and confirming that it did not accept the email.

Project invitations require `migrations/music/0009_audio_project_invitations.sql` after 0008. With the portal enabled, a new service request saves its provisional project first, then attempts a minimal sign-in-link email. The owner request view shows the delivery state and can send or retry an invitation for an existing project. An unconfirmed send requires checking Resend before another attempt. Neither the invitation nor its link authorizes access; clients still need their own email code.

Private project audio requires `migrations/music/0010_audio_project_files.sql` after 0009. Only the authenticated studio route can read objects under `studio/projects/`; it rechecks session, project, publication, payment, and expiry for each request and uses private, non-cacheable responses. The public media routes reject that prefix. This slice supplies the read boundary and client player.

Owner file upload requires `migrations/music/0011_audio_project_uploads.sql` after 0010. The owner request view uploads MP3 or WAV files to private R2 storage in 10 MiB parts, so a full-resolution file does not have to fit in one Worker request. Completed uploads remain private drafts until a separate owner publication action; an unfinished upload can be recovered if R2 completed it or discarded.

Owner publication requires `migrations/music/0012_audio_project_publication.sql` after 0011. A review can be published after the booking payment is confirmed; a final file requires confirmed balance payment. Publishing a new review or a final file hides earlier review versions. Publication advances the project stage, records an owner-authored timeline note, and queues the existing minimal sign-in-link email. The owner can mark an agreed revision in progress after publishing a review and close a project after the paid final is published; closing makes messages read-only while the final remains available until expiry.

File and project revocation require `migrations/music/0013_audio_project_revocation.sql` after 0012. Revoking a published file immediately blocks playback and sends a minimal sign-in-link notice attached to the owner's explanation in the timeline. Closing project access immediately hides the project, invalidates that client's current sessions and pending code, and records an audit event; it does not change Stripe invoices. Resolving a provisional request before acceptance also closes that project's access through `migrations/music/0015_audio_project_close_declined.sql`; apply it after 0014 when deploying the full portal stack.

Studio retention requires `migrations/music/0014_audio_project_retention.sql` after 0013. The [owner operations guide](docs/owner-operations.md) describes its review-first cleanup, private R2 deletion, failure recovery, and the order for running owner-request retention afterward. The owner Today page shows unread studio messages, failed update notices, and delivery dates needing attention now that the portal is enabled.

Waveform display requires `migrations/music/0016_audio_project_file_peaks.sql` after 0015. The owner's browser measures 160 loudness bars while uploading and sends them with the finished upload; the server only checks that they are whole numbers from 0 to 100. Files without them, including anything uploaded before 0016, show a plain progress bar instead of a waveform.

Timeline milestones require `migrations/music/0017_audio_project_update_milestones.sql` after 0016. It adds a nullable `milestone` to owner updates so starting a revision and completing a project show by name instead of as a general studio update, and backfills existing notes from the audit row written in the same batch.

`AUDIO_CLIENT_PORTAL_ENABLED` is `true` in production: migrations 0005 through 0017 are applied, the code key is set, and the audio bucket has no public access (see `wrangler.jsonc`). The per-migration notes above describe the gates that had to clear, in order, before enabling it. To roll back, set the flag to `false` and redeploy.

Review answers require `migrations/music/0018_audio_project_review_decisions.sql` after 0017, applied **before** deploying the code that reads it: every message query selects the new `review_decision` column. A client answers each published review by approving it, requesting changes while revision rounds remain (two), or stopping once they are used. Stopping closes that project's access in the same write, without signing the client out of other projects.

Software project briefs require `migrations/music/0019_software_requests.sql` after 0018, applied **before** deploying code that stores software briefs. It enables storing software briefs; audio requests continue to work before 0019 is applied.

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

For a replacement, first download the current remote value into a private, backed-up
directory outside the repository. Keep that copy until the replacement is verified.
Use the same sequence for `pdf:general` and `pdf:dod`, substituting the key and
filename. `BACKUP_DIR` must be a new directory on private storage, not a path in the
repository:

```bash
set -e
umask 077
mkdir -p /secure/private/resume-backups
BACKUP_DIR="$(mktemp -d /secure/private/resume-backups/resume.XXXXXX)"

# Preserve the bytes currently served before overwriting the canonical key.
npx wrangler kv key get pdf:general --binding=RESUME_STORE --remote > "$BACKUP_DIR/pdf-general.before.pdf"
# Wrangler may exit successfully when a key is missing; require a PDF backup.
test "$(head -c 5 "$BACKUP_DIR/pdf-general.before.pdf")" = "%PDF-"
shasum -a 256 "$BACKUP_DIR/pdf-general.before.pdf"

# Upload the candidate, download the stored bytes, and require an exact match.
npx wrangler kv key put pdf:general --binding=RESUME_STORE --remote --path "/path/to/resume.pdf"
npx wrangler kv key get pdf:general --binding=RESUME_STORE --remote > "$BACKUP_DIR/pdf-general.after.pdf"
cmp "/path/to/resume.pdf" "$BACKUP_DIR/pdf-general.after.pdf"
shasum -a 256 "/path/to/resume.pdf" "$BACKUP_DIR/pdf-general.after.pdf"
```

Do not report completion unless the remote readback matches the candidate bytes.
If it does not match, restore the saved `*.before.pdf` to the same key, read it
back again, and confirm the restored bytes with `cmp`:

```bash
npx wrangler kv key put pdf:general --binding=RESUME_STORE --remote --path "$BACKUP_DIR/pdf-general.before.pdf"
npx wrangler kv key get pdf:general --binding=RESUME_STORE --remote > "$BACKUP_DIR/pdf-general.restored.pdf"
cmp "$BACKUP_DIR/pdf-general.before.pdf" "$BACKUP_DIR/pdf-general.restored.pdf"
```

Keep the backup and the before/after hashes as the private replacement receipt.
For an initial upload where the key does not yet exist, upload the candidate and
perform the same readback and comparison; there is no previous object to back up.

### Rebuilding the services one-pager PDF

`/services` is the Work with me hub, rendered by `src/layouts/ServiceSheet.astro` from `src/data/services.ts` and `src/data/work-with-me.ts`; the existing `/services.html` redirects there. Its Print / Save PDF action hides the hub's doors and prints the software engineering sheet on one page. Audio's prices and scope live at `/audio/services`, which has no print action. Existing PDFs in KV are not updated by editing the pages.

For scripted export, start a local preview and specify its URL:

```bash
BASE_URL=http://127.0.0.1:4321 ./scripts/build-services-pdf.sh
BASE_URL=http://127.0.0.1:4321 ./scripts/build-services-pdf.sh --audio
```

These render to `/tmp/services-overview.pdf` and `/tmp/audio-services-overview.pdf`. `OUT` overrides the destination. Inspect the output before sharing; generated PDFs are not committed. The existing `--upload` option refreshes the software `doc:services-overview` key only when explicitly requested. Audio export is render-only and cannot overwrite that key.

### Security headers

`public/_headers` overrides Cloudflare's default `Permissions-Policy` with an explicit policy that doesn't reference Chrome-only features (which other browsers log as "Unrecognized feature" warnings). Also sets `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.

Cloudflare applies `_headers` only to static assets, so `src/middleware.ts` adds the same four headers, listed in `src/lib/security-headers.ts`, to every response that passes through it. A header already set by the route, or by the middleware's studio and agreement rules, is kept, so those pages keep `Referrer-Policy: no-referrer`. Astro's redirects for repeated trailing slashes and its bare 500 after a thrown error skip the middleware and carry none of the four. `tests/lib/security-headers.test.ts` fails if that list and the `/*` block of `public/_headers` differ.

## Resume request flow

1. A visitor requests the general resume via the form on `/about` (name/email/company/note + Turnstile). New requests always use the general audience; stored legacy approvals retain their original audience.
2. `POST /api/resume-request` validates, rate-limits, and stores a single-use token in KV (`req:<uuid>`, 7-day TTL). It emails the operator (`CONTACT_TO_EMAIL`) with the request details and a one-click approval link.
3. The operator clicks the approval link. `GET /api/resume-approve?id=<uuid>` looks up the token, reads the matching PDF from KV (`pdf:<audience>`), emails it to the requester as an attachment, and deletes the token. Single-use; the link can't be replayed.
4. The approval link's "credential" is the UUID itself (~122 bits of entropy). Because delivery is bound to the requester's email stored in KV (not the URL), a leaked or intercepted link cannot redirect delivery elsewhere.

## Audio site

Audio is part of the personal site at `/audio/`. `audio.thesuperhuman.us` remains an alternate entry using the same repository, build and Worker. Its pages point to main-site `/audio` canonical URLs. Main-site and local-preview links stay within the site; legacy audio-host pages, the single intake API at `/api/audio-intake`, and file links retain their existing routing. No separate studio brand or deployment pipeline.

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

Track metadata lives in `src/content/audio-tracks/` as one YAML file per track. The schema is defined in `src/content/config.ts`. Add a YAML file and upload the corresponding MP3 to R2 via the upload script, and the file is servable at `/audio/file/<slug>`. No page currently renders these tracks; a future page can group them by `groupTracksByService` from `src/lib/audio-tracks.ts`.

Notes are optional. Native audio controls and explicit user-initiated playback remain the baseline.

### Audio intake

Song requests start at `/audio/start`, a three-step form that POSTs to `/api/audio-intake`. A successful submission stores the request in `MUSIC_DB` and immediately emails the operator (`CONTACT_TO_EMAIL`) the service, working title, client name and email, file link, direction choices and notes, and a link to the request in the owner dashboard (`/owner/requests/<id>`), reply-to the client. This owner notice sends regardless of `AUDIO_CLIENT_PORTAL_ENABLED`. When that flag is `true`, the client also receives a private studio sign-in invitation. Both use the same Turnstile verification, KV rate limiting, and Resend delivery as the general contact form; rate-limit keys use the `rl:audio:` KV prefix (vs. `rl:` for general contact) so the two track separate windows per IP.

### Operator prerequisites before serving audio.thesuperhuman.us traffic

See plan Task 24 for full detail. The short list:

1. Create the `superhuman-audio` R2 bucket (command above).
2. Bind `audio.thesuperhuman.us` to the existing Worker via the Cloudflare dashboard, using a Custom Domain or Workers Route. Match how `thesuperhuman.us` is already bound.
3. Add `audio.thesuperhuman.us` to the hostname allowlist of the existing Turnstile widget in the Cloudflare dashboard.

## Link previews

Each page's link preview is a short silent looping video plus a poster image, both 1200×630. Apple Messages plays the video in place of the image (looped and muted); Discord, X, Slack, LinkedIn, Bluesky and most other apps show the poster, so the poster is the video's first frame and works on its own.

Each scene is an HTML page in `scripts/og-video/scenes/`, styled by `scripts/og-video/kit.css` and timed by `scripts/og-video/kit.js`, built from the site's fonts, reviewed artwork and real screenshots. `OG_SCENES` in `src/lib/og-media.ts` assigns scenes to pages and holds each poster's alt text: an exact route first, then a page's own `ogImage` (a music release's artwork), then a `/*` family, then the home scene. `BaseLayout` writes the tags; the 404 page names its scene with `ogScene`.

```bash
node scripts/og-video/render.mjs                  # every scene
node scripts/og-video/render.mjs services work    # only these
node scripts/og-video/render.mjs --sheet services # contact sheet in .og-video/ for review; writes nothing else
node scripts/og-video/render.mjs --sheet --at=0,2500 services  # also saves those moments (ms) at full size
```

Rendering needs ffmpeg with libx264 and Chromium (set `CHROMIUM_PATH` if Playwright's own build is missing). The renderer pauses every animation and steps one clock at 30 fps, so frames and posters are repeatable. MP4 bytes also depend on the ffmpeg build and the CPU, so a scene whose frames have not changed keeps its committed video; render only the scenes you changed. Each manifest entry records the local files its scene loaded and a hash of them, and `tests/lib/og-media.test.ts` fails when a scene, the kit or an image changes without a new render. `tests/scripts/og-video-copy.test.ts` fails when a scene's words, statuses or prices (or a price in its alt text) no longer match the site. It refuses a scene whose fonts did not load, whose content overflows the frame, whose unwrapped text is wider than its box, or whose last frame does not match its first (the loop would jump), and it keeps videos under 2.5 MB and posters under 600 KB. Posters are PNG; a photographic scene sets `data-poster="jpeg"` on `<html>` for a JPEG poster instead. Files are named by content hash (`public/og/<scene>-<hash>.png` or `.jpg`, and `public/og/raw/<scene>-<hash>.mp4`), which lets caches keep them for a year; the hashed names are recorded in `src/data/og-media.json` and stale files are deleted.

Static assets ignore `Range` requests and Safari's media stack expects them, so `/og/<scene>-<hash>.mp4` is served by `src/pages/og/[name].mp4.ts`, which reads the bytes from `/og/raw/` and answers 200, 206 or 416. Every rendered poster and video needs a review record in `docs/asset-reviews/` (`npm run assets:check` fails otherwise; see `docs/generated-image-qa.md`), so inspect each new render's frames and update the record with its hashes.

After deploying, check the video from outside: `curl -sI https://thesuperhuman.us/og/<file>.mp4` should give 200, `video/mp4` and `accept-ranges: bytes`, and `curl -s -o /dev/null -D - -H 'Range: bytes=0-1' https://thesuperhuman.us/og/<file>.mp4` should give 206 with `content-range: bytes 0-1/<size>`. (A HEAD request ignores `Range`, so the second check needs GET.) Then send a link in Messages on an iPhone and a Mac, and paste one into Discord's embed debugger and the Facebook Sharing Debugger.

## Email signature

`public/email/signature.html` is the paste-ready signature. Mail clients cannot load the custom name font, so the name is a PNG nameplate, `public/email/nameplate.png`, rendered from `scripts/email-nameplate.html` via headless Chrome at 3x (570×129 for a 190×43 display size).

```bash
./scripts/build-email-nameplate.sh
```

The nameplate URL is permanent. Sent emails reference `https://thesuperhuman.us/email/nameplate.png`, so never rename or delete it, and know that regenerating it changes how past emails display too. Inspect the result before committing: the z should have a short bar above it, and the corners should be transparent.

To install in Proton Mail, open `https://thesuperhuman.us/email/signature` in a browser, select all, copy, and paste into the signature editor under Settings › Identity and addresses. The nameplate and link styling need Proton's normal (HTML) composer, not plain text.

## General contact

The local redesign keeps general contact at `/#contact`: required name, email and message (nonempty after trimming, at most 4000 characters), with optional company. `/api/contact` uses this same schema and preserves origin checks, Turnstile, rate limiting and Resend delivery. Project type, timeline and budget are no longer part of the general form. The three-step audio intake at `/audio/start` remains a separate flow.

The three forms share pending, error, focus and receipt behavior in `src/scripts/form-submission.ts`. Without JavaScript or a configured public Turnstile key, submit remains disabled and a direct email alternative stays available. Resume receipt still means a request awaits approval, not that a PDF was sent.

## Pre-launch Definition of Done

Use [the pre-launch checklist](docs/prelaunch-checklist.md) before each website deployment. See [the readiness QA record](docs/prelaunch-qa-2026-09-15.md) for verified checks and remaining release work.

Regenerate browser icons from the existing brand SVG with `node scripts/build-icons.mjs`.

### Isolated email links

`SITE_ORIGIN` optionally sets the deployment-controlled HTTPS origin used in offer and studio
invitations, updates, sign-in codes, and owner request notices. It defaults to
`https://thesuperhuman.us`. Set it to the preview origin when deploying a test
Worker; never derive it from request headers. Test Workers must use separate D1,
KV and private R2 resources, Stripe test credentials, and a hostname-restricted
Turnstile widget.

### Software offers migration

Apply music migration `0020_software_offers.sql` before deploying code that uses fit reviews or software offers. Existing pages keep working before this migration; the new offer controls require it. Do not edit previously applied migrations.

### Software projects migration

Apply music migration `0021_software_projects.sql` after 0020 and before deploying code that uses software projects. This code requires 0021. Deploying it before the migration breaks studio sign-in (audio too) and the owner Today page. It stores project term snapshots, private updates, messages and audit records. Do not edit previously applied migrations.

Apply music migration `0022_software_invoices.sql` after 0021 and before deploying code that uses software invoices. It pins invoice records to requests and immutable offers, including deposits before project start, and preserves existing software audit ids and notes. It has not been applied in production. Signed software invoice events reuse the existing Stripe event de-duplication table; audio tables are unchanged.

### Software agreement signing

Migration 0023 follows software invoices migration 0022. Signing is controlled by
an owner-only `software_signing_enabled` setting, off by default. Publish private
MSA and SOW templates and complete verified contractor configuration before
sending an offer for website signing. Sent offers snapshot configuration and
pin immutable template versions. Private source templates are excluded from Git;
a one-shot private seed refuses to overwrite existing versions.

PDF preparation uses `pdf-lib`, `@pdf-lib/fontkit`, and licensed local Inter and
Newsreader fonts. Agreement PDFs and certificates belong in private storage.
Signed copy downloads remain available when new website signing is switched off.
Code completion does not establish deployment or live signing readiness.

### Software delivery review updates

Apply music migration `0024_software_delivery_selection_and_review_windows.sql`
after `0023_software_signing.sql` and before deploying code that reads delivery
selections or the extended review-window field. It snapshots the planned items
included in each shared delivery while acceptance remains tied to the complete
agreed milestone. It also stores executed-agreement review windows longer than
30 business days without changing the earlier column constraint. Both
migrations remain pending production approval; do not deploy this code before
the required schema is applied.

### Agreement template labels

Apply music migration `0026_agreement_template_labels.sql` after `0025_brief_suggestion_budget.sql` and before deploying code that reads template version labels. It is additive only: it adds nullable `version_label` and `source_revision` columns to `software_agreement_templates` and a partial unique index on `(kind, version_label)`. Existing template rows keep NULL values and show a `v` plus published-date fallback label. Deploying this code first breaks the owner request page for any request with an offer (even with signing off), the owner Agreements page, the client signing page after email verification and template publishing. `npm run owner:health -- --remote` reports `software_agreement_templates.version_label (migration 0026)` as missing until the migration is applied. Do not edit previously applied migrations.
