// What the public intake routes write to MUSIC_DB. The write stores one owner request and its creation audit in one batch
// (src/lib/owner-requests.ts `saveOwnerRequest`). A failure is an IntakeStoreFailed carrying its cause, which the route logs
// as it always has.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { type NewOwnerRequest, saveOwnerRequest } from "../lib/owner-requests";
import { MusicDb } from "./services";

/** The database refused the write. */
export class IntakeStoreFailed extends Data.TaggedError("IntakeStoreFailed")<{
	readonly cause: unknown;
}> {}

/** Stores one owner request with its audit row, and answers the row as stored. */
export const storeRequest = (request: NewOwnerRequest) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => saveOwnerRequest(db, request),
			catch: (cause) => new IntakeStoreFailed({ cause }),
		});
	});
