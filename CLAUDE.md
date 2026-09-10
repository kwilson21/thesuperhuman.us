# Claude Code: The Superhuman Group LLC Website Agent

## Who You Are Working With

You are working on the personal website of **Kazon Wilson**, who also operates **The Superhuman Group LLC**, a Wyoming LLC through which he can undertake independent work. His current direction is software engineering focused on building with AI.

The September 2026 redesign direction in [docs/website-direction.md](docs/website-direction.md)
and [docs/website-content-model.md](docs/website-content-model.md) supersedes the
original contractor-only positioning. The site introduces the person, interests,
and evidence of work. Contracts are preferred; interesting full-time opportunities
are welcome. The [system plan](docs/website-system-plan.md) describes the implementation
in the redesign PR stack; deployment is a separate decision. All generated website imagery must
pass [image QA](docs/generated-image-qa.md).

## About Kazon

- **7+ years** professional software engineering experience
- **Background:** Lyft, Sure (Toggle homeowners insurance), Axuall/Vendorpass (contract), Scotch Inc.
- **Current direction:** AI-assisted building, with room to shape solutions, prototype, iterate, and stay close to how people use the result. He welcomes ideas from collaborators; choosing the original idea is not a requirement.
- **Professional background:** Python, ETL pipelines, data engineering, backend API development. This establishes credibility; do not advertise data engineering as his desired next specialization.
- **Regulated industry experience:** Healthcare credentialing, insurance document systems
- **Website design:** Page structure, visual storytelling and responsive implementation. The personal website redesign is the current portfolio example; do not imply a history of client design projects.
- **Also works in:** Ruby on Rails, TypeScript, Django, Flask, Dagster, PostgreSQL, AWS
- **Infrastructure depth:** Docker Swarm, Traefik, Tailscale, Cloudflare, OPNsense, self-hosted everything
- **Side projects:** Kaillera-next (retro gaming netplay platform), Kova (custom ETL programming language), Frigate NVR, personal home cluster
- **Audio engineering:** Undergraduate degree in audio production from MTSU, still actively practiced (RME Babyface Pro, Sennheiser HD 650s, UAD Luna + Pro Tools)
- **Relocating to:** Northern Virginia in 2026
- **Contracting style:** Async-first, deliverable-focused, fixed-price engagements, full tool discretion (he chooses the stack)

## About the Website

- **URL:** thesuperhuman.us
- **Stack:** Astro 5, TypeScript, Tailwind CSS, Cloudflare Workers + Static Assets, Resend, Turnstile, Cloudflare KV
- **Resume delivery:** Approval-gated. PDFs stored in Cloudflare KV, emailed only after operator approval
- **New resume requests use the general variant only.** The public version picker and incoming DoD requests are retired in the local redesign. Approval and delivery still support stored legacy requests through `pdf:general` and `pdf:dod`; neither stored requests nor PDFs were migrated or deleted.

See `README.md` for environment variables, KV bindings, the full resume request flow, deployment commands, and OG image regeneration. Don't duplicate that information here.

## Positioning & Brand Voice

- **Person and interests first.** Show what Kazon cares about, makes, and contributes. Make professional evidence easy to assess. Express a preference for compatible contract work without excluding interesting full-time opportunities or turning every page into a services pitch.
- **Tone:** Direct, confident, technically specific. No fluff, no buzzwords
- **Audience:** curious visitors, potential collaborators, recruiters, and hiring managers
- **Key differentiators:**
  - Lyft pedigree
  - Regulated industry experience (healthcare, insurance)
  - AI-assisted building grounded in production engineering experience
  - Async-first, results-focused working style
  - AI-assisted development advocate
  - Interest in shaping solutions and seeing ideas become useful software

### Clearance posture

No active security clearance, but open to pursuing one for the right engagement. The redesign retires the DoD-focused resume option. Never write copy that implies current cleared status (e.g., "TS/SCI cleared engineer," "active clearance"). If a client asks about clearance in a request, route them to the contact form. That's an operator-handled conversation.

## Working Principles

- **Privacy.** Kazon's personal home address never appears in public-facing content. The business address is The Superhuman Group LLC's Wyoming registered agent address.
- **Engagement model.** All contracts are **fixed-price, deliverable-based**, never hourly. Never add hourly rate copy anywhere.
- **AI tool usage** is non-negotiable and is a feature, not a disclaimer. Reflect it positively. The Work page and project journals describe AI collaboration at a high level. Keep attribution truthful without publishing private operational recipes.
- **Async communication is preferred.** Reflect this in contact/engagement copy.

## Rate Context

Lives in `CLAUDE.local.md` (gitignored). Don't write public rate numbers anywhere.

## Historical capabilities

These describe prior capabilities, not a service menu to promote. Lead with the current building direction and preserve specific experience as supporting evidence.

1. **ETL Pipeline Architecture & Development**: Dagster, Python, multi-source ingestion
2. **Backend API Development**: Django, Flask, Python, REST, gRPC
3. **Data Systems & Infrastructure**: PostgreSQL, MySQL, AWS, data platform builds
4. **Healthcare & Regulated Industry Systems**: credentialing pipelines, insurance document systems
5. **Full Product Builds**: end-to-end backend and data layer for MVPs and full products
6. **Audio Engineering**: mixing, mastering, production (separate service line under the LLC)

## Repository Structure

- `src/`: Astro pages, components, layouts, content collections
- `public/`: Static assets and `_headers`
- `docs/superpowers/`: Design specs and implementation plans from the original build (`specs/`, `plans/`)
- `scripts/`: OG image generation and utilities
- `wrangler.jsonc`: Cloudflare Worker config, KV bindings, non-secret env vars

## Things to Never Do

- Never display Kazon's personal home address anywhere on the site
- Never display rates or pricing publicly
- Never imply contract exclusivity or a blanket rejection of full-time opportunities; follow the agreed personal-site direction
- Never use buzzwords: *passionate*, *innovative*, *guru*, *ninja*, *rockstar*
- Never use em-dashes (` — `) in user-facing prose, email bodies, subjects, or any new copy. They read as AI-generated. Use periods, colons, commas, semicolons, or parentheses instead. The middle-dot (` · `) is fine as a separator in metadata lines. This rule applies to `src/`, `public/`, README.md, and CLAUDE.md. Historical design specs in `docs/superpowers/specs/` are frozen and exempt.
- Never add hourly rates; all engagements are fixed price
- Never add non-compete or exclusivity language to any copy
- Never commit resume PDFs to the repository; they live in KV only
- Never write copy implying current security clearance

## Things to Always Do

- Keep tone direct, technically specific, and confident
- Reflect async-first, results-focused working style in all engagement copy
- Reflect AI-assisted development positively; it is a feature not a disclaimer
- Keep privacy front of mind: registered agent address for business, never personal
- Ensure all contact flows go through the approval-gated system
- Keep Tailwind classes clean and consistent with existing design system
- Run `npm run check` before committing any Astro changes
- Run `npm test` before committing any TypeScript logic changes
