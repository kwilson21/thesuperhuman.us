// What the owner's closing of a project's access decides, from the facts the flow read: the project's access
// (docs/plans/2026-11-audio-projects-conversion.md, sections 2 and 4). The write re-checks it: AR1 changes the project only while
// `revoked_at` is still null, so a request that lost the revoke to another one answers what a refused write answers, 409 at
// once, and is not retried. The access also closes in the owner status area through the trigger
// audio_project_close_declined_request (migration 0015) and by a client's stop; closing is absorbing, and no statement of this
// area clears `revoked_at`.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";
import type { StoredProject } from "./audio-project-messages";

/** The project's access is closed already, or the project does not exist, or no owner is named. 409. */
export class AccessAlreadyClosed extends Data.TaggedError(
	"AccessAlreadyClosed",
) {
	readonly say = "Project access is already closed.";
}

/** The owner who closes the access is named: the first check, before anything is read. */
export const accessActor = alwaysWrites({
	name: "name the owner who closes the access",
	given: (request: { readonly actor: string }, _facts: null) =>
		request.actor.trim() !== "",
	refusals: [
		unless(
			term("the owner's email is not blank", (named: boolean) => named),
			() => new AccessAlreadyClosed(),
		),
	],
	writes: () => null,
	writesText: "nothing: the owner is named",
});

/** The project exists and its access is open. */
export const openAccess = alwaysWrites({
	name: "close the access of an open project",
	given: (_request: null, facts: { readonly project: StoredProject | null }) =>
		facts.project,
	refusals: [
		unless(
			term(
				"the project exists and its access is open",
				(project: StoredProject | null) =>
					project !== null && project.revoked_at === null,
			),
			() => new AccessAlreadyClosed(),
		),
	],
	writes: () => null,
	writesText: "nothing: the access may close",
});
