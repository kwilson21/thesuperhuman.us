# audio.thesuperhuman.us — audio engineering site design

**Date:** 2026-05-17
**Owner:** Kazon Wilson
**Status:** Approved, ready for implementation planning

## 1. Goals and audience

A second public-facing site at `audio.thesuperhuman.us` that positions Kazon Wilson for **audio engineering contract work** (mixing, mastering, production, recording) through The Superhuman Group LLC. The site shares brand, repo, build, and deployment with the existing software site at `thesuperhuman.us`; only the visual surface and the audio-specific bookable services are new.

**Primary audience:** independent artists, producers, and small-label A&R who are considering hiring a mixing or mastering engineer.

**Success looks like:** a visitor lands on `audio.thesuperhuman.us`, listens to one or two examples in the service category they care about, reads the short about-the-engineer block, and submits a project inquiry through the booking form without leaving the page.

**Sequencing.** This spec covers the audio site only. A follow-up project will introduce an apex landing page at `thesuperhuman.us` and move the existing software site to `software.thesuperhuman.us`. None of that infra work is in scope here; until it lands, the existing software site continues to be served at the apex.

## 2. Architecture

### Topology: one Astro project, hostname-aware middleware

The existing `thesuperhuman-us` repo is extended to serve both hostnames from a single Cloudflare Worker. There is no second repo, no second build, no second deploy.

1. **DNS.** A new Cloudflare DNS record points `audio.thesuperhuman.us` at the existing Worker.
2. **Worker route.** `wrangler.jsonc` gains a route rule for `audio.thesuperhuman.us/*` targeting the same Worker that already serves `thesuperhuman.us`.
3. **Astro middleware.** A new `src/middleware.ts` inspects the incoming `Host` header. When the host is `audio.thesuperhuman.us`, the middleware internally rewrites non-API paths by prepending `/audio`: `/` becomes `/audio/`, `/about` becomes `/audio/about`, `/file/<slug>` becomes `/audio/file/<slug>`. API endpoints (`/api/*`) are not rewritten because they share a global namespace across hosts.
4. **Page layout.** Audio-site pages live at `src/pages/audio/index.astro` and `src/pages/audio/about.astro`. The audio file endpoint lives at `src/pages/audio/file/[slug].ts`. The audio inquiry endpoint lives at `src/pages/api/audio-inquiry.ts`. Existing software-site pages stay where they are.
5. **Local development.** Visiting `localhost:4321/audio/` directly works in dev because no middleware rewrite is needed (the path is already the internal one). A future improvement could spoof the host header for closer parity, but is not required for v1.

### Why this shape

- One repo, one build, one deploy keeps maintenance flat.
- BaseLayout, Tailwind config, design tokens, rate-limit pattern, Turnstile integration, and Resend client are all reusable. The audio site adds files; it does not duplicate infrastructure.
- The coupling cost is one shared deploy pipeline. For a low-traffic personal site, that is the correct trade.

### Cloudflare bindings

`wrangler.jsonc` adds one new binding:

| Binding | Type | Purpose |
|---|---|---|
| `AUDIO` | R2 bucket | Stores audio files for the portfolio. Bucket name `superhuman-audio`. |

KV bindings (`RATE_LIMIT`, `RESUME_STORE`, `SESSION`) are unchanged. Vars (`CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`, `PUBLIC_TURNSTILE_SITE_KEY`) are unchanged. Secrets (`RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`) are unchanged and reused by the audio inquiry endpoint.

### Environment variables (no new dashboard secrets)

The audio site reuses all existing secrets. No new dashboard-managed secrets are introduced.

## 3. Site map

### audio.thesuperhuman.us

| Public URL | Internal path | Purpose |
|---|---|---|
| `/` | `src/pages/audio/index.astro` | Single long page: hero, about-the-engineer, portfolio (grouped by service), booking form anchor. |
| `/about` | `src/pages/audio/about.astro` | Longer-form about page. Career arc, gear, mix philosophy, revision policy. |
| `/api/audio-inquiry` | `src/pages/api/audio-inquiry.ts` | POST endpoint for the booking form. |
| `/file/[slug]` | `src/pages/audio/file/[slug].ts` | Streams audio files from R2 with `Range` support. |

### Routing rules

On the audio host (`audio.thesuperhuman.us`):

- Paths starting with `/api/` pass through unchanged.
- All other paths are internally rewritten by prepending `/audio` (`/` → `/audio/`, `/about` → `/audio/about`, `/file/<slug>` → `/audio/file/<slug>`).

On the software host (`thesuperhuman.us`), no rewriting occurs; requests are passed through unchanged.

The middleware never issues an HTTP redirect; rewrites are internal so the browser keeps the clean URL.

### Prerender opt-out for host-routed pages

Astro middleware only runs on server-rendered routes. Because the project uses `output: 'static'` (every page prerenders by default), the routes that host-aware rewriting must intercept have to opt out of prerendering with `export const prerender = false`. This applies to:

- `src/pages/index.astro` (so `audio.thesuperhuman.us/` triggers middleware before static-asset resolution)
- `src/pages/about.astro` (same, for `audio.thesuperhuman.us/about`)
- All new `src/pages/audio/**` pages

Cloudflare edge caching offsets the server-rendering cost for these handful of routes. Response cache hints (`Cache-Control: public, s-maxage=...`) are set per page as needed.

### Canonical and OpenGraph URLs

`src/layouts/BaseLayout.astro` currently builds canonical URLs from `Astro.site` (fixed to `https://thesuperhuman.us`). Audio-host requests rendered through `/audio/...` would otherwise advertise `https://thesuperhuman.us/audio/...` in `<link rel="canonical">` and `og:url`. To prevent that, BaseLayout reads the request host via `Astro.request.headers.get('host')` (with `Astro.url.host` as a fallback) and, for the audio host, returns `https://audio.thesuperhuman.us/<unrewritten path>` (i.e., the `/audio/` internal prefix is stripped back out for the public URL). This works because audio pages are server-rendered, so `Astro.url.host` reflects the actual request host.

## 4. Content model

Tracks are an Astro content collection at `src/content/audio-tracks/`, one YAML file per track. Schema is defined in `src/content/config.ts` with Zod for type safety.

### Per-track schema

```yaml
title: "Slow Burn"            # required, string
artist: "Artist Name"          # required, string
year: 2024                     # required, integer
role:                          # required, array of: "mix" | "master" | "produce" | "record"
  - mix
  - master
primaryService: "mixing"       # required, one of: "mixing" | "mastering" | "production" | "recording"
notes: "Re-amped guitars, parallel drum bus, mastered for streaming." # required, string, 1-2 sentences
file: "tracks/slow-burn.mp3"   # required, R2 object key
length: "3:42"                 # required, display string ("M:SS")
featured: false                # optional, default false. Surfaces a track in a "selected work" strip.
order: 10                      # optional, default 100. Lower numbers sort first within a service section.
```

### Field semantics

- `primaryService` controls which portfolio section the track is rendered in. A track appears in exactly one section.
- `role` is a separate field so the metadata line can read "Mixed, mastered" even when the track is grouped under "Mixing." It lets a track contribute multiple credits without duplicating it across sections.
- `file` is the R2 object key; the file endpoint validates the key against the collection on every request to prevent arbitrary R2 reads.
- `notes` is shown as a short caption under the track. Keep it concrete: what you actually did, not adjectives.

### Add-a-track workflow

1. Encode the track to MP3 (operator chooses bitrate; 192–256 kbps is typical).
2. Upload to R2: `npm run audio:upload <local-file>` (script wraps `wrangler r2 object put`).
3. Add a YAML file under `src/content/audio-tracks/<slug>.yml`.
4. Commit, push, deploy.

No CMS, no admin UI. Git is the audit log; the content collection is the source of truth for what renders.

## 5. Audio storage and player

### Storage (R2)

- Bucket: `superhuman-audio`, bound as `AUDIO` in `wrangler.jsonc`.
- Object keys: `tracks/<slug>.mp3`. The bucket is not public; the only access path is the file endpoint described below.
- Files are pre-encoded MP3s. No transcoding pipeline, no waveform precomputation, no thumbnails in v1.

### File endpoint

`src/pages/audio/file/[slug].ts` is the only path that reads from R2:

1. Looks up the slug in the audio-tracks content collection.
2. If the slug is unknown, returns 404. (Prevents enumeration and arbitrary R2 reads.)
3. Reads the R2 object using `AUDIO.get(key, { range })` so `Range` requests stream just the requested byte window.
4. Sets headers: `Content-Type: audio/mpeg`, `Accept-Ranges: bytes`, `Content-Disposition: inline; filename="<slug>.mp3"`, `Cache-Control: public, max-age=31536000, immutable`.
5. Returns the body as a streamed response.

### Player UX

- One `<audio>` element per track, `preload="none"` so visitors do not download audio they never play.
- Native browser controls, styled to match the editorial palette via CSS where possible. `controlslist="nodownload"` suppresses the download affordance on Chromium browsers.
- A small inline script registers all players on the page; when one fires `play`, the others are paused. No external player library.
- No waveform rendering in v1.
- No shared persistent player bar in v1.

### Download posture

This is not a DRM system. Anyone with devtools can grab the URL and stream the file. The intent is to make casual downloading awkward, not impossible. R2 listing is disabled; the bucket is not public; the file endpoint validates slugs against the collection.

## 6. Booking flow

A new `BookingForm.astro` component lives at `src/components/audio/BookingForm.astro` and is rendered inline on the audio landing page.

### Form fields

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | text | yes | |
| Email | email | yes | Used as reply-to in the resulting Resend email. |
| Service interest | checkbox group | yes (1+) | Options: Mixing, Mastering, Production, Recording. |
| Number of tracks | number | no | Integer, min 1. |
| Target delivery date | date | no | Paired with a "flexible" checkbox; submitting "flexible" overrides the date. |
| Reference tracks | textarea | no | Free text. URLs or descriptions of sound targets. |
| File delivery method | select | yes | Options: Google Drive, Dropbox, WeTransfer, Other. |
| Project notes | textarea | yes | The "what is this project" field. |
| Turnstile token | hidden | yes | Standard widget, same site key as software site. |

### POST handler

`src/pages/api/audio-inquiry.ts`:

1. Parses and validates the form payload. Rejects with 400 on missing required fields or malformed values.
2. Rate-limits by IP using the existing `RATE_LIMIT` KV binding with prefix `rl:audio:<ip>`. Window and threshold match the existing software-site contact form.
3. Verifies the Turnstile token against Cloudflare's verification endpoint using `TURNSTILE_SECRET_KEY`.
4. Sends a Resend email to `CONTACT_TO_EMAIL` from `CONTACT_FROM_EMAIL`. Subject: `Audio inquiry: <service interests> from <name>`. Body is the audio-inquiry template (plain text and HTML), rendering each form field on its own labeled line.
5. Reply-to header is set to the submitter's email.
6. Returns 200 with a small JSON success payload; the page swaps to a success state on the client.

### Origin policy and Turnstile hostnames

The audio inquiry endpoint's allowed-origin list adds `https://audio.thesuperhuman.us` alongside the existing software-site origins. The shared Turnstile site key (`PUBLIC_TURNSTILE_SITE_KEY` in `wrangler.jsonc`) must have `audio.thesuperhuman.us` added to its hostname allowlist in the Cloudflare Turnstile dashboard, or widget challenges will fail on the audio host. This is an operator-side configuration captured in the implementation plan's operator runbook.

### Why no approval gate

The resume-request flow uses approval tokens because it controls release of a private PDF. A booking inquiry has no payload to release; the email itself is the deliverable. Direct send is appropriate, matching the software-site contact form.

### Operator-side mailbox

Inquiries land in `kazon.wilson@thesuperhuman.us`, the existing inbox. If volume grows, a future change can route audio inquiries to a separate alias by adding `AUDIO_CONTACT_TO_EMAIL` to `wrangler.jsonc` vars; out of scope here.

## 7. Visual system

The audio site extends the existing editorial design language, not a parallel design system. CLAUDE.md's brand-voice rules (no em-dashes, no buzzwords, no hourly rates, no job-seeker framing) apply to all audio-site copy.

### Reused tokens (from `src/styles/global.css`)

- `--paper: #FBF8F2`
- `--ink: #0E0E0E`
- `--muted: #4A4A4A`
- `--rule: #E8E3DA`
- `--accent: #AE5534`
- Existing component classes: `.eyebrow`, `.display`, `.heading`, `.lede`, `.btn-primary`.

### New audio-site components

- `Hero` variant for the audio landing page (or a small `AudioHero.astro`).
- `TrackRow.astro`: one row per track, with the inline player, title, artist, year, role-tags, length, and notes line.
- `ServiceSection.astro`: section header, short service description, "Book a [service] engagement" CTA that scrolls to the booking form, then a list of `TrackRow` components for that service.
- `BookingForm.astro`: described in section 6.

### Cross-site footer link

The audio-site footer links back to `thesuperhuman.us` (the software-engineering side) with the label "Software engineering at thesuperhuman.us" so visitors who landed on `audio.` can find the other half of the business. The reverse link is out of scope for this spec; it will be added when the apex landing page lands.

## 8. About content and copy direction

Two copy blocks, both written during implementation:

- **Short about-the-engineer block on `/`** (two to three short paragraphs). Sits between hero and portfolio. Covers: working audio engineer through The Superhuman Group LLC, MTSU undergrad in audio production, the kind of artists you work with (independent and label-affiliated), how engagements work (fixed-price, async-first, project-scoped).
- **`/about` page.** Longer narrative. Career arc, gear honesty (RME Babyface Pro, Sennheiser HD 650s, UAD Luna, Pro Tools), how you approach a mix or master, revision policy, file-delivery expectations.

Copy will avoid em-dashes, hourly-rate language, and exclusivity clauses per CLAUDE.md. The "How I work with AI" section from the software site is not duplicated; AI is a software-side disclosure and is not relevant to audio engineering work.

## 9. Launch prerequisites (content)

The site can technically render with empty service sections, but launch requires real content per category:

- At least one published track example under each of: **Mixing**, **Mastering**, **Production**, **Recording**.
- One "featured" track surfaced near the hero, ideally a strong all-around example.
- Encoded MP3 files in hand for every published track.
- About-the-engineer copy approved by the operator before deploy.

Content prep runs in parallel with implementation and is the operator's responsibility. The implementation plan should treat content as an input, not produce it.

## 10. Out of scope (explicit deferrals)

The following are deliberately not in this project. Each could become a follow-up spec.

- The apex landing page at `thesuperhuman.us` and the move of the existing software site to `software.thesuperhuman.us`. Deferred to the follow-up infra project.
- Public track downloads, paid or free.
- Waveform rendering in the player.
- Per-track album art or cover imagery.
- A shared "now playing" persistent player bar.
- An admin UI for adding tracks. Git plus the upload script is the workflow.
- Analytics on play events.
- Third-party embeds (SoundCloud, Bandcamp, Spotify).
- Cross-site links from the software-site footer back to the audio site. Added when the apex landing page lands.
- A separate `bookings@thesuperhuman.us` mailbox. Reuses the existing inbox; can be split later by var change.

## 11. Open questions

None at design approval. Implementation-time questions to surface in the plan:

- Exact rate-limit window for `/api/audio-inquiry`; will mirror the existing contact endpoint unless there's a reason to diverge.
- Whether the upload script should also write a sample YAML stub. Cosmetic; deferred to plan.
