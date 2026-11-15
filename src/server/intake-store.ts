// What the public intake routes read from and write to MUSIC_DB. A write stores one owner request and its creation audit in
// one batch (src/lib/owner-requests.ts `saveOwnerRequest`, which the owner routes share). A read asks for what is stored
// and decides nothing. The only SQL that can refuse is the unique index on the submission id, which `insertBrief` turns
// into ChangedSinceRead (a SubmissionIdClash) so the flow asks the rule again on fresh facts. A failure carries its cause, which the route logs
// as it always has.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { OwnerRequest } from "../lib/owner-model";
import {
	getOwnerRequestBySubmission,
	type NewOwnerRequest,
	RequestDetailsTooLargeError,
	saveOwnerRequest,
} from "../lib/owner-requests";
import { ChangedSinceRead, isUniqueViolation } from "./guarded-save";
import { MusicDb } from "./services";

/** The database refused the write. */
export class IntakeStoreFailed extends Data.TaggedError("IntakeStoreFailed")<{
	readonly cause: unknown;
}> {}

/** The database could not be read. */
export class IntakeReadFailed extends Data.TaggedError("IntakeReadFailed")<{
	readonly cause: unknown;
}> {}

/** The brief's details are larger than a request may store. Nothing was written. */
export class BriefTooLarge extends Data.TaggedError("BriefTooLarge") {}

/** The unique index refused the brief: another request stored the same submission id. It keeps what the database said, for the log. */
export class SubmissionIdClash extends ChangedSinceRead {
	constructor(readonly clash: Error) {
		super();
	}
}

/** Stores one owner request with its audit row, and answers the row as stored. */
export const storeRequest = (request: NewOwnerRequest) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => saveOwnerRequest(db, request),
			catch: (cause) => new IntakeStoreFailed({ cause }),
		});
	});

/** The brief stored under a submission id, or null. */
export const findStoredBrief = (submissionId: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: (): Promise<OwnerRequest | null> =>
				getOwnerRequestBySubmission(db, submissionId),
			catch: (cause) => new IntakeReadFailed({ cause }),
		});
	});

/**
 * Stores the brief the rule decided on. The unique index on the submission id refuses it when another request stored the
 * same id first, which is ChangedSinceRead: the facts the rule read have changed. A brief too large is its own failure, and
 * any other failure is an IntakeStoreFailed.
 */
export const insertBrief = (request: NewOwnerRequest) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => saveOwnerRequest(db, request),
			catch: (cause) => {
				if (cause instanceof RequestDetailsTooLargeError)
					return new BriefTooLarge();

				return isUniqueViolation(cause) && cause instanceof Error
					? new SubmissionIdClash(cause)
					: new IntakeStoreFailed({ cause });
			},
		});
	});
