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
- PASS · Without scripting: six links and no "You" jack; the message line lands on a sentence under the board that says the site's forms need JavaScript and gives the address, shown once. The brief keeps its heading when a link names a path.
- PASS, with a limit · 200% text (root font size doubled, standing in for text-only zoom): at 320, 390 and 768px the page does not scroll sideways and nothing leaves the board; the resting plug sits past the "You" label. At 1280px the board's columns hold their text, breaking a long word inside it when it cannot fit, because no query follows the text size (the November 13 decision). The page still scrolls sideways there, from the header's "Work with me" button, which does the same on `/work` and Home on `main`; not changed here.
- UNVERIFIED · A second browser engine and a real phone. Touch was checked by emulating an iPhone 13 in Chromium, with real touch events for the drag.

### 4. Performance and resilience

- PASS · No new dependency, image or font. The page script is the switchboard and the existing contact form scripts; Turnstile loads only when the message line opens the form.
- PASS · A modifier click or middle click on a line, its jack included while the plug reaches toward it, opens it in a new tab as a normal link (the plug's handle lets clicks through while it reaches). A load the visitor stops leaves the board usable; leaving during the pause (Back, or a plain click on another link that leaves in this tab) cancels the pending put-through, while a link opened in a new tab or a mail link does not. Back and forward restoring the page (bfcache) puts the plug at rest and the lamps out; UNVERIFIED in a browser, because the dev server's websocket blocks the bfcache.
- PASS · No layout shift from the script: the board is laid out for the cable from the first paint (`@media (scripting: none)` removes the "You" jack and the cable's room). With the page script delayed by 1.2s, the cumulative layout shift was 0.014 at 390px and 0.030 at 1280px, down from 0.078 and 0.055 before this change. Accepted cost: when scripting is on but the page script fails to load, the board shows the hint, the "You" jack and the cable's room with no plug, and the message line does nothing; the same shows to visitors without scripting on browsers that do not support the `scripting` media feature (Safari before 17, Chrome before 120, Firefox before 113).

### 5. Forms and sensitive flows

- PASS · The contact form, its endpoint, validation, rate limit and Turnstile are unchanged; only the page that hosts it changed.
- UNVERIFIED · Delivery of a message sent from `/contact` in production.

### 6. Privacy, legal and measurement

- N/A · No new data, storage, cookie, processor or analytics.

### 7. Release and final QA

- See "Checks" below for type, test, lint, design, copy, asset and build results.
- UNVERIFIED · Production: deployment and live verification follow merge, which deploys.

## Checks

On `0d62305` plus the review fixes (local, Linux, Node 22, Chromium through Playwright):

- `pnpm run lint`: no findings. `pnpm run check`: 0 errors, 0 warnings (16 hints, all in files this change does not touch). `pnpm run build`: passes; `tests/architecture/client-bundle.test.ts` with `REQUIRE_CLIENT_BUNDLE=1`: 27 passed. `assets:check`, `copy:check`, `design:check` and `publicist:gate`: pass. `/contact` is in the built sitemap.
- Tests for this change: `tests/scripts/brief-flow.test.ts` (with new cases that fail without the brief fix), `tests/scripts/pinned-contact.test.ts`, `tests/components/closing-panel.test.ts`, `tests/lib/contact-turnstile.test.ts`, `tests/scripts/screenshots.test.ts`, and `tests/architecture`: pass.
- Full `pnpm test` in this container: 79 files fail (the golden corpus harness, `tests/security/review-race.test.ts` and `tests/scripts/publication-journal-trace.test.ts`). The same files fail with the same counts on an untouched checkout of `origin/main` in the same container: a race trigger declared by the harness never fires in its emulated database here. CI on GitHub is the record for those.
- CI on the pull request: see the pull request's checks for the head that merges.

## Reviews

Two independent review agents read the diff, with Codex's code and security reviews on the pull request.

- Codex (code and security, head `1b89ea1`): no findings.
- Correctness and security review: no security findings. Fixed: a press on the jack under the reaching plug landed on the drag handle and did nothing; a stopped load left the board busy; the pending put-through was not cancelled when the visitor left first; following `/contact#message` lost focus on the form's heading; and a browser that restores form state on reload could skip the brief's choice screen (the brief now reads the path the link named from the page, `data-linked-path`).
- UI, copy and rules review, with the Hallmark audit below.

## Hallmark audit

Run read-only on `/contact` (`contact.astro`, `Switchboard.astro`, `switchboard.ts`), Home's contact section and the footer's pinned button, against `design.md`.

Defects, fixed in this pull request:

- Enlarged text broke the narrow board (the hardware column, gaps and padding grew with the text, and long words ran past the border) and put the resting plug on the "You" label. The hardware column is 40px, the padding is capped by the viewport, words may break when they cannot fit, and the resting plug is placed from the label's measured edge.
- The "Prefer email?" address did not wrap at enlarged text. It may break now.
- Dragging the plug past an edge widened the page. The plug is drawn inside the board; which jack is in reach is measured from the pointer itself, so a drag off the edge cancels instead of snapping.
- Without JavaScript the message line led nowhere. It lands on a sentence right under the board that says the site's forms need JavaScript and gives the address; the "Prefer email?" line hides then, so the address shows once.
- "Prefer email?" showed twice while the form was open. The page's line hides while the form is open.
- The Turnstile retry message said to reload, which would close the form and lose what was typed. It says to choose Send a message again, which retries.

Also fixed, restoring the shared system: the lines take the site's standard focus ring (2px offset); the lede uses ink like every other page; the reach toward a line has no overshoot (the seat and the drop keep a slight one); and the board no longer moves when the script arrives (above). The brief no longer flashes its choice screen before moving to the first question when a link names the path (the stylesheet keeps the choice screen out of sight until the script has moved past it, and without scripting it shows with the page's heading); this was true of every path link before this change. The brief's starting step also follows the path the link named, not a radio the browser restored.

A further independent review of the fix commits found seven more issues, fixed here: a modifier click on a reached jack navigated this tab; clamping the drag point made a drag off the left edge snap to a jack; a new-tab or mail link clicked during the pause stranded the board; the brief had no heading without scripting when a link named a path; the no-script sentence repeated the address and said the other lines work without JavaScript, which they do not; and the brief's starting step still read a restored radio. The seventh, the board when its script fails, is the accepted cost above.

Design choices for Kazon (not changed):

1. From 1100px the six columns wrap each title to two lines and the descriptions run 13 to 17 characters a line at 1280px (6 to 10 at 1100px). A: as built. B: the side layout up to about 1400px. C: a 3 × 2 grid with the cable hanging between the rows.
2. Home's first phone screen now has two filled pills, "Start a project" and the pinned Get in touch. A: as built. B: show the pinned button only after the hero's button has scrolled away. C: no pinned button on Home, since its contact section has its own button.
3. Home's contact line ("Ideas, opportunities, or a conversation worth having.") no longer says what the button opens, and the direct "Email me" moved to `/contact`. A: as built. B: a line naming the choices, such as "Send a message, request my resume, start a song or plan a project."

False positives: no Hallmark stamp (this site carries none by design); gate 47, because the patch bay draws hardware, not browser chrome; gates 22 and 48, the site's recorded departures; gate 24, spacing that matches the rest of the site; gate 3, six text cells with no icon tiles.
