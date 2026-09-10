# Website design system and repository plan

September 10, 2026. Proposed implementation model based on the selected visual
studies and [content responsibilities](website-content-model.md). The owner has
requested this plan and the required [generated-image QA process](generated-image-qa.md).
Stage 1 is now implemented locally: see the [Home prototype and verification](design-concepts/2026-09-10/home-prototype/README.md).
Stage 2 is implemented locally: Work, Building, Writing, and About. See the
[primary-page verification](design-concepts/2026-09-10/primary-pages/README.md).
Project/article details and Audio/contact are also implemented locally. The
[whole-site integration review](design-concepts/2026-09-10/integration/README.md)
is complete, including the repeated Lyft link fix and restrained About path
motion. [Launch preparation](design-concepts/2026-09-10/launch-preparation/README.md)
verified live configuration and public feeds, corrected runtime form configuration,
and validated the deployment bundle. Deployment and real email/resume smoke tests
remain; nothing has been deployed.

September 10 scope update: deployment and live email tests are on hold while
the owner's pre-launch project-journal and redesign-writing additions are
resolved. Those additions are now implemented locally, with the [journal increment review](design-concepts/2026-09-10/website-journal/README.md) recording validation. [Story material and pre/post-launch work](redesign-story-material.md)
records the recommendation and source evidence. Upstream PR #34's
published Threadline illustration is integrated and checked in the redesigned timeline; enriching other Threadline
milestones remains post-launch work. Deployment and live email tests remain on hold.

## Recommendation

Keep Astro, Tailwind, and the existing delivery infrastructure. Build a small
design system from the patterns these pages actually share. Retain custom
explanations where a project or idea needs them.

The alternatives are independent bespoke pages, which would repeat today's
maintenance problem, or a generic block builder, which would introduce another
system to configure. Shared foundations and a few purpose-specific templates
provide consistency while leaving room for expressive work.

Peace is the atmosphere, curiosity is the invitation, and confidence is the
impression. Home can be expressive; Work must make evidence easy to assess.
Every section should add information. Optional sections disappear when there is
nothing useful to put in them.

## Shared foundations

- **Colors:** retain the existing `--paper`, `--ink`, `--muted`, `--rule`, and
  `--accent` values in `src/styles/global.css`. Tailwind continues to reference
  them rather than defining a second palette.
- **Type:** retain Newsreader, Inter, and the existing monospace role. Refine the
  existing display, heading, lede, and eyebrow styles against the approved studies.
  Keep a small set of named roles instead of per-page type scales.
- **Layout:** retain the measure/content/page width roles in `tailwind.config.mjs`.
  Establish shared page gutters and section spacing there; keep deliberate art
  compositions local to the page. Mobile Home is one continuous paper surface.
- **Controls:** share navigation, links, buttons, focus treatment, form fields,
  validation, and disclosure styling. Begin with existing components and native
  elements. A matching appearance must not hide different form requirements.
- **Icons:** use lightweight SVG with common stroke, size, and color rules. The
  four Audio service icons are symbolic markers beside visible headings.
- **Motion:** start with the static composition. Enhance a specific interaction
  only after it works on keyboard and touch. Reduced motion preserves the full
  page; sound begins only on request. Three.js remains an option to evaluate if
  an agreed interaction benefits from actual 3D.

`BaseLayout.astro` retains document structure, metadata, canonical URLs, and the
skip link. Add one shared navigation component used by main-site pages, and
reuse the existing footer. Audio shares visual conventions while preserving
its host-aware links and distinct inquiry destination.

## Templates and explanations

| Page family | Shared responsibility | Custom content |
| --- | --- | --- |
| Home, Work, Building, Writing, About indexes | Navigation, widths, typography, controls, recurring entry summaries | Editorial order and selected page composition |
| Project detail | Introduction, core experience, optional context, supported current state, development journal | A real screenshot, demonstration, or custom explanation appropriate to that project |
| Work story | Problem and contribution, supported outcome, source/scope, next destination | The clearest account of what changed; no mandatory repeating sections |
| Article | Title and metadata, reading column, optional contents navigation, figures, related links | The full argument and illustrations that help explain it |
| Audio | Intro, service icons, inquiry access, optional selected recordings | Actual credits and recordings, without mandatory listening advice |

Use Astro layouts and named slots for repeated structure. Do not create a JSON
language for arranging arbitrary page blocks. Extract components when two real
uses share behavior or markup, or one substantial interactive explanation needs
its own boundary. Do not require every section to become a component.

Reuse `LyftWorkStory`, `ProjectCard`, `ExperienceRow`, `ProjectUpdates`, and
`ProjectTimeline` where their responsibilities fit. Keep the publication adapter
in `src/lib/project-story.ts`. Reuse the existing contact/resume forms and Audio
`TrackRow`/booking flow, modifying their real caller-to-result behavior where the
approved design changes it.

## Content ownership and repository shape

Keep route files small: they obtain content and compose the page. The target
organization extends the current folders rather than moving every file:

```text
src/
  layouts/             BaseLayout and repeated detail/article structures
  components/          shared site elements and focused explanations
    audio/             existing audio components
  content/
    pages/             existing About and essay bodies
    notes/             existing collection for dated writing when needed
    audio-tracks/      recording metadata, optional context, credits
  data/
    profile.ts         canonical public career facts and shared outcomes
    projects.ts        optional future extraction when shared consumers need it
    project-stories/   existing editorial project material
  lib/                 existing delivery, validation, and publication behavior
  styles/              shared foundations and focused feature styles
  assets/
    site/              optimized, QA-cleared generated site artwork
public/building/       existing stable project evidence URLs
docs/
  design-concepts/     layout studies and exploration, never site imports
  asset-reviews/       exact production-file QA records
```

Add these proposed files/folders only as their first consumer is migrated.
Each fact has one owner: professional facts in the profile data, personal prose
in About, essay bodies in content, audio credits in the track collection, and
curated project context in project data. Store shared facts once, then select
and summarize them for different pages. Page-specific wording stays local.

Current project progress continues to come from the owning project's publication
records. Do not copy its live status into the curated project catalogue. Preserve
entry IDs, deep links, corrections, withdrawals, and the current update-loading
behavior. A missing feed gets an honest unavailable state, not an invented status.

Use the existing content schemas and extend them only for actual content needs.
Writing needs an index that works with one essay; dates need a verified basis.
Audio notes become optional so empty prose is not required to publish a recording.

## Everyday maintenance

- **Add a project:** add its curated entry and destination, choose a fitting
  explanation, and connect supported publication data. Feature its ID on Home
  if selected; do not create a second project record there.
- **Update experience:** edit the canonical professional fact, then review the
  affected Work and Home summaries for accuracy and fit.
- **Publish writing:** add the content and supported metadata, then let the
  index render it. Give custom figures their own purpose and QA.
- **Add a recording:** add a permitted file and verified track metadata. The
  listening section appears only when real entries exist.
- **Change an illustration:** reuse or create the asset, complete its QA record,
  inspect actual placements, then replace the production reference.

## Implementation sequence

1. **Foundations and Home prototype.** Reuse the current palette and type; build
   shared navigation and the approved desktop/mobile composition. Produce only
   the assets that this page needs and complete their QA. Compare a restrained
   motion enhancement with its static baseline in the browser. Measure loading
   and rendering cost and set an asset/performance budget from those results.
2. **Primary pages and shared content.** Move repeated facts into their canonical
   home as each consumer is migrated. Build Work, Building, Writing, and About.
   Verify page ownership, scanability, responsive flow, navigation, and contact
   paths against the selected studies.
3. **Deeper destinations and flows.** Apply the project, work-story, article, and
   Audio patterns to real material. Simplify general contact validation with
   its server handler. Retire the DoD resume choice throughout UI, validation,
   emails, tests, and documentation while retaining approval before delivery.
   Inspect pending requests before changing fulfillment; do not silently send
   a different PDF or delete stored resumes. Preserve Audio's structured inquiry.
4. **Whole-site verification.** Check inbound URLs/anchors, keyboard and touch,
   reduced motion, error/empty/loading states, asset QA, public claims, and real
   recording playback where available. Run the repository's required checks for
   changed code and review the integrated site before deployment.

The prototype should establish composition and behavior before artwork and
components are multiplied across pages. It is not a full-site rewrite in one pass.

## Migration details to keep explicit

- The selected Building directory changes the older cross-project feed emphasis
  in `project-story-requirements.md`. Reconcile that presentation requirement
  through the September 10 amendment in that document. The shared publication
  transport and source authority are unchanged; progress remains in the journals.
- Keep `/about#resumes`, journal anchors, existing article URLs, and Audio's
  `#book` useful. Introduce redirects or retained anchors when necessary.
- Generated text, dates, interface states, and figures in studies are not approved
  factual content. Use the original Daily screenshot for product evidence and
  clearly identify Threadline concepts until real evidence is available.
- The pre-existing headshot deletion was retained in the Home prototype. Its
  remaining imports were removed before the successful build; the owner accepted
  the prototype. No replacement portrait is required by these compositions.
- Design-study files remain historical references. Production artwork is a
  separate deliverable governed by the required image QA process.

## Local stage 2 decisions

Work uses native disclosures for extra context, so its selected stories add depth without requiring unfinished standalone story routes. About uses separately reviewed artwork and native SVG connecting paths; on mobile it keeps a readable sequence. Writing’s qualitative diagram is native SVG so checkpoints and arrows can be placed precisely. Building uses the real Daily screenshot and clearly labeled Threadline illustration.

No publication adapter, transport, pending-request record, or PDF was changed. Only incoming resume validation changed. The public form no longer selects a version, includes an email fallback, and preserves operator approval. A stored DoD request still retrieves its original PDF through the existing approval flow.

Next: apply the approved detail/article/Audio templates, simplify the general contact flow with its server validation, then review purposeful motion and the complete site. Home remains the accepted visual baseline.

## Local stage 3: project and article pages

Daily and Threadline now consume a shared ProjectLayout and retain their custom explanations. ProjectTimeline remains the single journal component, styled as a desktop rail/mobile selector with complete no-JS history. ProjectUpdates preserves the existing publication integration and distinguishes unavailable from empty feeds. The essay now has heading-derived contents and a native SVG illustration; its argument is retained with targeted project-description reconciliation under the publication policy. Evidence is in `docs/design-concepts/2026-09-10/detail-pages/`.

Next: Audio and the general contact flow, then the integrated motion and whole-site review. The work stories currently remain native disclosures on Work. No deployment has occurred.

## Local stage 3: Audio and contact

Audio v3 and the simple contact flow are implemented, including shared form states and main-site navigation from the Audio host. Audio keeps its structured inquiry and native playback foundation; recordings are not invented. Contact, resume and audio delivery rules remain separate. Contact email/schema now accept a short introduction without business qualifiers; resumes still require approval. See `docs/design-concepts/2026-09-10/audio-contact/` for tests, intercepted browser evidence and real-delivery/recording limits.

Next: integrated whole-site and purposeful-motion review. Work stories remain native disclosures. Nothing has been committed, deployed or sent to external recipients during this redesign QA.

## September 10 pre-launch feedback

Work labels now say Work highlights; Audio engineering links stay local and
Audio is part of the personal site at /audio. The alternate subdomain still
works, with main-site canonical URLs. Two services sheets reuse one layout,
with mobile and print treatments and the existing software URL preserved.

The Personal website project now follows eleven visual milestones: twenty
historical studies, selected/rejected labels, direct excerpts of owner feedback,
and six page comparisons. A reader-path diagram replaces the wordy principles
section. The existing ProjectTimeline owns selection and keyboard behavior.
Only an optional quote block was added to its presentation model; no feed
contract or second timeline renderer was introduced.
