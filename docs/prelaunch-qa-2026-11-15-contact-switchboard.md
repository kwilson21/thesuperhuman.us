# Get in touch switchboard (release gate)

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/gracious-tesla-d3kwb2`, cut from `origin/main` at `7beca02`
Target: production `https://thesuperhuman.us` after merge. The new page is on the main host; the footer and phone menu also render on `audio.thesuperhuman.us`, where their Get in touch links leave for the main host.
Decisions and merge authorization: Kazon Wilson. The code was written with Claude Code; Kazon reviews the pull request. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `7beca02` (`origin/main` when the branch was cut). Re-check `origin/main` at merge time. The change adds no migration, binding, dependency or stored data.

## Owner request

November 15, 2026, in conversation (quoted in `design.md`): why Home had no Get in touch button; a screen where visitors quickly choose to send an inquiry, request the resume, start a song, or plan a website or discuss a project; the project buttons making the selection "if that makes sense"; and "Please be very very creative in re-envisioning this, let's make it fun for the user to make their selection".

Why Home had no button: the November 12 closing panel decision made Home a quiet page, because the Get in touch button pointed at Home's own contact section (`/#contact`). The button now opens `/contact`, so Home carries it too.

## Scope

- `src/pages/contact.astro`, `src/components/Switchboard.astro`, `src/data/contact-lines.ts`: the new page. Six lines, each a plain link: the message form on the same page, About's resume request, the song intake, and the project brief at `?path=website`, `?path=webapp` and `?path=workflow`.
- `src/scripts/switchboard.ts`, `src/scripts/contact-page.ts`: the cable, plug, lamps and drag; the message line opens the form instead of navigating.
- `src/scripts/contact-message.ts` (was `home-contact.ts`): the message form's lazy Turnstile loader, now opened by the message line.
- `src/pages/index.astro`: the contact section keeps its horizon and copy and ends on a Get in touch button; the contact form and "Email me" button moved to `/contact` ("Prefer email?" there); the footer stays quiet and asks for the pinned phone button.
- `src/components/Footer.astro`, `src/scripts/pinned-contact.ts`: the default button path is `/contact`; a `pinned` prop; the pinned button also steps aside for `[data-pinned-end]` (Home's contact section).
- `src/components/SiteNav.astro`, `src/layouts/ServiceSheet.astro`, `src/layouts/ProjectLayout.astro`, `src/pages/software/start.astro`, `public/email/signature.html`: Get in touch links go to `/contact`. An installed email signature keeps its old `/#contact` link until it is reinstalled; that link still lands on Home's contact section.
- `src/scripts/software-inquiry.ts`: a link that names a brief path opens at the first question even when the saved draft was left on the choice screen. Before, once a visitor pressed Back to the choice screen, every later "Plan your website" link opened "What are you working on?".
- `design.md`, `docs/website-content-model.md`: the rules and the owner request.
- Tests and screenshots: `tests/components/closing-panel.test.ts`, `tests/scripts/pinned-contact.test.ts`, `tests/lib/contact-turnstile.test.ts`, `tests/scripts/brief-flow.test.ts`, `tests/scripts/screenshots.test.ts`, `scripts/screenshots/config.mjs` (the `contact` page) and the scenario `scripts/screenshots/scenarios/contact-switchboard.mjs`.

## Checklist

### 1. Purpose and content

- PASS · Project, branch and instructions: this repository, the branch above, `CLAUDE.md`, `AGENTS.md`, `design.md`.
- PASS · Truthful copy: each line says what the visitor does and who does what, checked against the form it opens (resume requests are reviewed before delivery; the song intake takes vocals and a beat for mixing or a mix for mastering; the brief paths' own descriptions). No price, timing or availability claim was added.
- PASS · First screen and CTA: the board is in the first screen at 1280 × 800 and 390 × 844; Home's button and the pinned phone button open `/contact`.
- PASS · Contact routes: every line opened its form in the local preview (message form on the page; `/about#resumes` with the disclosure open; `/audio/start`; each brief path at its first question).
- N/A · Resume and professional claims: no professional fact changed.

### 2. Search and sharing

- PASS · Title "Get in touch · Kazon Wilson" and its own description.
- UNVERIFIED · Sitemap and canonical for `/contact` on the built site (see section 7).
- N/A · Open Graph image: the page uses the site's default card, like the other pages without their own.

### 3. Accessibility and responsive behavior

- PASS · One `h1`; the board is a list of links; the drawing, plug handle and "You" jack are `aria-hidden`; the message form keeps its labels and status region; focus moves to the form's heading when the message line opens it.
- PASS · Keyboard: Tab reaches each line, focus shows the 2px accent outline and the plug reaches toward it; Enter connects.
- PASS · Widths: 320, 375, 414, 768, 1099, 1100 and 1440 px, with `scrollWidth` equal to the viewport at each.
- PASS · Reduced motion: the plug moves without animating and the page changes at once (measured 389 ms to the next page, which is the load itself).
- PASS · Without JavaScript: six links and no "You" jack; the message form says it needs JavaScript and the email address is shown.
- UNVERIFIED · 200% text, a second browser engine and a real phone.

### 4. Performance and resilience

- PASS · No new dependency, image or font. The page script is the switchboard and the existing contact form scripts; Turnstile loads only when the message line opens the form.
- PASS · A modifier click or middle click on a line opens it in a new tab as a normal link; back and forward restore the board with the plug at rest and the lamps out.

### 5. Forms and sensitive flows

- PASS · The contact form, its endpoint, validation, rate limit and Turnstile are unchanged; only the page that hosts it changed.
- UNVERIFIED · Delivery of a message sent from `/contact` in production.

### 6. Privacy, legal and measurement

- N/A · No new data, storage, cookie, processor or analytics.

### 7. Release and final QA

- See "Checks" below for type, test, lint, design, copy, asset and build results.
- UNVERIFIED · Production: deployment and live verification follow merge, which deploys.

## Checks

To be completed with the results on the pushed head.

## Hallmark audit

To be completed after the audit on the pushed head.
