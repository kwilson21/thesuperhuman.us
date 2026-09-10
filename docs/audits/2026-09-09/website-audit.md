# Website audit against the agreed direction

Date: September 9, 2026. Status: findings and recommendations for discussion.
Basis: [Website direction](../../website-direction.md).
No presentation model, component library, or implementation plan is approved by
this audit.

## Main finding

The website contains substantial experience and some effective visual evidence,
but asks visitors to assemble the picture themselves. Career history and
AI-assisted development recur across several pages, while current interests,
project status, and opportunities to explore are less consistently organized.
Its introduction still sells contract engineering more strongly than it expresses
the person and future direction described in the brief.

The first need is editorial structure and discoverability. The second is evidence
that helps visitors understand the work. A new visual identity or framework is
not justified by these findings.

## Scope and confidence

Reviewed the public Home, Work, Building, two project journals, the existing
essay, About, Audio home, Audio about, and services one-pager. Compared their
behavior with the local route, component, content, style, and documentation files.
Local HEAD at inspection: `67769c6`.

Browser inspection used Chromium at 1440 × 900 and 390 × 844. Primary pages
returned HTTP 200. The proposed `/writing` index returned 404. The existing
`/services.html` URL resolved to `/services` and returned 200.

This is an editorial, information-architecture, and maintainability audit with
selected usability checks. It is not user research, a full accessibility audit,
a performance benchmark, or independent verification of career claims. No forms
were submitted, resumes requested, publication actions performed, or external
project applications evaluated. Existing private resume PDFs were not inspected.

Observed counts below use rendered `body.innerText`, split on whitespace, with
default disclosure states. They include navigation and form labels, exclude
collapsed text, and can change with live updates. They indicate reading burden,
not comprehension, quality scores, or a target word limit.

## Findings that should shape the next design discussion

### A1. The first impression still implies a narrower future

**Priority: high. Type: positioning and presentation.**

The homepage availability line, introduction, metadata, About, and services sheet
emphasize contracting. Work closes with an invitation to bring difficult
engineering problems. These are credible descriptions of past positioning, but
do not express the newly agreed openness to self-directed exploration,
collaboration, and interesting employment.

The contact form already includes “Full-time role” and “Just exploring.” This is
an inconsistency between invitation and destination, not a missing employment
option. Its surrounding project, timeline, and budget framing still assumes a
commercial inquiry more strongly than a curious conversation.

**Action: clarify.** Reconcile the introduction, metadata, availability language,
contact framing, services collateral, and agent instructions together. Preserve
the distinction between interests and services actually offered. Do not invent a
new preferred role or imply willingness to take every engagement.

Evidence: [Hero](../../../src/components/Hero.astro),
[Contact form](../../../src/components/ContactForm.astro),
[About content](../../../src/content/pages/about.md),
[services sheet](../../../public/services.html), [CLAUDE.md](../../../CLAUDE.md).

### A2. Visitors do not have a consistent map

**Priority: high. Type: navigation.**

Home offers Work and About near the introduction. Work, About, and the essay
have no shared navigation to Home, Building, Writing, and About. Their footer
links to Work, the individual essay, and Resume. Project journals have their own
Home/All projects navigation. Building lacks an H1 and acts as two project
features rather than a clear index. There is no Writing index.

Audio links back to the engineering site, but the inspected main-site links do
not reciprocate with a link to the audio destination. Audio is mentioned in About
without a route into listening or exploring that practice.

**Action: create and clarify.** Establish the agreed five-area navigation and
decide how Audio relates to it. Give each area an explicit purpose and a clear
way back. The menu treatment and page templates remain design decisions.

Evidence: [Base layout](../../../src/layouts/BaseLayout.astro),
[Footer](../../../src/components/Footer.astro),
[Building](../../../src/pages/building.astro),
[Audio footer](../../../src/components/audio/AudioFooter.astro).

### A3. Repetition obscures both the person and the evidence

**Priority: high. Type: editorial and maintenance.**

Home contains approximately 935 visible words, Work 757, and About 1,885.
All three present the same five employers. AI philosophy appears across these
pages and a separate essay. Project descriptions also recur with different
levels of detail and currency.

About contains useful personal context, but the long career account dominates it.
On the measured mobile viewport it occupied approximately 11,750 vertical pixels;
Home occupied 9,755. These are snapshots, not evidence that visitors abandon them.
They do demonstrate how much scrolling the current default presentation requires.

**Action: consolidate.** Assign a primary home to career evidence, personal
background, project status, and extended philosophy. Summaries elsewhere should
serve their page's purpose and lead to that deeper account. Do not remove useful
detail simply to reach a word count.

Evidence: [Home](../../../src/pages/index.astro),
[Work](../../../src/pages/work.astro),
[About content](../../../src/content/pages/about.md).

### A4. The strongest existing explanation is useful but not a universal template

**Priority: high. Type: evidence presentation.**

Work's Lyft example combines a proportional capacity comparison with a
before/after responsibility flow. It explains both scale and why the change
mattered. The source explicitly identifies owner-reported figures and avoids
claiming that the diagram measures elapsed time. Controls worked in the browser,
and reduced-motion mode disabled the step animation.

Most other work examples remain paragraphs and technology lists. Their prose
contains potential evidence of ownership, collaboration, and outcomes, but does
not consistently offer an inspectable artifact or compact explanation. The Lyft
migration paragraph and the different bulk-bonus example also share one story
block, requiring the reader to notice the change of project.

**Action: keep and clarify.** Preserve the existing comparison's honesty and
purpose. Assess other stories individually for the evidence needed to explain
them. Do not force each into a chart or claim that an illustration independently
verifies a result.

Evidence: [Lyft explanation](../../../src/components/LyftWorkStory.astro),
[captured comparison](assets/work-comparison.png).

### A5. Building is selective without explaining the selection

**Priority: high. Type: content ownership and evidence.**

Building features The Engineer's Daily and Threadline, while Home lists additional
personal projects and About introduces still more. There is no unified view of
what is current, exploratory, available, paused, or historical. Some version and
status statements are undated or embedded in narrative.

The Engineer's Daily journal is a strong exception: it distinguishes concepts
from a local prototype and gives dated visual history. Its five design stages
contain ten image assets. The current screenshot is repeated in the selected
history entry, and the separate development feed currently says there are no
published milestones. These two histories need clearer framing to avoid an
apparent contradiction. The homepage preview shows a selected concept, not the
latest local prototype, and labels it accordingly.

Threadline explains its intended experience and distinguishes built work from
availability, but has no visual artifact in the inspected journal. A reader can
understand the intention without being able to inspect the interaction itself.

**Action: reconcile and create selectively.** Confirm the project inventory and
current status with the owner and owning project records. Decide which projects
merit public emphasis. Add evidence only where the existing artifact and
publication permissions support it. Do not turn this inventory into another
project tracker.

Evidence: [Building](../../../src/pages/building.astro),
[Daily journal](../../../src/pages/building/the-engineers-daily.astro),
[journal data](../../../src/data/project-stories/the-engineers-daily.json),
[Threadline journal](../../../src/pages/building/threadline.astro).

### A6. Writing expresses a clear idea entirely through prose

**Priority: medium. Type: presentation and discovery.**

The existing essay contains approximately 1,129 visible words including its
header and footer. Short paragraphs help pacing, but there is no diagram,
illustration, interactive example, or link from its project discussion to a
project journal. Its central idea about direction and feedback is repeated in
several forms. The article has no visible publication date.

**Action: clarify and evaluate.** Give writing an index and appropriate metadata.
Assess whether one explanatory visual would communicate the central relationship
more efficiently, while retaining prose for the argument. Any simulated behavior
must be labeled as illustrative. No animation or rewrite is selected yet.

Evidence: [Essay](../../../src/content/pages/ai-gives-you-speed.md),
[article route](../../../src/pages/writing/ai-gives-you-speed.astro).

### A7. Audio needs actual material before it needs richer controls

**Priority: medium, higher if audio becomes prominent. Type: evidence gap.**

The live audio homepage has zero audio players and displays “More examples
coming” under all four services. The repository already has native playback,
track metadata, role labels, a player coordinator, and file delivery support.
The content inventory contains no audio-track entries.

**Action: create content.** Select excerpts that may be published, confirm credit
and permission, identify Kazon's contribution, and describe what to listen for.
A before/after comparison requires suitable paired material; it is not a
prerequisite for sharing a useful finished example. Do not build a custom player
to compensate for absent recordings.

Evidence: [Track row](../../../src/components/audio/TrackRow.astro),
[collection schema](../../../src/content/config.ts),
[Audio home](../../../src/pages/audio/index.astro).

### A8. Screening evidence exists, but the visitor must assemble it

**Priority: high. Type: audience outcome and evidence.**

Titles, dates, achievements, technical experience, location statements, and
contact details are available. Resume links jump directly to the request section,
so users need not scroll through About manually. Selecting the DoD card correctly
selected that audience in the form during inspection.

However, there is no concise, clearly bounded public account combining current
interests, relevant capabilities, selected evidence, and working preferences.
The services sheet is a contracting artifact, not an equivalent general profile.
The approval-gated resume is an intentional privacy boundary and should remain.

**Action: consolidate and confirm.** Determine what a recommender should be able
to quote or share directly from the website without needing private contact
details. Verify current location, availability, project versions, and owner-reported
career figures before rewriting them. The main and audio footers currently differ
between relocation language and Northern Virginia as the location.

No selected external contribution or independent endorsement was found in the
inspected pages. This does not establish that none exists. Open-source contributions
can become future evidence, but should not be manufactured as a portfolio checkbox.

### A9. The visual foundation is coherent; attention and delivery need care

**Priority: medium. Type: visual hierarchy and media delivery.**

The existing paper/ink palette, editorial typography, rules, portrait, and
restrained controls form a recognizable foundation. No horizontal document
overflow was observed on the nine primary pages at the two tested widths.

On mobile Home, the portrait precedes the introduction; the name begins roughly
508 pixels down and primary links begin near the bottom of the first 844-pixel
viewport. This is an attention-allocation decision to revisit, not proof that the
portrait should be removed.

Journal image files range from roughly 756 KB to 2.3 MB on disk. The same full-size
files supply small timeline thumbnails and large views, without responsive image
sources in the inspected markup. Lazy loading is already used in the timeline.
Do not equate the full asset inventory with bytes loaded on initial navigation.

**Action: preserve and refine.** Decide what the first mobile viewport must
communicate and require media sizes appropriate to their display role before
expanding visual coverage. No Core Web Vitals or connection-speed claim is made.

Evidence: [Desktop Home](assets/home-desktop.png),
[Mobile Home](assets/home-mobile.png),
[Journal](assets/journal-desktop.png),
[timeline component](../../../src/components/ProjectTimeline.astro).

### A10. Public detail needs an editorial boundary check

**Priority: high before republishing. Type: content governance.**

Some existing About and writing material describes operational methods at a
level that warrants review against the newer publication protocol. This audit
does not repeat those details or make a categorical confidentiality judgment.
Existing publication is not sufficient reason to copy the same detail into new
diagrams, captions, or case studies.

**Action: review and narrow where needed.** Preserve truthful high-level
attribution, supported outcomes, and general philosophy. Reconcile uncertain
details with source authority before reusing them. Do not require public access
to private evidence to make a truthful claim.

Evidence: [publication protocol](../../publication-agent-protocol.md).

## Repository findings

### R1. Content has several competing edit locations

Career facts live in Home, Work, and Markdown About. Project facts live in route
markup, component defaults, JSON journal data, and the publication feed. These
represent different kinds of content, but their ownership is not consistently
discoverable. Repeated rendering also duplicates publication state labels.

The writing schema defines a `notes` collection with dates and drafts, yet the
actual essay uses the generic `pages` collection and a dedicated route. Adding a
new essay has no single established route from content to index to article.

**Recommended constraint:** establish one owner for each repeated fact and one
documented authoring path per content type. Keep curated narrative distinct from
live project records. Choose exact collections and directories after the content
model, rather than moving files first.

### R2. The design system is partial, not absent

Global CSS and Tailwind already centralize named colors, fonts, widths, and some
type styles. Reusable cards, experience rows, forms, and the shared document
layout exist. Audio and publication already have useful domain boundaries.

Repeated section spacing is embedded in page classes. About and writing define
their own global prose styles. Journals introduce separate widths, heading sizes,
and some hardcoded colors. The standalone print-oriented services HTML carries
its own styling. These differences may serve real needs, but the intended
variants and exceptions are undocumented.

**Recommended constraint:** document proven conventions and deliberate variants;
extract only repetitions that have a clear shared responsibility. Preserve Astro
and the established server/domain boundaries unless a concrete finding warrants
a change. A monorepo, external component package, CMS, and new animation dependency
are not demonstrated needs.

### R3. Maintenance guidance emphasizes operations over common editing tasks

README documents operational flows, while design history and current requirements
are spread across docs. There is no concise guide for adding an essay, updating a
career fact, changing a shared visual rule, or publishing a project explanation.
The new brief and existing contractor-only instructions also need eventual
reconciliation so later agents do not reintroduce old positioning.

**Recommended constraint:** add task-oriented guidance and a small inventory of
existing patterns, linked from the current docs entry point. Examples should
render the actual shared implementation if a gallery is selected later. Keep
historical specs distinct from current requirements.

### R4. Verification should preserve existing behavior and cover presentation

The repository has logic/API tests and Astro checks. It has no checked-in browser
test suite in the inspected files. Selected interactions passed this audit, but
form error associations and visible keyboard focus for custom choice chips merit
a focused accessibility pass. No form delivery was tested.

A pre-existing local deletion of `src/assets/headshot.jpg` is still present.
Home, About, and Audio import it. Production portraits loaded, but a clean local
build cannot be assumed with that import target absent. The audit did not restore
or alter the owner's change and did not run a build or test suite.

**Recommended constraint:** resolve that asset state before implementation
verification. Retain existing checks and add targeted browser checks for whatever
navigation, media, and disclosure behavior is eventually changed.

## Material to gather, without deciding a showcase project yet

- **Current direction:** a short owner-approved account of interests and working
  preferences; no forced role definition. Needed for Home, About, and contact.
- **Project inventory:** which projects to feature, their current status, and
  supported links. Reconcile against owning records rather than infer from recency.
- **Work evidence:** confirm contribution, outcome, and permitted supporting
  material for selected career examples. Reconstructed diagrams must say what
  they represent; customer or employer material requires an appropriate basis.
- **Product experience:** where available, screenshots or short recordings that
  show an actual task and result. Explicitly separate concepts, prototypes, and
  usable releases. Threadline currently lacks such material on this site.
- **Audio:** publishable excerpts, credits, roles, and listening context.
- **Future contributions:** record meaningful public issues, reviews, or changes
  when they exist. No contribution quota or invented credential is recommended.
- **Personal context:** decide which non-work interests deserve space and whether
  additional photography or sound would communicate them better than prose.

## Decision order suggested by the findings

1. Agree what each of the five primary areas owns, including the place of Audio.
2. Select what existing material to keep, summarize, move, or retire; identify
   owner confirmations and evidence creation separately.
3. Compare concrete presentation models using that real content and its gaps.
4. Define the smallest reusable conventions that support the chosen model.
5. Plan staged implementation and verification, preserving publication controls.

The next discussion should decide content responsibilities and priorities. These
findings do not select a hero layout, animation style, universal case-study
template, showcase project, or new repository hierarchy.

## Verification record

- Nine primary pages rendered at both inspected viewport sizes; no document-wide
  horizontal overflow observed. The additional services route returned 200.
- `/writing` returned 404, confirming the missing index rather than a hidden one.
- Lyft Before/After switched visible panels; reduced-motion mode yielded no step
  animation. The linked About career anchor exists.
- Journal Home/End keys selected stages 1/5 and 5/5; Show all exposed five panels.
- DoD resume-card selection set the intended radio value; no request was sent.
- Audio had no rendered players. Playback could not be evaluated without tracks.
- Screenshots were inspected; the comparison was recaptured with motion disabled
  and the journal after its primary image decoded. Deferred image loading was not
  treated as a broken-image finding.
- Browser console noise came from the Turnstile challenge during automation; it
  was not treated as proof of a first-party form failure. Initial network-idle
  waiting timed out; subsequent checks used DOM readiness and specific elements.

This audit records observed behavior and editorial judgment. It does not measure
whether visitors can successfully summarize the profile; a later representative
reader review would be needed to validate that outcome.
