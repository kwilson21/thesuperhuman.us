// Sorts what a route caught, so that only a sentence the code wrote for the reader reaches a response.
import { ReaderMessage } from "~/lib/reader-message";
import { isUniqueViolation, raisedByJsonGuard } from "./guarded-save";

export type Failure =
	| { kind: "sentence"; say: string }
	| { kind: "stale" }
	| { kind: "unexpected" };

/**
 * A sentence meant for the reader, a save whose guard or unique index found the facts changed (a lost race or a stale version), or
 * anything else, which is a fault of the site: the route answers its fixed sentence at 500 and logs it with
 * `logUnexpected`.
 */
export function classifyFailure(error: unknown): Failure {
	if (error instanceof ReaderMessage)
		return { kind: "sentence", say: error.message };

	// A failed guard and a unique index both mean another request got there first: a conflict, not a fault.
	if (
		error instanceof Error &&
		(raisedByJsonGuard(error) || isUniqueViolation(error))
	)
		return { kind: "stale" };

	return { kind: "unexpected" };
}

/** Logs a fault of the site without its message, which can hold input or database detail. */
export function logUnexpected(route: string, error: unknown) {
	console.error(
		`${route} failed unexpectedly:`,
		error instanceof Error ? error.name : "UnknownError",
	);
}
