# Button inventory, 12 November 2026

This is the list of every button style in `src/` that was checked for the pill shape. A **pill** is a filled or outlined button with a text label that submits, continues, goes back, sends, approves or leads somewhere. It gets the fully rounded corner, `var(--radius-button)`. **Stays** means the control keeps its current corners: tabs, toggles, player controls, text-style buttons, illustrations and similar controls. **Unsure** means the owner decides before any change.

## Pill (changed or already pill through `.site-button`)

| Selector | File | What it does | Change |
| --- | --- | --- | --- |
| `.site-button`, `.site-button-outline` | `src/styles/global.css` | Shared button used on headers, doors, forms, 404, intake and audio pages | Pill through `--radius-button` in `src/styles/global.css`. |
| `.door-button` (on `.site-button`) | `src/components/WorkWithMe.astro` | Leads to each work door | Pill through `.site-button`; side padding raised from 1.15rem to 1.5rem |
| `.studio-button` (and its `.secondary` and `-outline` variants) | `src/styles/studio.css` | Submits or sends on studio, owner, sign-in, offer and agreement pages | Corners changed from 2px to the pill. Labels may wrap, because some are typed by the owner; the rule sets `max-width: 100%`. |
| `.owner-primary-action` | `src/styles/owner.css` | Main action in owner payment and project panels | Pill; side padding raised to 1.25rem. Labels may wrap; the rule sets `max-width: 100%`. |
| `.owner-filters button` (shared rule with `.request-work button` and `.audience-list button`) | `src/styles/owner.css` | Submits the request filters | Pill; side padding raised to 1.25rem. The other two selectors have no markup in `src/` |
| `.intake-actions [data-back]` | `src/styles/audio-intake.css` | Goes back a step on the audio and software intake forms | Pill |
| `.intake-actions .site-button` | `src/styles/audio-intake.css` | Continues or sends on the intake forms | Pill through `.site-button` |
| `.rail-actions button` | `src/pages/owner/requests/[id].astro` | Owner request actions (mark reviewed, resolve, withdraw, send invitation) | Pill; side padding raised to 1.25rem |
| `.rail-actions button.danger` | `src/pages/owner/requests/[id].astro` | Destructive owner request actions | Inherits the pill from `.rail-actions button` |
| `.sheet-footnote button` | `src/layouts/ServiceSheet.astro` | Print control in the sheet footer | Pill through `.site-button` (it also carries `.site-button-outline`) |
| `.terms-navigation` buttons | `src/components/SoftwareAgreedTerms.astro` | Back and next controls for the agreed terms | Pill through `.studio-button` |
| `.next-step-link` | `src/components/AudioProjectUpdates.astro` | Outlined link to the owner's next step on an audio project | Pill; the label is stored text and may wrap. |
| `button` (inside `consentStyle`) | `src/lib/publication/oauth-login.ts` | Submits "Allow and sign in with GitHub" on the standalone publishing consent page | Pill with the `.site-button` values as literals, because that response's Content-Security-Policy admits only its own hashed inline style. A test pins the literals to `global.css`. The label wraps whenever it does not fit on one line, at any width. Its pressed state uses the ink fill instead of the site's opacity, for label contrast. |

## Stays

| Selector | File | What it does |
| --- | --- | --- |
| `.studio-quiet` | `src/styles/studio.css` | Text-style action with an underline only, no border or fill |
| `.premiere-action`, `.video-poster-button`, `.round-play`, `.volume-button` | `src/styles/music-premiere.css`, `src/components/audio/*` | Player and play controls |
| `.comparison-switch button`, `.comparison-controls button`, `.native-video-controls button` | `src/components/audio/*` | Player switches and controls |
| `.collection-bar button`, `.methodology-tabs button` | `src/styles/music-hubs.css` | Tabs for release type and comparison method |
| `.milestone-strip button`, `.timeline-tools button`, `.timeline-pager button` | `src/components/ProjectTimeline.astro` | Milestone strip and previous and next controls |
| `.try-check button` | `src/components/SoftwareReviewResponse.astro` | Two-state toggles (works, not yet) |
| `.terms-stages button` | `src/components/SoftwareAgreedTerms.astro` | Step tabs |
| `.terms-link` | `src/components/SoftwareAgreedTerms.astro` | Text link style |
| `.intake-edit button` | `src/styles/audio-intake.css` | Underlined text button to edit an answer |
| `[data-skip]`, `[data-suggestions-toggle]` | `src/styles/software-intake.css` | Text-style skip and suggestion toggles |
| `.revision-action`, `.moved-entry-cta` | `src/components/owner/SoftwareProjectPanel.astro`, `src/styles/project-journal.css` | Text links |
| `.pad-button`, `.fake-button`, `.controls button`, `.press` | `src/components/BuildingIllustration.astro`, `src/components/PayloadReviewIllustration.astro`, `src/components/ObjectLife.astro` | Buttons drawn inside illustrations |

## Unsure (not changed)

| Selector or element | File | Why it is unsure |
| --- | --- | --- |
| `.saved-reference` | `src/pages/owner/requests/[id]/update.astro` (line 171) | Each saved link is a bordered card with a title and a web address. It fills a field rather than leading somewhere, so it may be a card (stays) or a pill. |

## Notes

- Dead selectors with no markup in `src/`: `.request-work button`, `.audience-list button`, `.request-actions .danger`, `[data-review] button`. They were left as they are, apart from the shared owner rule above.
- Most pill labels carry `white-space: nowrap`, so a label stays on one line instead of wrapping inside the curve. The consent page's button is the exception: its label wraps whenever it does not fit on one line, at any width, so the pill never overflows.

## Out of scope

- The email button in `src/lib/email-template.ts` keeps its 2px radius. Email templates are not part of this change.
