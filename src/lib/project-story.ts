import approvedReview from '../data/project-stories/threadline-review.json';
import type { ProjectFeed, PublicEntry } from './publication/read';
export interface ProjectArtifact {
  src: string; title: string; alt: string; caption: string; kind: string; width: number; height: number;
}
export interface Milestone {
  id: string; day: string; title: string; summary: string; detail?: string;
  illustration?: 'payload-review'; detailLabel?: string;
  status?: string; basis?: string; publishedAt?: string; backfilled?: boolean;
  artifacts?: ProjectArtifact[];
  visualProof?: { label: string; before: ProjectArtifact; after: ProjectArtifact };
  /** Explicit authored placement. Curators mark a milestone 'story' deliberately; a published
   * entry is never given this value automatically. Latest work and Archive are never stored on a
   * milestone; the projections below compute them from recency instead. */
  placement?: 'story';
}
const entries = (feed: ProjectFeed): PublicEntry[] => [...new Map([...feed.history, ...(feed.current ? [feed.current] : [])].map(entry => [entry.entryId, entry])).values()];
export function publicationMilestones(feed: ProjectFeed | null): Milestone[] {
  if (!feed) return [];
  return entries(feed).reverse().map(entry => {
    const split = entry.story.summary.match(/^(?:.*?[.!?](?:\s|$)){1,2}/)?.[0].trim();
    const reviewed = feed.projectId === approvedReview.projectId && entry.entryId === approvedReview.entryId
      && entry.occurredOn === approvedReview.occurredOn
      && Object.entries(approvedReview.story).every(([key, value]) => entry.story[key as keyof typeof entry.story] === value);
    return { illustration: reviewed ? 'payload-review' : undefined, detailLabel: reviewed ? 'What was checked' : undefined, id: entry.entryId, day: entry.occurredOn, title: entry.story.headline,
      summary: split || entry.story.summary,
      detail: [split ? entry.story.summary.slice(split.length).trim() : '', entry.story.technicalDetail].filter(Boolean).join('\n\n'),
      status: ({ proposed: 'Planned', implemented: 'Built', tested: 'Checked', available: 'Available to use' })[entry.story.delivery],
      publishedAt: entry.publishedAt, backfilled: entry.backfilled, basis: entry.story.basis };
  });
}
/** Curated history remains repository-owned; publish new milestones under separate IDs. */
export function journalMilestones(feed: ProjectFeed | null, curated: Milestone[] = []): Milestone[] {
  return [...curated, ...publicationMilestones(feed)].sort((a, b) => a.day.localeCompare(b.day));
}
/** Explicitly authored narrative chapters, in the order they happened. Never inferred from dates. */
export function storyMilestones(entries: Milestone[]): Milestone[] {
  return entries.filter(entry => entry.placement === 'story').sort((a, b) => a.day.localeCompare(b.day));
}
/** Everything not in the authored story, newest first: the pool Latest work and Archive divide by recency. */
function readingPool(entries: Milestone[]): Milestone[] {
  return entries.filter(entry => entry.placement !== 'story').slice().sort((a, b) => b.day.localeCompare(a.day));
}
/** The default view: at most `limit` recent, non-story updates, newest first. */
export function latestJournalMilestones(entries: Milestone[], limit = 5): Milestone[] {
  return readingPool(entries).slice(0, limit);
}
/** Non-story updates older than the Latest work window, newest first. Nothing is deleted, only relocated. */
export function archiveMilestones(entries: Milestone[], limit = 5): Milestone[] {
  return readingPool(entries).slice(limit);
}
/** The panel a reading view opens on. A named view (Latest work, Story, Archive) always opens on
 * the first entry of its own projection: newest for Latest work and Archive, oldest for the
 * chronological story. The live feed's current entry only takes precedence when there is no named
 * view (every project page besides Personal Website), matching that page's existing behavior. */
export function journalSelection(view: 'latest' | 'story' | 'archive' | undefined, visible: Milestone[], currentEntryId: string | undefined, selectedId: string | undefined): string | undefined {
  return view ? (visible[0]?.id ?? selectedId) : (currentEntryId ?? selectedId);
}
export function feedChange(previous: ProjectFeed, next: ProjectFeed): 'ignore' | 'unchanged' | 'new' | 'replace' {
  if (next.projectId !== previous.projectId || !Number.isSafeInteger(next.revision)) return 'ignore';
  const current = new Map(entries(next).map(entry => [entry.entryId, entry]));
  if ((previous.current && !next.current) || entries(previous).some(entry => JSON.stringify(current.get(entry.entryId)) !== JSON.stringify(entry))) return 'replace';
  return JSON.stringify(previous) === JSON.stringify(next) ? 'unchanged' : 'new';
}
