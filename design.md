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
  /* Added with the October 22 picks: --dur-hover 160ms, --dur-page 180ms,
     --dur-reveal 600ms, --rise-reveal 12px (D3.4-C); --site-chapter-space,
     128px on a computer and 112px on a phone (D6.5-C). */
}
```
New colours are named tokens. Illustrations may keep local colour tokens in their own
component (`--ill-*`, `--code-*`); declarations reference tokens, never raw hex.

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
  3vw, 2.25rem). Headings balance; prose wraps `pretty`. Roman headings only.
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

## CTA voice
- Primary · `.site-button`: accent fill, paper text, 1px border, 3px radius, 44px
  minimum height; on a fine-pointer hover, ink fill.
- Secondary · `.site-button-outline` (transparent, ink text) or `.site-link`: ink
  text, accent rule about 4px under the baseline, accent arrow, 44px tap area
  (D8.4-C).
- Running links · ink with a 1px accent rule; accent on fine-pointer hover.

## States
- Focus · `outline: 2px solid var(--accent)` with a 2px offset on `:focus-visible`,
  shown at once, never animated.
- Hover · only inside `(hover: hover) and (pointer: fine)`; one signal per element
  (D2.2-B: project cards keep their lean and resting glow; the glow does not grow).
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
- Home's three crossings and the About path follow the scroll; no drift, pointer
  lean or parallax beyond them (D2.1-D).
- Building drawings arrive with their row, then play once in reading order (D3.3-C).
- A caret appears only after typed text (D2.4-C). The essay pen stroke sits 3 to
  5px under "Direction" (D3.5-B).
- Anything that plays on its own rests within five seconds. Page cross-fade 180ms.

## Page families
From `docs/website-system-plan.md` (Templates and explanations): Home, Work,
Building, Writing and About indexes · project detail · work story · article · audio ·
the Work with me hub and service sheets · project briefs and intake · private
owner, studio and agreement pages. A new page reuses the nearest family. A new
family is a design choice for the owner.

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

## Owner decisions (October 22, 2026)
All picks are quoted in `docs/design-concepts/README.md` ("Owner's picks"), with
the boards in `docs/design-concepts/2026-10-22/`. Standing rules from them are above.
One-time changes with no standing rule: D1.1-B and D1.2-C (door layout on Home and
/services), D2.3-A, D5.2 (the 404 shows B or D at random; B without JavaScript),
D5.4-B, D8.5-D, D9.1-B, D10.1-C, D10.4-A, D10.6-B. Deferred: D5.1-D (photographs
of the owner's own objects, `docs/website-system-plan.md` Deferred maintenance).

## Variants
None. A page that needs something this file does not allow gets an owner decision
and an amendment here first.

## Exports
`src/styles/global.css` (Tailwind v4 `@theme` plus `:root`) is the source of truth.
Do not write `tokens.css`, DTCG or shadcn exports, or append them here. Another
project copies the tokens from `global.css` and writes its own `design.md`.
