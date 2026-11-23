/**
 * A sentence the code wrote for the person reading the answer. A route may put the message of this error in its
 * response; it never puts the message of any other error there, because those come from the database, the JSON parser
 * or the runtime and say nothing a reader can use. `src/server/failure.ts` sorts what a route caught.
 */
export class ReaderMessage extends Error {}

/**
 * Another request changed the facts this one was built on, found by a check written for one batch: a lost race, which a
 * route answers with 409 and its own sentence. A route never shows its message.
 */
export class LostRace extends Error {}

/**
 * A database call that rejected, marked where it was made so a route can tell it from a refusal the code threw (see
 * `countersignAgreements`), as `PreflightReadFailed` marks the preflight's reads. `failure` is the rejection itself: a route
 * sorts it with `classifyFailure` (a guard or a unique index is a lost race; anything else is a fault of the site, which
 * the route logs once and answers with its fixed 500).
 */
export class StoreRejected<Failure> extends Error {
	readonly failure: Failure;

	constructor(failure: Failure) {
		super("A database call was rejected.");
		this.failure = failure;
	}
}

/** The work's result; when it rejects, a StoreRejected carrying the rejection. */
export const stored = <T>(work: Promise<T>): Promise<T> =>
	work.catch((failure) => {
		throw new StoreRejected(failure);
	});
