// The feed flow: read the small columns of a project's journal in one batch, let the rule choose the current entry and the
// history, read the text of the chosen events only (a second plain read), and let the rule show them. Reading the journal
// in two steps is safe because a withdrawal landing between them erases text, which the second rule treats as withdrawn.
import * as Effect from "effect/Effect";
import { readFeedIndex, readFeedTexts } from "../publication-store";
import {
	chooseFeed,
	revisionsToRead,
	showFeed,
} from "../rules/publication-feed";

export const readFeed = (projectId: string) =>
	Effect.gen(function* () {
		const choice = yield* chooseFeed.decide(
			yield* readFeedIndex(projectId),
			{},
		);
		const texts = yield* readFeedTexts(projectId, revisionsToRead(choice));

		return yield* showFeed.decide({ projectId, choice }, { texts });
	});
