import type { Story } from "./contract";

/** The public shape of a project's journal. The feed rule (src/server/rules/publication-feed.ts) builds it from the stored events. */
export interface PublicEntry {
	entryId: string;
	occurredOn: string;
	publishedAt: string;
	backfilled: boolean;
	story: Story;
}

export interface ProjectFeed {
	projectId: string;
	revision: number;
	current: PublicEntry | null;
	history: PublicEntry[];
}
