// Sorts what a route caught, so that only a sentence the code wrote for the reader reaches a response.
//
// Three answers. A `ReaderMessage` is a sentence for the reader. A conflict (kind "stale") is another request getting
// there first: a guard that raised, a unique index, or a `LostRace` a batch's own recogniser raised. It answers 409 with
// the route's sentence. Everything else is a fault of the site and answers 500 with that sentence.
//
// What counts as a conflict is decided narrowly, per batch. Two things are recognised everywhere because in this schema
// only a concurrent request can cause them: a guard (`SELECT CASE WHEN ... ELSE json_extract('<sentence>','$') END`, which
// raises "malformed JSON") and a UNIQUE violation. A foreign key failure is NOT recognised here; a batch that can lose a
// race to one checks for it itself and throws `LostRace` (see `reviewAgreements`).
//
// The ways two legitimate requests can make a converted route's batch throw, and what each answers:
//   Agreement review (`POST /api/offer/[token]/review`: the draft save, then `reviewAgreements`)
//     guards (session, live signing link, "already signed", project started) ........ JSON guard, 409
//     `software_agreements_sow_offer`, `software_agreements_pending_msa`, the client unique key .. UNIQUE, 409
//     agreements naming a client another tab created under its own id or deleted ..... FOREIGN KEY, 409 through `LostRace`
//     the draft's primary key is an upsert; offers, templates and the reused MSA are never deleted: no other way
//   Owner agreements (`POST /api/owner/agreements`)
//     publish: the version guard, UNIQUE (kind, version label) (turned into a sentence) ... 409
//     config: the version guard, the version primary key ............................... 409
//     retention apply: `softwareGuard` guards when a hold, a project or an attachment appears ... 409
//     setting and cleanup are single statements with no race
//   Software invoices (`POST /api/owner/requests/[id]/invoices`, reserving)
//     the delivery, deposit and attempt guards, `software_invoices_one_active` ......... 409
//   A real outage (D1 or R2 unavailable, a failed bind, a CHECK that no request explains, a foreign key with its row
//   present) is none of these and answers 500.
//
// Limit: stored data that is not valid JSON, read through `json_each` or `json_extract` in a batch, raises the same
// "malformed JSON" as a guard, and D1 gives no more text to tell them apart. Such a failure answers 409 instead of 500.
// Telling them apart would mean changing every guard to raise a different message (for example an integer overflow); that
// is a change to every guard in the site and is not made here. The stored columns read this way carry `json_valid`
// checks (`values_json`, the contractor config) or are written by the site itself, so it is not expected in practice.
import { LostRace, ReaderMessage } from "~/lib/reader-message";
import { isUniqueViolation, raisedByJsonGuard } from "./guarded-save";

export type Failure =
	| { kind: "sentence"; say: string }
	| { kind: "stale" }
	| { kind: "unexpected" };

export function classifyFailure<T>(error: T): Failure {
	if (error instanceof ReaderMessage)
		return { kind: "sentence", say: error.message };

	if (
		error instanceof LostRace ||
		(error instanceof Error &&
			(raisedByJsonGuard(error) || isUniqueViolation(error)))
	)
		return { kind: "stale" };

	return { kind: "unexpected" };
}

const LOG_LIMIT = 300;

// A parser or validator message can quote the input it read ("... \"not json\" is not valid JSON"), so it is not logged.
const QUOTES_INPUT = /Syntax|Zod|Schema|Parse|Refused/i;

const CONTROLS = new RegExp(
	"[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+",
	"g",
);

/**
 * Logs a fault of the site: the route, the error's name and its message with control characters removed and cut to 300
 * characters. D1 and R2 messages name the failing constraint, table or operation ("UNIQUE constraint failed:
 * software_invoices.request_id", "no such table", "FOREIGN KEY constraint failed", a timeout) and never a bound value,
 * a request body, a token, a cookie or an address; the messages of the parser and validator errors that do quote input
 * are left out.
 */
export function logUnexpected<T>(route: string, error: T) {
	const name = error instanceof Error ? error.name : "UnknownError";

	const message =
		error instanceof Error && !QUOTES_INPUT.test(error.name)
			? error.message.replace(CONTROLS, " ").trim().slice(0, LOG_LIMIT)
			: "";

	console.error(`${route} failed unexpectedly:`, name, message);
}
