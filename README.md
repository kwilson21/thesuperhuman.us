# thesuperhuman.us

Personal site for Kazon Wilson · backend & data engineer · contracting through The Superhuman Group LLC.

## Stack

- Astro 5 (static output, `@astrojs/cloudflare` adapter)
- TypeScript
- Tailwind CSS
- Resend (transactional email)
- Cloudflare Turnstile (spam protection)
- Cloudflare KV (rate limiting)
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

Local env vars live in `.dev.vars` (not committed). See `src/env.d.ts` for required variables.

## Deployment

Push to `main` → Cloudflare Pages builds and deploys to https://thesuperhuman.us.

Env vars set in the Cloudflare Pages dashboard:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `TURNSTILE_SITE_KEY` (also `PUBLIC_TURNSTILE_SITE_KEY` for the client) | Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Turnstile secret |
| `CONTACT_TO_EMAIL` | `kazon.wilson@thesuperhuman.us` |
| `CONTACT_FROM_EMAIL` | `noreply@thesuperhuman.us` |

KV namespace `RATE_LIMIT` must be bound to the Pages project.
