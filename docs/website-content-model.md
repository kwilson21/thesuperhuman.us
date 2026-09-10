# Website content responsibilities

Status: Refined through September 10, 2026. The five primary areas and the
distinction between Work as capability evidence and Building as project exploration
are agreed. The [visual-study index](design-concepts/README.md) records
selected page compositions and deeper templates. Audio remains a secondary
destination associated with About. Final copy, production assets, and interaction
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
Its production assets and responsive behavior have local QA records; additional
motion is still a separate exploration.

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

## Audio: a connected practice with its own destination

Recommendation: retain the current audio destination and make it discoverable
from About and shared secondary navigation. Selected audio evidence may also
appear on Work or Home when it serves those pages.

The audio destination owns recordings, credits, listening context, and audio
engagement detail. This avoids a second copy of each recording's metadata on the
main site. Lack of recordings should not prevent mentioning audio as part of
Kazon's background; it does prevent presenting an empty player as evidence.

There is no demonstrated need to add a sixth primary navigation area or move the
audio site during this stage. Revisit that if the selected content warrants it.

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
   it connect to the selected content and Kazon's personality?

Use the selected presentation models and system plan to prototype Home, then
validate behavior and content before expanding across the site.

## Implemented content locations, September 10

- Shared career chronology, dates, working preference, and Lyft capacity values: `src/data/profile.ts`.
- Work story summaries and explanatory context: `src/pages/work.astro`; native diagrams: `src/components/WorkDiagram.astro`. `ExperienceRow` provides the five optional career disclosures.
- About introduction: `src/content/pages/about.md`; short personal chapters and their artwork: `src/pages/about.astro`. Older career anchors offer an onward link to Work. Detailed private operational material from the old About body is no longer rendered or retained in current content; this does not erase Git history.
- Building selection and summaries: `src/pages/building.astro`. Daily title/subtitle and its journal remain driven by the existing story JSON. Threadline progress remains in its existing journal. Other project rows use supported descriptions and existing destinations; servant-lang has no invented link.
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

`src/data/audio.ts` owns the short service descriptions. Recording metadata stays in the audio-tracks collection with optional notes. `src/scripts/form-submission.ts` shares only interaction states across the three existing forms; each retains its own payload and server endpoint. Home /#contact remains the accepted general-contact destination, with name/email/message and optional company. Audio #book remains the structured inquiry. About /about#resumes keeps the general, approval-gated resume request.

## Website project and writing topic

`src/data/project-stories/personal-website.ts` owns the project description,
curated design milestones and potential essay metadata.
`src/pages/building/personal-website.astro` owns the comparison and project
composition, using the shared layout/timeline. Building links to it; Writing
uses the same topic metadata at `#website-redesign` and links to the actual notes.
The eleven visual milestones are a dated retrospective, not feed publication receipts. `website-pages.ts` holds six actual page comparisons. Historical studies retain selection labels and owner feedback; they do not stand in for implemented screenshots.

Private checkpoints in `.private/development/journal/` own continuity and
source snapshots. Public notes are selected disclosures and are never a mirror
of those files. This increment does not onboard a new public feed or turn the
website into its own runtime dependency. A finished essay will develop the
argument rather than duplicate the journal.

## Shareable services overviews

Software at `/services` and Audio at `/audio/services` use ServiceSheet with data
from `src/data/services.ts`. Audio offerings reuse `src/data/audio.ts`. These are
concise follow-ups to direct conversations, discoverable from Work, Audio and
secondary footer navigation. The old `/services.html` address redirects to the
software sheet. Both support a one-page print view; ordinary contact and inquiry
routes remain the next step. Audio belongs within the personal site, with its
existing hostname retained as an alternate entry and main-site canonicals.
