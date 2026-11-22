import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { next } from "./next";

// The sign-in code's moves, as docs/plans/2026-11-studio-signin-conversion.md, section 1 ("The sign-in code") draws them.
// No column stores the state: it is derived from the browser's own row for the address (`audio_client_signin_codes`, one
// row per cookie value and address), in this order: no row is `none`; `used_at` set is `used`; `expires_at` at or before
// the time the request read is `expired`; attempts at or over the limit is `locked`; otherwise `live` (`codeStateOf`). The
// sign-in flows ask `next()` (src/server/machines/next.ts) whether that state allows a move, and the rules
// (src/server/rules/signin-*.ts) decide the rest from the address's facts. The writes are SQL guards that re-check the
// state at write time: C4 and C5 for ENTER, C8 for DISCARD.
//
// ISSUE is allowed from every state: the browser's own row for the address is replaced, or inserted from `none`. ENTER
// is allowed only from `live`; it lands on `used` when the entry rule accepted the code, on `locked` when a refused
// attempt was the last, and on `live` otherwise. DISCARD (Resend refused the code's email) is allowed from `live`,
// `locked` and `expired`, and removes the row. Each refused move is answered by the flow with the refusal its rule file
// exports: ENTER's NoCodeToTry (src/server/rules/signin-complete.ts), DISCARD's NothingToDiscard
// (src/server/rules/signin-discard.ts). A lifetime that passes is a fact of the clock, not a move. The machine has no move
// for another browser: a request reads and writes only rows of its own cookie value and address.

/** The states a code row is read as, in the order `codeStateOf` tells them apart. */
export const CODE_STATES = [
	"none",
	"used",
	"expired",
	"locked",
	"live",
] as const;

export type CodeState = (typeof CODE_STATES)[number];

/** The moves of a code. */
export const CODE_EVENTS = ["ISSUE", "ENTER", "DISCARD"] as const;

export type CodeEvent = (typeof CODE_EVENTS)[number];

/** The attempts a code allows: the fifth counted attempt that is not accepted locks it (the column's CHECK is 0 to 5). */
export const ATTEMPTS_PER_CODE = 5;

/** A move that carries nothing. */
const Plain = Schema.Struct({});

/**
 * ENTER, with what the entry made of it: whether the entry rule accepted the code, and whether the attempt it counted was
 * the last one the code allows. `next` asked with the type alone answers as for an attempt that was neither, `live`.
 */
const Entered = Schema.Struct({
	accepted: Schema.Boolean,
	lastAttempt: Schema.Boolean,
});

export const signinCode = setupEffect({
	schemas: { events: { ISSUE: Plain, ENTER: Entered, DISCARD: Plain } },
}).createMachine({
	id: "signinCode",
	initial: "none",
	states: {
		none: { on: { ISSUE: { target: "live" } } },
		used: { on: { ISSUE: { target: "live" } } },
		expired: {
			on: { ISSUE: { target: "live" }, DISCARD: { target: "none" } },
		},
		locked: {
			on: { ISSUE: { target: "live" }, DISCARD: { target: "none" } },
		},
		live: {
			on: {
				ISSUE: { target: "live" },
				DISCARD: { target: "none" },
				ENTER: ({ event }) => {
					if (event.accepted) return { target: "used" };

					if (event.lastAttempt) return { target: "locked" };

					return { target: "live" };
				},
			},
		},
	},
});

/** A code row as the entry reads it: what its state is derived from. */
export type CodeRow = {
	readonly attempts: number;
	readonly usedAt: string | null;
	readonly expiresAt: string;
};

/**
 * The state of the browser's row for the address at `now`, the time the request read (ISO text, compared as text as the
 * SQL compares it): the instant of expiry is expired, and a used row stays used after its lifetime.
 */
export function codeStateOf(row: CodeRow | null, now: string): CodeState {
	if (row === null) return "none";

	if (row.usedAt !== null) return "used";

	if (row.expiresAt <= now) return "expired";

	return row.attempts >= ATTEMPTS_PER_CODE ? "locked" : "live";
}

/**
 * The state the discard asks from, derived from `used_at` alone (the only column the discard's read selects): no row is
 * `none`, `used_at` set is `used`, and any other row is asked as `live`. DISCARD is allowed from `live`, `locked` and
 * `expired` alike, so the answer is the one the full state would give.
 */
export function discardStateOf(
	row: { readonly usedAt: string | null } | null,
): CodeState {
	if (row === null) return "none";

	return row.usedAt === null ? "live" : "used";
}

/** Whether a code in this state may take the move. */
export const codeAllows = (state: CodeState, event: CodeEvent) =>
	next(signinCode, state, event) !== null;
