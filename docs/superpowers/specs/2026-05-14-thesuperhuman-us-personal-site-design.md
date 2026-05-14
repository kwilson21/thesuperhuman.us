# thesuperhuman.us — personal site design

**Date:** 2026-05-14
**Owner:** Kazon Wilson
**Status:** Approved, ready for implementation planning

## 1. Goals and audience

A personal website at `thesuperhuman.us` that positions Kazon Wilson for software engineering contract work through The Superhuman Group LLC. Content is the focal point; the technical stack is deliberately minimal so editing and deploying stay frictionless.

**Primary audience:** prospective contract clients, hiring managers, recruiters (general, leadership, and DoD).

**Success looks like:** a visitor can, in one scroll on the landing page, understand who Kazon is, see proof of recent production work, and submit a qualified inquiry. A second visitor wanting more depth follows one link to `/about` and reads the full narrative.

**Out of scope for v1:** a blog/notes surface, a dedicated projects index, a CMS, analytics dashboards beyond defaults, dark mode toggle UI.

## 2. Architecture and deployment

### Stack

- **Framework:** Astro 5.x with `@astrojs/cloudflare` adapter. Static output where possible; one server route for the contact form.
- **Styling:** Tailwind CSS, constrained to the design tokens defined in section 3. No component libraries.
- **Language:** TypeScript throughout (`strict: true`).
- **Content:** Astro content collections. Existing `kazon-personal-site.md` becomes `src/content/pages/about.md`.
- **No JS framework** (React/Vue/etc.). Astro components only.

### Hosting

- **Cloudflare Pages** for both the static site and the contact form Pages Function. Single deploy, single repo, single dashboard.
- **GitHub repo** `kwilson21/thesuperhuman.us` (final name confirmed at implementation kickoff). Push to `main` → Cloudflare builds → deploys to apex.
- **PR previews** enabled by default.

### DNS

- `thesuperhuman.us` apex → Cloudflare Pages project.
- `www.thesuperhuman.us` → 301 redirect to apex.
- Existing subdomains (`finance.`, `kaillera-next.`) untouched — independent DNS records, no conflict.

### Email path

- **Resend** account with `thesuperhuman.us` verified as a sending domain (TXT + DKIM/SPF records added in Cloudflare DNS).
- Contact form submissions sent from `noreply@thesuperhuman.us` to `kazon.wilson@thesuperhuman.us`.
- Autoresponder sent from the same `noreply@` address to the visitor's email.

### Environment variables (Cloudflare Pages dashboard)

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (browser) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret (server) |
| `CONTACT_TO_EMAIL` | `kazon.wilson@thesuperhuman.us` |
| `CONTACT_FROM_EMAIL` | `noreply@thesuperhuman.us` |

## 3. Visual system

### Typography

- **Newsreader** (Google Fonts, variable, weights 200–800, optical sizing) — body and headings.
- **Inter** (Google Fonts) — UI labels, eyebrows, button text. Restrained use.
- **JetBrains Mono** (Google Fonts) — inline code and file paths. Sparing use.

All fonts loaded with `font-display: swap`. System fallbacks: `Georgia` (serif), `system-ui` (sans), `Menlo` (mono).

### Color palette

| Token | Value | Use |
|---|---|---|
| `--paper` | `#FBF8F2` | Background |
| `--ink` | `#0E0E0E` | Primary text, primary button background |
| `--muted` | `#4A4A4A` | Secondary text, captions |
| `--rule` | `#E8E3DA` | Hairlines, borders |
| `--accent` | `#B85C38` | Links, underlines on inline links, status dot, primary button text hover |

Contrast: rust on paper passes WCAG AA (verify at implementation). Ink on paper passes AAA.

### Type scale

| Style | Size | Line height | Letter spacing | Weight |
|---|---|---|---|---|
| Display | 46/52 (mobile/desktop) | 1.08 | -0.018em | 400 |
| Heading | 24/28 | 1.2 | -0.01em | 400 |
| Lede | 18/20 | 1.5 | normal | 400 |
| Body | 16 | 1.6 | normal | 400 |
| Small | 14 | 1.55 | normal | 400 |
| Eyebrow (Inter) | 11 | 1.4 | 0.12em | 500 uppercase |
| Mono (JetBrains) | 13 inline | 1.5 | normal | 400 |

### Layout

- Single column.
- Max measure for body prose: ~62 characters (~680px content width).
- Generous side gutters: minimum 24px mobile, scaling to 64px+ on wider viewports.
- Vertical rhythm on an 8px scale.
- No horizontal navigation bar in v1 — the only inter-page link from `/` is "Read more →" / "About" in the hero and footer.

## 4. Information architecture

```
/             Landing page (contract-lead pitch + intake form)
/about        Long-form narrative + resume chooser
/api/contact  Pages Function (contact form backend)
/resumes/general.pdf      Download
/resumes/leadership.pdf   Download
/resumes/dod.pdf          Download
```

`www.thesuperhuman.us/*` → 301 to apex.

## 5. Landing page sections (top to bottom)

### 5.1 Hero

Two-column on desktop (1.5fr left / 1fr right), single-column on mobile (text first, headshot below).

- **Left:** eyebrow ("Available for contract work · 2026" with rust status dot) → display "Kazon Wilson" → lede paragraph (`I'm most useful when a problem cuts across layers — when a UI bug turns out to be a data pipeline issue that turns out to be a business-logic miscommunication.`) → secondary line (`Backend & data engineer · 7+ years of production systems · Contracting through The Superhuman Group LLC.`) → two CTAs (primary ink button "Work with me" anchor-links to the form; secondary text link "Read more →" goes to `/about`).
- **Right:** headshot, 4:5 crop, `object-position: center 25%`, responsive width capped at ~280px.

### 5.2 Intro

One tight paragraph (~2–3 sentences) drafted for landing context, distinct from `/about`'s opener. Drafted during implementation; reviewed before merge.

### 5.3 What I do

Heading "What I do" with four bullets:

1. **Backend systems** — Python, Django, Rails, Postgres. Production reliability and observability are part of the deliverable.
2. **Data pipelines & ETL** — Dagster, custom ingestion, messy real-world data sources with undocumented contracts.
3. **Cross-team product work** — interfaces between engineering, ops, and external vendors; migrations and deprecations.
4. **AI-assisted development advocacy** — modeling Claude in feature planning, PR review, and PR description authorship.

Each bullet rendered as a bold serif lead-in + body sentence in a single paragraph. Final copy reviewed during implementation.

### 5.4 Recent work

Heading "Recent work" → two project cards. Stack vertically on mobile, side-by-side on desktop.

Each card contains: project name (serif heading) → one-line description → tech stack (small JetBrains Mono row) → "Visit live →" link. No screenshots in v1.

1. **Superhuman Finance** — `finance.thesuperhuman.us` · Rails 8.1, Hotwire, Tailwind, Postgres, Plaid.
2. **Kaillera Next** — `kaillera-next.thesuperhuman.us` · N64 netplay in the browser, WebRTC, EmulatorJS.

### 5.5 Selected experience

Heading "Selected experience" → compact vertical list. One row per role.

Each row: company (medium serif) · role · dates (eyebrow) · one-line outcome (body). Vertical hairline between rows.

Reverse chronological: Scotch, Vendorpass/Axuall, Sure, Lyft, Skupos. One-line outcome copy drafted from existing markdown during implementation, reviewed before merge.

Below the list, a small Inter caption: *"Looking for the resume? Pick the one that matches your role →"* anchor-linking to `/about#resumes`.

### 5.6 Work with me (intake form)

Heading "Work with me" → form per section 7. Submit returns inline success or error state on the same page.

### 5.7 Footer

Three columns on desktop, stacked on mobile:

- Contact: `kazonwilson@gmail.com` · Fairfield, CT → Northern Virginia.
- Social: GitHub icon ([github.com/kwilson21](https://github.com/kwilson21)) · LinkedIn icon ([linkedin.com/in/kazonwilson](https://www.linkedin.com/in/kazonwilson/)).
- Identity: "The Superhuman Group LLC · © 2026".

Small, quiet type (Inter 12px, muted).

## 6. About page sections (top to bottom)

### 6.1 Header

Small portrait (reuse `headshot.jpg`) · name (display) · subtitle line ("Software engineer · Fairfield, CT → Northern Virginia · Available for contract work").

### 6.2 Intro

The first two paragraphs of the existing `kazon-personal-site.md` rendered verbatim. **Drop cap** applied to the first letter of the first paragraph (large serif initial, ~3 lines tall, ink color).

### 6.3 About

The existing `## About` section rendered as-is.

### 6.4 Selected work

Each role from the existing markdown (`### Scotch`, `### Vendorpass / Axuall (Contract)`, `### Sure`, `### Lyft`, `### Skupos`) becomes a styled block:

- Company name as section heading (serif, 28px).
- Role + dates as eyebrow above the heading.
- Body prose rendered with editorial typography.
- Subtle horizontal rule between roles.

Bold lead-ins inside Lyft and Skupos subsections (e.g., "Vendor leadership on third-party rebooking APIs.") preserved as `<strong>` in markdown rendering.

### 6.5 Outside of work

The existing section with four subsections (Personal infrastructure, Kova, Retro gaming and emulation, Audio production). Subsections rendered as `h3` headings.

### 6.6 Tech

Three labeled groups ("Daily", "Used in production", "Adjacent personal infrastructure") rendered as tag-style lists. Each tag in JetBrains Mono, small, with hairline border.

### 6.7 Resume chooser (`#resumes` anchor)

Section heading: "Resume — pick the one that matches your role".

Three cards, in this order:

1. **General resume** — "Hiring for backend, data, or general engineering roles?" — *Full work history with technical depth and cross-team contributions.* — `/resumes/general.pdf`
2. **Leadership resume** — "Hiring for staff, principal, or engineering leadership?" — *Emphasizes ownership, mentorship, cross-org influence, and AI-assisted development advocacy.* — `/resumes/leadership.pdf`
3. **DoD-focused resume** — "Hiring for federal, defense, or cleared work?" — *Tailored for DoD format and contracting context.* — `/resumes/dod.pdf`

Each card: title row · audience question · descriptor line · download button with file size suffix (e.g., "Download PDF · 22 KB").

### 6.8 Contact

Email, GitHub, LinkedIn, location. Slightly larger and more prominent than the footer treatment, since the reader has earned it by reading down.

## 7. Contact form

### Fields

| Field | Type | Required | Constraints |
|---|---|---|---|
| Name | text | yes | 1–100 chars |
| Email | email | yes | valid format, ≤120 chars |
| Company | text | no | ≤120 chars |
| Project type | multi-select chips | yes | one or more of: Backend systems, Data pipelines, Contract role, Advisory, Other |
| Timeline | radio | yes | one of: Now, 1–3 months, Just exploring |
| Budget range | radio | no | one of: Under $10k, $10–50k, $50k+, Not sure yet |
| Description | textarea | yes | 40–4000 chars |
| Turnstile token | hidden | yes | validated server-side |

### Submission flow

1. Browser submits JSON to `POST /api/contact`.
2. Pages Function validates fields, verifies Turnstile token against Cloudflare's siteverify endpoint, applies rate limit.
3. Function calls Resend twice in parallel:
   - **Primary email** to `CONTACT_TO_EMAIL`. Subject: `New inquiry from [Name] — [Project type joined]`. Body: formatted plaintext with all fields. `Reply-To: <visitor's email>`.
   - **Autoresponder** to the visitor's email. Subject: `Thanks for reaching out — Kazon Wilson`. Body: short confirmation noting a two-business-day response target.
4. Function returns `200 { ok: true }`. Page swaps the form for a success message: *"Got it. I'll reply within two business days."*
5. On error, function returns `4xx`/`5xx` with `{ error: string }`. Form stays filled in and displays an inline error. If Resend fails, the error message includes: *"Something went wrong — email kazon.wilson@thesuperhuman.us directly."*

### Spam protection

Cloudflare Turnstile in invisible mode (no user checkbox). Free, no third-party deps, integrates natively with Pages.

### Rate limiting

Cloudflare KV namespace bound to the Function. Per-IP key with 5-minute TTL. If a key already exists, return `429 { error: "Please wait a few minutes before submitting again." }`.

### Security and JS requirement

The form requires JavaScript: it posts JSON via `fetch` and uses invisible Turnstile. A `<noscript>` fallback inside the form area instructs visitors without JS to email `kazon.wilson@thesuperhuman.us` directly.

The Function checks the `Origin` header against `thesuperhuman.us` (and Pages preview hostnames) before processing — defense in depth against direct API abuse from other sites.

### Contextual resume pointer

When a project type is selected, an inline hint appears below the chips:

- "Contract role" → "Looking for the full resume? [General](/resumes/general.pdf) or [Leadership](/resumes/leadership.pdf)."
- "Advisory" → "Looking for the full resume? [Leadership](/resumes/leadership.pdf)."
- Other types → no hint (form is enough).

## 8. Repo structure

```
thesuperhuman.us/
├─ public/
│  ├─ headshot.jpg                  optimized; source moved from project root
│  ├─ resumes/
│  │  ├─ general.pdf                from KWilson_Resume_G_2026.pdf
│  │  ├─ leadership.pdf             from KWilson_Resume_L_2026.pdf
│  │  └─ dod.pdf                    from KWilson_Resume_D_2026.pdf
│  ├─ favicon.svg
│  ├─ og-image.png                  1200×630, generated for link previews
│  └─ robots.txt
├─ src/
│  ├─ pages/
│  │  ├─ index.astro                landing
│  │  ├─ about.astro                renders content collection
│  │  └─ api/contact.ts             Pages Function
│  ├─ components/
│  │  ├─ Hero.astro
│  │  ├─ WhatIDo.astro
│  │  ├─ ProjectCard.astro
│  │  ├─ ExperienceRow.astro
│  │  ├─ ContactForm.astro
│  │  ├─ ResumeCard.astro
│  │  └─ Footer.astro
│  ├─ content/
│  │  ├─ config.ts                  collection schemas
│  │  ├─ pages/about.md             from kazon-personal-site.md
│  │  └─ notes/                     empty, scaffolded for future use
│  ├─ layouts/
│  │  └─ BaseLayout.astro           head, fonts, footer
│  ├─ styles/
│  │  └─ global.css                 tokens + base type + drop cap
│  └─ lib/
│     ├─ resend.ts                  email sending wrapper
│     ├─ turnstile.ts               token verification
│     └─ rate-limit.ts              KV-backed limiter
├─ astro.config.mjs
├─ tailwind.config.mjs
├─ package.json
├─ tsconfig.json
├─ .gitignore                       includes .superpowers/ and node_modules/
└─ README.md
```

## 9. Implementation order

Each step ends in a working, demoable state.

1. **Scaffold** — `npm create astro@latest`, install Tailwind and `@astrojs/cloudflare`, wire base layout, fonts, global tokens, drop-cap CSS.
2. **About page** — content collection wired, `kazon-personal-site.md` moved to `src/content/pages/about.md`, editorial typography applied. Header, intro with drop cap, selected work, outside of work, tech, resume chooser, contact section all rendered. PDFs in `public/resumes/`. Lighthouse a11y/perf checked.
3. **Landing page** — hero with real headshot, intro, what-I-do, recent work, selected experience, footer. Form component scaffolded but `/api/contact` not yet wired.
4. **Contact form backend** — `src/pages/api/contact.ts`, Resend wrapper, Turnstile verification, KV rate limiter, autoresponder, success and error states wired to the form component. Local dev mode skips Resend with a logged payload.
5. **Polish** — favicon, OG image, JSON-LD `Person` schema, sitemap.xml, robots.txt, contextual resume hints on the form, "looking for the resume?" pointer on landing, final accessibility and performance pass.
6. **Deploy** — push to GitHub, connect Cloudflare Pages, set env vars, verify Resend domain, point DNS, smoke-test the form end-to-end.

## 10. Non-functional requirements

### Accessibility

- Semantic HTML throughout (`<header>`, `<main>`, `<section>`, `<article>`, `<nav>`, `<footer>`).
- All form inputs have associated `<label>`s.
- All interactive elements keyboard reachable; visible focus styles.
- Color contrast: ink/paper passes AAA; rust/paper passes AA (verified before merge).
- Headshot `alt="Kazon Wilson"`.
- Skip-to-content link in the layout.
- Lighthouse accessibility ≥ 95 on both pages.

### Performance

- Static HTML output for `/` and `/about`.
- Headshot served as AVIF + WebP + JPEG via Astro's image pipeline, with `loading="eager"` and `fetchpriority="high"` on the hero portrait, `loading="lazy"` elsewhere.
- Fonts loaded with `font-display: swap` and subset where possible (latin only).
- Tailwind purged to used classes only.
- No client-side JS framework. Inline JS only for the form's submit handler.
- Lighthouse performance ≥ 95 on both pages.

### SEO

- Per-page `<title>`, `<meta name="description">`.
- Open Graph + Twitter card meta with `og-image.png`.
- JSON-LD `Person` schema on `/` and `/about` with name, role, sameAs links (GitHub, LinkedIn), worksFor (The Superhuman Group LLC).
- `sitemap.xml` auto-generated by `@astrojs/sitemap`.
- `robots.txt` allowing all crawlers.

## 11. Future-friendly architecture

Scaffolded in v1, not built:

- **`/notes` writing surface** — `src/content/notes/` directory and collection schema exist; a single route file (`src/pages/notes/[slug].astro`) plus an index would activate it. New notes become `.md` files dropped into the collection.
- **Dark mode** — all colors expressed as CSS custom properties (`--paper`, `--ink`, etc.). A toggle becomes a `prefers-color-scheme` query plus swapped token values; no markup churn.
- **More projects** — `ProjectCard` component accepts data props; a third card on landing is a copy-paste. A dedicated `/projects` index follows the content-collection pattern.

## 12. Deployment prerequisites

The build does not depend on these — they are wired during step 6.

- Cloudflare account with `thesuperhuman.us` DNS managed (or delegated) through Cloudflare.
- Resend account, `thesuperhuman.us` verified as a sending domain (DKIM + SPF + return-path DNS records).
- Mailbox `kazon.wilson@thesuperhuman.us` provisioned and receiving mail. Without this, the form submits successfully but the operator never sees it.
- GitHub repo created and Cloudflare Pages connected to it.
- Cloudflare KV namespace created and bound to the Pages project as `RATE_LIMIT`.
- Cloudflare Turnstile site key + secret key generated for `thesuperhuman.us`.

## 13. Open items resolved during implementation

These are intentionally deferred to the implementation phase:

- **Landing intro paragraph copy** — drafted from existing markdown, reviewed before merge.
- **Selected experience one-line outcomes** — drafted from existing markdown, reviewed before merge.
- **"What I do" bullet body sentences** — drafted, reviewed before merge.
- **Drop cap exact size and offset** — dialed in visually.
- **Headshot crop `object-position` fine-tune** — dialed in visually.
- **OG image composition** — name + role on the paper background with the rust accent dot.

## 14. Notes

- The existing `kazon-personal-site.md` at the repo root will be moved to `src/content/pages/about.md` during step 2 and deleted from the root.
- The headshot `IMG_2285.jpeg` at the repo root will be moved to `public/headshot.jpg` (renamed) during step 1 and deleted from the root.
- The three resume PDFs in `/Users/kazon/Downloads/Resumes 2026/` will be copied into `public/resumes/` and renamed during step 2.
- `.superpowers/` is in `.gitignore`; brainstorming artifacts do not ship.
