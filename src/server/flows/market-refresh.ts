// The daily market refresh (docs/plans/2026-11-market-refresh.md, sections 2 and 3). It reads the facts first, asks the
// rule whether a search is due, and marks the start; then, cell by cell, searches, reads the results with the model and
// keeps only the figures the rule's check lets stand; then saves the proposal those make (replacing older ones), the
// last run, and clears the owner's ask only if it was made before the run started (verification/market-refresh.qnt).
// A failed search ends the run with nothing saved but the last run's failure, and the ask kept for the next run. A
// cell the model could not read keeps its figures. Calls only services and the pure rules; builds no text for anyone.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	clearAsk,
	deleteProposalsBefore,
	proposalId,
	readAsk,
	readLast,
	readNewestProposal,
	writeLast,
	writeProposal,
} from "../market-refresh-store";
import { MarketReader, MarketSearch } from "../market-refresh-services";
import { readPricing } from "../pricing-store";
import {
	askServed,
	type Checked,
	cellName,
	checkReading,
	proposeMarket,
	queryOf,
	REFRESH_CELLS,
	type RefreshStart,
	startRefresh,
	workOf,
} from "../rules/market-refresh";

/** How a run ended: nothing due, a proposal saved, no new figure found, or the search failed. */
export type RefreshOutcome = "idle" | "proposal" | "nothing-new" | "failed";

export const refreshMarket = (start: RefreshStart) =>
	Effect.gen(function* () {
		const askedAt = yield* readAsk;
		const last = yield* readLast;
		const waiting = yield* readNewestProposal;
		const pricing = yield* readPricing;

		const begin = yield* startRefresh.decide(start, {
			askedAt,
			last,
			proposalWaiting: waiting !== null,
			researchedOn: pricing.market?.researchedOn ?? null,
		});

		if (Option.isNone(begin)) return "idle" satisfies RefreshOutcome;
		yield* writeLast(begin.value);

		const search = yield* MarketSearch;
		const reader = yield* MarketReader;
		const found = new Map<string, Checked | null>();
		let unread = 0;

		for (const cell of REFRESH_CELLS) {
			const work = workOf(cell, pricing.market);
			const results = yield* search.search(queryOf(cell, work));

			const reading = yield* reader.read(cell, work, results).pipe(
				Effect.catchTag("MarketReaderFailed", () => {
					unread += 1;

					return Effect.succeed(null);
				}),
			);

			found.set(
				cellName(cell),
				reading ? checkReading(cell, reading, results) : null,
			);
		}

		// The model read nothing at all: that is a failure to try again, not a search that found nothing new.
		if (unread === REFRESH_CELLS.length) {
			yield* writeLast({ at: start.now, result: "failed" });

			return "failed" satisfies RefreshOutcome;
		}

		const proposal = proposeMarket(
			proposalId(start.now),
			start.now,
			pricing.market,
			found,
		);

		if (proposal) {
			yield* writeProposal(proposal);
			yield* deleteProposalsBefore(proposal.id);
		}

		yield* writeLast({
			at: start.now,
			result: proposal ? "proposal" : "nothing-new",
		});

		if (askServed(yield* readAsk, start.now)) yield* clearAsk;

		return (proposal ? "proposal" : "nothing-new") satisfies RefreshOutcome;
	}).pipe(
		Effect.catchTag("MarketSearchFailed", (failure) =>
			writeLast({
				at: start.now,
				result: "failed",
				status: failure.status,
			}).pipe(Effect.as("failed" satisfies RefreshOutcome)),
		),
	);
