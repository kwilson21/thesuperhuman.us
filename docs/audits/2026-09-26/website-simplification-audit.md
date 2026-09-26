# Website simplification audit

Date: September 26, 2026. Status: findings, recommendations and recorded
decisions. Updated the same day after a second review (Astra) and the owner's
answers; the [reconciliation](#review-reconciliation-september-26) section
records what changed and why.
Basis: [Website direction](../../website-direction.md),
[content responsibilities](../../website-content-model.md), and the
[September 9 audit](../2026-09-09/website-audit.md). Local HEAD: `26fc4b9`.

Goal set by the owner: simplify the site, reduce what a visitor has to take in,
keep the main purpose, remove distractions, and improve the overall design.

## Main finding

The redesign already solved brevity. Home renders about 130 words, Work about
400, About about 270. Brevity is not the same as clarity: the Audio landing
page describes an interest ("Audio is still part of my life") where the site's
purpose includes selling mixing and mastering, and that needs sharper
positioning rather than fewer words. But the load that remains across the site
is mostly **choices**, and above all **orientation placed before evidence**:
eight top-level destinations, a row of jump links at the top of every primary
page, a contact invitation two or three times per page, and the same destination
offered under four or five labels. On the phone, Work's first screen is spent
entirely on introduction, links and a summary list before the first diagram.

The second finding is that the visual system is coherent at the token level
(paper, ink, terracotta, Newsreader) but not at the framing level. Each page
composes its sections with different headings, spacing and closing blocks, and
one generic illustration appears on five pages. That variety reads as busyness
even where the word count is low.

The fix is subtractive: fewer header items, one clear path to each service line,
evidence brought forward, one contact pattern, shared section framing, and one
audio funnel. No new visual identity, framework, or dependency is needed.

## What was measured

Chromium at 1280 × 800 and 390 × 844 against a local preview at HEAD. Counts use
rendered DOM with default disclosure states. "Clickable" counts links, buttons and
disclosure summaries outside the mobile menu. These are an inventory of choice
load, not usability scores: a navigation link, an experience disclosure and an
audio playback control make different demands, and visitors meet them at
different moments. No count below is a target.

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

No horizontal overflow was observed on any page at either width. Lazy images
below the fold load correctly once scrolled; a blank "Beyond the code" area in an
unscrolled capture was a capture artifact, not a defect.

## Findings

Ordered by how much simplification each one buys. Recommendations are the
reconciled versions; the original wording is summarized in the reconciliation
section where it changed.

### S1. Primary navigation offers eight destinations; two of them are service sheets

**Priority: high. Effort: small.**

`SiteNav` lists Home, Work, Building, Writing, Audio, Services, About, plus the
"Get in touch" button. The content model agreed on five primary areas, with Audio
secondary and Services as a "concise follow-up to direct conversations,
discoverable from Work, Audio and secondary footer navigation".

On audio pages a second bar (Audio, Releases, Portfolio, Services) sits under the
first. On the services sheet a third bar (Services: Software, Audio) appears.
`/audio/services` therefore opens with two stacked navigations before its heading
([capture](assets/audio-services-navs.webp)). The phone menu lists eight items.

Putting Services in the primary bar re-centres the services pitch that the
direction deliberately moved to the background. Audio is different: it serves a
distinct audience and is the service line most likely to bring paid work, so it
earns header space even though the content model placed it second.

**Recommendation (decided, revised September 26).** Header: **Work · Building ·
Writing · Audio · About · [Work with me]**. The name mark is the Home link. The
header button changes from "Get in touch" to "Work with me" and leads to one hub
page (the current `/services`, retitled) that names the three things a visitor
can hire him for, each with one line and one link: mixing and mastering (to
`/audio/services`), website design (to the hub's own section, with this site as
the example) and software engineering (to the hub's offerings). The hub also
carries "Request my resume" and "Get in touch" for the other two audiences. On
the phone, the menu's last item becomes a "Work with me" group listing those
three offers and "Get in touch", each one tap away. The footer says "Work with
me". Work keeps a "Hire me for software" link near its introduction and Audio
leads with the offer. No dropdown on desktop: a visible hub page is more robust
than a hover menu, and the phone menu already groups the routes. Remove the
Software/Audio switcher from the services sheet. Reduce the audio bar to Listen,
Portfolio, Services. Update the content model's "Audio" and services paragraphs
once this ships.

Owner requirement behind this (September 26): someone looking for mixing and
mastering, for a website designed, or for a serious software project must find
it from any point on the site without digging, and a label like "Services" or
"Audio" does not tell them what is on offer. A footer link is not enough.

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
the actions that do a job a recruiter needs on first view: Work keeps "Request
resume" and "Software services" near the introduction; Building and About keep
none. Fold the three facts in "At a glance" into the Work lede as one sentence.
Its fourth item, the website project, is not a fact but it is the current
evidence for the AI positioning, so it moves into the lede or the first highlight
rather than disappearing.

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

**Recommendation.** No redundant contact panels. On phones the header button is
inside the Menu, so one quiet closing invitation after the evidence earns its
place; the redundancy is the mid-page repeats, the blocks that only link to
header destinations, and the six headline variants. Keep one closing pattern
(`page-connect`) in one voice, use it at most once per page, and delete the other
six styles as the pages stop using them. Home keeps the contact section as the
destination. The opening and closing "Start your song" on the audio services page
serve readers at different stages and both stay.

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

**Recommendation.** Consistency for destinations, not for behavior. One label per
place: Work, Building, Writing, About, Audio, Software services, Audio services,
Request resume, Development journal, Read the essay. Labels that describe a
different action keep their difference: "Email me" opens mail, "Get in touch"
opens the form, "Start your song" begins the intake. Reserve "Explore" for the
hero, once.

Evidence: heading and link inventory in the verification record below.

### S5. Home: two overlapping intro lines, five section layouts, and a doorway section the nav already provides

**Priority: high. Effort: medium.**

The hero stacks a tagline ("Software, sound, and things worth exploring.") and an
intro ("Software engineer exploring ideas and building with AI."). They do
different jobs, breadth and profession, but share the verb, and the first button
repeats it. Below, five sections each use a different layout: a two-column
project grid, a boxed Lyft figure with a source footnote, an image-left editorial
pair, an image-right editorial pair (re-ordered on the phone), and a split
contact block ([desktop](assets/home-desktop.webp),
[phone](assets/home-phone.webp)).

"Beyond the code" is a full-width illustration, one sentence and two links to
About and Audio. Both destinations are in the header. On the phone that section
alone is more than 500 px tall. It is also, at present, the only place on Home
that mentions audio at all.

**Recommendation (decided: remove "Beyond the code").**

- Hero: keep the name, the studio scene and the personal introduction. Fix the
  repeated "exploring" rather than replacing the introduction with the Work
  heading. One hero link.
- Directly under the hero, a "Work with me" strip: the same three offers as
  the hub, each with a small illustration from the site's existing line-drawn
  set (the audio waveform, the website layout, the product illustration), one
  line, and a button with its own verb ("Start your song", "Plan your website",
  "Discuss your project"), plus "All services". Placement under the hero and
  the illustration-plus-button treatment were both confirmed by the owner on
  September 26 after seeing the rendered preview. This is wayfinding, not a
  pitch: the hero still leads with the person, and the strip is the only place
  on Home that sells anything. It replaces the earlier idea of a single audio
  line. The hub's three doors use the same treatment.
- Sections: Work with me, Building (up to two projects, a maximum not a quota),
  one Work proof, Writing (one essay), Contact. Home swaps "Beyond the code" for
  the strip and ends about the same height on the phone and shorter on desktop.
- Shared framing for all four: the existing `site-section-heading` rule,
  spacing and link behavior. Inside that frame each section keeps the layout
  its content needs. Retire the boxed Lyft treatment on desktop; the figure
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

**Recommendation.** Keep the lede, the two highlight stories and their diagrams,
and the experience rows. Remove "At a glance" and the three-column "How I work".
Retain, in short form near the introduction: one sentence that independent work
is the default and full-time roles are selective (a recruiter should not need
About to establish fit), "Request resume", "Software services", and the website
project as the direct example behind the AI positioning. The full
working-preference explanation lives on About. Drop the second link under each
highlight ("Explore my work across three Lyft teams"); the experience row is one
scroll away.

Heading (decided): "Software engineer. Building with AI.", the approved wording,
supported by truthful attribution and current evidence, without implying that
historical employer work used the same process.

Evidence: [`work.astro`](../../../src/pages/work.astro),
[`profile.ts`](../../../src/data/profile.ts).

### S7. Building: a featured/more split, a linkless row, and status only on one project

**Priority: medium. Effort: small.**

Two featured cards use mirrored layouts, then four rows follow. Only The
Engineer's Daily shows a status and date; Threadline's status ("Internal
prototype") and Tally's ("In development") appear only on their own pages.
servant-lang has no destination. The closing block links to Work and Writing.

**Recommendation (decided).** One row treatment with a small thumbnail and a
one-line status on every row (Local prototype, Internal prototype, In development,
Released), current work first. The Engineer's Daily stays featured. Threadline
moves to a row with its status; its page and journal stay, and it returns to a
feature slot when there is a representative screenshot, recording or inspectable
artifact (a public launch is not required). Hide servant-lang until it has a
public explanation, repository or artifact; this does not delete anything.
Remove the header links and the closing block.

Evidence: [`building.astro`](../../../src/pages/building.astro).

### S8. About: the chapters work; the jump links, the duplicated preference, and the mobile path do not

**Priority: medium. Effort: small.**

The four chapters and the traced path are the clearest expression of the person
on the site. The intro adds four jump links to them. "What's next" carries the
full 63-word working preference that Work also summarizes. On the phone the
chapter path renders as small disconnected curves between sections that read as
stray marks ([capture](assets/about-phone.webp)).

**Recommendation.** Remove the chapter links. The full preference lives here;
Work keeps its one-sentence summary. Hide the path below 800 px, or replace it
with the plain rule the other pages use. Keep the audio, laptop, controller and
notebook chapter imagery: it tells the story and is not decoration. The resume
disclosure at the end is right where it should be.

Evidence: [`about.astro`](../../../src/pages/about.astro).

### S9. Audio is a second site inside the site, with two intake funnels and a leftover About page

**Priority: high, and second in the order of work. Effort: medium.**

- Two funnels. The audio hero button "Discuss a project" and the "Discuss an
  audio project" disclosure open `BookingForm`, which posts to
  `/api/audio-inquiry`. The services and portfolio pages send visitors to the
  three-step `/audio/start` intake, which posts to `/api/audio-intake` and leads
  into the offer and invoice flow. A musician who arrives on `/audio` and one who
  arrives on `/audio/services` fill in different forms.
- `/audio/about` repeats the university line, lists gear, and says "Looking for
  the software-engineering side of The Superhuman Group? That lives at
  thesuperhuman.us", a remnant of the separate hostname. Its revision and payment
  terms already appear under "Before we start" on `/audio/services`.
- The landing page positions audio as an interest. The services page already
  communicates the paid offering more clearly than the landing page does.

**Recommendation (decided: keep `/audio/start`).**

- One funnel. Replace the hero's "Discuss a project" and the booking disclosure
  with "Start your song". Keep a working path from old `/audio#book` links (the
  hero, `/audio/about`, the unused `audioSheet` entry and any external link) to
  the intake. Verify the intake's submission and delivery end to end before
  retiring `BookingForm` and `/api/audio-inquiry`.
- Lead the landing page with what someone can hire you to do and something they
  can hear: hero with the offering and one button, a listening area where artist
  releases and engineering examples keep distinct roles and credits, the four
  services with the approved prices, then Start.
- Fold `/audio/about` into "Before we start", give that section an anchor, and
  redirect the old route to it permanently. Carry over its unique expectations
  first: async written briefs, delivery through Drive, Dropbox or WeTransfer,
  reference checks, and the line about recommending someone else when a project
  is outside what he does well. The gear inventory does not need its own page.

Evidence: [`audio/index.astro`](../../../src/pages/audio/index.astro),
[`AudioHero.astro`](../../../src/components/audio/AudioHero.astro),
[`BookingForm.astro`](../../../src/components/audio/BookingForm.astro),
[`audio/services.astro`](../../../src/pages/audio/services.astro),
[`audio/about.astro`](../../../src/pages/audio/about.astro).

### S10. Project journals carry the heaviest load on the site

**Priority: medium. Effort: medium. Governed by an existing plan.**

`/building/personal-website` renders 110 clickable elements, 65 images and a
17-entry timeline, with two "Development journal" links in the header area, a
before/after comparison, a six-page comparison accordion and a closing section
([capture](assets/personal-website-journal-desktop.webp)). The clearest evidence
on that page, the "What changed, page by page" accordion, sits below the
seventeen design-study milestones.

The [September 21 journal plan](../../superpowers/plans/2026-09-21-journal-experience.md)
already specifies the reading model for this page: a Latest work view capped at
five entries, an authored project story, and a separate archive route, never the
full archive inline, scoped to the Personal Website page so that the shared
`ProjectTimeline` and `ProjectUpdates` components keep serving Threadline and The
Engineer's Daily unchanged.

**Recommendation.** Implement that plan rather than a new one. This audit adds
two ordering points to it: place the page-by-page comparison above the journal,
and remove the duplicate "Development journal" header link. Keep every
milestone, caption, date, ID and bookmark reachable, as the plan requires.

Evidence: [`building/personal-website.astro`](../../../src/pages/building/personal-website.astro),
[`ProjectTimeline.astro`](../../../src/components/ProjectTimeline.astro).

### S11. One generic illustration is spread across five pages

**Priority: medium. Effort: small.**

The notebook appears on Home, About, Audio, the audio portfolio and The
Engineer's Daily. The headphones appear on About and Audio, the controller on
About and Building, the Threadline still on Home, Building and Threadline. Masks
also vary (radial on About and Building rows, linear elsewhere).

**Recommendation.** One primary purpose per illustration. Remove the notebook
where it is generic decoration on unrelated pages (Audio "Working together", the
portfolio outro, The Engineer's Daily "Behind the idea") and keep it where it
means something (Writing, the About chapter). A project image that identifies
the same project may appear on Home, Building and the project page. About's
chapter imagery stays. Where a section loses its image, use the plain section
framing rather than a substitute picture. Choose one mask treatment.

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

**Recommendation.** Standardize the framing, not the content: one section heading
treatment, one spacing scale, one alignment, one closing block, two link styles
(underlined link, filled button), one kicker face, one title suffix. Sections
keep the internal layout their content needs; a diagram, a project preview, an
essay and an A/B player explain different things. Remove each unused style in
the PR whose change makes it unused, not in one broad sweep.

Evidence: [`global.css`](../../../src/styles/global.css),
[`Footer.astro`](../../../src/components/Footer.astro),
[`services.ts`](../../../src/data/services.ts).

## What to keep

These already serve the purpose and should survive the simplification untouched:

- The palette, the Newsreader display type, the name mark and the paper texture.
- The Home studio scene and personal introduction; the About terrain, chapters
  and chapter imagery.
- The Lyft before/after and Skupos progression diagrams on Work.
- Collapsed experience rows with the grouped Lyft and Skupos accounts.
- The approval-gated resume request and the single general resume.
- The A/B comparison player, the actual music, and the approved audio prices.
- Journal captions, dates, milestone IDs and bookmarks.

## Agreed structure

```
Header        Work · Building · Writing · Audio · About · [Work with me]
Phone menu    Work · Building · Writing · Audio · About · Work with me: Mixing & mastering · Website design · Software engineering · Get in touch
Footer        GitHub · LinkedIn · Audio · Work with me · Support my work · Privacy

Home          Hero (name, intro, 1 link) · Work with me strip (3 offers) · Building (≤2) · Work (1 proof) · Writing (1) · Contact
Work with me  Hub at /services: 3 doors · Software engineering offerings (Prototypes, Products & tools, Website design, Integrations) · experience line · contact · resume
Work          Lede with three facts, preference sentence, Request resume, Hire me for software · 2 highlights with diagrams · Experience rows · one closing invitation
Building      Intro · project rows, each with a status · (no closing block)
Writing       Intro · essay · topic in progress
About         Intro · 4 chapters · full working preference · Contact · Request resume
Audio         Hero (offer and prices, Start your song, Prices and scope) · Listen · Services · Start
```

Three journeys this structure guarantees, from any page: mixing and mastering
in two clicks (Work with me, then the offer) or one from Home; a website
designed in two clicks or one from Home; a software project in two clicks or
one from Home. On the phone each is two taps from the menu.

## Agreed order of work

Each step is one narrow, reviewable PR. Unused styles leave in the PR that
stops using them.

1. **Header, hub and destination labels.** Six header items with the "Work
   with me" button, the phone menu group, the footer label, the `/services` hub
   (three doors, section anchors, resume and contact lines, switcher removed),
   the Home strip, and one label per destination.
2. **Audio consolidation.** One funnel on `/audio/start`, a preserved path from
   `#book`, verified delivery before the old endpoint retires, `/audio/about`
   redirected, landing page repositioned around the paid offering and something
   to hear.
3. **Page introductions.** Work, Building and About headers; "At a glance" and
   "How I work" removed with their content redistributed as in S6; evidence
   brought forward.
4. **Home.** "Beyond the code" removed, hero copy tightened with the audio line,
   shared section framing, contact pattern unified.
5. **Website journal.** The September 21 plan, plus the two ordering points in
   S10.
6. **Building rows and remaining decorative duplication.** Status on every row,
   Threadline and servant-lang per S7, notebook removed where generic.

**Success check.** After steps 1 to 4, ask a few unfamiliar people to complete
three short tasks and watch where they hesitate: assess the engineering
experience and find the resume request; hear the engineering work and begin an
inquiry; understand what is being built and make contact. That observation, not
a link count or a screen count, decides whether the simplification worked.

## Decisions recorded

Owner decisions, given in conversation on September 26:

- Header: keep Audio and Services findable; dropping both was not acceptable.
  Resolved as six header items with Audio, and Services through the three
  explicit links in S1.
- Audio intake: `/audio/start` stays; it is the flow most likely to bring paid
  work. The booking form retires after delivery is verified.
- Home "Beyond the code": remove it, since that simplifies the page.
- Wayfinding (after seeing the rendered preview): a footer "Software services"
  link is too hard to find, and "Services" or "Audio" as labels do not tell a
  visitor what is offered. Anyone looking for mixing and mastering, a website
  designed, or a serious software project must find it from any point on the
  site without digging. Resolved as the "Work with me" button, hub, Home strip
  and phone menu group in S1 and S5. This supersedes the earlier placement of
  Services in the footer and on Work only.

Answers from the second review (Astra), accepted:

- Redirect `/audio/about` permanently to an anchored "Before we start" after
  carrying over its unique expectations.
- Hide servant-lang for now.
- Threadline becomes a row with its status until there is an inspectable
  artifact.
- Work heading: "Software engineer. Building with AI."

## Review reconciliation, September 26

The second review agreed with simplifying, and with six of the seven decisions
as proposed, and changed the following. Each change is already reflected above.

- **"Reading burden is solved" was too strong.** Low word counts establish
  brevity, not clarity; the Audio landing page is the clear case. The main
  finding now says so, and the click counts are described as inventory rather
  than scores.
- **Header: six items, not five.** Audio serves a distinct audience and a
  commercial purpose. Services leaves the header only with explicit named
  replacements (S1).
- **Labels: consistent destinations, not uniform actions.** "Email me", "Get in
  touch" and "Start your song" describe different behavior and stay distinct
  (S4).
- **Home keeps an audio mention.** Removing "Beyond the code" must not remove the
  service line from Home, and the personal introduction is not replaced by the
  Work heading (S5).
- **Work keeps four short things near its introduction**: the preference
  sentence, Request resume, Software services, and the website project as AI
  evidence (S2, S6).
- **Framing is standardized, content is not.** Shared heading, spacing, alignment
  and link behavior; internal section layouts follow their content (S5, S12).
- **"One home per illustration" became "one primary purpose per illustration."**
  Project thumbnails may repeat where they identify the same project; About's
  chapter imagery stays (S11).
- **"One contact invitation per page" became "no redundant contact panels."** The
  header button is inside the phone Menu, so one closing invitation after the
  evidence stays (S3).
- **Audio moved from fifth to second in the order of work**, and the first PR
  was narrowed to the header and labels. Style cleanup rides the PR that makes
  each style unused.
- **The journal recommendation defers to the September 21 plan**, which this
  audit had not reconciled (S10).
- **A visitor test was added** as the success check.

Owner revision after the rendered preview, September 26:

- **Services links moved from the footer to a named door on every page.** The
  review's "Software services on Work and in the footer" was accepted first,
  then revised once the owner saw it rendered: it did not make the three offers
  findable. The header button, hub, Home strip and phone menu group replace it
  (S1, S5). The review's "no dropdown" still holds; the hub is a page.

## Verification record

- Twenty public routes rendered at both widths; all returned 200; no document
  overflow at either width.
- Heading and CTA inventory captured from rendered DOM for every route; counts
  in the table above come from that inventory.
- Illustration reuse counted from imports in `src/pages` and `src/components`.
- Dead code confirmed by grep: no `<Footer>` without `compact`; no route imports
  `audioSheet`; no markup uses `btn-primary` or `lede`.
- Audio form endpoints confirmed in source: `BookingForm` posts to
  `/api/audio-inquiry`; the `/audio/start` flow posts to `/api/audio-intake`.
- The September 21 journal plan was read after the second review raised it; its
  scope and constraints are quoted in S10.
- Forms were not submitted. No resume, publication or payment flow was exercised.
- This is an editorial, information-architecture and visual-consistency audit
  with rendered measurements. It is not user research or an accessibility audit;
  the existing focus styles, reduced-motion handling and skip link were observed
  working and are out of scope here.
