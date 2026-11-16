// The fit review: the owner labels how a software brief fits and adds a note. Decided from the request as read (its
// status, email and updated_at) and the updated_at the owner's page sent, if it sent one: refused when the request is
// closed or resolved, then when the page's updated_at is not the stored one (RequestChanged). A started project does
// not refuse it, so no project is read. Writes, in one batch: the fit review upserted, the request's updated_at, and the
// audit `fit-reviewed`. Re-checked at write time by G1, the request guard (the row still has the updated_at, status and
// email that were read); a refused batch is answered RequestChanged (src/server/rules/offer-refused-batch.ts).
import type { FitCommand } from "../software-offer-input";
import { alwaysWrites, term, unless } from "../terms";
import {
	RequestChanged,
	type Requested,
	type RequestRead,
	RequestResolved,
	requestOpen,
	requestRead,
	statusAllows,
	writeTime,
} from "./software-request";

/** What the owner asked, with the time the flow read and who is acting. */
export type FitRequest = Pick<
	FitCommand,
	"label" | "note" | "expectedRequestUpdatedAt"
> & {
	readonly now: string;
	readonly actor: string;
};

type FitGiven = Requested & { readonly command: FitRequest };

/** The fit batch: G1 over `request`, then the review, the request's updated_at and the audit, all at `at`. */
export type FitWrite = {
	readonly request: RequestRead;
	readonly label: FitCommand["label"];
	/** Trimmed by the command reader. */
	readonly note: string;
	readonly at: string;
	readonly actor: string;
	readonly audit: "fit-reviewed";
};

export const reviewFit = alwaysWrites({
	name: "review how a software brief fits",
	given: (command: FitRequest, facts: Requested): FitGiven => ({
		command,
		request: facts.request,
	}),
	refusals: [
		requestOpen("FIT"),
		statusAllows("FIT", () => new RequestResolved()),
		unless(
			term(
				"the page sent no updated_at, or the request's own",
				(given: FitGiven) =>
					given.command.expectedRequestUpdatedAt === undefined ||
					given.command.expectedRequestUpdatedAt === given.request.updatedAt,
			),
			() => new RequestChanged(),
		),
	],
	writes: (given): FitWrite => ({
		request: requestRead(given.request),
		label: given.command.label,
		note: given.command.note,
		at: writeTime(given.command.now, given.request.updatedAt),
		actor: given.command.actor,
		audit: "fit-reviewed",
	}),
	writesText:
		"the fit review (label, note, time, owner), the request's updated_at and the audit fit-reviewed, in one batch; the answer gives the time",
});
