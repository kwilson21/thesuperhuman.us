# Website simplification audit

Date: September 26, 2026. Status: findings and recommendations for the owner.
Basis: [Website direction](../../website-direction.md),
[content responsibilities](../../website-content-model.md), and the
[September 9 audit](../2026-09-09/website-audit.md). Local HEAD: `26fc4b9`.

Goal set by the owner: simplify the site, reduce what a visitor has to take in,
keep the main purpose, remove distractions, and improve the overall design.

## Main finding

The redesign already solved the reading burden. Home renders about 130 words,
Work about 400, About about 270. The load that remains is not prose. It is
**choices**: eight top-level destinations, a row of jump links at the top of every
primary page, a contact invitation two or three times per page, and the same
destination offered under four or five different labels. A visitor is asked to
decide where to go far more often than they are asked to read.

The second finding is that the visual system is coherent at the token level
(paper, ink, terracotta, Newsreader) but not at the section level. Each page
composes its sections differently, and several illustrations appear on three to
five pages. That variety reads as busyness even where the word count is low.

The fix is subtractive and mostly mechanical: fewer navigation items, one
invitation per page, one label per destination, one section pattern, and one
audio funnel. No new visual identity, framework, or dependency is needed.

## What was measured

Chromium at 1280 × 800 and 390 × 844 against a local preview at HEAD. Counts use
rendered DOM with default disclosure states. "Clickable" counts links, buttons and
disclosure summaries outside the mobile menu. Numbers indicate choice load, not
targets.

| Page | Words in `main` | Clickable elements | Phone height (screens) | Nav destinations repeated in `main` |
|---|---|---|---|---|
| Home | 131 | 34 | 3.9 | 5 |
| Work | 406 | 36 | 5.5 | 2 |
| Building | 159 | 29 | 3.5 | 2 |
| Writing | 90 | 20 | 2.3 | 1 |
| About | 271 | 30 | 4.7 | 4 |
| Audio | 121 | 34 | 3.6 | 4 |
| Services (software) | 129 | 19 | 2.8 | 5 |
| Audio services | 162 | 43 | 2.5 | 2 |
| Personal website journal | 488 | 110 | 5.2 | 3 |

Home carries 34 clickable elements for 131 words: about one choice for every four
words. The personal website journal carries 110.

No horizontal overflow was observed on any page at either width. Lazy images
below the fold load correctly once scrolled; a blank "Beyond the code" area in an
unscrolled capture was a capture artifact, not a defect.

## Findings

Ordered by how much simplification each one buys.

### S1. Primary navigation offers eight destinations; the agreed model has five

**Priority: high. Effort: small.**

`SiteNav` lists Home, Work, Building, Writing, Audio, Services, About, plus the
"Get in touch" button. The content model agreed on five primary areas, with Audio
as a secondary destination reached from About and the footer, and Services as a
"concise follow-up to direct conversations, discoverable from Work, Audio and
secondary footer navigation". Both are already in the footer.

On audio pages a second bar (Audio, Releases, Portfolio, Services) sits under the
first. On the services sheet a third bar (Services: Software, Audio) appears.
`/audio/services` therefore opens with two stacked navigations before its heading
([capture](assets/audio-services-navs.webp)). The phone menu lists eight items.

Putting Services in the primary bar also re-centres the services pitch that the
direction deliberately moved to the background.

**Recommendation.** Primary nav: Work, Building, Writing, About, and the contact
button. Drop "Home" (the name is the home link, and the logo already does this
job). Keep Audio and Services in the footer and in the About and Work links that
already exist. Reduce the audio bar to Listen, Portfolio, Services, or fold it
into the audio page's own sections. Remove the Software/Audio switcher from the
services sheet; the footer covers it.

Evidence: [`SiteNav.astro`](../../../src/components/SiteNav.astro),
[`MusicNav.astro`](../../../src/components/audio/MusicNav.astro),
[`ServiceSheet.astro`](../../../src/layouts/ServiceSheet.astro),
[content model, Audio and services](../../website-content-model.md).

### S2. Every primary page opens with a menu of jump links for a three-screen page

**Priority: high. Effort: small.**

- Work header: four links (Work highlights, Experience, Software services,
  Request resume) plus a four-item "At a glance" list. On the phone the first real
  evidence, the Lyft story, begins about one and a half screens down, after nine
  links ([capture](assets/work-phone.webp)).
- Building header: two links (Featured projects, More projects) for a page that
  is three screens tall on a phone.
- About header: four chapter links (Audio, Software, Play, What's next) for four
  chapters that follow immediately ([capture](assets/about-phone.webp)).

Scrolling one screen is faster than reading a menu, and each row adds two to four
more choices above the fold. The only page where a table of contents earns its
place is the essay, at nine desktop screens; keep that one.

**Recommendation.** Remove the jump-link rows from Work, Building and About. Keep
at most one action in each header: Work keeps "Request resume"; Building and
About keep none. Fold the three facts in "At a glance" into the Work lede as one
sentence, and drop item four ("AI-assisted website project"), which is a link,
not a fact, and breaks the list.

Evidence: [`work.astro`](../../../src/pages/work.astro),
[`building.astro`](../../../src/pages/building.astro),
[`about.astro`](../../../src/pages/about.astro).

### S3. Contact is requested two or three times per page, each time in different words

**Priority: high. Effort: small.**

The header button says "Get in touch" on every page. Each primary page then ends
with its own closing block, and Home adds a full contact section. The closing
blocks use six different headlines for the same destination:

- Home: "Have something in mind? Let's talk." with "Email me" and "Send a message"
- Work: "Have a problem worth exploring?"
- Building: "Want to see how I work?" (links to Work and Writing, both in the nav)
- Writing: "Have something to discuss?"
- About: "Let's talk."
- Audio: "Beyond audio" (links to Work and About, both in the nav)
- Project pages: "Back to Building" and "Get in touch"

Seven closing-block styles exist in the CSS for this one job (`page-connect`,
`writing-invitation`, `about-connect`, `audio-beyond`, `hub-outro`,
`sheet-contact`, `project-close`).

**Recommendation.** One invitation per page, in one voice. The header button is
the invitation everywhere; Home keeps the contact section as the destination.
Remove the closing blocks from Work, Building, Writing, About and the project
layout, or reduce each to one line that reuses the `page-connect` pattern. Delete
the other six variants.

Evidence: [`global.css`](../../../src/styles/global.css),
[`writing/index.astro`](../../../src/pages/writing/index.astro),
[`ProjectLayout.astro`](../../../src/layouts/ProjectLayout.astro).

### S4. The same destination is offered under four or five labels

**Priority: high. Effort: small.**

Work is reached as "Work highlights", "Explore my work", "See my professional
work", "Explore my work history" and "Software services". Contact is "Get in
touch", "Email me", "Send a message", "Discuss a project", "Discuss a software
project", "Discuss an audio project" and "Start your song". Twenty-one link labels
in `src/` begin with "Explore", and eighteen of them render across the twenty
public routes. On Home, the hero says "exploring", the intro says "exploring", and
the first button says "Explore".

Different labels for one place make the visitor re-evaluate every link. Repeated
verbs flatten the copy.

**Recommendation.** A fixed vocabulary, used everywhere: Work, Building, Writing,
About, Audio, Get in touch, Request resume, Development journal, Read the essay.
Use a verb only where it differs from navigation (Read, Listen). Reserve "Explore"
for the hero, once.

Evidence: heading and link inventory in the verification record below.

### S5. Home: two overlapping intro lines, five section layouts, and a doorway section the nav already provides

**Priority: high. Effort: medium.**

The hero stacks a tagline ("Software, sound, and things worth exploring.") and an
intro ("Software engineer exploring ideas and building with AI.") that say the
same thing, then two links. Below it, five sections each use a different layout:
a two-column project grid, a boxed Lyft figure with a source footnote, an
image-left editorial pair, an image-right editorial pair (re-ordered on the
phone), and a split contact block ([desktop](assets/home-desktop.webp),
[phone](assets/home-phone.webp)).

"Beyond the code" is a full-width illustration, one sentence and two links to
About and Audio. Both destinations are in the header. On the phone that section
alone is more than 500 px tall.

**Recommendation.**

- Hero: one identity line, one sentence, one button. The approved Work heading,
  "Software engineer. Building with AI.", can carry the identity; the tagline can
  stay as the page title.
- Sections: Building (two projects), one Work proof, Writing (one essay),
  Contact. Remove "Beyond the code". Home drops from five sections to four and
  from 3.9 phone screens to roughly 3.
- One section pattern for all four: the existing `site-section-heading` rule,
  one item, one link. Retire the boxed Lyft treatment on desktop; the figure
  already reads on the phone without a box.

Evidence: [`index.astro`](../../../src/pages/index.astro),
[`Hero.astro`](../../../src/components/Hero.astro).

### S6. Work: three summary layers sit above the evidence, and the AI note reads defensively

**Priority: medium. Effort: small.**

Above the first highlight a visitor reads the lede, the "At a glance" list, and a
working-preference paragraph. After the highlights come six collapsed experience
rows, then a three-column "How I work" whose middle column is five words ("Clear
communication keeps work moving.") and whose third column ends with "The
professional experience above describes my hands-on engineering work." CLAUDE.md
asks for AI-assisted development to read as a feature, not a disclaimer. The
Lyft and Skupos diagrams are the best evidence on the site; the working
preference is repeated in full on About.

**Recommendation.** Keep the lede (with the three facts folded in), the two
highlight stories and their diagrams, and the experience rows. Move the working
preference to About only, with one sentence and a link from Work. Fold "How I
work" into one confident sentence in the lede or drop it. Drop the second link
under each highlight ("Explore my work across three Lyft teams"); the experience
row is one scroll away.

Owner check: the direction records the approved Work heading as "Software
engineer. Building with AI." The page renders "Software engineer." only.

Evidence: [`work.astro`](../../../src/pages/work.astro),
[`profile.ts`](../../../src/data/profile.ts).

### S7. Building: a featured/more split, a linkless row, and status only on one project

**Priority: medium. Effort: small.**

Two featured cards use mirrored layouts, then four rows follow. Only The
Engineer's Daily shows a status and date; Threadline's status ("Internal
prototype") and Tally's ("In development") appear only on their own pages.
servant-lang has no destination. The closing block links to Work and Writing.

**Recommendation.** One row treatment with a small thumbnail, a one-line status
on every row (Local prototype, Internal prototype, In development, Released), and
the two current projects first. Hide servant-lang until there is something to
visit, or link its repository. Remove the header links and the closing block.

Evidence: [`building.astro`](../../../src/pages/building.astro).

### S8. About: the chapters work; the jump links, the duplicated preference, and the mobile path do not

**Priority: medium. Effort: small.**

The four chapters and the traced path are the clearest expression of the person
on the site. The intro adds four jump links to them. "What's next" carries the
full 63-word working preference that Work also summarizes. On the phone the
chapter path renders as small disconnected curves between sections that read as
stray marks ([capture](assets/about-phone.webp)).

**Recommendation.** Remove the chapter links. Keep the preference here in one
place. Hide the path below 800 px, or replace it with the plain rule the other
pages use. The resume disclosure at the end is right where it should be.

Evidence: [`about.astro`](../../../src/pages/about.astro).

### S9. Audio is a second site inside the site, with two intake funnels and a leftover About page

**Priority: high for audio visitors. Effort: medium. Needs an owner decision.**

- Two funnels. The audio hero button "Discuss a project" and the "Discuss an
  audio project" disclosure open the `BookingForm` on `/audio#book`. The services
  and portfolio pages send visitors to the three-step `/audio/start` intake. A
  musician who arrives on `/audio` and one who arrives on `/audio/services` fill
  in different forms.
- `/audio/about` repeats the university line, lists gear, and says "Looking for
  the software-engineering side of The Superhuman Group? That lives at
  thesuperhuman.us", a remnant of the separate hostname. Its revision and payment
  terms already appear under "Before we start" on `/audio/services`.
- The audio index has five sections plus a disclosure and its own "Beyond audio"
  block for a page of 121 words.

**Recommendation.** One funnel: `/audio/start`, which captures more and leads
into the offer flow. Replace the hero's "Discuss a project" and the booking
disclosure with "Start your song", and retire `BookingForm` and its API route once
the owner confirms. Fold `/audio/about` into "Before we start", give that section
an anchor, and redirect the old route to it. Reduce the index to hero (one
button), Listen (releases and portfolio), Services (four items with a prices
link), Start.

Evidence: [`audio/index.astro`](../../../src/pages/audio/index.astro),
[`AudioHero.astro`](../../../src/components/audio/AudioHero.astro),
[`audio/services.astro`](../../../src/pages/audio/services.astro),
[`audio/about.astro`](../../../src/pages/audio/about.astro).

### S10. Project journals carry the heaviest load on the site

**Priority: medium. Effort: medium.**

`/building/personal-website` renders 110 clickable elements, 65 images and a
17-entry timeline, with two "Development journal" links in the header area, a
before/after comparison, a six-page comparison accordion and a closing section
([capture](assets/personal-website-journal-desktop.webp)). The Engineer's Daily
page has a hero capture, a two-item "Behind the idea" with a reused notebook
illustration, a three-column "Where it stands", and the journal.

The clearest evidence on the website page is the "What changed, page by page"
accordion. It sits below the seventeen design-study milestones.

**Recommendation.** Show the latest three to five journal entries by default
with the existing "Show all entries". On the website page, move the page-by-page
comparison above the journal and remove the duplicate header link. Keep every
milestone, caption and bookmark; this is ordering, not deletion.

Evidence: [`building/personal-website.astro`](../../../src/pages/building/personal-website.astro),
[`ProjectTimeline.astro`](../../../src/components/ProjectTimeline.astro).

### S11. Five illustrations are spread across many pages

**Priority: medium. Effort: small.**

The notebook appears on Home, About, Audio, the audio portfolio and The
Engineer's Daily. The headphones appear on About and Audio, the controller on
About and Building, the Threadline still on Home, Building and Threadline. Each
reuse weakens the image's association with its page and makes pages look alike
for the wrong reason. Masks also vary (radial on About and Building rows, linear
elsewhere).

**Recommendation.** One home per illustration: notebook on Writing, headphones on
Audio, controller on Building, Threadline on its own page, studio scene on Home,
terrain on About. Where a section loses its image, use the plain section pattern
rather than a substitute picture. Choose one mask treatment.

Evidence: `src/assets/site/` usage in the verification record.

### S12. Section and control variants outnumber the jobs they do

**Priority: medium. Effort: small, and it makes every later change cheaper.**

- Seven closing-block styles (S3) and at least five section-heading treatments
  (`site-section-heading`, `audio-section`, `essay-feature`, `services-hero`,
  `sheet-hero`).
- Link styles: `site-link`, `site-button`, `site-button-outline`,
  `audio-detail-link`, `offering-evidence`, `missing-secondary`, plus
  `btn-primary`, which nothing uses.
- Kickers in three faces: mono `page-kicker`, sans `eyebrow`, serif headings.
- Dead code: `.btn-primary` and `.lede` in `global.css`; the four-column footer
  variant in `Footer.astro` (every use passes `compact`); `audioSheet` in
  `services.ts`, which no route renders.
- Page titles end in "· Kazon Wilson" on six pages, "· Kazon" on six audio pages,
  and "· The Superhuman Group" on one.

**Recommendation.** One section heading, one closing block, two link styles
(underlined link, filled button), one kicker face. Delete the unused variants and
the unused footer branch. One title suffix.

Evidence: [`global.css`](../../../src/styles/global.css),
[`Footer.astro`](../../../src/components/Footer.astro),
[`services.ts`](../../../src/data/services.ts).

## What to keep

These already serve the purpose and should survive the simplification untouched:

- The palette, the Newsreader display type, the name mark and the paper texture.
- The Home studio scene and the About terrain and chapter structure.
- The Lyft before/after and Skupos progression diagrams on Work.
- Collapsed experience rows with the grouped Lyft and Skupos accounts.
- The approval-gated resume request and the single general resume.
- The A/B comparison player and the approved audio prices.
- Journal captions, dates, milestone IDs and bookmarks.

## Proposed structure after simplification

```
Header     Work · Building · Writing · About · [Get in touch]
Footer     GitHub · LinkedIn · Audio · Services · Support my work · Privacy

Home       Hero (1 button) · Building (2) · Work (1 proof) · Writing (1) · Contact
Work       Lede with three facts · 2 highlights with diagrams · Experience rows · Request resume
Building   Intro · project rows with status · (no closing block)
Writing    Intro · essay · topic in progress
About      Intro · 4 chapters · working preference · Contact · Request resume
Audio      Hero (Start your song) · Listen · Services · Start
```

## Suggested order of work

Each step is one reviewable PR and can ship on its own.

1. **Navigation and labels.** S1, S3, S4, S12. Header to five items, one
   invitation per page, one vocabulary, dead variants removed. No layout change.
2. **Headers.** S2, S6, S8. Remove jump-link rows and "At a glance"; fold facts
   into ledes; move the working preference to About.
3. **Home.** S5. Remove "Beyond the code", tighten the hero, one section pattern.
4. **Building and illustrations.** S7, S11. Rows with status; one home per image.
5. **Audio funnel.** S9. After the owner picks the intake to keep.
6. **Journals.** S10. Latest entries first, page comparison promoted.

## Decisions for the owner

1. Drop Audio and Services from the primary header, as the content model states?
2. Which audio intake stays: the three-step `/audio/start` flow (recommended) or
   the `#book` booking form?
3. Retire `/audio/about` with a redirect to the "Before we start" section of
   `/audio/services`?
4. Remove "Beyond the code" from Home, or keep it as one line under the hero?
5. Hide servant-lang from Building until it has a destination?
6. Keep Threadline featured with illustration-only evidence, or list it as a row
   until there is an artifact?
7. Work heading: keep "Software engineer." or use the approved "Software
   engineer. Building with AI."?

## Verification record

- Twenty public routes rendered at both widths; all returned 200; no document
  overflow at either width.
- Heading and CTA inventory captured from rendered DOM for every route; counts
  in the table above come from that inventory.
- Illustration reuse counted from imports in `src/pages` and `src/components`.
- Dead code confirmed by grep: no `<Footer>` without `compact`; no route imports
  `audioSheet`; no markup uses `btn-primary` or `lede`.
- Forms were not submitted. No resume, publication or payment flow was exercised.
- This is an editorial, information-architecture and visual-consistency audit
  with rendered measurements. It is not user research or an accessibility audit;
  the existing focus styles, reduced-motion handling and skip link were observed
  working and are out of scope here.
