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

### Env vars

Set in **Project → Settings → Variables and Secrets**:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `TURNSTILE_SECRET_KEY` | Turnstile secret (server-side) |
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key (browser-side, prefixed `PUBLIC_` so Astro exposes it) |
| `CONTACT_TO_EMAIL` | `kazon.wilson@thesuperhuman.us` |
| `CONTACT_FROM_EMAIL` | `noreply@thesuperhuman.us` |

### KV bindings

Two bindings, both pointing to the same physical KV namespace (key prefixes keep data isolated):

| Binding | Keys stored |
| --- | --- |
| `RATE_LIMIT` | `rl:<ip>` — per-IP rate-limit windows |
| `RESUME_STORE` | `req:<uuid>` — pending resume-request approval tokens · `pdf:general` / `pdf:leadership` / `pdf:dod` — the binary resume PDFs |

Bind in **Project → Settings → Variables and Secrets → KV namespace bindings**.

### Uploading resumes to KV (one-time)

Resume PDFs are **never** committed to this repo and **never** served from `public/`. They live exclusively in KV and are emailed to requesters only after you approve each request.

Upload all three from the repo root:

```bash
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:general    --path "/path/to/KWilson_Resume_G_2026.pdf"
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:leadership --path "/path/to/KWilson_Resume_L_2026.pdf"
npx wrangler kv key put --binding=RESUME_STORE --remote pdf:dod        --path "/path/to/KWilson_Resume_D_2026.pdf"
```

Replace the paths with wherever you keep the source PDFs. Re-run any of these commands whenever a resume changes.

If `wrangler` complains about the binding, declare the KV namespace in `wrangler.jsonc` with its dashboard ID, or pass `--namespace-id=<id>` directly.

## Resume request flow

1. A visitor requests a resume via the form on `/about` (audience + name/email/company/note + Turnstile).
2. `POST /api/resume-request` validates, rate-limits, and stores a single-use token in KV (`req:<uuid>`, 7-day TTL). It emails the operator (`CONTACT_TO_EMAIL`) with the request details and a one-click approval link.
3. The operator clicks the approval link. `GET /api/resume-approve?id=<uuid>` looks up the token, reads the matching PDF from KV (`pdf:<audience>`), emails it to the requester as an attachment, and deletes the token. Single-use; the link can't be replayed.
4. The approval link's "credential" is the UUID itself (~122 bits of entropy). Because delivery is bound to the requester's email stored in KV — not the URL — a leaked or intercepted link cannot redirect delivery elsewhere.
