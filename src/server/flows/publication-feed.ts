// The feed flow: read the small columns of a project's journal in one batch, read the day of each entry that may be shown,
// let the rule choose the current entry and the history, read the text of the chosen events only, and let the rule show
// them. Reading the journal in steps is safe because a withdrawal landing between them erases text, which the rules treat
// as withdrawn: the entry is left out, and a spare entry takes its place in the history.
import * as Effect from "effect/Effect";
import {
	readFeedDays,
	readFeedIndex,
	readFeedTexts,
} from "../publication-store";
import {
	chooseFeed,
	daysToRead,
	revisionsToRead,
	showFeed,
} from "../rules/publication-feed";

export const readFeed = (projectId: string) =>
	Effect.gen(function* () {
		const index = yield* readFeedIndex(projectId);
		const days = yield* readFeedDays(projectId, daysToRead(index));
		const choice = yield* chooseFeed.decide({ index, days }, {});

		const texts = yield* readFeedTexts(projectId, revisionsToRead(choice));

		return yield* showFeed.decide({ projectId, choice }, { texts });
	});
