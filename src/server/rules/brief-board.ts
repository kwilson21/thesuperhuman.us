// The brief board's budget rule (docs/plans/2026-11-living-brief.md, section 6): whether one more interpretation may be
// reserved today. It decides from the day's counts read for the visitor (their daily IP hash, under the scope
// `board:<hash>`) and for the whole site (`board:site`), and answers the reservation to save, or refuses when either count
// has reached its limit. The guard that re-checks it at write time is the batch in `reserveBoardBudget`
// (src/server/brief-board-store.ts): it raises unless both counts are still under their limits, so a request that took
// the last place first sends this one back to read again and refuse. Time is an input; the rule reads no clock.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** Interpretations one visitor may have in a day. */
export const BOARD_VISITOR_LIMIT = 40;

/** Interpretations the whole site may have in a day. */
export const BOARD_SITE_LIMIT = 150;

/** The scope the site's count is kept under, in the table the autocomplete also counts in. */
export const BOARD_SITE_SCOPE = "board:site";

/** The scope a visitor's count is kept under. */
export const boardVisitorScope = (hash: string) => `board:${hash}`;

export class BoardDailyLimit extends Data.TaggedError("BoardDailyLimit") {
	readonly say =
		"Suggestions reached today’s limit. You can still add your own notes.";
}

/** The day's counts, as read: 0 when no row has been written today. */
export type BoardBudget = {
	readonly visitor: number;
	readonly site: number;
};

export type BoardBudgetRequest = {
	/** The UTC day, YYYY-MM-DD. */
	readonly day: string;
	/** The day before, whose rows and older ones may be cleaned up. */
	readonly previousDay: string;
	readonly visitorScope: string;
};

/** One more interpretation, counted for the visitor and the site, with the limits the guard checks again. */
export type BoardReservation = {
	readonly day: string;
	readonly visitorScope: string;
	readonly visitorLimit: number;
	readonly siteScope: string;
	readonly siteLimit: number;
	/** Rows of days before this one are old (two days are kept): the first reservation of a day cleans them up. Empty otherwise. */
	readonly cleanBefore: string;
};

type Given = BoardBudgetRequest & BoardBudget;

const visitorUnder = term<Given>(
	"the visitor has had fewer interpretations today than their limit",
	(g) => g.visitor < BOARD_VISITOR_LIMIT,
);

const siteUnder = term<Given>(
	"the site has had fewer interpretations today than its limit",
	(g) => g.site < BOARD_SITE_LIMIT,
);

export const reserveInterpretation = alwaysWrites({
	name: "Reserve one interpretation of a brief",
	given: (request: BoardBudgetRequest, facts: BoardBudget): Given => ({
		...request,
		...facts,
	}),
	refusals: [
		unless(visitorUnder, () => new BoardDailyLimit()),
		unless(siteUnder, () => new BoardDailyLimit()),
	],
	writes: (g): BoardReservation => ({
		day: g.day,
		visitorScope: g.visitorScope,
		visitorLimit: BOARD_VISITOR_LIMIT,
		siteScope: BOARD_SITE_SCOPE,
		siteLimit: BOARD_SITE_LIMIT,
		cleanBefore: g.site === 0 ? g.previousDay : "",
	}),
	writesText:
		"one more interpretation for the visitor and the site today, and, on the day's first, the cleanup of older days",
});
