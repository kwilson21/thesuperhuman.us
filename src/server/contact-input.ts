// The edge for the contact form and the resume request form: what each visitor's JSON body must hold, and the sentence
// each field gives when it does not. These replace src/lib/validation.ts and answer exactly as it did (the golden corpus
// in tests/golden holds both routes to that): the same sentences, the same trimming, and the error keys in field order.
// A value that is not text reads as empty, so a missing field and a number both say "is required".
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
	type FieldValues,
	fieldOf,
	rawTextField,
	readFields,
	textField,
} from "./edge";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOT_OBJECT = { notObject: "Invalid request body." } as const;

const nameField = textField(
	Schema.isMinLength(1, { message: "Name is required." }),
	Schema.isMaxLength(100, { message: "Name is too long." }),
);

const emailField = textField(
	Schema.isMinLength(1, { message: "Email is required." }),
	Schema.isMaxLength(120, { message: "Invalid email." }),
	Schema.isPattern(EMAIL, { message: "Invalid email." }),
);

const companyField = textField(
	Schema.isMaxLength(120, { message: "Company is too long." }),
);

/** The captcha token is kept as it arrived: it is not trimmed. */
const tokenField = rawTextField(
	Schema.isMinLength(1, { message: "Captcha missing." }),
);

const contactFields = {
	name: nameField,
	email: emailField,
	company: companyField,
	description: textField(
		Schema.isMinLength(1, { message: "Please enter a message." }),
		Schema.isMaxLength(4000, { message: "Message is too long." }),
	),
	turnstileToken: tokenField,
};

export type ContactInput = FieldValues<typeof contactFields>;

/** Reads a contact form body. `body` is whatever the visitor sent, parsed from JSON. */
export const readContactInput = <Body>(body: Body) =>
	readFields(contactFields, body, NOT_OBJECT);

/** New requests use the general resume; stored legacy requests remain fulfillable, so only "general" is read here. */
const audienceField = fieldOf<"general">((raw) => {
	const text = Predicate.isString(raw) ? raw.trim() : "";

	return text === "general"
		? { value: "general" }
		: { say: "Only the general resume is available." };
});

const resumeRequestFields = {
	name: nameField,
	email: emailField,
	company: companyField,
	audience: audienceField,
	note: textField(Schema.isMaxLength(1000, { message: "Note is too long." })),
	turnstileToken: tokenField,
};

export type ResumeRequestInput = FieldValues<typeof resumeRequestFields>;

/** Reads a resume request body. `body` is whatever the visitor sent, parsed from JSON. */
export const readResumeRequestInput = <Body>(body: Body) =>
	readFields(resumeRequestFields, body, NOT_OBJECT);
