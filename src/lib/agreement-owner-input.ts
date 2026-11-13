import * as Schema from "effect/Schema";
import { cleanCheck, requiredField } from "./agreement-client-fields";
import { validProjectDate } from "./audio-project-updates";
import {
	afterwards,
	choiceField,
	fieldOf,
	type FieldValues,
	type Mutable,
	type RawValue,
	readFields,
	readVariants,
	refuseEveryKind,
	stringField,
	uuidPattern,
	type VariantValues,
} from "./fields";
import { list, patternText, readWith, record, type Value } from "./readers";

// What the owner's agreement requests must hold, read with Effect Schema. A request that does not read is refused with
// one fixed sentence whatever was wrong (the routes never show which field), so these answer only whether the body reads
// and with what values; tests/server/validators-differential.test.ts holds them to the Zod schemas they replaced.

const kinds = { missing: "Required", wrongType: () => "Required" };

/** A UUID as Zod 3 read one: any text of the reader, not trimmed. */
const uuid = stringField(
	{ ...kinds, trim: false },
	Schema.isPattern(uuidPattern, { message: "Invalid uuid" }),
);

/** A reader of src/lib/readers.ts, as a field that gives its value or refuses. */
const readerField = <T>(reader: Parameters<typeof readWith<T>>[0]) =>
	fieldOf<T>((raw) => {
		const read = readWith(reader, raw);

		return read.ok ? { value: read.value } : { say: "Invalid" };
	});

const documentsReader = list(
	record(
		{ id: patternText(uuidPattern), hash: patternText(/^[a-f0-9]{64}$/) },
		{ strict: false },
	),
	{ min: 1, max: 2 },
);

const documents = readerField<Value<typeof documentsReader>>(documentsReader);

/** Clean text that is not blank (a blank or control-character answer refuses the request). */
const needed = (max: number) => requiredField(max);

const literalTrue = fieldOf<true>((raw) =>
	raw === true ? { value: true } : { say: "Invalid" },
);

const flag = (initial: boolean) =>
	fieldOf<boolean>((raw) =>
		raw === undefined
			? { value: initial }
			: raw === true || raw === false
				? { value: raw }
				: { say: "Invalid" },
	);

const choice = <const V extends readonly [string, ...string[]]>(values: V) =>
	choiceField(values, {
		missing: "Required",
		wrongType: () => "Invalid",
		notOneOf: () => "Invalid",
	});

const retryFields = {
	agreement_id: uuid,
	confirmedNotSent: flag(false),
	// A missing attempt is left out; one that is there must be a UUID.
	expectedAttempt: fieldOf<string | undefined>((raw) => {
		if (raw === undefined) return { value: undefined };

		const read = readFields({ id: uuid }, { id: raw });

		return read.ok ? { value: read.value.id } : { say: "Invalid" };
	}),
	confirmedStale: flag(false),
};

const variants = {
	countersign: {
		documents,
		typed_name: needed(200),
		consent: literalTrue,
	},
	abandon: {
		documents,
		reason: needed(1000),
		confirmed: literalTrue,
	},
	"retry-artifact": retryFields,
	"retry-copy": retryFields,
	"record-alternate-copy": {
		agreement_id: uuid,
		role: choice(["client", "contractor"]),
		method: needed(200),
		confirmed: literalTrue,
	},
	hold: {
		agreement_id: uuid,
		held: fieldOf<boolean>((raw) =>
			raw === true || raw === false ? { value: raw } : { say: "Invalid" },
		),
	},
	end: {
		agreement_id: uuid,
		ended_on: stringField(
			{ ...kinds, trim: false },
			Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { message: "Invalid" }),
		),
		confirmed: literalTrue,
	},
};

export type OwnerAgreementAction = Mutable<
	VariantValues<"action", typeof variants>
>;

/** The owner's agreement action (countersign, abandon, retry, record a copy, hold, end), or that it does not read. */
export function readOwnerAgreementAction(
	input: RawValue,
): { ok: true; value: OwnerAgreementAction } | { ok: false } {
	const read = readVariants("action", variants, input, {
		unknownVariant: "Invalid",
		notObject: refuseEveryKind("Invalid"),
	});

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
	version: needed(80),
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
