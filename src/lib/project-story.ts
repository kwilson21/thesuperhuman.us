import approvedReview from '../data/project-stories/threadline-review.json';
import type { ProjectFeed, PublicEntry } from './publication/read';
export interface Milestone {
  id: string; day: string; title: string; summary: string; detail?: string;
  illustration?: 'payload-review'; detailLabel?: string;
  status?: string; basis?: string; publishedAt?: string; backfilled?: boolean;
  artifacts?: { src: string; title: string; alt: string; caption: string; kind: string; width: number; height: number }[];
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
export function feedChange(previous: ProjectFeed, next: ProjectFeed): 'ignore' | 'unchanged' | 'new' | 'replace' {
  if (next.projectId !== previous.projectId || !Number.isSafeInteger(next.revision)) return 'ignore';
  const current = new Map(entries(next).map(entry => [entry.entryId, entry]));
  if ((previous.current && !next.current) || entries(previous).some(entry => JSON.stringify(current.get(entry.entryId)) !== JSON.stringify(entry))) return 'replace';
  return JSON.stringify(previous) === JSON.stringify(next) ? 'unchanged' : 'new';
}
