// The commit flow: a delivered envelope is admitted (a revision must be able to follow it), the facts are read in one
// batch, the rule decides, and the row is stored with the table's constraints as the guard. When the guard says another
// writer took the revision or stored this event first, the facts are read again and the rule decides again, three tries
// in all (src/server/guarded-save.ts). It builds no response text; each refusal is a named failure the route maps.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Publication, Receipt } from "../../lib/publication/contract";
import { sha256Hex } from "../digest";
import { decideAndSave } from "../guarded-save";
import { insertEvent, readCommitFacts } from "../publication-store";
import {
	PublicationConflict,
	admitPublication,
	commitPublication,
	requestOf,
} from "../rules/publication-commit";
import { canonicalPublication } from "../../lib/publication/canonical";

/** The journal took the event (accepted) or already had it (duplicate); either way the receipt is the stored one. */
export type Committed = {
	readonly status: "accepted" | "duplicate";
	readonly receipt: Receipt;
};

export const commit = (publication: Publication) =>
	Effect.gen(function* () {
		yield* admitPublication.decide(publication, {});

		const request = requestOf(
			publication,
			yield* sha256Hex(canonicalPublication(publication)),
		);

		const done = yield* decideAndSave({
			facts: readCommitFacts(
				publication.projectId,
				publication.eventId,
				publication.entryId,
			),
			decide: (facts) => commitPublication.decide(request, facts),
			save: insertEvent,
		});

		const receipt = (stored: {
			readonly revision: number;
			readonly publishedAt: string;
		}): Receipt => ({
			projectId: publication.projectId,
			eventId: publication.eventId,
			revision: stored.revision,
			publishedAt: stored.publishedAt,
		});

		if (Option.isSome(done.decided) && done.saved)
			return {
				status: done.decided.value.inserts ? "accepted" : "duplicate",
				receipt: receipt(done.saved),
			} as const;

		// Nothing to do means the event is stored with this content, so its receipt was in the facts the rule read.
		return done.facts.sameEvent
			? ({
					status: "duplicate",
					receipt: receipt(done.facts.sameEvent),
				} as const)
			: yield* Effect.fail(new PublicationConflict());
	});
