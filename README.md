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
| `RATE_LIMIT` | `rl:<ip>` — per-IP rate-limit windows |
| `RESUME_STORE` | `req:<uuid>` — pending resume-request approval tokens · `pdf:general` / `pdf:leadership` / `pdf:dod` — the binary resume PDFs |
| `SESSION` | (unused — satisfies the `@astrojs/cloudflare` adapter's default expectation; Astro sessions aren't used) |

Declared in `wrangler.jsonc` `kv_namespaces` with explicit namespace IDs.

### Uploading resumes to KV

Resume PDFs are **never** committed to this repo and **never** served from `public/`. They live exclusively in KV and are emailed to requesters only after you approve each request.

```bash
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:general    --path "/path/to/KWilson_Resume_G_2026.pdf"
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:leadership --path "/path/to/KWilson_Resume_L_2026.pdf"
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:dod        --path "/path/to/KWilson_Resume_D_2026.pdf"
```

Re-run any of these whenever a resume changes.

### Security headers

`public/_headers` overrides Cloudflare's default `Permissions-Policy` with an explicit policy that doesn't reference Chrome-only features (which other browsers log as "Unrecognized feature" warnings). Also sets `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.

## Resume request flow

1. A visitor requests a resume via the form on `/about` (audience + name/email/company/note + Turnstile).
2. `POST /api/resume-request` validates, rate-limits, and stores a single-use token in KV (`req:<uuid>`, 7-day TTL). It emails the operator (`CONTACT_TO_EMAIL`) with the request details and a one-click approval link.
3. The operator clicks the approval link. `GET /api/resume-approve?id=<uuid>` looks up the token, reads the matching PDF from KV (`pdf:<audience>`), emails it to the requester as an attachment, and deletes the token. Single-use; the link can't be replayed.
4. The approval link's "credential" is the UUID itself (~122 bits of entropy). Because delivery is bound to the requester's email stored in KV — not the URL — a leaked or intercepted link cannot redirect delivery elsewhere.

## Regenerating the OG image

The `/og-image.png` social-share card is rendered from `scripts/og.html` via headless Chrome at 1200×630.

```bash
./scripts/build-og.sh
```

Editing `scripts/og.html` updates the layout; replacing `scripts/logo.png` or `src/assets/headshot.jpg` updates the imagery. The script re-inlines the source images into `scripts/og.html` as base64 data URIs on every run (so the template renders correctly when opened directly in a browser too).
