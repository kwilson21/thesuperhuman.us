// Sweeping an address's expired sign-in codes, on every code request (POST /api/studio/code), whatever the issue's
// answer. Decided from the address's code rows, read in the issue's read batch, and the time the request read: a row
// whose `expires_at` is at or before that time is swept, whatever its state (a used row past its lifetime included), so
// the sweep is this rule's choice of rows and not a move of the code machine
// (docs/plans/2026-11-studio-signin-conversion.md, sections 1 and 2). Refuses nothing. Writes, in one batch after the read
// and before the issue's write (kept when that write fails): the rows named here deleted by key, each with the code it
// held. Re-checked at write time by C3: a row goes only while it is still expired and still holds the code that was read,
// so a fresh code another request stored under the same key since the read is never deleted. A sweep that misses a row
// deletes nothing and changes no answer. Only rows of the request's address are read or deleted, so the sweep never
// touches another address's codes (those stay for retention). Nothing here reads a clock: the time is an input.
import { alwaysWrites } from "../terms";
import type { AddressCode } from "./signin-issue";

/** An expired row as it was read: its key (with the address) and the code it held. */
export type ExpiredCode = {
	readonly nonceHash: string;
	readonly codeHash: string;
};

export type SweepRequest = {
	/** The time the request read, as ISO text. */
	readonly now: string;
};

/** The sweep's batch: the rows to delete by key, each only while it still holds the code read (C3). */
export type SweepWrite = {
	readonly expired: readonly ExpiredCode[];
};

export const sweepCodes = alwaysWrites({
	name: "sweep the address's expired sign-in codes",
	given: (
		request: SweepRequest,
		facts: { readonly codes: readonly AddressCode[] },
	) => ({ ...request, ...facts }),
	refusals: [],
	writes: (given): SweepWrite => ({
		// The instant of expiry is expired.
		expired: given.codes.flatMap((code) =>
			code.expiresAt <= given.now
				? [{ nonceHash: code.nonceHash, codeHash: code.codeHash }]
				: [],
		),
	}),
	writesText:
		"the address's rows read as expired, deleted by key while each still holds the code read (C3), in one batch",
});
