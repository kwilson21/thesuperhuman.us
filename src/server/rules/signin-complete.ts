// Entering a sign-in code (POST /api/studio/session): the visitor types the emailed code in the browser that asked for
// it. Decided from the browser's own code row for the address and the address's projects, read in one batch, with the
// hash of the typed code (keyed with the address and the cookie value's hash, so it can only equal the code issued to
// this browser). The code machine (src/server/machines/signin-code.ts) is asked first, from the row's state at the time
// the request read: ENTER is allowed only from `live` (unused, unexpired, under five attempts). From any other state the
// flow answers NoCodeToTry, exported here, and this rule never sees the row, so it takes no time, limit or missing row
// and refuses nothing (docs/plans/2026-11-studio-signin-conversion.md, sections 1 and 2). The attempt is counted whatever
// was typed, and it signs in only when the typed code's hash equals the stored one (compared in constant time,
// `sameHash`) and a project of the address is open. Writes, in one batch of four guarded statements that runs for every
// entry (bound to match no row when the machine refused): the attempt counted, the code accepted, the session made, and
// an audit `signed-in` for every project that is not closed (a withdrawn one included). Re-checked at write time by C4
// (the attempt counts only on the code read, while it is unused, unexpired and under the limit), C5 (the accept only on
// that same code, after the counted attempt, `changes()=1`, while a project of the address is open, C1's form), C6 (the
// session only for the accepted code's token) and C7 (the audit only with that session, and for a project still open).
// A guard that does not hold accepts nothing, and the answer is the one for a wrong code.
//
// A lost race is answered like a refusal, not 409. This is the owner's exception to the 2026-11-14 rule for the code and
// session routes (owner, 2026-11-22, "Yes, record the exception"; the design's "Owner decisions"): a lost race, a wrong
// code and NoCodeToTry all answer the one 401, so the answer never tells a stranger what state an address's code is in.
// None is retried. Nothing here reads a clock, a store or a random value.
import * as Data from "effect/Data";
import { CODE_INVALID_OR_EXPIRED } from "../../lib/studio-signin";
import type { CodeRow } from "../machines/signin-code";
import { alwaysWrites } from "../terms";
import { anyProjectOpen, auditIdsOf, type SigninProject } from "./signin-issue";

/**
 * The machine refused ENTER: no code, or one that is used, expired or out of attempts. Answered with the one sentence a
 * wrong code and a browser that did not ask also get.
 */
export class NoCodeToTry extends Data.TaggedError("NoCodeToTry") {
	readonly say = CODE_INVALID_OR_EXPIRED;
}

/** The browser's code row for the address, as the entry reads it: its state's columns and the hash of its code. */
export type StoredCode = CodeRow & { readonly codeHash: string };

/** Whether two hex hashes are equal, looking at every character whatever the first difference. */
export function sameHash(left: string, right: string): boolean {
	let difference = left.length ^ right.length;

	for (let index = 0; index < Math.max(left.length, right.length); index++)
		difference |=
			(left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);

	return difference === 0;
}

export type EntryRequest = {
	/** The hash of the typed code, keyed as the stored one is. */
	readonly digest: string;
};

export type EntryFacts = {
	/** The stored hash of the browser's `live` code. */
	readonly codeHash: string;
	/** Every project of the address that is not closed (a withdrawn one included). */
	readonly projects: readonly SigninProject[];
};

/** What the entry's write batch stores beyond the request's own values: whether to accept, and the audit's projects. */
export type EntryWrite = {
	/** Sign in: the typed code is right and a project of the address is open. */
	readonly accept: boolean;
	readonly auditRequestIds: readonly string[];
};

export const enterCode = alwaysWrites({
	name: "count an attempt at a live sign-in code, and say whether it signs in",
	given: (request: EntryRequest, facts: EntryFacts) => ({
		...request,
		...facts,
	}),
	refusals: [],
	writes: (given): EntryWrite => ({
		accept:
			sameHash(given.codeHash, given.digest) && anyProjectOpen(given.projects),
		auditRequestIds: auditIdsOf(given.projects),
	}),
	writesText:
		"the attempt counted (C4); on a right code with a project open, the code accepted (C5), the session made (C6) and the audit signed-in (C7), in one batch",
});
