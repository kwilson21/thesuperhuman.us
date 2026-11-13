import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { directionFields, validateIntake } from "../../src/lib/audio-intake";
import {
	currentSiteHref,
	currentUrlMessage,
	softwareDetailKeys,
	softwareQuestions,
	validateSoftwareInquiry,
} from "../../src/lib/software-inquiry";
import {
	type Body,
	choiceField,
	fieldOf,
	readFields,
	readVariants,
	receivedKind,
	stringField,
} from "../../src/server/edge";
import { readContactInput } from "../../src/server/contact-input";
import { isObject, isText } from "../../src/lib/type-guards";
import type { JsonValue } from "../helpers/json";

// What these tests show, and what they do not. Layer 2 will convert routes whose answers the site's current validators
// define. Each describe block below takes one real validator (validateContactInput, validateIntake,
// validateSoftwareInquiry), calls it on every input in a list, and requires the schemas written here, with the edge
// helpers only, to answer exactly as it does: the ok flag, every value on success, every message on failure, and the
// order of the error keys. The expected answers are never copied strings; they are what the real validator returns.
//
// Shown: that the helpers CAN express these three validators for the listed inputs (31 contact, 72 intake, 66 software
// inquiry), including Zod's own sentences (they are written into the test's schemas, the way a route's layer will write
// them), Zod's email and uuid patterns, a message that depends on the value received, one set of fields per `path`, and
// the raw-body line checks merged over the field errors.
//
// Not shown: that the inputs cover every input a person can send (they are examples, chosen to hit every field, every
// message and every key-order case); anything about the routes themselves; how a body reaches the validator (JSON
// parsing and the size limit are the route's). A value the validator changes after parsing (the software inquiry blanks
// `approverRole` unless `approver` is "other") is plain code after the read, written in the test as the route will. A body
// that is `undefined` is the only non-object kind of "other" tested; a bigint or a symbol cannot come from JSON.

type LegacyContactResult =
	| { ok: true; value: Record<string, string> }
	| { ok: false; errors: Record<string, string> };

/**
 * The contact validator as src/lib/validation.ts wrote it, before the contact route was converted (layer 2). It is the
 * oracle for the schema the route now reads with (src/server/contact-input.ts), kept here as it was.
 */
function validateContactInput(
	input: JsonValue | undefined,
): LegacyContactResult {
	const errors: Record<string, string> = {};

	if (!isObject(input)) {
		return { ok: false, errors: { _form: "Invalid request body." } };
	}

	const v = new Map<string, unknown>(Object.entries(input));

	const text = (key: string): string | undefined => {
		const value = v.get(key);

		return isText(value) ? value : undefined;
	};

	const name = text("name")?.trim() ?? "";

	if (!name) errors.name = "Name is required.";
	else if (name.length > 100) errors.name = "Name is too long.";

	const email = text("email")?.trim() ?? "";

	if (!email) errors.email = "Email is required.";
	else if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		errors.email = "Invalid email.";

	const company = text("company")?.trim() ?? "";

	if (company.length > 120) errors.company = "Company is too long.";

	const description = text("description")?.trim() ?? "";

	if (!description) errors.description = "Please enter a message.";
	else if (description.length > 4000)
		errors.description = "Message is too long.";

	const turnstileToken = text("turnstileToken") ?? "";

	if (!turnstileToken) errors.turnstileToken = "Captcha missing.";

	if (Object.keys(errors).length > 0) return { ok: false, errors };

	return {
		ok: true,
		value: { name, email, company, description, turnstileToken },
	};
}

const readContact = readContactInput;

const good = {
	name: "Ada",
	email: "ada@example.com",
	company: "Acme",
	description: "Hello there",
	turnstileToken: "token",
};

const withProto = JSON.parse(
	'{"__proto__":{"name":"evil"},"name":"Ada","email":"ada@example.com","description":"Hi","turnstileToken":"t"}',
);

const contactInputs: [string, JsonValue | undefined][] = [
	["a good body", good],
	["a good body with extra keys", { ...good, admin: true, role: "owner" }],
	["a good body without the optional company", { ...good, company: undefined }],
	[
		"whitespace around every text field",
		{
			name: "  Ada  ",
			email: "  ada@example.com  ",
			company: "  Acme  ",
			description: "  Hi  ",
			turnstileToken: "  token  ",
		},
	],
	["name missing", { ...good, name: undefined }],
	["email missing", { ...good, email: undefined }],
	["description missing", { ...good, description: undefined }],
	["token missing", { ...good, turnstileToken: undefined }],
	["every field missing", {}],
	["name a number", { ...good, name: 5 }],
	["email an array", { ...good, email: ["a@b.co"] }],
	["description null", { ...good, description: null }],
	["company an object", { ...good, company: { a: 1 } }],
	["token a boolean", { ...good, turnstileToken: true }],
	["name too long", { ...good, name: "n".repeat(101) }],
	["name exactly 100", { ...good, name: "n".repeat(100) }],
	["email too long", { ...good, email: `${"e".repeat(120)}@x.co` }],
	["email without a domain", { ...good, email: "ada@" }],
	["email with a space inside", { ...good, email: "a da@example.com" }],
	["company too long", { ...good, company: "c".repeat(121) }],
	["description too long", { ...good, description: "d".repeat(4001) }],
	[
		"whitespace-only name and description",
		{ ...good, name: "   ", description: "\n\t " },
	],
	[
		"whitespace-only token (not trimmed, so it passes)",
		{ ...good, turnstileToken: "   " },
	],
	[
		"several bad fields, keys in reverse order",
		{
			turnstileToken: "",
			description: "",
			email: "nope",
			name: "",
		},
	],
	["null", null],
	["a string", "text"],
	["a number", 4],
	["an empty array", []],
	["an array with a string", ["a"]],
	["undefined", undefined],
	["an own __proto__ key", withProto],
];

describe("readFields against validateContactInput", () => {
	it("covers at least 25 inputs", () => {
		expect(contactInputs.length).toBeGreaterThanOrEqual(25);
	});

	for (const [label, input] of contactInputs) {
		it(`answers ${label} as validateContactInput does`, () => {
			const expected = validateContactInput(input);
			const read = readContact(input);

			expect(read.ok).toBe(expected.ok);

			if (expected.ok && read.ok) expect(read.value).toEqual(expected.value);
			else if (!expected.ok && !read.ok) {
				expect(read.errors).toEqual(expected.errors);
				// Same keys in the same order, which toEqual does not check.
				expect(Object.keys(read.errors)).toEqual(Object.keys(expected.errors));
			}
		});
	}

	it("closes the result type over the field names and _form", () => {
		const read = readContact(null);

		if (!read.ok) {
			const form: string | undefined = read.errors._form;
			const name: string | undefined = read.errors.name;
			// @ts-expect-error only the named fields and _form can have an error
			const other: string | undefined = read.errors.phone;

			expect(form).toBe("Invalid request body.");
			expect(name).toBeUndefined();
			expect(other).toBeUndefined();
		}
	});
});

// Zod's own sentences, which both validators below answer with. A route's layer will write the ones its form uses.
const zodMax = (max: number) =>
	`String must contain at most ${max} character(s)`;

const zodNotString = (received: string) =>
	`Expected string, received ${received}`;

// Zod 3's own patterns (astro/zod bundles zod 3.25), copied from its source: they are not the contact form's.
const ZOD_EMAIL =
	/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

const ZOD_UUID =
	/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;

/** Both validators compare the answer, every value, every message and the order of the error keys. */
function expectSameAnswer(
	read:
		| { ok: true; value: unknown }
		| { ok: false; errors: Record<string, string | undefined> },
	expected:
		| { ok: true; value: unknown }
		| { ok: false; errors: Record<string, string> },
) {
	expect(read.ok).toBe(expected.ok);

	if (expected.ok && read.ok) expect(read.value).toStrictEqual(expected.value);
	else if (!expected.ok && !read.ok) {
		expect(read.errors).toStrictEqual(expected.errors);
		// Same keys in the same order, which toStrictEqual does not check.
		expect(Object.keys(read.errors)).toEqual(Object.keys(expected.errors));
	}
}

describe("readFields against validateIntake", () => {
	const kinds = { missing: "Required", wrongType: zodNotString };
	const oneLine = (value: string) => !/[\r\n]/.test(value) || "Invalid input";

	const httpsLink = (value: string) => {
		if (!value) return true;

		try {
			const url = new URL(value);

			return url.protocol === "https:" && !url.username && !url.password
				? true
				: "Use a complete HTTPS link, or leave this blank.";
		} catch {
			return "Use a complete HTTPS link, or leave this blank.";
		}
	};

	const link = (max: number) =>
		stringField(
			kinds,
			Schema.isMaxLength(max, { message: zodMax(max) }),
			Schema.makeFilter(httpsLink),
		);

	const choice = <const V extends readonly [string, ...string[]]>(
		values: V,
	) => {
		const expected = values.map((value) => `'${value}'`).join(" | ");

		return choiceField(values, {
			missing: "Required",
			wrongType: (received) => `Expected ${expected}, received ${received}`,
			notOneOf: (received) =>
				`Invalid enum value. Expected ${expected}, received '${received}'`,
		});
	};

	// z.record(z.string().max(30), z.string().max(30)): the sentence is the last issue Zod raises, a key's before its value's.
	const preferences = fieldOf<Record<string, string>>((raw) => {
		if (raw === undefined) return { value: {} };

		if (!Predicate.isObject(raw))
			return { say: `Expected object, received ${receivedKind(raw)}` };

		const said: string[] = [];
		const copy: Record<string, string> = {};

		for (const [key, choice] of Object.entries(raw)) {
			if (key.length > 30) said.push(zodMax(30));

			if (!Predicate.isString(choice))
				said.push(
					choice === undefined
						? "Required"
						: zodNotString(receivedKind(choice)),
				);
			else {
				if (choice.length > 30) said.push(zodMax(30));
				copy[key] = choice;
			}
		}

		return said.length > 0 ? { say: said[said.length - 1] } : { value: copy };
	});

	const fields = {
		service: choice(["vocal-mix", "mastering", "bundle", "custom"]),
		title: stringField(
			kinds,
			Schema.isMaxLength(120, { message: zodMax(120) }),
			Schema.isMinLength(1, { message: "Add a song or project title." }),
			Schema.makeFilter(oneLine),
		),
		direction: choice(["judgment", "preferences", "specific"]),
		preferences,
		preserve: stringField(
			kinds,
			Schema.isMaxLength(1200, { message: zodMax(1200) }),
		),
		referenceUrl: link(2048),
		referenceNote: stringField(
			kinds,
			Schema.isMaxLength(2000, { message: zodMax(2000) }),
		),
		name: stringField(
			kinds,
			Schema.isMaxLength(100, { message: zodMax(100) }),
			Schema.isMinLength(1, { message: "Add your name." }),
			Schema.makeFilter(oneLine),
		),
		email: stringField(
			kinds,
			Schema.isMaxLength(120, { message: zodMax(120) }),
			Schema.isPattern(ZOD_EMAIL, { message: "Add a valid email address." }),
		),
		permission: fieldOf<true>((raw) =>
			raw === true
				? { value: true }
				: { say: "Allow access to the files for this review." },
		),
		turnstileToken: stringField(
			{ ...kinds, trim: false },
			Schema.isMinLength(1, { message: "Complete the security check." }),
			Schema.isMaxLength(2048, { message: zodMax(2048) }),
		),
		fileLink: link(2048),
	};

	const readIntake = <Input>(input: Input) =>
		readFields(fields, input, {
			// Zod keeps the last failing message of a field.
			winner: "last",
			defaults: {
				preferences: {},
				preserve: "",
				referenceUrl: "",
				referenceNote: "",
				fileLink: "",
			},
			notObject: {
				null: "Expected object, received null",
				string: "Expected object, received string",
				number: "Expected object, received number",
				boolean: "Expected object, received boolean",
				array: "Expected object, received array",
				undefined: "Required",
				other: "Required",
			},
			// Run only after every field passed, as validateIntake's own checks do.
			after: (value) => {
				const errors: Partial<Record<keyof typeof fields, string>> = {};

				const allowed = directionFields(value.service);

				for (const [key, choice] of Object.entries(value.preferences)) {
					const field = allowed.find((f) => f.id === key);

					if (
						!field ||
						(choice !== "decide" &&
							!field.options.some((o) => o.value === choice))
					)
						errors.preferences =
							"These preferences do not match your selected service.";
				}

				if (
					value.direction === "judgment" &&
					Object.values(value.preferences).some((v) => v !== "decide")
				)
					errors.preferences =
						"Choose a preference path to include specific settings.";

				if (value.service !== "custom" && !value.fileLink)
					errors.fileLink = "Provide your files before submitting for review.";

				if (value.direction === "specific" && !value.referenceNote)
					errors.referenceNote =
						"Describe the specific direction you have in mind.";

				if (value.service === "custom" && !value.referenceNote)
					errors.referenceNote =
						"Briefly describe your project and what you need.";

				return errors;
			},
		});

	const base = {
		service: "vocal-mix",
		title: "Song",
		direction: "judgment",
		name: "Ada",
		email: "ada@example.com",
		permission: true,
		turnstileToken: "t",
		fileLink: "https://example.com/f",
	};

	const withProto = JSON.parse(
		'{"service":"vocal-mix","title":"Song","direction":"preferences","name":"Ada","email":"ada@example.com","permission":true,"turnstileToken":"t","fileLink":"https://example.com/f","preferences":{"__proto__":"natural","vocal":"natural"}}',
	);

	const inputs: [string, unknown][] = [
		["a good body (the defaults apply)", base],
		[
			"a good body with every optional field",
			{
				...base,
				direction: "preferences",
				preferences: { vocal: "natural", space: "decide" },
				preserve: "  the ad-libs  ",
				referenceUrl: " https://example.com/ref ",
				referenceNote: "Like track 3",
				service: "bundle",
			},
		],
		[
			"a good body for mastering with its preferences",
			{
				...base,
				service: "mastering",
				direction: "preferences",
				preferences: { tone: "warm", dynamics: "dense" },
			},
		],
		["a good body with extra keys", { ...base, admin: true }],
		[
			"whitespace around the text fields",
			{
				...base,
				title: "  Song  ",
				name: "  Ada  ",
				email: "  ada@example.com  ",
				fileLink: "  https://example.com/f  ",
			},
		],
		["service missing", { ...base, service: undefined }],
		["service a number", { ...base, service: 4 }],
		["service null", { ...base, service: null }],
		["service not one of the four", { ...base, service: "remix" }],
		["service an inherited property name", { ...base, service: "toString" }],
		["direction missing", { ...base, direction: undefined }],
		["direction an array", { ...base, direction: ["judgment"] }],
		["direction not one of the three", { ...base, direction: "vibes" }],
		["title missing", { ...base, title: undefined }],
		["title a boolean", { ...base, title: true }],
		["an empty title", { ...base, title: "" }],
		["a title of 121 characters", { ...base, title: "t".repeat(121) }],
		["a title with a line break", { ...base, title: "Line\nbreak" }],
		[
			"a title of 121 characters with a line break (last message wins)",
			{ ...base, title: `${"t".repeat(121)}\n` },
		],
		["a whitespace-only name", { ...base, name: "   " }],
		["a name with a line break", { ...base, name: "Ada\r\nL" }],
		["a name of 101 characters", { ...base, name: "n".repeat(101) }],
		["name null", { ...base, name: null }],
		["email missing", { ...base, email: undefined }],
		["email a number", { ...base, email: 12 }],
		["an email that is not one", { ...base, email: "nope" }],
		[
			"the email a@b.c (Zod wants a two-letter ending)",
			{ ...base, email: "a@b.c" },
		],
		[
			"the email a..b@x.co (Zod refuses two dots)",
			{ ...base, email: "a..b@x.co" },
		],
		[
			"the email .a@x.co (Zod refuses a leading dot)",
			{ ...base, email: ".a@x.co" },
		],
		[
			"the email a+b_c@x-y.co (Zod accepts it)",
			{ ...base, email: "a+b_c@x-y.co" },
		],
		["the email a@-x.co", { ...base, email: "a@-x.co" }],
		[
			"an email that is too long and not one (last message wins)",
			{ ...base, email: "x".repeat(130) },
		],
		[
			"an email that is too long and valid",
			{ ...base, email: `${"e".repeat(120)}@x.co` },
		],
		["permission missing", { ...base, permission: undefined }],
		["permission false", { ...base, permission: false }],
		["permission the string true", { ...base, permission: "true" }],
		["a missing security token", { ...base, turnstileToken: undefined }],
		["an empty security token", { ...base, turnstileToken: "" }],
		[
			"a whitespace-only security token (kept as it is)",
			{ ...base, turnstileToken: "   " },
		],
		[
			"a security token of 2049 characters",
			{ ...base, turnstileToken: "t".repeat(2049) },
		],
		["a link that is not https", { ...base, fileLink: "http://example.com" }],
		[
			"a link with a password",
			{ ...base, fileLink: "https://u:p@example.com" },
		],
		["a link that does not parse", { ...base, fileLink: "not a link" }],
		["no file link for a service that needs one", { ...base, fileLink: "" }],
		["fileLink null", { ...base, fileLink: null }],
		[
			"a reference URL that is not https",
			{ ...base, referenceUrl: "ftp://x.co" },
		],
		[
			"a preserve note of 1201 characters",
			{ ...base, preserve: "p".repeat(1201) },
		],
		[
			"a reference note of 2001 characters",
			{ ...base, referenceNote: "r".repeat(2001) },
		],
		["specific direction without a note", { ...base, direction: "specific" }],
		[
			"custom service without a note",
			{ ...base, service: "custom", fileLink: "" },
		],
		[
			"custom service and specific direction without a note",
			{ ...base, service: "custom", direction: "specific" },
		],
		[
			"custom service with a note and no link",
			{ ...base, service: "custom", fileLink: "", referenceNote: "A project" },
		],
		[
			"a preference that does not match the service",
			{ ...base, direction: "preferences", preferences: { vocal: "bogus" } },
		],
		[
			"a preference key the service does not have",
			{
				...base,
				service: "mastering",
				direction: "preferences",
				preferences: { vocal: "natural" },
			},
		],
		[
			"specific settings under the judgment path",
			{ ...base, preferences: { vocal: "natural" } },
		],
		[
			"preferences that are all decide under the judgment path",
			{ ...base, preferences: { vocal: "decide" } },
		],
		["preferences a string", { ...base, preferences: "natural" }],
		["preferences null", { ...base, preferences: null }],
		["preferences an array", { ...base, preferences: ["x"] }],
		[
			"a preference value that is a number",
			{ ...base, preferences: { vocal: 3 } },
		],
		[
			"a preference value of 31 characters",
			{ ...base, preferences: { vocal: "v".repeat(31) } },
		],
		[
			"a preference key of 31 characters",
			{ ...base, preferences: { ["k".repeat(31)]: "x" } },
		],
		[
			"a preference key and value both too long, then a number (last wins)",
			{ ...base, preferences: { ["k".repeat(31)]: "v".repeat(31), b: 4 } },
		],
		["an own __proto__ key among the preferences", withProto],
		[
			"several field errors, keys in reverse order",
			{
				fileLink: "http://x.co",
				turnstileToken: "",
				permission: false,
				email: "nope",
				name: "",
				title: "",
				direction: "judgment",
				service: "vocal-mix",
			},
		],
		[
			"field errors suppress the cross-field checks",
			{ ...base, title: "", fileLink: "" },
		],
		["null", null],
		["a string", "text"],
		["a number", 4],
		["a boolean", false],
		["an array", ["a"]],
		["undefined", undefined],
	];

	it("covers at least 40 inputs", () => {
		expect(inputs.length).toBeGreaterThanOrEqual(40);
	});

	for (const [label, input] of inputs) {
		it(`answers ${label} as validateIntake does`, () => {
			expectSameAnswer(readIntake(input), validateIntake(input));
		});
	}
});

describe("readVariants against validateSoftwareInquiry", () => {
	const required = {
		missing: "This answer is required.",
		wrongType: () => "This answer is required.",
	};

	const single = (max: number) =>
		stringField(
			required,
			Schema.isMaxLength(max, {
				message: `Keep this under ${max} characters.`,
			}),
		);

	const needed = (max: number) =>
		stringField(
			required,
			Schema.isMaxLength(max, {
				message: `Keep this under ${max} characters.`,
			}),
			Schema.isMinLength(1, { message: "This answer is required." }),
		);

	const chooseOne = <const V extends readonly [string, ...string[]]>(
		values: V,
	) =>
		choiceField(values, {
			missing: "Choose one.",
			wrongType: () => "Choose one.",
			notOneOf: () => "Choose one.",
		});

	const common = {
		name: stringField(
			required,
			Schema.isMaxLength(100, { message: "Keep this under 100 characters." }),
			Schema.isMinLength(1, { message: "Add your name." }),
		),
		email: stringField(
			required,
			Schema.isMaxLength(120, { message: "Keep this under 120 characters." }),
			Schema.isPattern(ZOD_EMAIL, { message: "Add a valid email address." }),
		),
		company: single(120),
		timing: chooseOne(["flexible", "month", "quarter", "date", "asap"]),
		timingDate: stringField(
			{ ...required, trim: false },
			Schema.isPattern(/^$|^\d{4}-\d{2}-\d{2}$/, { message: "Add a date." }),
		),
		timingReason: single(500),
		budgetStatus: chooseOne(["", "approved", "pending", "exploring", "unsure"]),
		budgetNote: single(200),
		approver: chooseOne(["", "self", "other", "unsure"]),
		approverRole: single(120),
		turnstileToken: stringField(
			{ ...required, trim: false },
			Schema.isMinLength(1, { message: "Complete the security check." }),
			Schema.isMaxLength(2048, { message: "Keep this under 2048 characters." }),
		),
		submissionId: stringField(
			{ ...required, trim: false },
			Schema.isPattern(ZOD_UUID, { message: "Invalid submission ID." }),
		),
	};

	const variants = {
		workflow: {
			...common,
			today: needed(2000),
			audience: single(1000),
			firstResult: single(2000),
		},
		idea: {
			...common,
			idea: needed(1000),
			audienceToday: single(1000),
			firstVersion: single(1000),
			signal: single(500),
		},
		website: {
			...common,
			purpose: needed(2000),
			// The sentence depends on the value received.
			currentUrl: stringField(
				required,
				Schema.isMaxLength(2048, {
					message: "Keep this under 2048 characters.",
				}),
				Schema.makeFilter((value: string) =>
					value.length > 2048 || value === "" || currentSiteHref(value) !== null
						? true
						: currentUrlMessage(value),
				),
			),
			existing: single(2000),
			updates: chooseOne(["self", "help", "unsure"]),
		},
		webapp: {
			...common,
			appGoal: needed(1000),
			firstVersion: single(1000),
		},
	};

	/** The body's own value for a key, as a Map read it. */
	const own = (input: Body, key: string) =>
		Object.hasOwn(input, key) ? input[key] : undefined;

	// The checks validateSoftwareInquiry makes on the raw body before its schema: a later entry for a key replaces an
	// earlier one and keeps its place.
	const lineChecks = (input: Body) => {
		const entries: [string, string][] = [];
		const timingDate = own(input, "timingDate");

		if (
			Object.hasOwn(input, "timingDate") &&
			own(input, "timing") === "date" &&
			(!Predicate.isString(timingDate) ||
				!/^\d{4}-\d{2}-\d{2}$/.test(timingDate) ||
				!Number.isFinite(Date.parse(timingDate)) ||
				new Date(timingDate).toISOString().slice(0, 10) !== timingDate)
		)
			entries.push(["timingDate", "Add a valid date."]);

		for (const key of [
			"name",
			"email",
			"company",
			"timingReason",
			"budgetNote",
			"approverRole",
		]) {
			const value = own(input, key);

			if (Predicate.isString(value) && /[\r\n]/.test(value))
				entries.push([key, "Use one line."]);
		}

		const currentUrl = own(input, "currentUrl");

		if (
			own(input, "path") === "website" &&
			Predicate.isString(currentUrl) &&
			/[\r\n]/.test(currentUrl)
		)
			entries.push(["currentUrl", "Use one line."]);

		const path = own(input, "path");

		const questions =
			Object.entries(softwareQuestions).find(([name]) => name === path)?.[1] ??
			[];

		for (const key of [...questions, ...softwareDetailKeys]) {
			const value = own(input, key);

			if (
				Predicate.isString(value) &&
				/[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value)
			)
				entries.push([key, "Remove control characters."]);
		}

		return Object.fromEntries(entries);
	};

	const readInquiry = <Input>(input: Input) => {
		const read = readVariants("path", variants, input, {
			unknownVariant: "Choose a starting point.",
			notObject: {
				null: "Please send the form again.",
				string: "Please send the form again.",
				number: "Please send the form again.",
				boolean: "Please send the form again.",
				array: "Please send the form again.",
				undefined: "Please send the form again.",
				other: "Please send the form again.",
			},
			defaults: {
				workflow: {
					company: "",
					timingDate: "",
					timingReason: "",
					budgetStatus: "",
					budgetNote: "",
					approver: "",
					approverRole: "",
					audience: "",
					firstResult: "",
				},
				idea: {
					company: "",
					timingDate: "",
					timingReason: "",
					budgetStatus: "",
					budgetNote: "",
					approver: "",
					approverRole: "",
					audienceToday: "",
					firstVersion: "",
					signal: "",
				},
				website: {
					company: "",
					timingDate: "",
					timingReason: "",
					budgetStatus: "",
					budgetNote: "",
					approver: "",
					approverRole: "",
					currentUrl: "",
					existing: "",
				},
				webapp: {
					company: "",
					timingDate: "",
					timingReason: "",
					budgetStatus: "",
					budgetNote: "",
					approver: "",
					approverRole: "",
					firstVersion: "",
				},
			},
			alongside: lineChecks,
		});

		// What the validator does to a good value after parsing is plain code after the read.
		return read.ok
			? {
					ok: true as const,
					value: {
						...read.value,
						approverRole:
							read.value.approver !== "other" ? "" : read.value.approverRole,
					},
				}
			: read;
	};

	const id = "123e4567-e89b-42d3-a456-426614174000";

	const common_ = {
		name: "Ada",
		email: "ada@example.com",
		timing: "flexible",
		turnstileToken: "t",
		submissionId: id,
	};

	const workflow = {
		...common_,
		path: "workflow",
		today: "Copying rows by hand.",
	};

	const idea = { ...common_, path: "idea", idea: "A tool" };

	const website = {
		...common_,
		path: "website",
		purpose: "Sell things",
		updates: "self",
	};

	const webapp = { ...common_, path: "webapp", appGoal: "Track orders" };

	const inputs: [string, unknown][] = [
		["a good workflow body (defaults apply)", workflow],
		["a good idea body", idea],
		["a good website body", website],
		["a good webapp body", webapp],
		[
			"a good workflow body with every optional field",
			{
				...workflow,
				audience: " Ops ",
				firstResult: "Fewer errors",
				company: "Acme",
				timing: "date",
				timingDate: "2027-03-01",
				timingReason: "Launch",
				budgetStatus: "approved",
				budgetNote: "10k",
				approver: "other",
				approverRole: "CTO",
			},
		],
		[
			"approverRole kept only for approver other",
			{ ...workflow, approver: "self", approverRole: "CTO" },
		],
		[
			"a good website body with a current URL",
			{ ...website, currentUrl: " https://example.com ", existing: "Logo" },
		],
		[
			"a good body with extra keys and another variant's fields",
			{ ...webapp, today: 4, purpose: {}, admin: true },
		],
		["path missing", { ...workflow, path: undefined }],
		["path a number", { ...workflow, path: 4 }],
		["path null", { ...workflow, path: null }],
		["path not one of the four", { ...workflow, path: "mobile" }],
		["path an inherited property name", { ...workflow, path: "toString" }],
		[
			"path unknown and a line break in the name",
			{ ...workflow, path: "mobile", name: "A\nB" },
		],
		["name missing", { ...workflow, name: undefined }],
		["name a number", { ...workflow, name: 3 }],
		["an empty name", { ...workflow, name: "  " }],
		["a name of 101 characters", { ...workflow, name: "n".repeat(101) }],
		[
			"a name with a line break (one line wins over the field error)",
			{ ...workflow, name: "A\nB" },
		],
		[
			"an empty name with a line break elsewhere",
			{ ...workflow, name: "", company: "x\ny" },
		],
		["email missing", { ...workflow, email: undefined }],
		["an email that is not one", { ...workflow, email: "nope" }],
		["the email a@b.c", { ...workflow, email: "a@b.c" }],
		["the email a..b@x.co", { ...workflow, email: "a..b@x.co" }],
		[
			"an email of 121 characters",
			{ ...workflow, email: `${"e".repeat(116)}@x.co` },
		],
		["timing missing", { ...workflow, timing: undefined }],
		["timing not one of the five", { ...workflow, timing: "never" }],
		["timing date without a date", { ...workflow, timing: "date" }],
		[
			"timing date with an impossible date",
			{ ...workflow, timing: "date", timingDate: "2027-02-30" },
		],
		[
			"timing date with a date that is not a date",
			{ ...workflow, timing: "date", timingDate: "soon" },
		],
		[
			"timing date with a number",
			{ ...workflow, timing: "date", timingDate: 5 },
		],
		[
			"a date given for a timing that is not date",
			{ ...workflow, timingDate: "soon" },
		],
		[
			"budgetStatus not one of the allowed",
			{ ...workflow, budgetStatus: "rich" },
		],
		["approver a number", { ...workflow, approver: 1 }],
		[
			"budgetNote of 201 characters",
			{ ...workflow, budgetNote: "b".repeat(201) },
		],
		[
			"a control character in a free-text answer",
			{ ...workflow, today: "a\u0001b" },
		],
		[
			"a control character in the budget note and a line break in the reason",
			{ ...workflow, budgetNote: "a\u0007", timingReason: "a\nb" },
		],
		["a lone surrogate in the company", { ...workflow, company: "a\ud800" }],
		["the security token missing", { ...workflow, turnstileToken: undefined }],
		["the security token empty", { ...workflow, turnstileToken: "" }],
		[
			"the security token of 2049 characters",
			{ ...workflow, turnstileToken: "t".repeat(2049) },
		],
		["the submission id not a uuid", { ...workflow, submissionId: "abc" }],
		["the submission id missing", { ...workflow, submissionId: undefined }],
		["workflow without its question", { ...workflow, today: "" }],
		["workflow question too long", { ...workflow, today: "t".repeat(2001) }],
		["workflow question a number", { ...workflow, today: 5 }],
		["idea without its question", { ...idea, idea: undefined }],
		["idea signal of 501 characters", { ...idea, signal: "s".repeat(501) }],
		["website without a purpose", { ...website, purpose: "" }],
		["website updates missing", { ...website, updates: undefined }],
		["website updates not allowed", { ...website, updates: "never" }],
		[
			"website current URL without a scheme (bare host)",
			{ ...website, currentUrl: "example.com" },
		],
		[
			"website current URL with a mistyped scheme",
			{ ...website, currentUrl: "https//example.com" },
		],
		[
			"website current URL with a password",
			{ ...website, currentUrl: "https://u:p@example.com" },
		],
		[
			"website current URL that is not a link",
			{ ...website, currentUrl: "n/a" },
		],
		[
			"website current URL with a line break",
			{ ...website, currentUrl: "https://example.com\nx" },
		],
		[
			"website current URL of 2049 characters",
			{ ...website, currentUrl: `https://example.com/${"a".repeat(2040)}` },
		],
		["webapp without a goal", { ...webapp, appGoal: "" }],
		[
			"webapp first version of 1001 characters",
			{ ...webapp, firstVersion: "f".repeat(1001) },
		],
		[
			"several errors across fields, keys in reverse order",
			{
				turnstileToken: "",
				appGoal: "",
				email: "nope",
				name: "",
				path: "webapp",
				timing: "x",
				submissionId: "z",
			},
		],
		["null", null],
		["a string", "text"],
		["a number", 7],
		["a boolean", true],
		["an array", [1]],
		["undefined", undefined],
	];

	it("covers at least 40 inputs, each path included", () => {
		expect(inputs.length).toBeGreaterThanOrEqual(40);

		for (const path of Object.keys(variants))
			expect(
				inputs.some(
					([, input]) => Predicate.isObject(input) && input.path === path,
				),
			).toBe(true);
	});

	for (const [label, input] of inputs) {
		it(`answers ${label} as validateSoftwareInquiry does`, () => {
			expectSameAnswer(readInquiry(input), validateSoftwareInquiry(input));
		});
	}
});
