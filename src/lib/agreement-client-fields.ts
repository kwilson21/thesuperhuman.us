import * as Schema from "effect/Schema";
import {
	afterwards,
	choiceField,
	emailPattern,
	FieldsRefused,
	type KindSentences,
	fieldOf,
	type FormErrors,
	type FieldValues,
	type Mutable,
	plainErrors,
	type RawValue,
	readFields,
	refuseEveryKind,
	stringField,
} from "./fields";

// The pieces of the agreement flow that run in the browser: the client's own validator and the consent text. Pure,
// with no server imports, so a browser entry can import them without the invoicing, e-mail or session code. The
// validators are Effect Schema fields (src/lib/fields.ts). Their sentences are not shown as they are: the draft and the
// client readers turn them into the text a visitor sees (agreement-draft-fields.ts), so a sentence here is a signal of
// what kind of check failed.

/** The signal for any check that is not one of the three below: too long, not text, not one of the choices. */
export const checkMessage = "Check this field.";

/** The signal for text with a control character or a lone surrogate. */
export const controlMessage = "Remove control characters.";

/** The signal for an answer that is blank once trimmed. */
export const requiredMessage = "This answer is required.";

/** The signal for an address that is not an email address. */
export const emailMessage = "Add a valid email address.";

/** The sentences a text field gives for what is not text and for text that is too long. */
export type TextSentences = {
	readonly kinds: KindSentences;
	readonly tooLong: (max: number) => string;
};

/** The signals the client and draft readers use: every such failure is the one "Check this field." signal. */
const signals: TextSentences = {
	kinds: { missing: checkMessage, wrongType: () => checkMessage },
	tooLong: () => checkMessage,
};

/**
 * The sentences Zod 3 gave, for the owner agreement schemas, whose failures a person reads word for word ("Required",
 * "Expected string, received number", "String must contain at most 200 character(s)").
 */
export const zodSentences: TextSentences = {
	kinds: {
		missing: "Required",
		wrongType: (received) => `Expected string, received ${received}`,
	},
	tooLong: (max) => `String must contain at most ${max} character(s)`,
};

const kinds = signals.kinds;

/** The sentence for text that is too long or holds a control character: the length is asked first, and a text that is too long is not read for control characters (as Zod's refine after its `max` was not). */
export const cleanCheck = (max: number, sentences: TextSentences = signals) =>
	Schema.makeFilter((value: string) => {
		if (value.length > max) return sentences.tooLong(max);

		return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(value)
			? controlMessage
			: true;
	});

/**
 * Text that is trimmed, no longer than `max` (counted before normalising), free of control characters, and normalised
 * to NFC. A check that fails stops the normalising, as it stopped Zod's transform.
 */
export const cleanTextField = (max: number, sentences = signals) =>
	afterwards(
		stringField(sentences.kinds, cleanCheck(max, sentences)),
		(value) => value.normalize("NFC"),
	);

/** Clean text that is not blank. */
export const requiredField = (max: number, sentences = signals) =>
	afterwards(
		stringField(
			sentences.kinds,
			cleanCheck(max, sentences),
			Schema.isMinLength(1, { message: requiredMessage }),
		),
		(value) => value.normalize("NFC"),
	);

/** An email address, trimmed and lower-cased, at most 320 characters. */
export const emailField = afterwards(
	stringField(
		kinds,
		Schema.isPattern(emailPattern, { message: emailMessage }),
		Schema.isMaxLength(320, { message: checkMessage }),
	),
	(value) => value.toLowerCase(),
);

const clientFields = {
	legal_name: requiredField(200),
	entity_type: requiredField(200),
	jurisdiction: requiredField(100),
	business_address: requiredField(1000),
	notice_email: emailField,
	reviewer_name: requiredField(200),
	reviewer_email: emailField,
	approver_name: requiredField(200),
	approver_email: emailField,
	signer_name: requiredField(200),
	signer_title: requiredField(200),
	portfolio: choiceField(["allow", "deny"], {
		...kinds,
		notOneOf: () => checkMessage,
	}),
	naming: fieldOf<boolean>((raw) =>
		raw === true || raw === false ? { value: raw } : { say: checkMessage },
	),
};

export type ClientAgreement = Mutable<FieldValues<typeof clientFields>>;

/**
 * Reads the client's details: every field as its own check says, and nothing else in the body (an extra key refuses it
 * under `_form`), and a refused naming under `_form` too (naming needs the portfolio to be allowed). Each field's
 * sentence is the last check that failed. The answer is a new plain object the caller may change.
 */
export function readClientAgreement(
	input: RawValue,
):
	| { ok: true; value: ClientAgreement }
	| { ok: false; errors: Record<string, string> } {
	const read = readFields(clientFields, input, {
		winner: "last",
		defaults: { naming: false },
		notObject: refuseEveryKind(checkMessage),
		alongside: (body): FormErrors<typeof clientFields> =>
			Object.keys(body).some((key) => !Object.hasOwn(clientFields, key))
				? { _form: checkMessage }
				: {},
		after: (value) =>
			value.portfolio === "allow" || !value.naming
				? {}
				: { _form: "Naming requires portfolio permission." },
	});

	return read.ok
		? { ok: true, value: read.value }
		: { ok: false, errors: plainErrors(read.errors) };
}

/** The client's details, or a thrown `FieldsRefused` (its message starts with `[`) for a body that does not read. */
export function parseClientAgreement(input: RawValue): ClientAgreement {
	const read = readClientAgreement(input);

	if (!read.ok) throw new FieldsRefused(read.errors);

	return read.value;
}

export const consentText = (party: string, owner = false) =>
	owner
		? "I agree to sign and receive these documents electronically, and I’m authorized to sign for The Superhuman Group LLC."
		: `I agree to sign and receive these documents electronically, and I’m authorized to sign for ${party}, a business. I can download and keep a complete copy.`;

export const intentText = (owner = false, sowOnly = false) =>
	owner
		? `Countersigning applies your name above as your electronic signature on the ${sowOnly ? "statement of work" : "agreement and statement of work"} you reviewed.`
		: `Signing applies your name above as your electronic signature on the ${sowOnly ? "statement of work" : "agreement and statement of work"} linked above.`;
