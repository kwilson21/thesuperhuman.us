import * as Effect from "effect/Effect";
import type { NewOwnerRequest } from "../../src/lib/owner-requests";
import { insertRequest } from "../../src/server/intake-store";
import { MusicDb } from "../../src/server/services";

/** Creates an owner request through the intake store, as the public forms do, and answers the row as stored. A refusal rejects. */
export const createRequest = (db: D1Database, request: NewOwnerRequest) =>
	Effect.runPromise(
		insertRequest(request).pipe(Effect.provideService(MusicDb, db)),
	);
