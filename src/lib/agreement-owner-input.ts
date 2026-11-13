import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { cleanCheck, requiredField } from "./agreement-client-fields";
import { validProjectDate } from "./audio-project-updates";
import {
	afterwards,
	type FieldValues,
	type Mutable,
	type RawValue,
	readFields,
	stringField,
	uuidPattern,
} from "./fields";
import {
	alwaysTrue,
	list,
	oneOf,
	optional,
	patternText,
	type Reader,
	readWith,
	record,
	text,
	truth,
	type Value,
	withDefault,
} from "./readers";

// What the owner's agreement requests must hold, read with Effect Schema. A request that does not read is refused with
// one fixed sentence whatever was wrong (the routes never show which field), so these answer only whether the body reads
// and with what values; tests/server/validators-differential.test.ts holds them to the Zod schemas they replaced, the
// parsed value included: its keys, their order and which are absent.

const kinds = { missing: "Required", wrongType: () => "Required" };

const uuid = patternText(uuidPattern);

const documents = list(
	record({ id: uuid, hash: patternText(/^[a-f0-9]{64}$/) }, { strict: false }),
	{ min: 1, max: 2 },
);

/** Clean text that is not blank (a blank or control-character answer refuses the request). */
const needed = (max: number) => text(requiredField(max), true);

const confirmed = withDefault(truth, false);

/** The retry actions share their fields, so they are one member of the union with either action. */
const retry = record(
	{
		action: oneOf(["retry-artifact", "retry-copy"]),
		agreement_id: uuid,
		confirmedNotSent: confirmed,
		expectedAttempt: optional(uuid),
		confirmedStale: confirmed,
	},
	{ strict: false },
);

/** One reader for each action the owner can take; the first field of each is the action. */
const actions = {
	countersign: record(
		{
			action: oneOf(["countersign"]),
			documents,
			typed_name: needed(200),
			consent: alwaysTrue,
		},
		{ strict: false },
	),
	abandon: record(
		{
			action: oneOf(["abandon"]),
			documents,
			reason: needed(1000),
			confirmed: alwaysTrue,
		},
		{ strict: false },
	),
	"retry-artifact": retry,
	"retry-copy": retry,
	"record-alternate-copy": record(
		{
			action: oneOf(["record-alternate-copy"]),
			agreement_id: uuid,
			role: oneOf(["client", "contractor"]),
			method: needed(200),
			confirmed: alwaysTrue,
		},
		{ strict: false },
	),
	hold: record(
		{ action: oneOf(["hold"]), agreement_id: uuid, held: truth },
		{ strict: false },
	),
	end: record(
		{
			action: oneOf(["end"]),
			agreement_id: uuid,
			ended_on: patternText(/^\d{4}-\d{2}-\d{2}$/),
			confirmed: alwaysTrue,
		},
		{ strict: false },
	),
};

export type OwnerAgreementAction =
	| Value<typeof actions.countersign>
	| Value<typeof actions.abandon>
	| Value<typeof actions.hold>
	| Value<typeof actions.end>
	| Value<(typeof actions)["record-alternate-copy"]>
	| Value<(typeof actions)["retry-artifact"]>
	| Value<(typeof actions)["retry-copy"]>;

/** The owner's agreement action (countersign, abandon, retry, record a copy, hold, end), or that it does not read. */
export function readOwnerAgreementAction(
	input: RawValue,
): { ok: true; value: OwnerAgreementAction } | { ok: false } {
	const named = Predicate.isObject(input) ? input.action : undefined;

	const reader: Reader<OwnerAgreementAction> | undefined = Predicate.isString(
		named,
	)
		? Object.entries(actions).find(([name]) => name === named)?.[1]
		: undefined;

	if (!reader) return { ok: false };

	const read = readWith(reader, input);

	return read.ok ? { ok: true, value: read.value } : { ok: false };
}

const attachmentQueryFields = {
	// A filename is clean text that is not blank and holds no slash or backslash.
	filename: afterwards(
		stringField(
			kinds,
			cleanCheck(200),
			Schema.makeFilter((value: string) =>
				/[\\/]/.test(value) ? "Invalid" : true,
			),
			Schema.isMinLength(1),
		),
		(value) => value.normalize("NFC"),
	),
	version: requiredField(80),
	date: stringField(
		{ ...kinds, trim: false },
		Schema.makeFilter((value: string) =>
			validProjectDate(value) ? true : "Invalid",
		),
	),
};

export type AttachmentQuery = Mutable<
	FieldValues<typeof attachmentQueryFields>
>;

/** The filename, version and date an attachment upload names in its query, or that they do not read. */
export function readAttachmentQuery(
	input: RawValue,
): { ok: true; value: AttachmentQuery } | { ok: false } {
	const read = readFields(attachmentQueryFields, input);

	return read.ok ? { ok: true, value: read.value } : { ok: false };
}
