// The statements that close a client's studio sign-in when a project's access closes (docs/plans/2026-11-audio-projects-conversion.md,
// section 4, AR2, AR3 and AR5). They write `audio_client_sessions`, `audio_client_signin_codes` and the retired sign-in codes table,
// which belong to the studio sign-in area, so they live here, one function per statement, and the studio sign-in area's
// conversion extends this file. The first two are statements of the access revocation's batch, so they are built over the
// batch's database and run with the project's own statements; the third is run alone, after the batch.
//
// The client's email is selected by request id inside each statement (a lookup by key, not a decision), so the statement acts
// on the client's email as it is at the write, and binding an email read earlier would end the sessions of an address the
// request no longer has. AR2 and AR3 are linked to the revocation by its id: a request that lost the revoke to another one
// ends no session and deletes no code.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { MusicDb } from "./services";

/** A statement of the studio sign-in tables failed. The cause is for the caller's log. */
export class StudioSigninStoreFailed extends Data.TaggedError(
	"StudioSigninStoreFailed",
)<{ readonly failure: unknown }> {}

/** AR2, compare-and-set: every open session of the client the request names is ended, while the revocation is this request's. */
export const endClientSessions = (
	db: D1Database,
	requestId: string,
	revocationId: string,
	at: string,
) =>
	db
		.prepare(`UPDATE audio_client_sessions SET revoked_at=? WHERE revoked_at IS NULL AND email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`)
		.bind(at, requestId, revocationId);

/** AR3, compare-and-set: the sign-in codes of the client the request names are deleted, while the revocation is this request's. */
export const deleteClientSigninCodes = (
	db: D1Database,
	requestId: string,
	revocationId: string,
) =>
	db
		.prepare(`DELETE FROM audio_client_signin_codes WHERE email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`)
		.bind(requestId, revocationId);

/**
 * AR5, write guarded by key, best effort after the revocation: the codes of the retired sign-in table. A table that is already
 * dropped (a later migration, issue 271) is silent and not a failure; any other failure is a `StudioSigninStoreFailed` the
 * caller logs and goes on from.
 */
export const deleteRetiredClientCodes = (requestId: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db
					.prepare(
						"DELETE FROM audio_client_codes WHERE email=(SELECT email FROM owner_requests WHERE id=?)",
					)
					.bind(requestId)
					.run(),
			catch: (cause) => new StudioSigninStoreFailed({ failure: cause }),
		}).pipe(
			Effect.catchTag("StudioSigninStoreFailed", (failure) =>
				failure.failure instanceof Error &&
				/no such table/i.test(failure.failure.message)
					? Effect.void
					: Effect.fail(failure),
			),
		);
	});
