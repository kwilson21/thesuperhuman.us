// The feed flow: read the small columns of a project's journal in one batch, read the day of each entry that may be shown,
// let the rule choose the current entry and the history, read the text of the chosen events only, and let the rule show
// them. Reading the journal in steps is safe because a withdrawal landing between them erases text, which the rules treat
// as withdrawn: the entry is left out, and when that leaves fewer than 100 with text the rule asks for the next candidates,
// for at most a few rounds, so the history is what a request just after the withdrawals would show.
import * as Effect from "effect/Effect";
import {
	readFeedDays,
	readFeedIndex,
	readFeedTexts,
} from "../publication-store";
import {
	MOST_REFILL_ROUNDS,
	chooseFeed,
	daysToRead,
	moreToRead,
	revisionsToRead,
	showFeed,
} from "../rules/publication-feed";

export const readFeed = (projectId: string) =>
	Effect.gen(function* () {
		const index = yield* readFeedIndex(projectId);
		const days = yield* readFeedDays(projectId, daysToRead(index));
		const choice = yield* chooseFeed.decide({ index, days }, {});

		const first = revisionsToRead(choice);
		const asked = new Set(first);
		let texts = yield* readFeedTexts(projectId, first);

		for (let round = 0; round < MOST_REFILL_ROUNDS; round += 1) {
			const more = yield* moreToRead.decide({ choice, asked, texts }, {});

			if (more.length === 0) break;

			for (const revision of more) asked.add(revision);
			const read = yield* readFeedTexts(projectId, more);

			texts = new Map([...texts, ...read]);
		}

		return yield* showFeed.decide({ projectId, choice }, { texts });
	});
