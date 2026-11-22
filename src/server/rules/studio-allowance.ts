// The studio allowance: at most `limit` uses per five-minute window for one scope and subject (an address, a client IP
// address, or an address with the browser's cookie hash), counted in D1 under a keyed hash of the scope and subject.
// The code and session routes count through it, and so does the agreement link route. Decided from the uses the
// counting upsert returned for the window (the stale windows pruned and the use counted in one batch, `countAllowance`
// in src/server/studio-signin-store.ts) and the limit: refused with AllowanceSpent when the count is over the limit, or
// when no count came back (docs/plans/2026-11-studio-signin-conversion.md, sections 2 and 4). Writes nothing: the use
// was counted by the read. None of the guards C1 to C9 re-checks it, and none needs to: the count is itself the atomic
// write (the upsert's `uses=uses+1`), so two requests at once each see their own count. Nothing here reads a clock: the
// time is an input, and `allowanceTimes` works out the two times the count binds from it.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/**
 * The allowance is used up for this window. Each route answers it with its own sentence (the code route's, the session
 * route's, the agreement link's), so this has none.
 */
export class AllowanceSpent extends Data.TaggedError("AllowanceSpent") {
	readonly say = "";
}

/** How long an allowance window lasts: a use counts in the window that started at most this long before it. */
export const ALLOWANCE_WINDOW_MS = 5 * 60 * 1000;

/** The times one count binds: when the use happened, and the start at or before which a window is stale and pruned. */
export type AllowanceTimes = {
	readonly at: string;
	readonly staleAt: string;
};

/** The times one count binds, from the time the flow read. */
export const allowanceTimes = (now: Date): AllowanceTimes => ({
	at: now.toISOString(),
	staleAt: new Date(now.getTime() - ALLOWANCE_WINDOW_MS).toISOString(),
});

export type AllowanceRequest = {
	/** The most uses a window allows for this scope. */
	readonly limit: number;
};

export type AllowanceCount = {
	/** The uses counted in this window, this one included; null when the count came back with no row. */
	readonly uses: number | null;
};

type AllowanceGiven = AllowanceRequest & AllowanceCount;

export const takeAllowance = alwaysWrites({
	name: "take one use of a studio allowance",
	given: (
		request: AllowanceRequest,
		facts: AllowanceCount,
	): AllowanceGiven => ({
		...request,
		...facts,
	}),
	refusals: [
		unless(
			term(
				"the uses counted in this window are within the limit",
				(given: AllowanceGiven) =>
					given.uses !== null && given.uses <= given.limit,
			),
			() => new AllowanceSpent(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the use was counted when it was read",
});
