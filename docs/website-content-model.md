# Website content responsibilities

Status: Refined through September 10, 2026, and updated September 26 for the
website simplification audit. The five primary areas and the
distinction between Work as capability evidence and Building as project exploration
are agreed. The [visual-study index](design-concepts/README.md) records
selected page compositions and deeper templates. Audio is now a primary header
destination alongside Work, Building, Writing and About: it serves a distinct,
commercial audience. Final copy, production assets, and interaction
behavior still require validation. The proposed [system plan](website-system-plan.md)
turns these responsibilities into repository conventions. Home and the four primary
page compositions, project/article details, Audio and the contact flow are implemented locally. Integrated whole-site verification passes. The website project and redesign topic are also implemented locally; see the [journal increment review](redesign-story-material.md). Nothing has been deployed.

Based on the [agreed direction](website-direction.md) and
[website audit](audits/2026-09-09/website-audit.md).

## Organizing idea

Let visitors meet the person, explore what interests him, and inspect evidence
of his abilities. Provide clear routes to greater depth without requiring that
everyone read the full profile.

Each fact or extended story has one primary home. Other pages may summarize it
for a different reader need and link to that home. Different summaries are useful;
independently maintained dates, outcomes, and project status are not.

## Home: meet me and find a reason to explore

**Visitor outcome:** understand who Kazon is, what interests him now, the kind of
work he does, and where to explore or make contact.

Home owns the introduction and editorial selection. It draws its supporting
material from the other areas rather than maintaining a second portfolio.

Approved desktop composition: [Quiet studio, version 2](design-concepts/2026-09-09/home-quiet-studio-v2.png).
Home mobile v2 is also approved. The owner accepted the implemented Home prototype.
Its production assets and responsive behavior have local QA records. The motion
layer proposed on September 27 is described under "Home motion" below.

The owner welcomes an expressive homepage with motion and potentially 3D,
including exploration of Three.js. This is permission to explore the experience,
not a selected dependency or implementation. Personality, play, and a sense of
discovery can be legitimate purposes alongside explaining technical work.
Identity and navigation should remain readily understandable; sound stays
user-initiated, and essential content must remain available with reduced motion
or without the enhanced experience. The homepage can be more exploratory while
Work provides a direct path to professional evidence.

Proposed emphasis:

- A short introduction that includes engineering experience without making
  contract availability the defining message.
- A small selection of current interests or projects, explained through a
  concrete example where one is available.
- A compact route into demonstrated work and professional background.
- A route into writing and personal context, plus an easy contact invitation.

Move the complete employer list, full project inventory, and extended AI
philosophy to their respective homes. Retain summaries only when they add
orientation. These are content priorities, not a prescribed section count or
layout order.

## Work: understand what I can do and how I work

**Visitor outcome:** form an accurate professional profile and inspect relevant
evidence without reconstructing it from several pages.

Work owns the professional overview, career chronology, and selected accounts of
contribution and outcome. Explain the problem, Kazon's role, the consequential
decision or intervention, and what changed. Link to permitted evidence and label
illustrative reconstructions appropriately.

Include working preferences and a clear path to contact and the existing
approval-gated resume. The public overview should be useful to someone sharing
the page with a hiring manager even before a resume is delivered.

September 10 decision: offer only the general resume for now. Retire the
DoD-focused option and version selection as part of implementation, preserving
approval before delivery. See the [approved request flow](design-concepts/README.md#resume-and-contact).

This area can include personal projects, audio work, and future open-source
contributions when they demonstrate a relevant capability. It is not restricted
to paid work. For a project whose detailed account lives under Building, summarize
the contribution here and link there instead of creating a competing journal.

Retain the existing Lyft explanation as usable evidence. Consider Skupos and
cross-team work for further treatment, subject to confirmed claims and suitable
material. Do not automatically promote every former role into a full case study.

## Building: explore what I am making and learning

**Visitor outcome:** understand a project's purpose, why Kazon cares about it,
what exists today, and how to explore its development.

Building owns the public project directory and project destinations, including
their current state, demonstrations, and history. It can retain released or
paused projects; the section is not restricted to unfinished software. Emphasize
the current experience before the history of how it was built.

Curated project context belongs to the website. Supported progress and changes
in direction continue to come from the owning project records through the
existing publication contract. This is not a second roadmap or tracker.

The Engineer's Daily already has visual material to work with. Threadline has
published context and progress but needs an appropriate artifact if we want to
show its interaction. Reconcile the other projects currently scattered across
Home and About before selecting what to feature. Appearance on the existing site
does not establish current priority or active development.

### One Development journal per project

Use **Development journal** as the consistent public destination name. Design
studies, implementation, testing, and launch are kinds of milestones in one
chronological journal, not separate destinations named Design history or Design
notes. The project overview introduces the purpose and current state; it links
to that journal. Essays remain separate reflections that link to relevant work.

Preserve existing visuals, captions, supported dates, milestone IDs, and old
section bookmarks when reorganizing. The Engineer's Daily keeps all five visual
stages and their artifacts; the website keeps its eleven visual milestones.
The shared timeline combines curated entries and published updates by work date.
Curated entries remain repository-owned and must not also be published as new
feed records. Existing publication corrections and withdrawals clear affected
feed content while leaving curated work readable. Repeated polls must not reset
the reader's context or focus in that fallback.

Private project records, evidence, and backups remain separate from this public
presentation. Saving a private checkpoint does not publish it. This naming and
composition decision uses existing storage and publication mechanisms; no new
ADR or content-storage system is needed.

## Writing: follow an idea

**Visitor outcome:** understand a point of view, argument, or lesson and follow
its connections to actual work where useful.

Writing owns essays and their supporting explanations. Establish a real index
and consistent article metadata. Existing long-form AI philosophy belongs here;
short references on Work or About should point to it.

Use visuals, sound, or interaction where they explain the idea more clearly.
Keep prose where the argument depends on it. A project mention can link to its
journal without reproducing that journal's status or history. Do not invent
publication dates that are not supported.

## About: understand the person and connect

**Visitor outcome:** understand Kazon's background, interests, motivations, and
preferred relationships well enough to recognize a possible connection.

About owns the fuller personal introduction and a shared contact destination.
Audio, gaming, faith, and other interests can appear where Kazon wants them to
be part of the public picture. Their prominence is an owner choice, not a
conclusion inferred from how often they appear in the current content.

Approved desktop composition: [Personal path, version 1](design-concepts/2026-09-09/about-personal-path-v1.png),
adapted from D. The owner affirmed that its audio origins, transition into
software, play, and future possibilities capture what he wants to share at a high
level. Preserve that brevity. Keep direct section access alongside the path;
the About mobile v1 composition is also approved. Interaction behavior remains
to be defined.

Keep the audio-to-software background story. Move detailed employer accounts to
Work and project inventories to Building. Link to working preferences and
extended writing rather than repeating them.

Keep the existing resume request destination reachable while making its entry
point obvious from Work. A curious visitor should be able to contact Kazon
without presenting a fully scoped project. The approved
[contact study](design-concepts/README.md#resume-and-contact) simplifies the
general inquiry; implementation must preserve delivery and privacy safeguards.

## Audio: one funnel, offer led

`/audio/` leads with the paid offer and the approved starting prices (from
$150 for two-track vocal mixing, from $75 for mastering, from $200 for both;
custom mixing, production or recording work is quoted after review), a
"Start your song" button and a "Prices and scope" link to `/audio/services`.
Below the hero: Listen (the Old News release, distinct from the mastering
engineering example that demonstrates the work, plus one "Portfolio" link),
What I work on (the four service categories, linking back to prices and
scope), and Start (a one-line lead and the same "Start your song" button).
Audio is a primary header destination alongside Work, Building, Writing and
About; it serves a distinct, commercial audience and earns that placement.

There is exactly one intake funnel: the three-step `/audio/start` form,
posting to `/api/audio-intake`. `/audio/#book` keeps working through the
Start section's own anchor, which carries the "Start your song" button. The
secondary Audio bar (`MusicNav`) is Listen, Portfolio, Services.

`/audio/about` permanently redirects to `/audio/services#before-we-start`.
Its unique process detail now lives in that section's opening paragraph:
communication is async, most projects start with a written brief and files
shared through Drive, Dropbox or WeTransfer, mixes are checked on multiple
reference systems before delivery, and a project outside what Kazon does
well gets a recommendation elsewhere rather than accepted. The gear
inventory and the university line (already on About's Audio chapter) did not
need their own page.

The audio destination still owns recordings, credits, listening context, and
audio engagement detail. This avoids a second copy of each recording's
metadata on the main site.

## Proposed treatment of existing material

- **Keep and make easier to find:** the portrait and personal introduction,
  supported career outcomes, Lyft comparison, project journal artifacts, resume
  request flow, and direct paths into contact.
- **Consolidate:** employer facts under Work; public project destinations under
  Building; extended AI philosophy under Writing; personal background under About.
- **Rewrite around current intent:** availability, introductions, contact framing,
  and related metadata. Keep the services sheet specific to real contracting
  offerings rather than treating it as the general profile.
- **Hold from greater prominence until confirmed:** project currency, dated
  versions, location, unsupported implications about results, and material whose
  public detail needs review.
- **Create when material is available:** publishable audio excerpts, selected
  product demonstrations, concise work evidence, and future contribution records.
- **Retire duplication, not history:** preserve useful deeper accounts and
  inbound links when migrating content. Do not delete a project merely because
  it is no longer current.

## How to choose prominence

An item deserves prominent space when it reflects an interest Kazon wants to
pursue, helps a visitor understand something meaningful, and can be represented
honestly with the available evidence. Strong presentation alone does not make
a project the right homepage feature. Recency and employer recognition alone
are also insufficient.

Show the meaning and the evidence first; offer technical detail and history on
demand. Any medium must have a clear explanatory purpose and a usable fallback.
No universal animation, card, timeline, or demonstration format is selected.

## Remaining content and behavior decisions

1. Which current interests and existing material should lead, after project
   currency and public evidence are confirmed?
2. What experience should motion or potential 3D create on Home, and how does
   it connect to the selected content and Kazon's personality? Answered by the
   "Home motion" worlds below, which the owner kept on September 27.

Use the selected presentation models and system plan to prototype Home, then
validate behavior and content before expanding across the site.

## Home motion, September 27

Proposed after the owner asked for a Home that feels alive and changes worlds as
you scroll, while keeping the site's goals. The owner chose to keep the dark
screen world and the notepad trail in the hero's resting frame (September 27,
in conversation). The content, order and copy of Home
are unchanged from the September 26 audit (hero, Work with me, Currently
building, one Work proof, Writing, Contact); only presentation and motion change.

The worlds follow the hero tagline, "Software, sound, and things worth exploring":

- **Studio (paper).** The hero artwork plays one short scene on arrival: the
  monitor re-types its last lines of code, the headphones give off three rings,
  and a terracotta trail is drawn on the notepad from the pen tip. It rests within
  five seconds and replays only when the visitor returns to the top or points at
  the studio. Work with me stays on paper; its doors rise in turn.
- **Screen (software, dark).** Currently building and the Lyft proof sit inside
  a dark screen that arrives as a rounded panel and widens to full width. The
  site's own tokens are inverted for that subtree, with the terracotta lifted for
  contrast. Project captures glow like screens and lean toward a fine pointer.
  The Lyft figure counts up beside one cell per 5,000 rows.
- **Sound.** The screen ends in a waveform: paper peaks rise into the dark and
  dark peaks fall into the paper. It swells as it crosses the viewport and is
  silent at either edge. It is a picture of sound; nothing plays.
- **Notebook and horizon (things worth exploring).** The essay title is inked in
  and underlined with a pen stroke; a sun rises over the contact rule as the page
  ends.

Rules the implementation keeps: every resting frame is in the HTML and CSS, so
the page is complete without JavaScript and with reduced motion (the view CI
screenshots use). Motion that plays by itself finishes within five seconds;
everything else is tied to scroll or pointer. A keyboard user who lands inside a
block that has not revealed yet sees it at once. No new dependency, image or
claim; the only new visible text is the capacity key (one cell = 5,000 rows).
The script is about 2.4 KB gzipped. Three.js was not needed for this
concept. Code: `src/components/home/`, `src/scripts/home-worlds.ts` and
`src/lib/home-motion.ts`, on the shared layer in `src/scripts/scroll-scenes.ts`.

### Motion on the other pages, September 27

The owner asked for the same life across the site. Each page gets motion sized to
its job, on the shared layer; content, copy and order are unchanged everywhere.

- **About:** the path between chapters draws as far as the reader has scrolled
  (still hidden below 800 px, per the audit), and each chapter's object plays one
  short scene as it arrives: rings from the headphones, a glow and caret on the
  laptop's `</>`, the controller's buttons pressing in turn, a glow from the
  notebook's sun. The terrain drifts slightly with scroll.
- **Audio:** the hero headphones give off the same rings on arrival and the
  sections rise in. It stays light: this page sells, and playback is untouched.
- **Building:** the feature and the project rows rise in; the Tally capture leans
  toward a fine pointer and the row pictures lift on hover.
- **Work:** restrained for recruiters. Only the two evidence diagrams build as
  they arrive (before, then after; each timeline step in turn).
- **Writing:** the direction illustration draws its path through the checkpoints
  on arrival, once. It starts on load; where the page first shows it off screen
  (small or landscape phones, or a link to a piece further down), it waits until
  it is half on screen. The essay page itself is unchanged.

## Implemented content locations, September 10

- Shared career chronology, dates, working preference, and Lyft capacity values: `src/data/profile.ts`.
- Work story summaries and explanatory context: `src/pages/work.astro`; native diagrams: `src/components/WorkDiagram.astro`. `ExperienceRow` provides the five optional career disclosures.
- About introduction: `src/content/pages/about.md`; short personal chapters and their artwork: `src/pages/about.astro`. Older career anchors offer an onward link to Work. Detailed private operational material from the old About body is no longer rendered or retained in current content; this does not erase Git history.
- Building selection and summaries: `src/pages/building.astro`. Daily title/subtitle and its journal remain driven by the existing story JSON. Threadline progress remains in its existing journal. Other project rows use supported descriptions and existing destinations; servant-lang is hidden until it has a public repository, explanation, or artifact (per the September 26 simplification audit, S7).
- Writing feature: existing essay metadata via the content collection. No new date, article, or newsletter was invented.
- New resume requests: general only in the form and validation. Stored legacy audiences and PDFs remain compatible with approval and delivery. No KV migration, PDF deletion, or remote delivery occurred.

This increment uses curated index compositions. It does not add a page-block language, CMS, separate status tracker, or dependency. Extract another shared content source only when an actual second consumer needs the same fact.

## Current professional positioning, September 10

Lead with “Software engineer. Building with AI.” and the interest in shaping
solutions through exploration and iteration. Backend/data experience remains
career evidence rather than a promoted specialty. Keep the current opportunity
statement in `src/data/profile.ts` for Work and About; Home uses a brief
introduction. The owner does not need to originate the idea to enjoy the work.
No layout, imagery, career facts, project status, or delivery flow changes are
required for this positioning adjustment.

### Lyft team scope correction, September 10

The owner clarified that Lyft experience spans Rentals, Associate Tools and Comms Platform. `src/data/profile.ts` now owns `lyftTeams`, with rebooking, the rentals-service migration and touchless drop-off grouped under Rentals; bulk driver bonuses under Associate Tools; and the newly recalled quiet-hours preference integration under Comms Platform. The owner subsequently confirmed that fare recalculation belongs to Associate Tools; it is now grouped there. Do not infer team dates, ordering, or more Comms Platform accomplishments.

Work exposes a direct link from the featured Associate Tools story to the full three-team account. It uses the existing ExperienceRow disclosure with a slot for grouped content. Astro check and build passed; the local built page passed at 1440, 800, 390 and 320px, including direct hash opening, all team/project content, no overflow, and no-JS disclosure. Desktop and mobile screenshots were visually inspected. No resume PDFs or remote publications changed.

### Audio and forms, September 10

`src/data/audio.ts` owns the short service descriptions. Recording metadata stays in the audio-tracks collection with optional notes. `src/scripts/form-submission.ts` shares only interaction states across the three existing forms; each retains its own payload and server endpoint. Home /#contact remains the accepted general-contact destination, with name/email/message and optional company. About /about#resumes keeps the general, approval-gated resume request. (September 26: Audio #book now leads into the `/audio/start` intake rather than a separate inquiry form; see "Audio: one funnel, offer led" above.)

## Website project and writing topic

`src/data/project-stories/personal-website.ts` owns the project description,
curated design milestones and essay-topic metadata. The essay is tracked through
author review and publication in GitHub issue #45.
`src/pages/building/personal-website.astro` owns the comparison and project
composition, using the shared layout/timeline. Building links to it; Writing
uses the same topic metadata at `#website-redesign` and links to the actual notes.
The eleven visual milestones are a dated retrospective, not feed publication receipts. `website-pages.ts` holds six actual page comparisons. Historical studies retain selection labels and owner feedback; they do not stand in for implemented screenshots.

Private checkpoints in `.private/development/journal/` own continuity and
source snapshots. Public notes are selected disclosures and are never a mirror
of those files. One Development journal combines these curated visual milestones with the
`personal-website` publication feed through `websiteFeed` and `ProjectUpdates`.
Entries are ordered by work date, preserving order within each day. Curated
`website-*` entries remain repository-owned and must not be republished through
the feed: new publications use distinct identities. Corrections to curated entries
belong in reviewed source changes; feed corrections retain the existing immediate
clearing behavior. It disables
response caching and retains the visual retrospective if live data is unavailable.
Deployment and renewed OAuth consent are required before the publisher can use
this additional project. Private journal writes never depend on the website being
online. A finished essay will develop the argument rather than duplicate the journal.

## Work with me hub and services overviews

`/services` is the "Work with me" hub. It opens with three doors, one per thing a
visitor can hire Kazon for (mixing and mastering, website design, software
engineering), each with a picture of real, verifiable work, one line and one
button that starts the conversation (`src/data/work-with-me.ts`, rendered by
`WorkWithMe.astro`): the mixing door opens the `/audio/start` intake, the other
two open the contact form. Below them the software engineering offerings from
`src/data/services.ts` keep their one-page print view, followed by the
experience line, a closing contact and a line for the other two audiences
(request a resume, get in touch). The hub is one step from every page: the
header button, the phone menu's "Work with me" group (which also names the
hub's offer sections), the footer, and Work; the Home strip under the hero
shows the same three doors. Audio's prices and scope live at `/audio/services`.
The old `/services.html` address redirects to the hub. Audio belongs within the
personal site, with its existing hostname retained as an alternate entry and
main-site canonicals.
