# Journal Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unbounded journal feed with latest-first reading, an authored project story, and a separate archive.

**Architecture:** Keep curated milestones and the existing `ProjectUpdates` publication feed as source data. Apply presentation placement to the combined `journalMilestones(feed, curated)` result so published entries also reach Latest work or Archive. Keep the shared `ProjectTimeline` behavior for Threadline and Engineers' Daily unless those pages receive their own reviewed reading design. Put Personal Website archive navigation on a dedicated route or paginated surface, with no new dependencies.

**Tech Stack:** Astro 5, TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-journal-experience.md`

## Global Constraints

- Preserve stable milestone IDs, direct links, captions, and full-size evidence links.
- Preserve publication correction and withdrawal behavior in `ProjectUpdates.astro`, including its live-refresh notice and curated fallback. A withdrawn published entry must disappear from every reading surface after refresh.
- Scope the new bounded reading behavior to Personal Website; `ProjectTimeline.astro` and `ProjectUpdates.astro` also serve Threadline and Engineers' Daily.
- Public updates are newest-first; only explicitly authored story chapters may be chronological.
- The default view shows at most five recent choices and never expands the archive inline.
- Verify 390px and 1440px views, keyboard selection, and no-JavaScript fallback.

---

### Task 1: Classify journal presentation

**Files:**
- Modify: `src/lib/project-story.ts`
- Modify: `src/data/project-stories/personal-website.ts`
- Inspect: `src/components/ProjectUpdates.astro`
- Test: `tests/lib/project-story.test.ts`

**Interfaces:** Define `JournalPlacement = 'latest' | 'story' | 'archive'` and typed `latestJournalMilestones(entries, limit = 5)`, `storyMilestones(entries)`, and `archiveMilestones(entries)` projections over the combined curated and published feed. Keep authored story placement explicit. Published entries default to Latest work while recent and then Archive when outside the limit; do not put a published entry in the authored story without an explicit editorial choice.

- [ ] Write failing tests using both curated milestones and `ProjectFeed` entries. Expect Latest work to be reverse chronological and capped at five, older published entries to remain reachable in Archive, and story chapters to be explicitly authored.
- [ ] Run `npm test -- tests/lib/project-story.test.ts`; confirm the missing typed projection fails.
- [ ] Implement the placement metadata and projections. Classify every existing Personal Website milestone deliberately; do not infer story order from dates alone. Preserve `journalMilestones` as the merge point for curated and published entries.
- [ ] Re-run the focused test and commit `Classify journal presentation`.

### Task 2: Render bounded Latest work

**Files:**
- Modify: `src/components/ProjectTimeline.astro`
- Modify: `src/components/ProjectUpdates.astro`
- Modify: `src/pages/building/personal-website.astro`
- Test: `tests/browser/personal-website-journal.cjs`

**Interfaces:** Add a Personal Website-specific bounded mode to the shared components. Consume `latestJournalMilestones` from the combined feed and render one active panel and at most five selectable updates under a visible `Latest work` heading. Leave the other project pages' current timeline controls intact.

- [ ] Write a failing browser check asserting five-or-fewer choices, one visible panel, no horizontal overflow, and visible `View project story` and `Browse archive` links at 390px and 1440px.
- [ ] Run the browser check; confirm the unbounded current component fails it.
- [ ] Render Latest work as the default. Remove `selectedId="website-start-with-the-reader"` from `src/pages/building/personal-website.astro`; select the newest combined-feed entry instead. Preserve keyboard controls, captions, direct links, full-size evidence, and the live publication notice. Remove `Show all entries` only in the Personal Website bounded mode.
- [ ] Re-run the browser check and commit `Bound the latest journal view`.

### Task 3: Separate story and archive

**Files:**
- Create: `src/pages/building/personal-website/story.astro`
- Create: `src/pages/building/personal-website/archive.astro`
- Modify: `src/pages/building/personal-website.astro`
- Test: `tests/browser/personal-website-journal.cjs`

**Interfaces:** Story consumes `storyMilestones`; archive consumes `archiveMilestones` from curated and published sources; both retain stable direct links. Load the current publication feed on each server-rendered route and use the same correction/withdrawal handling as the main page.

- [ ] Write a failing route check for `/building/personal-website/story` and `/building/personal-website/archive`, plus a reverse-chronological archive assertion.
- [ ] Run the browser check and confirm both routes are absent.
- [ ] Implement labeled routes. Keep story to authored chapters and choose pagination or year/topic grouping for the archive during implementation review.
- [ ] Verify no-JavaScript output presents latest five plus Archive link, never the full archive inline. Verify a corrected or withdrawn published entry is removed on the next page load and from the live-refresh view. Commit `Separate journal story and archive`.

### Task 4: Enforce the reading contract

**Files:**
- Modify: `tests/browser/personal-website-journal.cjs`
- Modify: `docs/superpowers/specs/2026-09-21-journal-experience.md`

**Interfaces:** Browser checks assert the visible current state, latest change, and next path in the mobile initial reading flow.

- [ ] Write a failing assertion for `Latest work`, `View project story`, and `Browse archive` in the initial mobile flow.
- [ ] Implement only missing labels or accessible landmarks.
- [ ] Run `npm test && npm run check && npm run build`, then the focused browser checks. Commit `Protect journal reading flow`.

## Self-review

- Tasks 1–3 cover placement, bounded latest work, authored story, and archive.
- Task 4 prevents the default route from regressing to an unbounded vertical feed.
- No new dependency, public private-journal content, or visual direction is introduced.
