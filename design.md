# Design · thesuperhuman.us

Locked design system for Kazon Wilson's personal website, in Hallmark's `design.md`
format. Hallmark reads this file first; every page defers to it, and pages share
the system instead of varying. Amend it on purpose, after an owner decision; the
file is the rule. Process rules (audits, triage, image QA, copy) live in
`CLAUDE.md`, `AGENTS.md` and `docs/design-standard.md`, and they take precedence.

## Context
- Audience · curious visitors, potential collaborators, recruiters and hiring managers.
- Use case · meet the person, assess the evidence of work, get in touch. Each page's
  job is in `docs/website-content-model.md`.
- Tone · editorial and quiet: "Peace is the atmosphere, curiosity is the invitation,
  and confidence is the impression" (`docs/website-system-plan.md`).

## System
- Genre · editorial
- Macrostructure · none from Hallmark's catalogue; the site's own page families (below)
- Theme · custom (vibe: "quiet studio on warm paper, terracotta accent")
- Axes · light paper (oklch L 98%) / serif, roman (Libron Regular) / warm accent (hue 40)

## Tokens (canonical · `src/styles/global.css` is the source of truth)
```css
:root {
  --paper:  #FBF8F2;  /* oklch(98.0% 0.009 85) */
  --ink:    #0E0E0E;  /* oklch(16.4% 0 0)  18.2:1 on paper */
  --muted:  #4A4A4A;  /* oklch(40.9% 0 0)   8.4:1 on paper */
  --rule:   #E8E3DA;  /* hairlines only, 1.2:1 */
  --accent: #AE5534;  /* oklch(55.3% 0.126 40)  4.78:1 on paper, and paper on accent */
  --field-border: color-mix(in srgb, var(--muted) 65%, var(--paper)); /* 3.4:1, field edges */
  --panel: color-mix(in srgb, var(--rule) 50%, var(--paper)); /* the closing panel and door art: the one soft surface */
  /* on --panel, ink is 16.5:1, muted is 7.6:1, accent is 4.3:1 (focus rings and non-text only; no accent text on the panel) */
  --radius-panel: 32px;  /* closing panel corners */
  --radius-button: 999px; /* every button is a pill; fields, pictures and cards keep 3px or their own corners */

  /* @theme: Tailwind maps --color-paper/ink/muted/rule/accent to the above. */
  --font-serif: 'Libron', 'Iowan Old Style', Georgia, serif;     /* display, body */
  --font-sans:  'Inter', system-ui, -apple-system, sans-serif;   /* labels, private UI */
  --font-mono:  'JetBrains Mono', 'SF Mono', Menlo, monospace;   /* code, two places */
  /* Name mark: 'Kazon Name Text' / 'Kazon Name Display', cut from Libron (.personal-name). */

  --container-measure: 38rem;  --container-content: 42.5rem;  --container-page: 64rem;
  --measure-prose: 33rem;      /* running prose, about 65 characters of Libron */
  --site-gutter: clamp(1.5rem, 5vw, 3.5rem);
  --site-section-space: clamp(3rem, 6vw, 5.5rem);
  --space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem;
  --space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem; --space-10: 2.5rem;
  --space-12: 3rem; --space-16: 4rem;  /* 4px steps, numbered like Tailwind */
  --tracking-eyebrow: 0.1em;   /* labels move to .12em with D4.2-C */

  --ease-site: cubic-bezier(.2, .7, .2, 1);  /* the one easing */
  /* From the October 22 picks (#209):
     --dur-hover 160ms, --dur-page 180ms, --dur-reveal 600ms, --rise-reveal 12px
     (D3.4-C); --site-rule-space, 48px on a computer and 40px on a phone, and
     --site-chapter-space, 128px on a computer and 112px on a phone (D6.5-C). */
}
```
New colours are named tokens. Illustrations may keep local colour tokens in their own
component (`--ill-*`, `--code-*`, the switchboard's `--sb-*`); declarations reference tokens,
never raw hex.
The publishing consent page (`src/lib/publication/oauth-login.ts`) is a standalone page with its own
Content-Security-Policy, so it inlines the tokens as literals and loads Libron from the site's own font
files; a test checks those literals against `global.css`.

## Typography
- Libron (`--font-serif`) sets headings, body and public interface text at 14px or
  more (D4.4-B). Headings stay Regular 400; size carries the hierarchy (D4.5-A). The
  release masthead uses Libron Bold (D8.1-B). Agreement and offer pages and the
  signed PDF's headings use Libron too (D9.3-C).
- Small capital labels: Inter 500, 11px, .12em tracking (D4.2-C). Owner, studio and
  agreement pages keep Inter for interface text (D4.4-B).
- JetBrains Mono only on Home's code field and its capacity key (D4.2-C).
- Three families at most: Libron (the name mark counts as Libron), Inter, JetBrains Mono.
- Body 16px / 1.6. Roles in `global.css`: `.page-title` clamp(3.25rem, 6.5vw, 5.4rem)
  / 1.02, `.page-lede`, `.display`, `.heading`, `.lede`, section `h2` clamp(1.75rem,
  3vw, 2.25rem). Headings balance; prose wraps `pretty`. One exception: the closing panel's LLC
  line balances (Nov 13 decision). Roman headings only.
- Header wordmark and footer name are both 24px (D10.3-B).
- Punctuation: curly quotes and apostrophes (D10.5-B), `·` as the separator in
  statuses and metadata (D10.7-B), and no em dashes anywhere.

## Layout
- `.site-shell` (max 1232px, `--site-gutter`) holds every page. Prose stops at
  `--measure-prose`; opened experience rows on /work hang from the Role column at
  that measure (D10.2-C).
- Sections are separated by `--site-section-space`, with one named
  `--site-chapter-space` break per page before the part that changes job (D6.5-C).
- Project titles land on the same line as /building: top clamp(2rem, 5vw, 4rem),
  bottom clamp(2.5rem, 5vw, 4rem) (D6.4-C).
- Section headings: `h2` followed by a hairline rule, at rest (D3.2-B).
- Labels must add a fact their heading does not (D4.1-D). Page kickers sit above the
  title; service-section labels sit directly under their heading at every width
  (D7.2-C). Never beside a heading.
- Project statuses are accent-dot lines in their stored sentence case (D4.1-D).
- Numbered steps: hanging numerals in one list (D7.1-C); Threadline's steps use the
  study's stepper, accent circles joined by a hairline (D6.3-C).
- Every page with the shared footer ends on the closing panel (`--panel`,
  `--radius-panel`). It is the site's one soft surface; no other panel, card or field
  takes a large radius without an owner decision.
  On invitation pages the panel holds one "Get in touch" button, the footer links and the
  LLC line. On quiet pages it holds the name mark, the footer links and the LLC line.
- Every Get in touch button and link goes to the switchboard at `/contact`.
  Home keeps its horizon and contact copy; its bottom button lives in the shared footer.
- Every public page with the shared footer is an invitation page except the contact
  switchboard and the two intake forms, which are quiet. Private task pages remain quiet.
- Pinned contact button: the only element fixed over page content. On invitation pages,
  at 600px wide and below, a full-width Get in touch pill stays at the bottom of the
  screen through all sections, including other filled buttons. It steps aside when the
  shared footer enters view and returns when the footer leaves. It also hides while
  the phone menu is open or a form field has focus. The contact handoff uses a brief
  token-timed fade with a 4px settle only when reduced motion is not requested,
  and never shows above 600px, in print or without JavaScript.
- The switchboard (`/contact`, `Switchboard.astro`) is a patch bay drawn in the site's
  hairlines: rack ears with screws, a lamp over each jack, and the visitor's own "You"
  jack. Each line is a plain link to the form that fits; the three project lines open the
  brief with its path already chosen. From 1100px wide the lines are six columns, title and line over
  lamp and jack, and the cable hangs below them; narrower, the board turns on its side
  and the jacks run down the left. It is laid out for the cable from the first paint, so
  nothing moves when the script arrives; without scripting it is the six links, with no
  "You" jack. It takes the 3px corner of fields and pictures, not the panel radius.
- At 380px wide and below a button label may wrap (reflow, WCAG 1.4.10); wider than
  that it stays on one line. The publishing consent page's button is the exception: its
  label wraps at any width, because that page cannot use a width query that follows text
  size, and the label must stay inside the pill when text is enlarged. The closing panel's
  large button is a second exception: its label wraps at any width when it does not fit, so
  enlarged text reflows inside the panel; at the default text size it stays on one line.
- The Work diagram's flow wraps by content: its parts share a row 1 : 1.2 and stack when the
  row cannot hold their longest word, so enlarged text reflows instead of scrolling sideways
  (WCAG 1.4.10). A word breaks inside itself only when it cannot fit a line. The large
  button's and the phone closing panel's side padding are capped by the viewport
  (`min(1.75rem, 8.75vw)`, `min(1.25rem, 6.25vw)`), and the footer's side gutter is capped
  too (`min(var(--site-gutter), max(24px, 7.5vw))`). Each cap equals its rem value at 320px
  wide and above at the default text size; the `max(24px, …)` floor keeps the footer's gutter
  at its default value below 320px. The footer's side gutter stops growing with the text,
  which gives the closing panel room for its button when text is enlarged.

## CTA voice
- Primary · `.site-button`: accent fill, paper text, 1px border, pill (`--radius-button`),
  44px minimum height, one line; on a fine-pointer hover, ink fill. Large size,
  `.site-button-large`, 52px, in the closing panel and the pinned contact button only.
- Secondary · `.site-button-outline` (transparent, ink text, also a pill) or `.site-link`: ink
  text, accent rule about 4px under the baseline, accent arrow, 44px tap area
  (D8.4-C).
- Running links · ink with a 1px accent rule; accent on fine-pointer hover.

- On the closing panel, footer links are muted and turn ink on a fine-pointer hover; accent is not used for text there (4.3:1).

## States
- Focus · `outline: 2px solid var(--accent)` with a 2px offset on `:focus-visible`,
  shown at once, never animated.
- Hover · only inside `(hover: hover) and (pointer: fine)`; one signal per element
  (D2.2-B: project cards keep their lean and resting glow; the glow does not grow).
  On the switchboard the signal is the plug reaching toward the line, or the lamp
  warming when the script has not drawn the cable.
- Active · opacity .78 on links, buttons, summaries and sliders.
- Fields · 1px `--field-border`, paper fill, 3px radius, 16px text; invalid shows
  the accent edge with an error message in text; disabled is opacity .5 with a
  not-allowed cursor and the native attribute.
- Messages slide open over 180ms on `--ease-site` and fade in; with reduced motion
  they appear at once; a message never pushes a primary button off a screen it was
  on (D9.2-D).

## Motion stance
- Static composition first: with reduced motion, without JavaScript or in print,
  every page shows its finished frame. Motion lives inside
  `prefers-reduced-motion: no-preference`.
- `[data-reveal]` blocks rise in once (D3.1-A), 600ms and 12px (D3.4-C).
- Home's three crossings and the About path follow the scroll. The four drift layers
  stop: the studio picture no longer lifts or leans toward the pointer, and the code
  rows, notebook and terrain sit still (D2.1-D). Nothing else drifts or parallaxes.
  The project-card lean on Home is a hover state, kept by D2.2-B (see States).
- Home's waveform edge draws the newest released song. While the A/B comparison plays,
  the edge rises and falls with the music's level and a ring of light around the
  horizon sun glows with it; both rest when the music stops, and only a visitor's
  Play starts them (owner decision, 2026-11-15, PR #320).
- Building drawings arrive with their row, then play once in reading order (D3.3-C).
- A caret appears only after typed text (D2.4-C). The essay pen stroke sits 3 to
  5px under "Direction" (D3.5-B).
- Anything that plays on its own rests within five seconds. Page cross-fade 180ms.
- The switchboard's plug sits square over the jack it reaches toward or seats in; a lifted
  plug shows the lift by its size and shadow. Reaching toward a line on hover or focus
  arrives in about 0.15s with no overshoot; seating or dropping it overshoots a touch,
  like a plug clicking home, and settles in about half a second. A carried plug stays
  under the pointer. Its lamp strikes twice in 420ms. The cable is a chain under gravity
  pinned at both plugs, so it whips and sways as the plug moves; the first time the
  board's "You" jack comes into view it drops from straight into its hang. Each settles
  within three seconds; a change of layout lets the cable swing to its new ends. With reduced motion the cable is drawn at rest and never swings. A chosen line navigates 560ms after the click so the lamp can
  be seen; with reduced motion the plug moves without animating and the page changes at
  once.

## Page families
From `docs/website-system-plan.md` (Templates and explanations): Home, Work,
Building, Writing and About indexes · project detail · work story · article · audio.
Built since: the service sheets (the plan, Implemented boundaries) and the Work with me
hub (`docs/website-content-model.md`). This file records the rest, which the system plan
does not list: project briefs and intake, and the private owner, studio and agreement
pages. A new page reuses the nearest family. A new family is a design choice for the
owner.

## What pages MUST share
The palette, the three faces and the name mark, the header and footer, the CTA
voice, focus and field states, the section heading and its rule, the spacing
tokens and the motion layer (`src/scripts/scroll-scenes.ts`).

## What pages MAY differ on
Composition and illustration within their family (Home may be expressive; Work
makes evidence easy to assess), and scene choreography, which keeps its own
timings and local colour tokens.

## Where this site departs from Hallmark's defaults
- Kickers and labels that carry a fact stay (D4.1-D), overriding "eyebrows default
  off". Gate 54 still holds: a label is stacked with its heading, never beside it.
- No macrostructure, theme, nav or footer rotation for existing pages: the site
  keeps this one system, and the header is the one decided on September 26
  (`docs/audits/2026-09-26/website-simplification-audit.md`). No Hallmark stamp
  comments, no `.hallmark/log.json`, no root `tokens.css`; this file is the
  system reference.
- Hex tokens instead of OKLCH; neutral (zero-chroma) ink and muted greys (D4.3-A,
  gate 22).
- Regular-weight headings (D4.5-A); Inter for labels and private pages (D4.2-C,
  D4.4-B), though Hallmark lists Inter as a default to avoid.
- One easing, `--ease-site`, and 600ms reveals (D3.4-C), longer than Hallmark's
  420ms; scroll-linked crossings on Home and About (D2.1-D).
- Title padding about 1.1 times top to bottom (D6.4-C, gate 44 asks 1.3); even
  section spacing with one chapter break (D6.5-C, gate 9).
- Link rules sit about 4px under the baseline (D8.4-C, gate 35 asks 1 to 2px).
- Form messages push content when they open instead of reserving a line (D9.2-D,
  gate 39).
- The centred, symmetric premiere masthead on /music/old-news (D8.2-A, gate 6),
  with the lead column fitting the poster in the first screen (D8.3-D).
- The Kaillera-next drawing keeps its small browser windows, with a redrawn
  controller (D6.1-A, gate 47). Other drawings use no window chrome (D6.2-C).
- Generated or AI-edited imagery ships only after `docs/generated-image-qa.md`,
  including its "Reads as generated" check (D5.3-B). Hallmark's generation tiers do
  not replace it. The current studio and About art stay (D5.1-A).
- Punctuation and copy follow `CLAUDE.md`: no em dashes (overriding Hallmark's
  advice to use them), no buzzwords, no hourly rates, nothing implying a current
  clearance, and never a personal address. Gate 46 (no invented metrics) applies.
- Design-choice findings go to the owner as alternatives. They are never silently
  fixed, flattened or "brought into line"; only defects are fixed directly.
- The studio's labels and phone pins are frosted glass pills (owner decision, November
  15, 2026), against Hallmark's editorial default of no glass. They are overlays over
  the picture, the one case Hallmark's anti-patterns allow.

## Owner decisions (October 22, 2026)
All picks are quoted in `docs/design-concepts/README.md` ("Owner's picks"), with
the boards in `docs/design-concepts/2026-10-22/` (#206). Standing rules from them are
above; #209 built them.
One-time changes with no standing rule: D1.1-B and D1.2-C (door layout on Home and
/services), D2.3-A, D5.2 (the 404 shows B or D at random; B without JavaScript),
D5.4-B, D8.5-D, D9.1-B, D10.1-C, D10.4-A, D10.6-B. Deferred: D5.1-D (photographs
of the owner's own objects; recorded in `docs/website-system-plan.md`, Deferred
maintenance).

## Owner decisions (November 12, 2026)
Kazon chose the closing panel and pill buttons from the design options: "I really like B"
and "Pills on every button". The spec is
`docs/superpowers/specs/2026-11-12-closing-panel-and-pill-buttons-design.md`.

Kazon revised the panel after seeing the built pages: "it feels like there's two calls to action, I just want a simple get in touch button"; "The original one button only worked best"; and, for the pinned button, "Phones only".

## Owner decisions (November 13, 2026)
Kazon chose how the closing panel's legal line wraps on a narrow phone, from four options
shown side by side at 320px wide: "B" (balanced wrap). The line balances when it wraps and
is unchanged where it fits on one line.

When the closing button's label wraps to two lines at enlarged text, the arrow stays centred
beside both lines. Kazon chose it from two renders ("1 for sure", November 13, 2026). At a
doubled root the label is two lines from 320px to 430px wide (measured in the release
record). A width where it needs three lines is not yet approved and is an owner decision.

At enlarged text on phone widths the footer's side gutter stops growing, so the closing panel may sit wider than the content above it and the gap before the arrow may widen. Kazon accepted both from a render: "Yes, acceptable" (November 13, 2026).

Kazon chose to load Libron on the publishing consent page, so it matches the rest of the site: "We should def load libron" (November 13, 2026, after seeing the page with fallback fonts).

## Owner decisions (November 15, 2026)
Kazon's picks on the round-two decision page, given in conversation: frosted glass for the
studio's labels and for its phone pins, "Play Kaillera Next" for the controller's label, and
the Combo for its scene, with the note "Frosted glass looks the best but let's improve upon
what we have with that". Built from those picks and that note, and shown to Kazon in the
PR: paper glass that blurs the desk behind it, in pill corners like the buttons, with a
bright top edge, a hairline and a soft shadow; dark glass for the monitor's pin over its
screen; an accent dot on each pin; the headphones' pin near their top and the controller's
just above it, so both stay in view; plain paper where a browser cannot blur. Its colours are local tokens mixed from the
site's own (`--glass-*` in `src/components/Hero.astro`). The controller's pin is "Play",
and it opens the game itself at kaillera-next.thesuperhuman.us, its label ending in ↗ as a
link that leaves the site ("yes straight to the game").
Pointing at the controller or focusing it plays the Combo: the D-pad glints, then the four
face buttons light in turn, resting within two seconds.

Kazon asked why Home had no Get in touch button ("Why is the get in touch button missing on
the home page?") and for the button to open a chooser: "modify the button so we can instead
bring the user to a screen to let them quickly choose whether they want to send me an
inquiry, request my resume, start a song or plan their website/discuss their project", with
the project choices making the selection for the visitor "if that makes sense", and "Please
be very very creative in re-envisioning this, let's make it fun for the user to make their
selection". The switchboard, its patch bay look, and the split of "Discuss your project" into
its two briefs (web app, workflow) are the builder's answer to that request, recorded above
and waiting for Kazon's review on the pull request.

## Owner decisions (November 16, 2026)
Kazon asked, in conversation: "Are there any other screens that are missing the get in
touch button? Be sure to address those, idk how to answer the other design choices".
Privacy, the 404 and the audio pages (Audio, Portfolio, Releases, Services and each song
page) had the quiet panel; they now end on the Get in touch button. On the audio site it
opens the switchboard on the main site, whose song line leads back to the song intake. The
switchboard and the two intake forms stay quiet, since each is where Get in touch leads.

The builder's calls on the three design choices put to Kazon on November 15, for Kazon's
review on the pull request:

- The switchboard keeps its six columns from 1100px: at 1280px each line reads in four or
  five short lines, and the row is what makes it a patch bay.
- The pinned phone button steps aside while another filled button is on screen, so
  Home's first phone screen shows "Start a project" alone and the pinned button appears
  once it has scrolled away. The same rule hides it through Home's Work with me doors (three
  filled buttons) and covers the 404 and the audio pages.
- Home's contact section keeps its approved line ("Ideas, opportunities, or a
  conversation worth having."); the switchboard names the choices one click later.

## Variants
None. A page that needs something this file does not allow gets an owner decision
and an amendment here first.

## Exports
`src/styles/global.css` (Tailwind v4 `@theme` plus `:root`) is the source of truth.
Do not write `tokens.css`, DTCG or shadcn exports, or append them here. Another
project copies the tokens from `global.css` and writes its own `design.md`.

### Mobile contact consistency (November 16, 2026)

Kazon corrected the pinned button's section-by-section disappearance: “The get in touch
button should be at the bottom of the page and sticky on all pages that make sense on
mobile then disappear when we get to the footer”. This supersedes the earlier builder
choice to step aside for every filled button. Invitation pages keep the pinned action
throughout their content, hiding it only when the shared footer enters view (also while
the mobile menu or a focused form field needs the space). Home's horizon and invitation
copy remain, but its bottom Get in touch button is now in the same footer as other pages.
The new contact switchboard, its message form, software/song intakes and private task
pages remain quiet; they are already performing the action and must not link back to
themselves as a competing sticky CTA.


### Contact handoff refinement (November 16, 2026)
The owner requested a Hallmark audit and a smoother, consistently sized mobile
handoff. Both contact links share the same mobile horizontal bounds and arrow;
the footer panel and page composition remain unchanged. Use the existing hover
arrow nudge, not a perpetual pulse, bounce, shimmer or attention loop. Hidden
pinned contact becomes inert immediately. Reduced motion keeps the handoff instant.


### Continuous contact docking, revised after owner preview
The owner rejected the fade/settle swap after watching it in both directions.
Use one visible phone action: fixed at the bottom until it meets its exact footer
slot, then scroll-bound to that slot. Reverse at that same point. The footer
fallback reserves geometry and becomes inert while proxied. Do not fade, scale,
or slide the button independently of scrolling. Only the floating background
wash may fade away; reduced motion makes that wash change instantly. Keep the
aligned widths, locked typography, colors and pill shape.
