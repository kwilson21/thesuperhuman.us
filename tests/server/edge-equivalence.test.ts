import * as Predicate from "effect/Predicate";
import { describe, expect, it } from "vitest";
import { validateIntake } from "../../src/lib/audio-intake";
import { validateSoftwareInquiry } from "../../src/lib/software-inquiry";
import { readContactInput } from "../../src/server/contact-input";
import { isObject, isText } from "../../src/lib/type-guards";
import { legacyValidateIntake } from "../fixtures/legacy-validators/audio-intake";
import { legacyValidateSoftwareInquiry } from "../fixtures/legacy-validators/software-inquiry";
import type { JsonValue } from "../helpers/json";

// What these tests show, and what they do not. The contact validator was converted to the edge helpers in layer 2: its
// describe block takes the real validator as it was (kept here as `validateContactInput`, the oracle) and requires the
// schema the route now reads with (src/server/contact-input.ts) to answer exactly as it does. validateIntake and
// validateSoftwareInquiry were converted in this layer: their blocks take the frozen Zod 3 copies
// (tests/fixtures/legacy-validators) and require the Effect versions in src/lib to answer exactly as they do. Every
// block compares the ok flag, every value on success, every message on failure, and the order of the error keys, on a
// hand-picked list of inputs chosen to hit every field, every message and every key-order case. The generated tables
// (tens of thousands of inputs per validator) are in validators-differential.test.ts.
//
// Not shown: that the inputs cover every input a person can send; anything about the routes themselves; how a body
// reaches the validator (JSON parsing and the size limit are the route's).

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

describe("validateIntake (Effect Schema) against the Zod validator it replaced", () => {
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
		it(`answers ${label} as the Zod validateIntake did`, () => {
			expectSameAnswer(validateIntake(input), legacyValidateIntake(input));
		});
	}
});

describe("validateSoftwareInquiry (Effect Schema) against the Zod validator it replaced", () => {
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

		for (const path of ["workflow", "idea", "website", "webapp"])
			expect(
				inputs.some(
					([, input]) => Predicate.isObject(input) && input.path === path,
				),
			).toBe(true);
	});

	for (const [label, input] of inputs) {
		it(`answers ${label} as the Zod validateSoftwareInquiry did`, () => {
			expectSameAnswer(
				validateSoftwareInquiry(input),
				legacyValidateSoftwareInquiry(input),
			);
		});
	}
});
