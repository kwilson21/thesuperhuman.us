import {
	checkMessage,
	cleanTextField,
	controlMessage,
	emailMessage,
	readClientAgreement,
	requiredMessage,
} from "./agreement-client-fields";
import {
	choiceField,
	FieldsRefused,
	type FieldValues,
	type FormErrors,
	type Mutable,
	plainErrors,
	type RawValue,
	readFields,
	refuseEveryKind,
} from "./fields";

// The client-side draft of the signing form: its choices, validator and messages. Pure, with no server imports, because
// the browser runs resolveClientDetails before it posts.

export const businessTypes = [
	"LLC",
	"Corporation",
	"Sole proprietorship",
	"Partnership",
	"Nonprofit",
	"Other",
];

export const states = [
	"Alabama",
	"Alaska",
	"Arizona",
	"Arkansas",
	"California",
	"Colorado",
	"Connecticut",
	"Delaware",
	"District of Columbia",
	"Florida",
	"Georgia",
	"Hawaii",
	"Idaho",
	"Illinois",
	"Indiana",
	"Iowa",
	"Kansas",
	"Kentucky",
	"Louisiana",
	"Maine",
	"Maryland",
	"Massachusetts",
	"Michigan",
	"Minnesota",
	"Mississippi",
	"Missouri",
	"Montana",
	"Nebraska",
	"Nevada",
	"New Hampshire",
	"New Jersey",
	"New Mexico",
	"New York",
	"North Carolina",
	"North Dakota",
	"Ohio",
	"Oklahoma",
	"Oregon",
	"Pennsylvania",
	"Rhode Island",
	"South Carolina",
	"South Dakota",
	"Tennessee",
	"Texas",
	"Utah",
	"Vermont",
	"Virginia",
	"Washington",
	"West Virginia",
	"Wisconsin",
	"Wyoming",
	"Outside the US",
];

const draftFields = {
	legal_name: cleanTextField(200),
	entity_type: cleanTextField(200),
	state: cleanTextField(100),
	country: cleanTextField(100),
	business_address: cleanTextField(1000),
	signer_name: cleanTextField(200),
	signer_title: cleanTextField(200),
	portfolio_choice: choiceField(["private", "anonymous", "named", ""], {
		missing: checkMessage,
		wrongType: () => checkMessage,
		notOneOf: () => checkMessage,
	}),
	reviewer_name: cleanTextField(200),
	reviewer_email: cleanTextField(320),
	approver_name: cleanTextField(200),
	approver_email: cleanTextField(320),
	notice_email: cleanTextField(320),
};

export type AgreementDraft = Mutable<FieldValues<typeof draftFields>>;

/** A field that is missing reads as empty. */
const emptyDraft = Object.fromEntries(
	Object.keys(draftFields).map((name) => [name, ""]),
);

/** What a visitor sees for a field whose control characters or lone surrogates the reader refused. */
const unusualCharacters = "Remove unusual characters from this field.";

export const fieldMessages: Record<string, string> = {
	legal_name: "Add your legal business name",
	entity_type: "Choose a business type",
	state: "Choose a state",
	country: "Add your country",
	business_address: "Add your business mailing address",
	signer_name: "Add your full legal name",
	signer_title: "Add your title",
	portfolio_choice: "Choose a portfolio option",
	reviewer_name: "Add the reviewer name",
	reviewer_email: "Add a valid reviewer email",
	approver_name: "Add the approver name",
	approver_email: "Add a valid approver email",
	notice_email: "Add a valid notice email",
};

/**
 * Reads the draft the signing form posts: every field is text (or one of the portfolio choices), a missing field is
 * empty, and an unknown key refuses the body under `legal_name` (as does a body that is not an object). A field that
 * fails says what a visitor sees: the sentence for control characters, or "Check this field.". The answer is a new
 * plain object the caller may change.
 */
export function readDraft(
	input: RawValue,
):
	| { ok: true; value: AgreementDraft }
	| { ok: false; errors: Record<string, string> } {
	const read = readFields(draftFields, input, {
		winner: "last",
		defaults: emptyDraft,
		notObject: refuseEveryKind(checkMessage),
		alongside: (body): FormErrors<typeof draftFields> =>
			Object.keys(body).some((key) => !Object.hasOwn(draftFields, key))
				? { legal_name: checkMessage }
				: {},
	});

	if (read.ok) return { ok: true, value: read.value };

	return {
		ok: false,
		errors: Object.fromEntries(
			Object.entries(plainErrors(read.errors)).map(([field, message]) => [
				// A body that is not an object has no field to name, so its one error goes under the first.
				field === "_form" ? "legal_name" : field,
				message === controlMessage ? unusualCharacters : checkMessage,
			]),
		),
	};
}

/** The draft, or a thrown `FieldsRefused` (its message starts with `[`) for input that does not read. */
export function parseDraft(input: RawValue): AgreementDraft {
	const read = readDraft(input);

	if (!read.ok) throw new FieldsRefused(read.errors);

	return read.value;
}

export function resolveClientDetails(input: RawValue, email: string) {
	const parsed = readDraft(input);

	if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
	const draft = parsed.value;

	const client = readClientAgreement({
		legal_name: draft.legal_name,
		entity_type: draft.entity_type,
		jurisdiction:
			draft.state === "Outside the US" ? draft.country : draft.state,
		business_address: draft.business_address,
		signer_name: draft.signer_name,
		signer_title: draft.signer_title,
		notice_email: draft.notice_email || email,
		reviewer_name: draft.reviewer_name || draft.signer_name,
		reviewer_email: draft.reviewer_email || email,
		approver_name: draft.approver_name || draft.signer_name,
		approver_email: draft.approver_email || email,
		portfolio: draft.portfolio_choice === "private" ? "deny" : "allow",
		naming: draft.portfolio_choice === "named",
	});

	const errors: Record<string, string> = {};

	// The client details are read from values this function built, so no extra key or naming rule can refuse them.
	if (!client.ok)
		for (const [name, message] of Object.entries(client.errors)) {
			const field =
				name === "jurisdiction"
					? draft.state === "Outside the US"
						? "country"
						: "state"
					: name;

			errors[field] =
				message === controlMessage
					? unusualCharacters
					: message === requiredMessage || message === emailMessage
						? (fieldMessages[field] ?? checkMessage)
						: checkMessage;
		}

	if (!businessTypes.includes(draft.entity_type))
		errors.entity_type = fieldMessages.entity_type;

	if (!states.includes(draft.state)) errors.state = fieldMessages.state;

	if (!draft.portfolio_choice)
		errors.portfolio_choice = fieldMessages.portfolio_choice;

	return client.ok && !Object.keys(errors).length
		? { ok: true as const, client: client.value }
		: { ok: false as const, errors };
}
