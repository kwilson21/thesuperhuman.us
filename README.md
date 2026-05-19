# thesuperhuman.us

Personal site for Kazon Wilson · backend & data engineer · contracting through The Superhuman Group LLC.

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
npm run preview   # serve the built site locally
```

Local env vars live in `.dev.vars` (not committed). See `src/env.d.ts` for the full list.

## Deployment

Push to `main` → Cloudflare's git integration rebuilds and runs `wrangler deploy`.

### Configuration: secrets vs. vars

| Variable | Where it lives | Why |
| --- | --- | --- |
| `RESEND_API_KEY` | Dashboard secret | Sensitive |
| `TURNSTILE_SECRET_KEY` | Dashboard secret | Sensitive |
| `CONTACT_TO_EMAIL` | `wrangler.jsonc` `vars` | Not sensitive |
| `CONTACT_FROM_EMAIL` | `wrangler.jsonc` `vars` (currently `noreply@notifs.thesuperhuman.us`, the verified Resend sending subdomain) | Not sensitive |
| `PUBLIC_TURNSTILE_SITE_KEY` | `wrangler.jsonc` `vars` | Browser-readable by design (Astro inlines `PUBLIC_*` into the build) |

Update version-controlled vars by editing `wrangler.jsonc` and pushing. Update dashboard secrets in the Cloudflare Worker settings (Variables and Secrets → Secrets).

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

The source HTML lives at `public/services.html` (also served at `/services.html`). To regenerate the PDF and refresh `doc:services-overview` in KV:

```bash
./scripts/build-services-pdf.sh --upload
```

Without `--upload`, the script only renders to `/tmp/services-overview.pdf` for inspection. The PDF artifact is never committed.

### Security headers

`public/_headers` overrides Cloudflare's default `Permissions-Policy` with an explicit policy that doesn't reference Chrome-only features (which other browsers log as "Unrecognized feature" warnings). Also sets `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.

## Resume request flow

1. A visitor requests a resume via the form on `/about` (audience + name/email/company/note + Turnstile).
2. `POST /api/resume-request` validates, rate-limits, and stores a single-use token in KV (`req:<uuid>`, 7-day TTL). It emails the operator (`CONTACT_TO_EMAIL`) with the request details and a one-click approval link.
3. The operator clicks the approval link. `GET /api/resume-approve?id=<uuid>` looks up the token, reads the matching PDF from KV (`pdf:<audience>`), emails it to the requester as an attachment, and deletes the token. Single-use; the link can't be replayed.
4. The approval link's "credential" is the UUID itself (~122 bits of entropy). Because delivery is bound to the requester's email stored in KV (not the URL), a leaked or intercepted link cannot redirect delivery elsewhere.

## Audio site

`audio.thesuperhuman.us` shares this repo, this build, and this Worker deployment with the software site. No separate project or deploy pipeline.

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

Editing `scripts/og.html` updates the layout; replacing `scripts/logo.png` or `src/assets/headshot.jpg` updates the imagery. The script re-inlines the source images into `scripts/og.html` as base64 data URIs on every run (so the template renders correctly when opened directly in a browser too).
