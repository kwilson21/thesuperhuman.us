// The edge for POST /api/owner/requests/[id]/software: the owner's command, one of six actions named by `action`. An Effect
// Schema reader that accepts and refuses every body as the Zod 3 discriminated union it replaces did, with the same value
// (tests/server/validators-differential.test.ts holds it to a frozen copy of that union): a body that is not an object, an
// action that is not one of the six, or a field that does not read refuses the whole command, and the route answers its one
// sentence ("Check the required fields and their limits.") whatever was wrong. What the value keeps, as Zod 3 kept it:
// - only the action's own fields, in the order written below; any other key is left out;
// - a field that may be left out is in the value when the body has the key, even with `undefined` (Zod set a key the body
//   had), and not when the body lacks it;
// - the note and the question or decline text are trimmed before their lengths are checked;
// - the removed attachment keys are an empty list when the field is missing or `undefined`;
// - the reused MSA id is checked with Zod 3's UUID pattern (`uuidPattern`, which asks for no version);
// - the offer version is a whole number above 0 by `Number.isInteger` (so 2 ** 60 is one, as it was), never NaN.
// The terms and the agreement details are not read here: the draft rule reads the terms (`validateOfferTerms`) and the
// details' attachments (`parseAgreementAttachments`) where the route reads them today.
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { receivedKind, stringField, uuidPattern } from "../lib/fields";

/** The sentences are never shown (the route has one sentence for any refusal), so each field says the same. */
const unread = { missing: "Required", wrongType: () => "Required" };

/** Text, trimmed, then checked. */
const trimmed = (...checks: Parameters<typeof Schema.String.check>) =>
	stringField(unread, ...checks);

/** A whole number above 0, as Zod 3's `.int().positive()` read it: `Number.isInteger`, so any integer a double holds. */
const positiveWhole = Schema.Number.check(
	Schema.makeFilter((value: number) => Number.isInteger(value) && value > 0),
);

const REMOVED_KEY = /^agreements\/attachments\/[a-f0-9-]+\.pdf$/;

/** The fit labels the owner chooses from. */
export const FIT_LABELS = [
	"potential-fit",
	"needs-clarification",
	"stated-mismatch",
] as const;

const fit = Schema.Struct({
	action: Schema.Literal("fit"),
	label: Schema.Literals(FIT_LABELS),
	note: trimmed(Schema.isMaxLength(500)),
	expectedRequestUpdatedAt: Schema.optional(Schema.String),
});

const draft = Schema.Struct({
	action: Schema.Literal("draft"),
	terms: Schema.optionalKey(Schema.Unknown),
	agreementDetails: Schema.optionalKey(Schema.Unknown),
	reusedMsaId: Schema.optional(
		Schema.NullOr(Schema.String.check(Schema.isPattern(uuidPattern))),
	),
	confirmMsaReuse: Schema.optional(Schema.Boolean),
	removedAttachmentKeys: Schema.Array(
		Schema.String.check(Schema.isPattern(REMOVED_KEY)),
	)
		.check(Schema.isMaxLength(100))
		.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
	expectedUpdatedAt: Schema.NullOr(Schema.String),
});

const send = Schema.Struct({
	action: Schema.Literal("send"),
	version: positiveWhole,
	expectedUpdatedAt: Schema.String,
});

const revoke = Schema.Struct({
	action: Schema.Literal("revoke"),
	expectedLinkCreatedAt: Schema.String.check(Schema.isMinLength(1)),
});

const message = Schema.Struct({
	action: Schema.Literals(["question", "decline"]),
	text: trimmed(Schema.isMinLength(1), Schema.isMaxLength(2000)),
});

/** The reader of each action, by the action's name. */
const commands = {
	fit,
	draft,
	send,
	revoke,
	question: message,
	decline: message,
};

export type FitCommand = typeof fit.Type;

export type DraftCommand = typeof draft.Type;

export type SendCommand = typeof send.Type;

export type RevokeCommand = typeof revoke.Type;

/** A question or a decline: the text the client is sent. */
export type MessageCommand = typeof message.Type;

/** The owner's command, read. */
export type SoftwareCommand =
	| FitCommand
	| DraftCommand
	| SendCommand
	| RevokeCommand
	| MessageCommand;

/**
 * Reads the owner's command. `body` is what `musicRequest` parsed from JSON. Like the Zod union: a body that is not an
 * object (an array, a date, a map, a set and a promise are not) is refused, and so is one whose `action`, read as the
 * union read it (`body.action`), names no action.
 */
export function readSoftwareCommand<Body>(
	body: Body,
): { ok: true; value: SoftwareCommand } | { ok: false } {
	if (receivedKind(body) !== "object" || !Predicate.isObject(body))
		return { ok: false };

	const named = "action" in body ? body.action : undefined;

	const reader = Object.entries(commands).find(
		([action]) => action === named,
	)?.[1];

	if (!reader) return { ok: false };

	const read = Schema.decodeUnknownResult(reader)(body);

	return Result.isSuccess(read)
		? { ok: true, value: read.success }
		: { ok: false };
}
