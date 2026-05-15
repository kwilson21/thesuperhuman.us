# Claude Code — The Superhuman Group LLC Website Agent

## Who You Are Working With

You are working on the personal contracting website of **Kazon Wilson**, operating as **The Superhuman Group LLC** — a Wyoming LLC providing senior backend and data engineering services.

## About Kazon

- **7+ years** professional software engineering experience
- **Background:** Lyft, Sure (Toggle homeowners insurance), Axuall/Vendorpass (contract), Scotch Inc.
- **Core specialty:** Python, ETL pipelines, data engineering, backend API development
- **Regulated industry experience:** Healthcare credentialing, insurance document systems
- **Also works in:** Ruby on Rails, TypeScript, Django, Flask, Dagster, PostgreSQL, AWS
- **Infrastructure depth:** Docker Swarm, Traefik, Tailscale, Cloudflare, OPNsense, self-hosted everything
- **Side projects:** Kaillera-next (retro gaming netplay platform), Kova (custom ETL programming language), Frigate NVR, personal home cluster
- **Audio engineering:** Undergraduate degree in audio production from MTSU, still actively practiced (RME Babyface Pro, Sennheiser HD 650s, UAD Luna + Pro Tools)
- **Relocating to:** Northern Virginia in 2026
- **Contracting style:** Async-first, deliverable-focused, fixed-price engagements, full tool discretion (he chooses the stack)

## About the Website

- **URL:** thesuperhuman.us
- **Stack:** Astro 5, TypeScript, Tailwind CSS, Cloudflare Workers + Static Assets, Resend, Turnstile, Cloudflare KV
- **Resume delivery:** Approval-gated — PDFs stored in Cloudflare KV, emailed only after operator approval
- **Three resume variants:** `pdf:general`, `pdf:leadership`, `pdf:dod`

See `README.md` for environment variables, KV bindings, the full resume request flow, deployment commands, and OG image regeneration. Don't duplicate that information here.

## Positioning & Brand Voice

- **Contractor, not a job seeker.** Kazon offers specialized services through his LLC. All public-facing copy should reflect that. Never write "looking for roles," "open to opportunities," "seeking a position," etc. Frame everything as taking on engagements / accepting contracts / available for project work.
- **Tone:** Direct, confident, technically specific — no fluff, no buzzwords
- **Audience:** CTOs, engineering leads, startup founders, government prime contractors
- **Key differentiators:**
  - Lyft pedigree
  - Regulated industry experience (healthcare, insurance)
  - ETL/pipeline specialist — not a generalist
  - Async-first, results-focused working style
  - AI-assisted development advocate
  - Moving to NoVA — positioned for government contracting

### Clearance posture

No active security clearance. The **DoD-focused resume** is positioned for **non-cleared support work**: data engineering for prime contractors on unclassified efforts, subcontract roles, public-facing agency systems, and prime/sub positions willing to sponsor clearance for the right engagement. Never write copy that implies current cleared status (e.g., "TS/SCI cleared engineer," "active clearance"). If a client asks about clearance in a request, route them to the contact form — that's an operator-handled conversation.

## Working Principles

- **Privacy.** Kazon's personal home address never appears in public-facing content. The business address is The Superhuman Group LLC's Wyoming registered agent address.
- **Engagement model.** All contracts are **fixed-price, deliverable-based** — never hourly. Never add hourly rate copy anywhere.
- **AI tool usage** is non-negotiable and is a feature, not a disclaimer. Reflect it positively. The site already includes a section-level disclosure on `/about` under "Outside of work" — match that tone if you ever need to write similar copy.
- **Async communication is preferred** — reflect this in contact/engagement copy.

## Rate Context

Lives in `CLAUDE.local.md` (gitignored). Don't write public rate numbers anywhere.

## Services Offered

1. **ETL Pipeline Architecture & Development** — Dagster, Python, multi-source ingestion
2. **Backend API Development** — Django, Flask, Python, REST, gRPC
3. **Data Systems & Infrastructure** — PostgreSQL, MySQL, AWS, data platform builds
4. **Healthcare & Regulated Industry Systems** — credentialing pipelines, insurance document systems
5. **Full Product Builds** — end-to-end backend and data layer for MVPs and full products
6. **Audio Engineering** — mixing, mastering, production (separate service line under the LLC)

## Repository Structure

- `src/` — Astro pages, components, layouts, content collections
- `public/` — Static assets and `_headers`
- `docs/superpowers/` — Design specs and implementation plans from the original build (`specs/`, `plans/`)
- `scripts/` — OG image generation and utilities
- `wrangler.jsonc` — Cloudflare Worker config, KV bindings, non-secret env vars

## Things to Never Do

- Never display Kazon's personal home address anywhere on the site
- Never display rates or pricing publicly
- Never position Kazon as a job seeker — he is a contractor offering services
- Never use buzzwords: *passionate*, *innovative*, *guru*, *ninja*, *rockstar*
- Never add hourly rates — all engagements are fixed price
- Never add non-compete or exclusivity language to any copy
- Never commit resume PDFs to the repository — they live in KV only
- Never write copy implying current security clearance

## Things to Always Do

- Keep tone direct, technically specific, and confident
- Reflect async-first, results-focused working style in all engagement copy
- Reflect AI-assisted development positively — it is a feature not a disclaimer
- Keep privacy front of mind — registered agent address for business, never personal
- Ensure all contact flows go through the approval-gated system
- Keep Tailwind classes clean and consistent with existing design system
- Run `npm run check` before committing any Astro changes
- Run `npm test` before committing any TypeScript logic changes
