// The two studio sign-in decisions as plain pure functions: each is handed the facts the caller read and says what to write,
// or why not. They read nothing, write nothing and have no effects. The writes (src/lib/audio-client-access.ts) keep only
// guards that re-check, at write time, the facts a decision relied on.
//
// Why plain functions here and not `rule()` from src/server/terms.ts in src/server/rules/: `src/lib` may not load a value
// from `src/server` (tests/architecture/lib-server-imports.test.ts), and the studio sign-in functions that use these are
// called directly from the routes and from many tests. Moving them under src/server/flows would convert the whole studio
// area, which is a separate piece of work. Each decision is written as the same named terms and refusals so it converts
// to `rule()` unchanged.

/** A project of the address that is not closed; `withdrawn` is its request's status. */
export type SigninProject = {
	readonly requestId: string;
	readonly withdrawn: boolean;
};

/** A stored sign-in code row, as read: the browser's value (hashed), its address, when it was used and when it expires. */
export type IssueCode = {
	readonly nonceHash: string;
	readonly email: string;
	readonly usedAt: string | null;
	readonly expiresAt: string;
};

export type IssueFacts = {
	/** The address the code is asked for. */
	readonly address: string;
	/** The hash of the browser's own cookie value. */
	readonly ownNonceHash: string;
	/** ISO time of the request. */
	readonly now: string;
	/** Every project of the address whose access is not closed (a withdrawn one included). */
	readonly projects: readonly SigninProject[];
	/** The address's code rows and the browser's own row, whatever its address. */
	readonly codes: readonly IssueCode[];
};

export type IssueDecision =
	| {
			readonly kind: "issue";
			/** The sign-in audit has a row for every project that is not closed, a withdrawn one included. */
			readonly auditRequestIds: readonly string[];
			/** The write's guard: the address's other live codes must still be fewer than this. */
			readonly liveOthersBelow: number;
			readonly clearEarlierEmail: string | null;
	  }
	| {
			readonly kind: "refuse";
			readonly refusal: "NoOpenProject" | "AddressFull";
			readonly clearEarlierEmail: string | null;
	  };

/**
 * Issue a code, or refuse. A code is live when it is unused and expires after `now` (the instant of expiry is expired).
 * Refuses (in this order) when the address has no project that is open (none, or every one is withdrawn), and when it
 * already has `cap` live codes other than the browser's own. Both refusals are answered like any other: the person is told
 * nothing about which it was. Whatever the answer, the browser's earlier code is to be deleted when it is for a different
 * address (`clearEarlierEmail` names that address), so asking for any other address always ends the earlier code; an earlier
 * code for the same address is left alone by a refusal.
 */
export function decideIssue(facts: IssueFacts, cap: number): IssueDecision {
	const own = facts.codes.find((code) => code.nonceHash === facts.ownNonceHash);

	const clearEarlierEmail =
		own !== undefined && own.email !== facts.address ? own.email : null;

	if (!facts.projects.some((project) => !project.withdrawn))
		return { kind: "refuse", refusal: "NoOpenProject", clearEarlierEmail };

	const liveOthers = facts.codes.filter(
		(code) =>
			code.email === facts.address &&
			code.nonceHash !== facts.ownNonceHash &&
			code.usedAt === null &&
			code.expiresAt > facts.now,
	).length;

	if (liveOthers >= cap)
		return { kind: "refuse", refusal: "AddressFull", clearEarlierEmail };

	return {
		kind: "issue",
		auditRequestIds: facts.projects.map((project) => project.requestId),
		liveOthersBelow: cap,
		clearEarlierEmail,
	};
}

export type StoredCode = {
	readonly attempts: number;
	readonly usedAt: string | null;
	readonly expiresAt: string;
	readonly codeHash: string;
};

export type CompleteFacts = {
	readonly code: StoredCode | null;
	readonly projects: readonly SigninProject[];
};

export type CompleteDecision =
	| {
			readonly kind: "count";
			/** Sign in: the code is right and a project is open. */
			readonly accept: boolean;
			readonly auditRequestIds: readonly string[];
	  }
	| { readonly kind: "refuse"; readonly refusal: "NoCodeToTry" };

/** Whether two hex hashes are equal, looking at every character whatever the first difference. */
export function sameHash(left: string, right: string): boolean {
	let difference = left.length ^ right.length;

	for (let index = 0; index < Math.max(left.length, right.length); index++)
		difference |=
			(left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);

	return difference === 0;
}

/**
 * Count an attempt, and say whether it signs in. Refuses when there is no code that is unused, unexpired and has attempts
 * left (the instant of expiry is expired). Otherwise the attempt is counted whatever was typed, and it signs in only when
 * the typed code's hash equals the stored one and the address has a project that is open.
 */
export function decideComplete(
	facts: CompleteFacts,
	request: { limit: number; now: string; digest: string },
): CompleteDecision {
	const { code } = facts;

	if (
		code === null ||
		code.usedAt !== null ||
		code.expiresAt <= request.now ||
		code.attempts >= request.limit
	)
		return { kind: "refuse", refusal: "NoCodeToTry" };

	return {
		kind: "count",
		accept:
			sameHash(code.codeHash, request.digest) &&
			facts.projects.some((project) => !project.withdrawn),
		auditRequestIds: facts.projects.map((project) => project.requestId),
	};
}

export type DiscardDecision =
	| { readonly kind: "discard"; readonly auditRequestIds: readonly string[] }
	| { readonly kind: "refuse"; readonly refusal: "NothingToDiscard" };

/**
 * Discard an undelivered code: only a code that is still unused (the row exists and has no use time). The failed delivery is
 * audited for every project that is not closed.
 */
export function decideDiscard(facts: {
	readonly code: { readonly usedAt: string | null } | null;
	readonly projects: readonly SigninProject[];
}): DiscardDecision {
	if (facts.code === null || facts.code.usedAt !== null)
		return { kind: "refuse", refusal: "NothingToDiscard" };

	return {
		kind: "discard",
		auditRequestIds: facts.projects.map((project) => project.requestId),
	};
}
