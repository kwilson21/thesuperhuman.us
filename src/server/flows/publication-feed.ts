// The feed flow: read a project's journal in one batch and let the feed rule pick the current entry and the history.
import * as Effect from "effect/Effect";
import { readFeedFacts } from "../publication-store";
import { projectFeed } from "../rules/publication-feed";

export const readFeed = (projectId: string) =>
	readFeedFacts(projectId).pipe(
		Effect.flatMap((facts) => projectFeed.decide({ projectId }, facts)),
	);
