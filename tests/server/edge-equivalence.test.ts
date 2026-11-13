import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { directionFields, validateIntake } from "../../src/lib/audio-intake";
import { validateContactInput } from "../../src/lib/validation";
import { rawTextField, readFields, textField } from "../../src/server/edge";

// Layer 2 will convert routes whose answers the site's current validators define. These tests state that the edge
// helpers can express those answers: each expected value is what the current validator returns for the same input, and
// the schema below, written with the helpers only, must return exactly that, error order included.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const contactFields = {
	name: textField(
		Schema.isMinLength(1, { message: "Name is required." }),
		Schema.isMaxLength(100, { message: "Name is too long." }),
	),
	email: textField(
		Schema.isMinLength(1, { message: "Email is required." }),
		Schema.isMaxLength(120, { message: "Invalid email." }),
		Schema.isPattern(EMAIL, { message: "Invalid email." }),
	),
	company: textField(
		Schema.isMaxLength(120, { message: "Company is too long." }),
	),
	description: textField(
		Schema.isMinLength(1, { message: "Please enter a message." }),
		Schema.isMaxLength(4000, { message: "Message is too long." }),
	),
	turnstileToken: rawTextField(
		Schema.isMinLength(1, { message: "Captcha missing." }),
	),
};

const readContact = <Input>(input: Input) =>
	readFields(contactFields, input, { notObject: "Invalid request body." });

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

const contactInputs: [string, unknown][] = [
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

describe("readFields against validateIntake", () => {
	const ZOD_MAX_120 = "String must contain at most 120 character(s)";

	const fields = {
		service: Schema.Literals(["vocal-mix", "mastering", "bundle", "custom"]),
		title: textField(
			Schema.isMinLength(1, { message: "Add a song or project title." }),
		),
		direction: Schema.Literals(["judgment", "preferences", "specific"]),
		preferences: Schema.Record(Schema.String, Schema.String),
		referenceNote: textField(),
		name: textField(Schema.isMinLength(1, { message: "Add your name." })),
		email: textField(
			Schema.isMaxLength(120, { message: ZOD_MAX_120 }),
			Schema.isPattern(EMAIL, { message: "Add a valid email address." }),
		),
		permission: Schema.Literal(true).annotate({
			message: "Allow access to the files for this review.",
		}),
		turnstileToken: rawTextField(
			Schema.isMinLength(1, { message: "Complete the security check." }),
		),
		fileLink: textField(
			Schema.makeFilter(
				(value: string) => {
					if (!value) return true;

					try {
						const url = new URL(value);

						return url.protocol === "https:" && !url.username && !url.password;
					} catch {
						return false;
					}
				},
				{ message: "Use a complete HTTPS link, or leave this blank." },
			),
		),
	};

	const readIntake = <Input>(input: Input) =>
		readFields(fields, input, {
			// Zod keeps the last failing message of a field.
			winner: "last",
			defaults: { preferences: {} },
			notObject: {
				null: "Expected object, received null",
				string: "Expected object, received string",
				number: "Expected object, received number",
				array: "Expected object, received array",
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

	const inputs: [string, unknown][] = [
		["a good body (preferences take their default)", base],
		["an empty title", { ...base, title: "" }],
		["a whitespace-only name", { ...base, name: "   " }],
		["an email that is not one", { ...base, email: "nope" }],
		[
			"an email that is too long and not one (last message wins)",
			{ ...base, email: "x".repeat(130) },
		],
		["permission false", { ...base, permission: false }],
		["an empty security token", { ...base, turnstileToken: "" }],
		["a link that is not https", { ...base, fileLink: "http://example.com" }],
		["no file link for a service that needs one", { ...base, fileLink: "" }],
		["specific direction without a note", { ...base, direction: "specific" }],
		[
			"custom service without a note",
			{ ...base, service: "custom", fileLink: "" },
		],
		[
			"custom service and specific direction without a note (last rule wins)",
			{ ...base, service: "custom", direction: "specific" },
		],
		[
			"a preference that does not match the service",
			{ ...base, direction: "preferences", preferences: { vocal: "bogus" } },
		],
		[
			"specific settings under the judgment path",
			{ ...base, preferences: { vocal: "natural" } },
		],
		[
			"several field errors, keys in reverse order",
			{
				fileLink: "http://x.co",
				turnstileToken: "",
				email: "nope",
				name: "",
				title: "",
				direction: "judgment",
				service: "vocal-mix",
				permission: true,
			},
		],
		[
			"field errors suppress the cross-field checks",
			{ ...base, title: "", fileLink: "" },
		],
		["null", null],
		["a string", "text"],
		["a number", 4],
		["an array", ["a"]],
	];

	for (const [label, input] of inputs) {
		it(`answers ${label} as validateIntake does`, () => {
			const expected = validateIntake(input);
			const read = readIntake(input);

			expect(read.ok).toBe(expected.ok);

			if (expected.ok && read.ok)
				expect(read.value).toEqual(
					expect.objectContaining({
						title: expected.value.title,
						name: expected.value.name,
						email: expected.value.email,
						fileLink: expected.value.fileLink,
						preferences: expected.value.preferences,
					}),
				);
			else if (!expected.ok && !read.ok) {
				expect(read.errors).toEqual(expected.errors);
				expect(Object.keys(read.errors)).toEqual(Object.keys(expected.errors));
			}
		});
	}
});
