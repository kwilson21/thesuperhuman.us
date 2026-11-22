// The owner closes a project's access: the owner is named (the first check, before anything is read), the id of the revocation
// is drawn, the project is read and judged, and one batch closes the project, ends the client's sessions, deletes the client's
// sign-in codes and writes the audit row (docs/plans/2026-11-audio-projects-conversion.md, sections 3 and 4). A write that lost the
// revoke to another request answers 409 at once. Afterwards the retired sign-in codes are cleared, best effort: the table already
// dropped is silent, and any other failure is logged once and the revoke still stands. The route builds every answer.
import * as Effect from "effect/Effect";
import { logUnexpected } from "../failure";
import { readProjectFacts, revokeAccessBatch } from "../audio-project-store";
import {
	AccessAlreadyClosed,
	accessActor,
	openAccess,
} from "../rules/audio-project-access";
import { deleteRetiredClientCodes } from "../studio-signin-store";

/** Where a failed cleanup of the retired sign-in codes is logged: it is not the route's answer, so it has its own label. */
const CLEANUP = "/api/owner/projects/[id]/access (retired sign-in codes)";

export const revokeProjectAccess = (input: {
	readonly requestId: string;
	readonly ownerEmail: string;
	readonly now: () => Date;
	readonly newId: () => string;
}) =>
	Effect.gen(function* () {
		yield* accessActor.decide({ actor: input.ownerEmail }, null);

		const at = input.now().toISOString();
		const revocationId = input.newId();
		const facts = yield* readProjectFacts(input.requestId);
		yield* openAccess.decide(null, facts);

		const closed = yield* revokeAccessBatch({
			requestId: input.requestId,
			actor: input.ownerEmail,
			at,
			revocationId,
		});

		if (!closed) return yield* Effect.fail(new AccessAlreadyClosed());

		yield* deleteRetiredClientCodes(input.requestId).pipe(
			Effect.catchTag("StudioSigninStoreFailed", (failure) =>
				Effect.sync(() => logUnexpected(CLEANUP, failure.failure)),
			),
		);
	});
