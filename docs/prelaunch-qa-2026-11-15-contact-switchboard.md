# Get in touch switchboard (release gate)

Date: November 15, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/gracious-tesla-d3kwb2`, cut from `origin/main` at `7beca02`
Target: production `https://thesuperhuman.us` after merge. The new page is on the main host; the footer and phone menu also render on `audio.thesuperhuman.us`, where their Get in touch links leave for the main host.
Decisions and merge authorization: Kazon Wilson ("looks good merge ASAP", in conversation, November 16, 2026). The code was written with Claude Code; Kazon reviews the pull request. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `9eecc5e` (`origin/main` at merge time, merged into the branch at `b903f42`; the branch was cut from `7beca02`). The change adds no migration, binding, dependency or stored data.

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
- November 16, at the owner's request ("Are there any other screens that are missing the get in touch button?"): `src/pages/privacy.astro`, `src/pages/404.astro` and `src/components/audio/AudioFooter.astro` (Audio, Portfolio, Releases, Services and each song page) end on the closing panel's Get in touch button; `src/pages/audio/start.astro` stays quiet. `src/scripts/pinned-contact.ts`: the pinned phone button steps aside while any other filled button in the page is on screen, and starts aside until its first report.
- Tests and screenshots: `tests/components/closing-panel.test.ts`, `tests/scripts/pinned-contact.test.ts`, `tests/lib/contact-turnstile.test.ts`, `tests/scripts/brief-flow.test.ts`, `tests/scripts/screenshots.test.ts`, `scripts/screenshots/config.mjs` (the `contact` page) and the scenario `scripts/screenshots/scenarios/contact-switchboard.mjs`. The `home-contact` scenario that `main` added on November 16 (the contact form's check-before-send hold) is now `contact-hold`, captured on `/contact` after the message line opens the form, because the form no longer lives on Home.

## Checklist

### 1. Purpose and content

- PASS · Project, branch and instructions: this repository, the branch above, `CLAUDE.md`, `AGENTS.md`, `design.md`.
- PASS · Truthful copy: each line says what the visitor does and who does what, checked against the form it opens (resume requests are reviewed before delivery; the song intake takes vocals and a beat for mixing or a mix for mastering; the brief paths' own descriptions). No price, timing or availability claim was added.
- PASS · First screen and CTA: the board is in the first screen at 1280 × 800 and 390 × 844; Home's button and the pinned phone button open `/contact`.
- PASS · Get in touch on every public page except `/contact` and the two intake forms: in the local preview the closing button opens `/contact` on Privacy, the 404, Audio and Audio services; on a 390 × 844 phone the pinned button is aside on Home's first screen, the 404 and Audio's first screen (each has its own filled button in view) and shows once that button has scrolled away. The song intake's quiet panel is checked by `tests/components/closing-panel.test.ts`.
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
- PASS · A modifier click or middle click on a line opens it in a new tab as a normal link. On the jack under a reaching plug, a click with a modifier key held passes through to the link, and a middle click opens the line in a new tab through the script (Chromium and Firefox put that tab in front, where a native middle click would open it behind). A right click on that jack shows the page's menu, not the link's; the line's title and text still give the link's menu. A load the visitor stops leaves the board usable; leaving during the pause (Back, or a plain click on another link that leaves in this tab) cancels the pending put-through, while a link opened in a new tab or a mail link does not. Back and forward restoring the page (bfcache) puts the plug at rest and the lamps out; verified in Chromium with the back-forward cache enabled and the dev server's websocket closed.
- PASS · The cable's motion (owner request, in conversation: "hopefully the cables actually shake as you move them"): a chain of 16 links under gravity, pinned at both plugs, stepped at 120 Hz with friction. It waits straight until your jack is well inside the window, then drops into its hang; with reduced motion it is drawn at rest. After a corner-to-corner drag the animation stops 1.9s after release at 1280px and 1.7s at 390px, and 1.3s and 1.2s after seating the message line (measured). A change of layout (a resize, fonts arriving) lets the cable swing to its new ends instead of re-laying it (0.1px first-frame move for a 1px resize), and on a narrow board its length eases between the two resting shapes, so it never shortens with a jerk as the plug passes your jack's row (1.5px largest move per 1px of plug travel). Recorded on video at 1280 × 800 and on an emulated iPhone 13 (mouse and touch drag, shaking, release, connect).
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
- After merging `main` at `9eecc5e` (`b903f42`): lint has no findings, formatting is clean, and `tests/scripts`, `tests/components`, `tests/lib` and the client graph test pass except `tests/scripts/publication-journal-trace.test.ts`, which needs the Quint evaluator download this container cannot reach.
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

A third review found that letting clicks through the handle while the plug reached toward a line stopped a mouse from picking up the plug there. The handle now catches presses again (so a still press on that jack seats the plug, and a press and drag carries it), and lets a click through only while a modifier key is held; a middle click on it opens the line in a new tab. It also found that a back-forward restore could leave the reach state on, and that a same-page fragment link during the pause cancelled the put-through without leaving; both are fixed. The lines are `draggable="false"`, so a press on a line while the plug is still flying never starts the browser's own link drag. Browsers without the `scripting` media feature still flash the brief's choice screen on a linked path.

Owner feedback on the branch preview (in conversation, 2026-11-15): "The preview is very laggy and the plug is off by a few pixels". The plug had been drawn 4px left of and 7px above the jack it reached toward, as a lift; it now sits square over the jack (measured 0.00px off when reaching and when seated) and shows the lift by size and shadow. A carried plug had followed the pointer through a spring and trailed it; it now stays under the pointer, and keeps its speed when let go. The reach is quicker (about 0.15s), and the animation frames read no layout from the page: positions are measured when the board's layout changes. The loop stops at rest in every state checked (rest, reaching each line, seated), so nothing runs in the background.

A fourth review, of the physics commit, found: the drop could start while the cable was still below the fold (the observer watched the board's top edge) and the first frame showed the final hang before laying it straight; a narrow board's cable length jumped by 8 to 11 percent when the plug crossed 36px above or below your jack; a layout change re-laid the cable in its drawn curve, a visible snap that then stayed frozen; and the records overstated how fast the motion settles. All are fixed (measured above). It also verified the back-forward restore in Chromium with the cache on: the plug returns to rest with the lamps out.

A fifth review found that the quicker reach spring, stepped once per frame, became unstable at about 30 frames a second, the rate battery savers hold animation to: the plug flew off the page and the loop never stopped. A sixth review found that the first fix, fixed 1/120s steps with the remainder carried to the next frame, stalled and jumped on 90, 144 and 165 Hz displays (an uneven number of steps per frame), and that its test did not run the code the page runs. Each frame of the plug is now split into equal steps near 1/120s (a frame a little over a whole number of steps keeps that number, so a 60 Hz display's 16.6 and 16.7 ms frames both take two). `tests/scripts/switchboard-spring.test.ts` drives `advancePlug`, the frame update the page calls, at 30, 60, 90, 120, 144, 165 and 240 frames a second: the reach never overshoots, never stalls and never jumps (each frame past the fastest moves no further than the one before), the seat overshoots slightly, and both stop; it fails on the once-per-frame step and on the carried remainder. In Chromium with frames held to 33.4ms the plug reaches the jack in about 0.3s and stays there; at 144 and 90 Hz no frame stalls while it moves; the loop stops in every state.

A seventh review found that giving the cable the same equal steps broke it: its resting shape depends on the step, so frame times that varied (dropped frames, jitter near a step boundary, random frame lengths) kept nudging it and the loop never stopped, and a frame a few hundredths of a millisecond long followed by a normal one flung a resting cable 10 to 86px. The cable is back on exact 1/120s steps with the rest of the frame carried to the next one, in an exported `advanceChain`. `tests/scripts/switchboard-cable.test.ts` runs it under steady 60 and 144 Hz, 53.3 Hz with 0.15ms of jitter, random 5 to 40ms frames, 90 Hz with three frames in ten dropped, alternating 7 and 25ms, and 60 Hz with a second callback 0.02ms after some frames: it rests within three seconds in each, in the same shape (within 0.05px after eight seconds), and a near-zero frame moves a resting cable less than 0.5px; the equal-step cable fails five of these. In Chromium the loop stops in every state, the cable settles 1.1 to 1.9s after a release or a seat, and the plug still moves evenly at 144 Hz and stays stable at 30.

An eighth review found that with the plug moving evenly and the cable stepping on its own clock, the cable moved unevenly at 90 Hz (a frame held one step or two) and froze on the frames that fell between its steps at 144, 165 and 240 Hz while the plug moved on, stretching its last link to 3 to 5 times its length for a frame; and that the loop could stop after a small drag before the cable had stepped toward the new end. Each cable step now pins the plug's end where the plug was at that step's moment (between the last frame's end and this one's), the cable is drawn carried forward by the part of a step that has passed (`drawnChain`, which never changes the cable's state, so its resting shape is unchanged), and a new target counts as motion until the cable has stepped. The cable test now also drives a steadily moving plug at 60, 90, 120, 144, 165 and 240 Hz and requires each drawn frame to move the cable's middle within 5 percent of its neighbours' average; it fails without either of the two changes. In Chromium on a virtual clock the drawn cable moves on every frame of a fast reach at 90, 144 and 240 Hz, and the loop stops after every action at 90, 144 Hz, 33.4ms frames, 120 Hz with jitter, random 5 to 40ms frames and 60 Hz with a doubled callback, in 1.2 to 2.8s.

A ninth review, of that commit, found that the eighth review's record overstated one result: the cable's own last link stayed at its length, but the drawn one did not. The cable's end is pinned where the plug was at its last step, and a cable at rest has no speed to carry it on, so as the plug set off the drawn last link stretched to 1.5 to 7 times its length for one to three frames at 90 to 240 Hz, worst at 120 Hz in some phases of the frames against the cable's steps. It also found that a layout change mid-reach drew the cable flung out to ten times its length for a frame or two (the plug was put in place but the cable's end was then dragged along a path the plug never took, and the first step's leap was carried on in the drawing), and that a sharp stop or reversal at 144 or 240 Hz folded the last link for a few frames. A first fix (`e69693c`) pinned the cable's end where `settle()` put the plug, capped how far a link was drawn ahead at 20px, and pulled each drawn link in from the plug.

A tenth review, of that fix, found it made fast reaches worse: the pull-in carried the plug's lag back along the cable into its first link (2.7 to 4 times its length) and made the cable lurch up to 35px and snap back at 144 to 240 Hz, and the cap switched on and off through ordinary reaches, whose plug peaks near 9,000 px/s, far above the 2,400 px/s it assumed. It also found the set-off test could only fail if the pull-in was removed. Both were replaced. The drawing now carries every point on as before, then spreads the difference between the cable's carried ends and your jack and the plug along the cable, all of it at the end it belongs to and none at the other (`drawnChain`); a step records its ends' last places so they carry like the rest. A layout change moves the whole cable with its ends (`shiftChain`, called by `settle()`), its speed kept, so its first step drags nothing hundreds of pixels. In the reviewer's simulation of a far reach and back at 60 to 240 Hz: the drawn last link is at most 1.63 times its length (the parent 6.19, the first fix 1.00) and the first at most 1.31 (1.35, 4.15); the drawing stays within 25px of where the cable is between its steps (27px, 57px), with at most 8.2px back against its motion (8.3px, 30.7px). In Chromium on a virtual clock: the last link peaks at 1.2 to 1.8 times its length as the plug sets off at 90 to 240 Hz; after an idle resize from 1280 to 390px the drawn cable is 114px long against its 111px rope (391px before), and after a resize mid-reach 254px (467px with the first fix). The cable test now drives a spring reach from rest across the board at 90 to 240 Hz and holds each drawn link to under 2.5 times the cable's own, and at 144 Hz and up each drawn point to within 30px of where the cable is between its steps; and it moves the ends with `shiftChain` and holds every drawn link to under 2.5 times its length. The parent's drawing fails five of these tests, the first fix fails four, and a `shiftChain` that only pins the end fails the layout test.

Design choices for Kazon. On November 16 Kazon answered "idk how to answer the other design choices", so the builder chose (recorded in `design.md`, for review on the pull request): 1 A, 2 B (by a general rule: the pinned button steps aside while any other filled button is on screen) and 3 A.

1. From 1100px the six columns wrap each title to two lines and the descriptions run 13 to 17 characters a line at 1280px (6 to 10 at 1100px). A: as built. B: the side layout up to about 1400px. C: a 3 × 2 grid with the cable hanging between the rows.
2. Home's first phone screen now has two filled pills, "Start a project" and the pinned Get in touch. A: as built. B: show the pinned button only after the hero's button has scrolled away. C: no pinned button on Home, since its contact section has its own button.
3. Home's contact line ("Ideas, opportunities, or a conversation worth having.") no longer says what the button opens, and the direct "Email me" moved to `/contact`. A: as built. B: a line naming the choices, such as "Send a message, request my resume, start a song or plan a project."

False positives: no Hallmark stamp (this site carries none by design); gate 47, because the patch bay draws hardware, not browser chrome; gates 22 and 48, the site's recorded departures; gate 24, spacing that matches the rest of the site; gate 3, six text cells with no icon tiles.
