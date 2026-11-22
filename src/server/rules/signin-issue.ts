// Issuing a sign-in code (POST /api/studio/code): a visitor asks for an emailed code for an address, from the browser
// that holds the pending sign-in cookie. Decided from the facts read in one batch before it (the address's projects that
// are not closed, each with whether its request is withdrawn, and the address's code rows), with the address, the hash of
// the browser's cookie value and the time the request read (docs/plans/2026-11-studio-signin-conversion.md, sections 2
// and 3). ISSUE is allowed from every state of the browser's own code (src/server/machines/signin-code.ts): its row is
// replaced, or inserted, so the rule decides on the address's facts alone. Refused, in this order, when no project of the
// address is open (NoOpenProject: none, or each one's request withdrawn), and when the address already has six live codes
// other than this browser's (AddressFull; a code is live when it is unused and expires after the time read). Writes, in
// one batch that runs for every answer and is bound to do nothing when the rule refused: the guard, the browser's row for
// the address replaced by the new code, and an audit `code-issued` for every project that is not closed (a withdrawn one
// included). Re-checked at write time by C1 (a project of the address is still open) and C2 (its live codes other than
// this browser's are still under the cap), both in the batch's guard, which raises and writes nothing when either has
// changed; the audit rows are written only for a project still open when the batch runs (C7).
//
// A lost race is answered like a refusal, not 409. This is the owner's exception to the 2026-11-14 rule for the code and
// session routes (owner, 2026-11-22, "Yes, record the exception"; the design's "Owner decisions"): the guard raises only
// after a decision to issue, so a 409 would tell a stranger that the address had an open project and room for a code.
// NoOpenProject, AddressFull and a raised guard all answer the generic 200 with the same cookie, and none is retried, so a
// request never makes extra round trips that depend on the address. Nothing here reads a clock, a store or a random
// value: the time and the cookie value's hash are inputs.
import * as Data from "effect/Data";
import { CODE_ON_ITS_WAY } from "../../lib/studio-signin";
import { alwaysWrites, term, unless } from "../terms";

/** The address has no project that is open: none, or each one's request is withdrawn. */
export class NoOpenProject extends Data.TaggedError("NoOpenProject") {
	readonly say = CODE_ON_ITS_WAY;
}

/** The address already has the most live codes other than this browser's. */
export class AddressFull extends Data.TaggedError("AddressFull") {
	readonly say = CODE_ON_ITS_WAY;
}

/**
 * The live codes an address may have besides the asking browser's own: two allowance windows of codes (three emails per
 * five minutes, a ten-minute lifetime); see verification/signin-codes.qnt.
 */
export const LIVE_CODES_PER_ADDRESS = 6;

/** A project of the address that is not closed; `withdrawn` is its request's status. */
export type SigninProject = {
	readonly requestId: string;
	readonly withdrawn: boolean;
};

/** One of the address's code rows, as read: the browser's value (hashed), the address, the code it holds and its times. */
export type AddressCode = {
	readonly nonceHash: string;
	readonly email: string;
	/** The hash of the code the row held when it was read: it names which code the row was, so a replaced row is told apart. */
	readonly codeHash: string;
	readonly usedAt: string | null;
	readonly expiresAt: string;
};

/** Whether a project of the address is open: one whose request is not withdrawn. */
export const anyProjectOpen = (projects: readonly SigninProject[]) =>
	projects.some((project) => !project.withdrawn);

/** The audit's projects: every project that is not closed, a withdrawn one included. */
export const auditIdsOf = (projects: readonly SigninProject[]) =>
	projects.map((project) => project.requestId);

export type IssueRequest = {
	/** The address the code is asked for. */
	readonly address: string;
	/** The hash of the browser's own cookie value. */
	readonly ownNonceHash: string;
	/** The time the request read, as ISO text. */
	readonly now: string;
};

export type IssueFacts = {
	/** Every project of the address whose access is not closed (a withdrawn one included). */
	readonly projects: readonly SigninProject[];
	/** The address's code rows, and only them: a request for an address never reads another address's rows. */
	readonly codes: readonly AddressCode[];
};

type IssueGiven = IssueRequest & IssueFacts;

/** The address's live codes other than the browser's own. */
const liveOthers = (given: IssueGiven) =>
	given.codes.filter(
		(code) =>
			code.email === given.address &&
			code.nonceHash !== given.ownNonceHash &&
			code.usedAt === null &&
			code.expiresAt > given.now,
	).length;

/** What the issue's write batch stores beyond the request's own values: the audit's projects and C2's cap. */
export type IssueWrite = {
	readonly auditRequestIds: readonly string[];
	/** C2: the address's other live codes must still be fewer than this when the batch runs. */
	readonly liveOthersBelow: number;
};

export const issueCode = alwaysWrites({
	name: "issue a sign-in code to the asking browser",
	given: (request: IssueRequest, facts: IssueFacts): IssueGiven => ({
		...request,
		...facts,
	}),
	refusals: [
		unless(
			term("a project of the address is open", (given: IssueGiven) =>
				anyProjectOpen(given.projects),
			),
			() => new NoOpenProject(),
		),
		unless(
			term(
				`the address has fewer than ${LIVE_CODES_PER_ADDRESS} live codes other than this browser's`,
				(given: IssueGiven) => liveOthers(given) < LIVE_CODES_PER_ADDRESS,
			),
			() => new AddressFull(),
		),
	],
	writes: (given): IssueWrite => ({
		auditRequestIds: auditIdsOf(given.projects),
		liveOthersBelow: LIVE_CODES_PER_ADDRESS,
	}),
	writesText:
		"the browser's row for the address replaced by the new code, and the audit code-issued for every project not closed, in one batch behind C1 and C2",
});
