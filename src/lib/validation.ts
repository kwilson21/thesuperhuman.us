export type ContactInput = {
	name: string;
	email: string;
	company: string;
	description: string;
	turnstileToken: string;
};

export type ValidationResult =
	| { ok: true; value: ContactInput }
	| { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isText<T>(value: T): value is T & string {
	return typeof value === "string";
}

function isObject(value: unknown): value is object {
	return value !== null && typeof value === "object";
}

function textField(
	fields: Map<string, unknown>,
	key: string,
): string | undefined {
	const value = fields.get(key);

	return isText(value) ? value : undefined;
}

export function validateContactInput(input: unknown): ValidationResult {
	const errors: Record<string, string> = {};

	if (!isObject(input)) {
		return { ok: false, errors: { _form: "Invalid request body." } };
	}

	const v = new Map<string, unknown>(Object.entries(input));

	const name = textField(v, "name")?.trim() ?? "";

	if (!name) errors.name = "Name is required.";
	else if (name.length > 100) errors.name = "Name is too long.";

	const email = textField(v, "email")?.trim() ?? "";

	if (!email) errors.email = "Email is required.";
	else if (email.length > 120 || !EMAIL_RE.test(email))
		errors.email = "Invalid email.";

	const company = textField(v, "company")?.trim() ?? "";

	if (company.length > 120) errors.company = "Company is too long.";

	const description = textField(v, "description")?.trim() ?? "";

	if (!description) {
		errors.description = "Please enter a message.";
	} else if (description.length > 4000) {
		errors.description = "Message is too long.";
	}

	const turnstileToken = textField(v, "turnstileToken") ?? "";

	if (!turnstileToken) errors.turnstileToken = "Captcha missing.";

	if (Object.keys(errors).length > 0) return { ok: false, errors };

	return {
		ok: true,
		value: { name, email, company, description, turnstileToken },
	};
}

// --- Resume request validation ---

import type { ResumeRequest } from "./resume-requests";

export type ResumeRequestInput = ResumeRequest & { turnstileToken: string };

export type ResumeRequestValidationResult =
	| { ok: true; value: ResumeRequestInput }
	| { ok: false; errors: Record<string, string> };

export function validateResumeRequestInput(
	input: unknown,
): ResumeRequestValidationResult {
	const errors: Record<string, string> = {};

	if (!isObject(input)) {
		return { ok: false, errors: { _form: "Invalid request body." } };
	}

	const v = new Map<string, unknown>(Object.entries(input));

	const name = textField(v, "name")?.trim() ?? "";

	if (!name) errors.name = "Name is required.";
	else if (name.length > 100) errors.name = "Name is too long.";

	const email = textField(v, "email")?.trim() ?? "";

	if (!email) errors.email = "Email is required.";
	else if (email.length > 120 || !EMAIL_RE.test(email))
		errors.email = "Invalid email.";

	const company = textField(v, "company")?.trim() ?? "";

	if (company.length > 120) errors.company = "Company is too long.";

	const audienceRaw = textField(v, "audience")?.trim() ?? "";

	// New requests use the general resume; stored legacy requests remain fulfillable.
	if (audienceRaw !== "general")
		errors.audience = "Only the general resume is available.";

	const note = textField(v, "note")?.trim() ?? "";

	if (note.length > 1000) errors.note = "Note is too long.";

	const turnstileToken = textField(v, "turnstileToken") ?? "";

	if (!turnstileToken) errors.turnstileToken = "Captcha missing.";

	if (Object.keys(errors).length > 0) return { ok: false, errors };

	return {
		ok: true,
		value: {
			name,
			email,
			company,
			audience: "general",
			note,
			turnstileToken,
		},
	};
}
