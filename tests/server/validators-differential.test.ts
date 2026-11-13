import { describe, expect, it } from "vitest";
import { validateIntake } from "../../src/lib/audio-intake";
import {
	cleanTextField,
	emailField,
	parseClientAgreement,
	readClientAgreement,
	requiredField,
} from "../../src/lib/agreement-client-fields";
import {
	businessTypes,
	parseDraft,
	readDraft,
	resolveClientDetails,
	states,
} from "../../src/lib/agreement-draft-fields";
import { type Body, type RawValue, readFields } from "../../src/lib/fields";
import { validateSoftwareInquiry } from "../../src/lib/software-inquiry";
import {
	cleanText as zodCleanText,
	email as zodEmail,
	required as zodRequired,
} from "../../src/server/agreement-zod-fields";
import {
	legacyCleanText,
	legacyClientAgreementSchema,
	legacyEmail,
	legacyRequired,
} from "../fixtures/legacy-validators/agreement-client-fields";
import {
	legacyDraftFieldErrors,
	legacyDraftSchema,
	legacyResolveClientDetails,
} from "../fixtures/legacy-validators/agreement-draft-fields";
import { legacyValidateIntake } from "../fixtures/legacy-validators/audio-intake";
import { legacyValidateSoftwareInquiry } from "../fixtures/legacy-validators/software-inquiry";
import {
	differential,
	emails,
	fingerprint,
	links,
	notStrings,
	seeded,
	texts,
} from "../helpers/differential";

// What this file shows. The three validators that run in both the browser and the server (validateIntake,
// validateSoftwareInquiry and resolveClientDetails with its draft and client readers) were Zod 3 and are now Effect
// Schema. Each describe block below runs the frozen Zod 3 copy (tests/fixtures/legacy-validators) and the Effect version
// on the same inputs and requires the same answer for every one: the ok flag, every value (key order included), every
// error key in the same order, and every message. A thrown error is an answer too (the Effect version must not throw
// where the Zod one did not). The inputs are generated from a seeded random source, so a failure is the same on every run.
//
// Not shown: inputs outside what the generators build (they are broad, not exhaustive); anything about the routes
// (the golden corpus in tests/golden holds those); a body that cannot come from `request.json()` or from the site's own
// browser scripts is covered only for the kinds Zod names (a bigint, a symbol, a function, a date, a map, a set, a
// promise and NaN are included).

const take = (found: { mismatches: unknown[]; count: number }) => ({
	count: found.count,
	first: found.mismatches.slice(0, 4),
	total: found.mismatches.length,
});

const noMismatch = (found: { mismatches: unknown[]; count: number }) => ({
	count: found.count,
	first: [],
	total: 0,
});

/** Own copy of every entry, in a shuffled key order, so the body's key order never leaks into the answer. */
function shuffled(body: Body, random: ReturnType<typeof seeded>): Body {
	const keys = Object.keys(body);

	for (let i = keys.length - 1; i > 0; i -= 1) {
		const j = random.below(i + 1);
		[keys[i], keys[j]] = [keys[j], keys[i]];
	}

	return Object.fromEntries(keys.map((key) => [key, body[key]]));
}

/** The same body with an own `__proto__` key (a JSON body can carry one; an object literal cannot). */
function withProto(body: Body, proto: RawValue): Body {
	const rest = JSON.stringify(body);

	const inner = rest.slice(1, -1);

	return JSON.parse(
		`{"__proto__":${JSON.stringify(proto)}${inner ? `,${inner}` : ""}}`,
	);
}

/** Bodies that are not objects, of every kind. */
const notBodies: readonly RawValue[] = [
	...notStrings,
	"",
	"text",
	"{}",
	'{"name":"x"}',
];

type Pools = Record<string, readonly RawValue[]>;

/** The body with the fields set (each name and value) and the fields removed, as a new object. */
function changed(
	base: Body,
	set: readonly (readonly [string, RawValue])[],
	remove: readonly string[] = [],
): Body {
	return Object.fromEntries(
		[
			...Object.entries(base).filter(
				([name]) => !set.some(([n]) => n === name),
			),
			...set,
		].filter(([name]) => !remove.includes(name)),
	);
}

/**
 * Every single-field mutation of every base (each pool value, and the field deleted), then random multi-field mutations
 * in a shuffled key order, then the bodies that are not objects, extra keys and own prototype-named keys.
 */
function* bodies(
	bases: readonly Body[],
	pools: Pools,
	seed: number,
	multi: number,
): Generator<RawValue> {
	const random = seeded(seed);
	const names = Object.keys(pools);

	for (const base of bases) {
		yield base;

		for (const name of names) {
			const { [name]: _removed, ...without } = base;
			yield without;

			for (const value of pools[name]) yield { ...base, [name]: value };
		}
	}

	for (let i = 0; i < multi; i += 1) {
		const set: [string, RawValue][] = [];
		const remove: string[] = [];

		for (let n = 1 + random.below(4); n > 0; n -= 1) {
			const name = random.pick(names);

			if (random.chance(0.1)) remove.push(name);
			else set.push([name, random.pick(pools[name])]);
		}

		yield shuffled(changed(random.pick(bases), set, remove), random);
	}

	for (const base of bases) {
		yield { ...base, admin: true, role: "owner", "": "x" };
		yield withProto(base, { service: "x", path: "x", name: "x" });
		yield withProto(base, "text");
		yield withProto(base, null);
		yield { ...base, constructor: "x", toString: "y", hasOwnProperty: 1 };
		yield { ...base, valueOf: () => "x" };
	}

	for (const value of notBodies) yield value;
}

// ---------------------------------------------------------------------------------------------------------------------
// validateIntake

describe("validateIntake against the frozen Zod 3 validator", () => {
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

	const bases: Body[] = [
		base,
		{ ...base, service: "custom", fileLink: "", referenceNote: "A project" },
		{
			...base,
			service: "custom",
			fileLink: "https://example.com/f",
			referenceNote: "A",
		},
		{
			...base,
			service: "mastering",
			direction: "preferences",
			preferences: { tone: "warm", dynamics: "decide" },
			referenceUrl: "https://example.com/r",
			preserve: "the ad-libs",
		},
		{
			...base,
			service: "bundle",
			direction: "preferences",
			preferences: { vocal: "natural", space: "dry", tuning: "stylized" },
		},
		{
			...base,
			direction: "specific",
			referenceNote: "Like track 3",
			preferences: { vocal: "forward" },
		},
		{ ...base, direction: "judgment", preferences: { vocal: "decide" } },
		{
			...base,
			service: "vocal-mix",
			direction: "specific",
			referenceNote: "x",
		},
	];

	const choices = (values: string[]) => [
		...values,
		...values.map((v) => v.toUpperCase()),
		...values.map((v) => ` ${v} `),
		"",
		"toString",
		"constructor",
		"__proto__",
		"hasOwnProperty",
		"remix",
		"decide",
		...notStrings,
	];

	const preferenceMaps: unknown[] = [
		{},
		{ vocal: "natural" },
		{ vocal: "decide", space: "decide", tuning: "decide" },
		{ vocal: "natural", space: "dry", tuning: "natural" },
		{ tone: "warm", dynamics: "dense" },
		{ tone: "warm", vocal: "natural" },
		{ vocal: "bogus" },
		{ vocal: "NATURAL" },
		{ unknown: "decide" },
		{ vocal: 3 },
		{ vocal: null },
		{ vocal: undefined },
		{ vocal: {} },
		{ vocal: ["natural"] },
		{ vocal: "v".repeat(30) },
		{ vocal: "v".repeat(31) },
		{ ["k".repeat(30)]: "x" },
		{ ["k".repeat(31)]: "x" },
		{ ["k".repeat(31)]: "v".repeat(31), b: 4 },
		{ ["k".repeat(31)]: "v".repeat(31), b: 4, c: "x".repeat(40) },
		{ a: 4, b: "v".repeat(31), c: undefined },
		{ ["k".repeat(40)]: 4 },
		JSON.parse('{"__proto__":"natural","vocal":"natural"}'),
		JSON.parse('{"__proto__":{"a":1}}'),
		JSON.parse('{"constructor":"decide","vocal":"decide"}'),
		{ "": "" },
		{ "": "decide" },
		[],
		["x"],
		[["a", "b"]],
		"natural",
		"",
		...notStrings,
	];

	const pools = {
		service: choices(["vocal-mix", "mastering", "bundle", "custom"]),
		direction: choices(["judgment", "preferences", "specific"]),
		title: [...texts(120), ...notStrings],
		name: [...texts(100), ...notStrings],
		email: [...emails, ...notStrings],
		preferences: preferenceMaps,
		preserve: [...texts(1200), ...notStrings],
		referenceUrl: [...links, ...texts(2048), ...notStrings],
		referenceNote: [...texts(2000), ...notStrings],
		permission: [true, false, "true", 1, 0, null, undefined, [], {}, "", "yes"],
		turnstileToken: [...texts(2048), ...notStrings],
		fileLink: [...links, ...texts(2048), ...notStrings],
	} satisfies Pools;

	it("answers every generated body as the Zod validator did", () => {
		const found = differential(legacyValidateIntake, validateIntake, (answer) =>
			fingerprint(answer, true),
		);

		for (const body of bodies(bases, pools, 20261113, 4000)) found.run(body);

		expect(found.count).toBeGreaterThan(9000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`validateIntake differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	});

	it("returns a fresh plain object the browser may change", () => {
		for (const body of [base, { ...base, title: "" }, null]) {
			const answer = validateIntake(body);
			const answerTwice = validateIntake(body);

			expect(answer).not.toBe(answerTwice);

			if (answer.ok) {
				expect(Object.getPrototypeOf(answer.value)).toBe(Object.prototype);
			} else {
				expect(Object.getPrototypeOf(answer.errors)).toBe(Object.prototype);
				expect(Object.isFrozen(answer.errors)).toBe(false);
				answer.errors.extra = "x";
				expect(validateIntake(body)).not.toHaveProperty("errors.extra");
			}
		}
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// validateSoftwareInquiry

describe("validateSoftwareInquiry against the frozen Zod 3 validator", () => {
	const common = {
		name: "Ada",
		email: "ada@example.com",
		timing: "flexible",
		turnstileToken: "t",
		submissionId: "123e4567-e89b-42d3-a456-426614174000",
	};

	const bases: Body[] = [
		{ ...common, path: "workflow", today: "Copying rows by hand." },
		{
			...common,
			path: "workflow",
			today: "Copying rows",
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
		{
			...common,
			path: "idea",
			idea: "A tool",
			approver: "self",
			approverRole: "x",
		},
		{
			...common,
			path: "idea",
			idea: "A tool",
			audienceToday: "a",
			firstVersion: "b",
			signal: "c",
		},
		{ ...common, path: "website", purpose: "Sell things", updates: "self" },
		{
			...common,
			path: "website",
			purpose: "Sell things",
			updates: "help",
			currentUrl: " https://example.com ",
			existing: "Logo",
		},
		{ ...common, path: "webapp", appGoal: "Track orders" },
		{ ...common, path: "webapp", appGoal: "Track", firstVersion: "Login" },
	];

	const choices = (values: string[]) => [
		...values,
		...values.map((v) => v.toUpperCase()),
		...values.map((v) => ` ${v} `),
		"",
		"toString",
		"constructor",
		"__proto__",
		"hasOwnProperty",
		"never",
		...notStrings,
	];

	const dates = [
		"",
		"2027-03-01",
		"2027-02-30",
		"2027-02-29",
		"2028-02-29",
		"2027-13-01",
		"2027-00-10",
		"0000-01-01",
		"0001-01-01",
		"9999-12-31",
		"-0001-01-01",
		"2027-3-1",
		"27-03-01",
		" 2027-03-01",
		"2027-03-01 ",
		"2027-03-01\n",
		"2027-03-01T00:00:00Z",
		"soon",
		"٢٠٢٧-٠٣-٠١",
		"2027-03-01\u0000",
		...notStrings,
	];

	const uuids = [
		"123e4567-e89b-42d3-a456-426614174000",
		"123E4567-E89B-42D3-A456-426614174000",
		"123e4567-e89b-12d3-a456-426614174000",
		"00000000-0000-0000-0000-000000000000",
		"ffffffff-ffff-ffff-ffff-ffffffffffff",
		"123e4567e89b42d3a456426614174000",
		" 123e4567-e89b-42d3-a456-426614174000",
		"123e4567-e89b-42d3-a456-426614174000 ",
		"123e4567-e89b-42d3-a456-426614174000\n",
		"123e4567-e89b-42d3-a456-42661417400",
		"123e4567-e89b-42d3-a456-4266141740000",
		"123e4567-e89b-42d3-a456-42661417400g",
		"g23e4567-e89b-42d3-a456-426614174000",
		"123e4567_e89b_42d3_a456_426614174000",
		"abc",
		"",
		...notStrings,
	];

	const urls = [
		...links,
		"example.com",
		"example.com/path",
		"www.example.com",
		"//example.com",
		"example.com:8080",
		"EXAMPLE.COM",
		"sub.example.co.uk",
		"example",
		"localhost:3000/x",
		"1.2.3.4",
		"1.2.3.4:80",
		"ftp://x",
		"ftp:x",
		"https:",
		"http:",
		"HTTPS:/x.com",
		"Website: example.com",
		"Website:example.com",
		"foo@bar.com",
		"foo@bar.com:80",
		"user:pass@example.com",
		"a:1",
		"a:b",
		"1a:b",
		"tel:+15551234567",
		"x.com:8080/a b",
		"https://example.com\nx",
		"example.com\n",
		"https//x.com",
		"https:/x.com",
		"https://u:p@x.co",
		`https://${"é".repeat(500)}.com`,
		`${"é".repeat(2048)}`,
		`${"é".repeat(2049)}`,
		`${"a.".repeat(1000)}com`,
		...texts(2048),
		...notStrings,
	];

	const common_ = (max: number) => [...texts(max), ...notStrings];

	const pools = {
		path: choices(["workflow", "idea", "website", "webapp"]),
		name: common_(100),
		email: [...emails, ...notStrings],
		company: common_(120),
		timing: choices(["flexible", "month", "quarter", "date", "asap"]),
		timingDate: dates,
		timingReason: common_(500),
		budgetStatus: choices(["approved", "pending", "exploring", "unsure"]),
		budgetNote: common_(200),
		approver: choices(["self", "other", "unsure"]),
		approverRole: common_(120),
		turnstileToken: common_(2048),
		submissionId: uuids,
		today: common_(2000),
		audience: common_(1000),
		firstResult: common_(2000),
		idea: common_(1000),
		audienceToday: common_(1000),
		firstVersion: common_(1000),
		signal: common_(500),
		purpose: common_(2000),
		currentUrl: urls,
		existing: common_(2000),
		updates: choices(["self", "help", "unsure"]),
		appGoal: common_(1000),
	} satisfies Pools;

	it("answers every generated body as the Zod validator did", () => {
		const found = differential(
			legacyValidateSoftwareInquiry,
			validateSoftwareInquiry,
			(answer) => fingerprint(answer),
		);

		for (const body of bodies(bases, pools, 20261114, 6000)) found.run(body);

		// The date rule also needs `timing` to be `date`, and the line rules need each key: cross them on purpose.
		const random = seeded(77);

		const entries = Object.entries(pools);

		for (let i = 0; i < 3000; i += 1) {
			const set: [string, RawValue][] = [["timing", "date"]];

			for (let n = 1 + random.below(3); n > 0; n -= 1) {
				const [name, values] = random.pick(entries);
				set.push([name, random.pick(values)]);
			}

			found.run(shuffled(changed(random.pick(bases), set), random));
		}

		expect(found.count).toBeGreaterThan(20000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`validateSoftwareInquiry differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	});

	it("returns a fresh plain object the browser may change", () => {
		const body = bases[0];
		const answer = validateSoftwareInquiry({ ...body, name: "" });

		expect(answer.ok).toBe(false);

		if (!answer.ok) {
			expect(Object.getPrototypeOf(answer.errors)).toBe(Object.prototype);
			answer.errors.path = "Choose a starting point.";
			expect(validateSoftwareInquiry({ ...body, name: "" })).not.toHaveProperty(
				"errors.path",
			);
		}
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// resolveClientDetails, the draft reader and the client reader

describe("the agreement client details against the frozen Zod 3 validators", () => {
	const draft = {
		legal_name: "Acme LLC",
		entity_type: "LLC",
		state: "Virginia",
		country: "",
		business_address: "1 Main St, Roanoke, VA",
		signer_name: "Ada Lovelace",
		signer_title: "CEO",
		portfolio_choice: "named",
		reviewer_name: "Rae Reviewer",
		reviewer_email: "rae@example.com",
		approver_name: "Pat Approver",
		approver_email: "pat@example.com",
		notice_email: "notices@example.com",
	};

	const bases: Body[] = [
		draft,
		{
			...draft,
			state: "Outside the US",
			country: "Canada",
			portfolio_choice: "private",
		},
		{
			...draft,
			portfolio_choice: "anonymous",
			reviewer_name: "",
			reviewer_email: "",
			approver_name: "",
			approver_email: "",
			notice_email: "",
		},
		{ legal_name: "Only a name" },
		{},
		{ ...draft, entity_type: "", state: "", portfolio_choice: "" },
	];

	const sessionEmails = [
		"client@example.com",
		"CLIENT@Example.COM",
		" client@example.com ",
		"",
		"not an email",
		`${"a".repeat(320)}@example.com`,
		"client@example",
	];

	const choices = (values: readonly string[]) => [
		...values,
		...values.map((v) => ` ${v} `),
		...values.map((v) => v.toLowerCase()),
		"",
		"toString",
		"__proto__",
		"Atlantis",
		...notStrings,
	];

	const emailPool = [...emails, ...texts(320), ...notStrings];

	const pools = {
		legal_name: [...texts(200), ...notStrings],
		entity_type: [...choices(businessTypes), ...texts(200)],
		state: [...choices(states), ...texts(100)],
		country: [...texts(100), ...notStrings, "Canada", "United States"],
		business_address: [...texts(1000), ...notStrings],
		signer_name: [...texts(200), ...notStrings],
		signer_title: [...texts(200), ...notStrings],
		portfolio_choice: choices(["private", "anonymous", "named"]),
		reviewer_name: [...texts(200), ...notStrings],
		reviewer_email: emailPool,
		approver_name: [...texts(200), ...notStrings],
		approver_email: emailPool,
		notice_email: emailPool,
	} satisfies Pools;

	const answerOf = (
		answer:
			| { ok: true; client: unknown }
			| { ok: false; errors: Record<string, string> },
	) =>
		answer.ok
			? fingerprint({ ok: true, value: answer.client }, true)
			: fingerprint(answer, true);

	it("answers resolveClientDetails as the Zod validator did", () => {
		const found = differential(
			([input, email]: [RawValue, string]) =>
				legacyResolveClientDetails(input, email),
			([input, email]: [RawValue, string]) =>
				resolveClientDetails(input, email),
			answerOf,
		);

		const random = seeded(20261115);

		for (const body of bodies(bases, pools, 20261115, 6000))
			found.run([body, random.pick(sessionEmails)]);

		for (const email of sessionEmails)
			for (const base of bases) found.run([base, email]);

		expect(found.count).toBeGreaterThan(12000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`resolveClientDetails differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	});

	it("answers the draft reader as the Zod draft schema and its field errors did", () => {
		const oracle = (input: RawValue) => {
			const parsed = legacyDraftSchema.safeParse(input);

			return parsed.success
				? { ok: true as const, value: parsed.data }
				: {
						ok: false as const,
						errors: legacyDraftFieldErrors(parsed.error.issues),
					};
		};

		const found = differential(oracle, readDraft, (answer) =>
			fingerprint(answer, true),
		);

		for (const body of bodies(bases, pools, 20261116, 4000)) found.run(body);

		expect(found.count).toBeGreaterThan(8000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`readDraft differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	});

	it("throws from parseDraft exactly where the Zod schema's parse threw, with a message that starts with [", () => {
		let threw = 0;

		for (const body of bodies(bases, pools, 20261117, 1500)) {
			const expected = legacyDraftSchema.safeParse(body);

			if (expected.success) {
				expect(JSON.stringify(parseDraft(body))).toBe(
					JSON.stringify(expected.data),
				);
			} else {
				threw += 1;
				let message = "";

				try {
					parseDraft(body);
				} catch (error) {
					message = error instanceof Error ? error.message : "";
				}

				expect(message.startsWith("[")).toBe(true);
				expect(() => legacyDraftSchema.parse(body)).toThrow();
			}
		}

		expect(threw).toBeGreaterThan(500);
	});

	it("answers the client reader and parseClientAgreement as the Zod client schema did", () => {
		const client = {
			legal_name: "Acme LLC",
			entity_type: "LLC",
			jurisdiction: "Virginia",
			business_address: "1 Main St",
			notice_email: "n@example.com",
			reviewer_name: "R",
			reviewer_email: "r@example.com",
			approver_name: "A",
			approver_email: "a@example.com",
			signer_name: "Ada",
			signer_title: "CEO",
			portfolio: "allow",
			naming: true,
		};

		const clientBases: Body[] = [
			client,
			{ ...client, portfolio: "deny", naming: false },
			{ ...client, portfolio: "deny", naming: true },
			{ ...client, naming: undefined },
		];

		const clientPools = {
			legal_name: [...texts(200), ...notStrings],
			entity_type: [...texts(200), ...notStrings],
			jurisdiction: [...texts(100), ...notStrings],
			business_address: [...texts(1000), ...notStrings],
			notice_email: emailPool,
			reviewer_name: [...texts(200), ...notStrings],
			reviewer_email: emailPool,
			approver_name: [...texts(200), ...notStrings],
			approver_email: emailPool,
			signer_name: [...texts(200), ...notStrings],
			signer_title: [...texts(200), ...notStrings],
			portfolio: choices(["allow", "deny"]),
			naming: [true, false, "true", 1, 0, null, undefined, "", [], {}],
		} satisfies Pools;

		const oracle = (input: RawValue) => {
			const parsed = legacyClientAgreementSchema.safeParse(input);

			return parsed.success
				? { ok: true as const, value: parsed.data }
				: {
						ok: false as const,
						// The fields that failed, in the order Zod reported them (an object-level failure has no field).
						errors: Object.fromEntries(
							parsed.error.issues
								.filter((issue) => issue.path.length > 0)
								.map((issue) => [String(issue.path[0]), "failed"]),
						),
					};
		};

		const found = differential(
			oracle,
			(input: RawValue) => {
				const read = readClientAgreement(input);

				return read.ok
					? read
					: {
							ok: false as const,
							errors: Object.fromEntries(
								Object.keys(read.errors)
									.filter((key) => key !== "_form")
									.map((key) => [key, "failed"]),
							),
						};
			},
			(answer) => fingerprint(answer, true),
		);

		let throws = 0;

		for (const body of bodies(clientBases, clientPools, 20261118, 5000)) {
			found.run(body);

			const expectedThrows =
				!legacyClientAgreementSchema.safeParse(body).success;

			let message: string | undefined;

			try {
				parseClientAgreement(body);
			} catch (error) {
				message = error instanceof Error ? error.message : "";
			}

			expect(message !== undefined).toBe(expectedThrows);

			if (message !== undefined) {
				throws += 1;
				expect(message.startsWith("[")).toBe(true);
			}
		}

		expect(found.count).toBeGreaterThan(8000);
		expect(throws).toBeGreaterThan(2000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`clientAgreement differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// The server-only Zod copy of the three small helpers

describe("the server-only Zod copy of cleanText, required and email", () => {
	const maxima = [1, 2, 3, 10, 80, 200, 320, 1000];

	const same = (
		copy: {
			safeParse: (value: RawValue) => { success: boolean; data?: RawValue };
		},
		oracle: {
			safeParse: (value: RawValue) => { success: boolean; data?: RawValue };
		},
		value: RawValue,
	) => {
		const a = copy.safeParse(value);
		const b = oracle.safeParse(value);

		return (
			a.success === b.success &&
			JSON.stringify(a.data) === JSON.stringify(b.data)
		);
	};

	it("is the Zod cleanText the browser validators used, on every input of a shared table", () => {
		let count = 0;

		for (const max of maxima)
			for (const value of [...texts(max), ...notStrings]) {
				count += 1;
				expect(same(zodCleanText(max), legacyCleanText(max), value)).toBe(true);
				expect(same(zodRequired(max), legacyRequired(max), value)).toBe(true);
			}

		for (const value of [...emails, ...notStrings]) {
			count += 1;
			expect(same(zodEmail, legacyEmail, value)).toBe(true);
		}

		expect(count).toBeGreaterThan(900);
	});

	it("agrees with the Effect cleanText, required and email fields on a shared table", () => {
		let count = 0;

		for (const max of maxima) {
			const fields = { text: cleanTextField(max), needed: requiredField(max) };

			for (const value of [...texts(max), ...notStrings]) {
				count += 1;

				const read = readFields(
					fields,
					{ text: value, needed: value },
					{
						winner: "last",
					},
				);

				const expectedText = zodCleanText(max).safeParse(value);
				const expectedNeeded = zodRequired(max).safeParse(value);

				if (read.ok) {
					expect(expectedText.success).toBe(true);
					expect(expectedNeeded.success).toBe(true);
					expect(read.value.text).toBe(expectedText.data);
					expect(read.value.needed).toBe(expectedNeeded.data);
				} else {
					expect(read.errors.text !== undefined).toBe(!expectedText.success);
					expect(read.errors.needed !== undefined).toBe(
						!expectedNeeded.success,
					);
				}
			}
		}

		for (const value of [...emails, ...notStrings]) {
			count += 1;

			const read = readFields({ email: emailField }, { email: value });
			const expected = zodEmail.safeParse(value);

			expect(read.ok).toBe(expected.success);

			if (read.ok) expect(read.value.email).toBe(expected.data);
		}

		expect(count).toBeGreaterThan(900);
	});
});
