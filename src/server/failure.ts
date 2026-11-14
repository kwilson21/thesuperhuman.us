// Sorts what a route caught, so that only a sentence the code wrote for the reader reaches a response.
//
// Three answers. A `ReaderMessage` is a sentence for the reader. A conflict (kind "stale") is another request getting
// there first: a guard that raised, a unique index, or a `LostRace` a batch's own recogniser raised. It answers 409 with
// the route's sentence. Everything else is a fault of the site and answers 500 with that sentence.
//
// What counts as a conflict is decided narrowly, per batch. Two things are recognised everywhere because in this schema
// only a concurrent request can cause them: a guard (`SELECT CASE WHEN ... ELSE json_extract('<sentence>','$') END`, which
// raises "malformed JSON") and a UNIQUE violation. A foreign key failure is NOT recognised here; a batch that can lose a
// race to one looks for positive evidence of the race itself and throws `LostRace` only then (see `reviewAgreements`).
//
// The ways two legitimate requests can make a converted route's batch throw, and what each answers:
//   Agreement review (`POST /api/offer/[token]/review`: the draft save, then `reviewAgreements`)
//     guards (session, live signing link, "already signed", project started) ........ JSON guard, 409
//     `software_agreements_sow_offer`, `software_agreements_pending_msa`, the client unique key .. UNIQUE, 409
//     agreements naming a client another tab created under its own id or deleted ..... FOREIGN KEY, 409 through `LostRace`,
//       only on positive evidence read afterwards: a row with the same natural key (recipient email, legal name key,
//       entity type, jurisdiction) under another id, or the earlier client row gone. Any other foreign key failure, or
//       a failed read of that evidence, rethrows the ORIGINAL error: 500, logged
//     the draft's primary key is an upsert; offers, templates and the reused MSA are never deleted: no other way
//   Owner agreements (`POST /api/owner/agreements`)
//     publish: the version guard, UNIQUE (kind, version label) (turned into a sentence) ... 409
//     config: the version guard, the version primary key ............................... 409
//     retention apply: `softwareGuard` guards when a hold, a project or an attachment appears ... 409
//     setting and cleanup are single statements with no race
//   Software invoices (`POST /api/owner/requests/[id]/invoices`, reserving)
//     the delivery, deposit and attempt guards, `software_invoices_one_active` ......... 409
//   A real outage (D1 or R2 unavailable, a failed bind, a CHECK that no request explains, a foreign key failure with no evidence of a race
//   behind it) is none of these and answers 500.
//
// Limit: stored data that is not valid JSON, read through `json_each` or `json_extract` in a batch, raises the same
// "malformed JSON" as a guard, and D1 gives no more text to tell them apart. Such a failure answers 409 instead of 500.
// Telling them apart would mean changing every guard to raise a different message (for example an integer overflow); that
// is a change to every guard in the site and is not made here. The stored columns read this way carry `json_valid`
// checks (`values_json`, the contractor config) or are written by the site itself, so it is not expected in practice.
import Stripe from "stripe";
import { z } from "astro/zod";
import * as Schema from "effect/Schema";
import { isText } from "~/lib/type-guards";
import { FieldsRefused } from "~/lib/fields";
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

const NAME_LIMIT = 60;

// A message that names a credential is not logged.
const NAMES_SECRET =
	/\b[sr]k_|API key|bearer|token|password|secret|authorization/i;

const CONTROLS = new RegExp(
	"[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+",
	"g",
);

const clean = (text: string, limit: number) =>
	text.replace(CONTROLS, " ").trim().slice(0, limit);

// What a message may quote of what was sent is removed, not listed by word: the userinfo and the query string of anything
// that looks like a URL, any other query string, anything shaped like an email address, and an IPv4 or IPv6 address.
const USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#"'<>]*@/gi;
const QUERY = /\?[^\s"'<>]+/g;
const EMAIL = /[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/g;

// An IPv4 address is four dotted groups of digits, not inside a longer number or word and not followed by a fifth group
// (so 4.1.4 and 1.2.3.4.5 are not one). An IPv6 address is eight full groups (the last two may be an IPv4 address), or a compressed form containing "::" (so
// a time such as 12:30:45 and a port after a bracketed address are not one), with an optional IPv4 tail (the mapped
// ::ffff:203.0.113.7 is one address) and an optional zone (fe80::1%eth0). None may sit inside a longer word. The patterns
// have no nested repeats, and every repeat is bounded, so they run in linear time.
const HEX = "[0-9a-f]{1,4}";
const OCTETS = "(?:\\d{1,3}\\.){3}\\d{1,3}";

const IPV4 = new RegExp(`(?<![\\w.])${OCTETS}(?!\\w|\\.\\d)`, "g");

const IPV6 = new RegExp(
	`(?<![\\w:])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){6}${OCTETS}|(?:${HEX}(?::${HEX}){0,6})?::(?:(?:${HEX}:){0,5}${OCTETS}|${HEX}(?::${HEX}){0,6})?)(?:%[\\w.-]+)?(?![\\w:]|\\.\\d)`,
	"gi",
);

/**
 * Whether text that matched IPV6 is an address. A compressed form with no decimal digit and at most two groups (a bare "::",
 * "cafe::", "abc::def", "a::b") cannot be told from a name, so it is left alone; every other match is redacted, since a
 * real client address has a digit (a global address starts with 2 or 3, a link-local one is fe80) and a longer one is never
 * left. Redacting wins: an all-letter address of two groups or fewer would be logged, and none is known to exist.
 */
function looksLikeAddress(match: string) {
	if (!match.includes("::") || match.includes(".")) return true;

	const groups = match.split(/[:%]/).filter((group) => group !== "");

	return /\d/.test(match) || groups.length > 2;
}

/** Replaces IPv4 and IPv6 addresses with [ip] (exported for its own test, which feeds it long adversarial text). */
export const redactAddresses = (text: string) =>
	text
		.replace(IPV6, (match) => (looksLikeAddress(match) ? "[ip]" : match))
		.replace(IPV4, "[ip]");

const redact = (text: string) =>
	redactAddresses(
		text
			.replace(USERINFO, "$1[redacted]@")
			.replace(QUERY, "?[redacted]")
			.replace(EMAIL, "[email]"),
	);

/** Errors whose message quotes the input they read or the values they were sent, found by what they are, not by name. */
const quotesInput = <T>(error: T): boolean =>
	error instanceof SyntaxError ||
	error instanceof z.ZodError ||
	error instanceof FieldsRefused ||
	Schema.isSchemaError(error);

/**
 * Logs a fault of the site: the route, the error's name (cleaned and cut to 60 characters) and its message with control
 * characters removed and cut to 300 characters. D1 and R2 messages name the failing constraint, table or operation
 * ("UNIQUE constraint failed: software_invoices.request_id", "no such table", "FOREIGN KEY constraint failed", a timeout)
 * and never a bound value, a request body, a token, a cookie or an address.
 *
 * Three kinds of error never have their message logged, because it can quote what was sent: a Stripe error (its message
 * repeats parameter values such as a customer's email; only its type, code and status are logged), a parser or validator
 * error (JSON syntax, Zod, Effect Schema, the shared form validator), and any message that names a credential. They are
 * recognised by what they are (`instanceof`), not by their name, because a Stripe error never sets `name`.
 */
export function logUnexpected<T>(route: string, error: T) {
	try {
		console.error(`${route} failed unexpectedly:`, ...describe(error));
	} catch {
		// This runs inside a route's catch block, so it must not throw: an error whose fields cannot be read gets a fixed line.
		console.error(`${route} failed unexpectedly:`, "(details unavailable)");
	}
}

/** The class name of an error's cause, which is all that is logged of it: its message can quote what was sent. */
function causeClass(error: Error): string[] {
	const { cause } = error;

	return cause instanceof Error
		? [`cause=${clean(cause.constructor.name, NAME_LIMIT)}`]
		: [];
}

function describe<T>(error: T): string[] {
	if (error instanceof Stripe.errors.StripeError)
		return [
			clean(String(error.type), NAME_LIMIT),
			`code=${clean(String(error.code ?? "none"), NAME_LIMIT)} status=${error.statusCode ?? "none"}`,
		];

	if (!(error instanceof Error)) return ["UnknownError", ""];
	const name = isText(error.name) ? clean(error.name, NAME_LIMIT) : "Error";
	const cause = causeClass(error);

	// A message built from a Stripe, parser or validator error's can quote it, so it goes with it.
	const wraps =
		error.cause instanceof Stripe.errors.StripeError ||
		quotesInput(error.cause);

	const text = error.message;

	const message =
		isText(text) && !quotesInput(error) && !wraps && !NAMES_SECRET.test(text)
			? clean(redact(clean(text, 2000)), LOG_LIMIT)
			: "";

	return [name, message, ...cause];
}
