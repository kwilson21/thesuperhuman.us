# Closing panel and pill buttons: design brief

November 12, 2026. Status: approved by the owner in conversation, 2026-11-12 ("Approve the brief").
Plan: `docs/superpowers/plans/2026-11-12-closing-panel-and-pill-buttons.md`.

## Intent

Kazon saw [alexkyr.com](https://alexkyr.com/) and liked two things: the page ends on
one calm, soft panel with a single invitation, and the "Let's work together" button.
Today this site ends on a thin utility footer where "Work with me" is one small link
among six, so most pages close without an invitation.

This change gives every public page a closing panel in the site's own type and
colours, and makes action buttons pill shaped. Only the structure and the shapes are
borrowed. No reference assets, fonts, colours or copy are used.

Owner decisions, in conversation, 2026-11-12:

- "I really like B" (the soft panel, over a square closing line).
- "Pills on every button" (over keeping the pill inside the panel only, and over
  also rounding fields and pictures).

## Goals

- Every page that renders the shared footer ends on one soft panel that holds it.
  Pages with their own ending and no shared footer (the Work with me hub and service
  sheets, with their print footnote; the agreement and offer pages) are not given one.
- Pages where an invitation fits get a heading, one line and one button in that panel.
- Every action button on the site is a pill.

## Non-goals

- No new colours, typefaces or motion.
- Fields, pictures, cards and tabs keep their current corners.
- No pinned or floating button. The header's existing "Work with me" button stays as it is, apart from its shape.
- No portrait and no "Online" badge. The panel adds no email address. Home's existing
  contact section, with its "Email me" button and message form, is unchanged.
- Email templates and the signed agreement PDF are not restyled.

## Anti-goals

- The site must not start to read as a generic app. If a screen looks softer than
  "buttons and one panel", the change has gone too far.
- Two button shapes on one screen.
- A sales invitation under a privacy policy, an error page or a form someone is filling in.

## Approaches considered

| | What it was | Outcome |
|---|---|---|
| A · Closing line | Large Libron heading, hairline, the existing 3px button, footer unchanged | Not chosen. Fits the locked system with no amendment, but the owner preferred the soft panel. |
| B · Soft panel | Rounded tinted panel, centred, pill button, footer folded inside | **Chosen.** |
| C · Button that stays with you | Header button on a computer, pinned bar on a phone | Not chosen. The header button already exists; a pinned bar pushes on every page. |

For how far the soft shapes spread:

| | Outcome |
|---|---|
| Pill only inside the panel | Not chosen. Leaves two button shapes near each other. |
| Pills on every button | **Chosen.** One rule. |
| Pills plus rounder fields and pictures | Not chosen. Forms read as a generic app and rounded corners cut into artwork. |

Mockups shown to the owner were throwaway files and CSS overlays on the live site.
They are not in the repository.

## The closing panel

One component replaces the body of `src/components/Footer.astro`. It keeps the
`<footer>` landmark and the "Elsewhere" nav label.

Shape and surface:

- Sits inside `.site-shell`, full width of the shell.
- Background: a new token `--panel`, `color-mix(in srgb, var(--rule) 50%, var(--paper))`
  (the tint `.door-art` already uses; that rule should use the token too).
- Corner radius: a new token `--radius-panel`, 32px; 28px at 600px wide and below.
- No border, no shadow. The footer's top hairline is removed.
- Content is centred in one column.
- Padding: 4.5rem top, 2rem sides, 2.25rem bottom; on a phone 3rem, 1.25rem, 1.75rem.
- Space above the panel: `--site-section-space`. Space below: `--space-8`.

Content, top to bottom, in the **invitation** variant:

1. Name mark, 24px, linking Home (same as the header wordmark).
2. Heading, `h2`, Libron Regular, clamp(2rem, 3.6vw, 2.9rem) / 1.08, tracking -.03em, balanced.
3. One line, 1.125rem, `--muted`, at most 28rem wide.
4. One primary button (see Buttons), with the large size and an arrow.
5. Footer links, .875rem, `--muted`, wrapping, centred. Each keeps its 44px tap area.
6. The LLC line: "The Superhuman Group LLC · {year}".

The **quiet** variant shows items 1, 5 and 6 only, with 3rem top padding.

Which page gets what:

| Page | Variant | Heading | Line | Button |
|---|---|---|---|---|
| Building, Writing index, articles, project pages (including the personal-website story and archive) | Invitation | Let’s work together. | Every project is fixed price and agreed in writing before work begins. | Work with me → `/services` |
| Work | Invitation | Have a problem worth exploring? | I’d love to hear about it. | Get in touch → `/#contact` |
| About | Invitation | Let’s talk. | An idea, a shared interest, or an opportunity worth discussing. | Get in touch → `/#contact` |
| Home, software and audio intake, Privacy, 404, audio pages | Quiet | | | |

- Home is quiet because it already ends on its contact section (`#contact`, with the
  horizon scene, "Email me" and the message form). That section stays exactly as it is
  and remains the target of the Work and About buttons.
- The Work and About rows reuse those pages' current endings word for word. Their
  `.page-connect` sections are removed, because the panel now carries them, and the
  `.page-connect` rules go with them (nothing else uses them). On About the panel takes
  `id="contact"`, so the existing anchor keeps working.
- The gap above the panel is `--site-section-space` in total. It must not stack with a
  bottom margin from the page's last section.
- The footer keeps the class names `.compact-footer` and `.footer-name`. Print styles
  hide the first and a type-role test reads the second.
- The button's arrow is an `aria-hidden` span, as in `.site-link`.
- About keeps its "Request my resume" disclosure, placed as the last item before the panel.
- The default line is the sentence already live on the Work with me hub.
- Footer links in the invitation variant: GitHub, LinkedIn, Audio, Support my work,
  Privacy. The quiet variant also keeps "Work with me", since it has no button.
- The component takes the variant, heading, line, button label and button target as
  props, with the first row as the default. The unused `compact` prop is removed from
  every caller in this change.

## Buttons

A new token `--radius-button: 999px`.

The rule: a control becomes a pill if it is a filled or outlined rectangle with a text
label that submits, continues, goes back, sends, approves or leads somewhere.

Known members:

- `.site-button` and `.site-button-outline` everywhere, including the header button,
  the doors, forms, 404, intake and audio pages.
- `.studio-button` on studio pages.
- `.owner-primary-action` and `.rail-actions button` on owner pages.
- The intake back button (`.intake-actions [data-back]`).

This list is not complete. The first step of the build is an inventory of every
button-like rule in `src/`, sorted into "pill", "stays" and "unsure" by the rule
above. The "unsure" group comes to the owner with a screenshot before it is changed.

Stay as they are:

- Fields, selects and textareas (3px).
- Pictures, cards and the door art.
- Tabs, switches and toggles: the collection bar, methodology tabs, milestone strip,
  studio toggles, player and volume controls.
- Text-style buttons with no border or fill: intake "skip" and suggestion toggles,
  disclosure summaries, `.premiere-action` on the release page.
- The video poster button, drop zones, and buttons drawn inside illustrations.

Details:

- Inline padding grows from 1.35rem to 1.5rem so the label clears the curve.
- Colours, border, 44px minimum height, hover (ink fill), focus and active states do not change.
- A label never wraps inside a pill: `white-space: nowrap`. Full-width phone buttons stay pills.
- Large size, used only in the panel: 52px minimum height, 1.0625rem text, 1.75rem
  inline padding, with a trailing arrow that follows the `.site-link` arrow's hover rule.

## Constraints

- `design.md` is amended in the same PR, since the header, footer and CTA voice are on
  its "must share" list:
  - Tokens: add `--panel`, `--radius-panel`, `--radius-button`.
  - CTA voice: primary and secondary buttons are pills; add the large size.
  - Layout: the closing panel is the site's one soft surface; no other panel, card or
    field takes a large radius without an owner decision.
  - Owner decisions: add a November 12, 2026 entry quoting the two picks above.
- Contrast on `--panel` must be checked and recorded: `--muted` text, `--ink` text,
  and the accent focus ring.
- Copy rules in `CLAUDE.md` apply: curly apostrophes, no em dashes, no rates.
- With reduced motion, without JavaScript and in print, the panel shows complete. It
  adds no motion.
- Screenshots at 1280×800 and 390×844 for every page, and a read-only `hallmark audit`
  on changed pages, before review. No new screenshot scenario is needed.
- Per the owner's rule for this repository: Haiku subagents write code, tests first;
  independent review subagents review each round; Greptile and Codex review on the PR.
  Merging to `main` deploys, so the deployment gate in `AGENTS.md` applies.

## Amendments from review (November 12, 2026)

Reviews of the built pages changed four points in this brief. They wait for the
owner's yes or no on the pull request.

1. "A label never wraps inside a pill" holds above 380px wide. At 380px and below a
   `.site-button` label may wrap, because "Discuss your project" pushed past the page
   gutter at 360px and 320px (WCAG 1.4.10, reflow).
2. Buttons whose label is typed or stored text may wrap at any width:
   `.studio-button` (the countersign label copies a typed name), `.owner-primary-action`
   and `.next-step-link`.
3. Footer links turn ink on hover, not accent. Accent on `--panel` is 4.3:1, under
   4.5:1 for small text.
4. `.next-step-link` (the owner's next step on an audio project) was missing from the
   known members and is a pill.

5. The Writing index carries its own ending in the panel, like Work and About:
   "Have something to discuss?" / "Ideas, opportunities, or a conversation worth
   having." / "Get in touch" to `/#contact`. Its separate closing section is removed,
   so the page no longer ends on two invitations. Owner, in conversation, 2026-11-12:
   "Yes, move it".

## Calls made by the designer, for the owner to check

1. The default line reuses the hub's live sentence instead of new copy.
2. Audio pages get the quiet panel in this pass, with no audio-specific invitation.
3. Private owner, studio and agreement pages are included in the pill rule.
4. Email templates and the signed PDF are left out.
5. Both intake flows are quiet. The Work with me hub and service sheets get no panel,
   because they do not use the shared footer.
6. The About resume disclosure moves to sit directly above the panel.
7. Home is quiet and keeps its contact section untouched.

## Left to the builder

- How the pill rule is applied across the stylesheets, as long as every radius comes
  from `--radius-button`.
- How the unused `compact` prop and `.page-connect` rules are cleaned up.
- Test structure.
- Exact link gaps and wrapping in the panel, within the tap-area rule.
