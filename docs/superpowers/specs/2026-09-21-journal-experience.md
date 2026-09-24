# Personal Website Journal Experience

**Date:** 2026-09-21  
**Status:** Approved design direction; implementation deferred.

## Problem

The current journal lets a curated project story behave like an unbounded
chronological feed. On a phone, opening all entries creates a long vertical
document and puts the oldest work first. A new visitor cannot quickly identify
the current state, the meaningful recent change, or the next useful path.

## Reading model

The journal has three separate surfaces:

1. **Latest work** is the default. It opens on the newest public-safe update
   and lists at most five recent updates in reverse chronological order.
2. **Project story** is an explicitly authored sequence of at most five
   chapters. It may be chronological only when that order explains a deliberate
   before-to-after narrative.
3. **Archive** is a separate, clearly labeled path for older updates. It is
   reverse chronological, paginated or grouped by year/topic, and never
   expands the main project page into a continuous feed.

The Personal Website page leads with Latest work. Older redesign material belongs
in the authored Project story or Archive, not in the default reading path.

The journal combines repository-owned milestones with the live public publication feed. Both sources use the same Latest work and Archive rules. A published entry is never silently promoted into the authored Project story. Corrections and withdrawals continue to clear superseded public content through the existing feed behavior.

## Interaction contract

- The first visible panel names the current state and shows the newest update.
- A reader can select another recent update without losing their position.
- “View project story” and “Browse archive” state what each path contains.
  “Show all entries” is not a primary action.
- Direct links to an update remain stable.
- When an entry moves to Story or Archive, its former main-page fragment still reaches a link to the entry at its new location. Withdrawn publication entries are removed rather than linked.
- The newest available entry is the default selection; an old, fixed milestone does not take precedence over newer work.
- Without JavaScript, the document presents the latest five updates in reverse
  chronological order followed by the Archive link. It does not emit every
  archived panel.
- Visual proof stays attached to its update and retains captions and full-size
  links.
- The bounded view is specific to Personal Website. Threadline and Engineers' Daily continue using the shared journal components without a reading-model change in this increment.

## Guardrails

Every journal change must pass these product checks before review:

- **Purpose:** classify an item as Latest work, Project story, or Archive.
- **Bounded default:** at 390px and 1440px, show one selected update plus no
  more than five recent choices. Never expand the archive inline by default.
- **Order:** updates are newest-first. Chronological order needs an explicit
  Project-story label and authored chapter order.
- **First two screens:** a new visitor can identify current state, latest
  change, and one next action without scrolling through previous updates. At a
  390×844 viewport, each must be rendered without opening a panel and end
  within 1,688 CSS pixels of the top of the document.
- **Evidence:** image proof has visible captions, useful alternative text, and
  a working full-size link.
- **Accessibility:** keyboard selection exposes the active panel state.

## Research basis

W3C’s [clear page-structure guidance](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p03-page-structure/)
calls for logical sections and visible hierarchy so readers can locate and focus
on what matters. Its [accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)
recognizes progressive disclosure as a way to reduce needless scrolling, with
clear control and panel semantics. The [GOV.UK pagination guidance](https://design-system.service.gov.uk/components/pagination/)
recommends pagination or sorting/filtering for long collections rather than
showing all content on one page.

## Non-goals

- No implementation, migration, or content deletion in this design increment.
- No automated publication of private checkpoints.
- No new dependency, framework, or visual direction.
