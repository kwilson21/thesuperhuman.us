import { ZodError } from "astro/zod";
import * as Predicate from "effect/Predicate";
import { describe, expect, it, vi } from "vitest";
import { validateIntake } from "../../src/lib/audio-intake";
import {
	parseClientAgreement,
	readClientAgreement,
} from "../../src/lib/agreement-client-fields";
import {
	parseAgreementAttachments,
	parseContractor,
	readAgreementDetails,
	readContractor,
	validateAgreementDetails,
} from "../../src/lib/agreement-fields";
import {
	readAttachmentQuery,
	readOwnerAgreementAction,
} from "../../src/lib/agreement-owner-input";
import type { OwnerRequest } from "../../src/lib/owner-model";
import {
	clientOffer,
	type OfferTerms,
	parseOfferTerms,
	readOfferTerms,
	type SoftwareOffer,
	validateOfferTerms,
} from "../../src/lib/software-offers";
import { projectTerms } from "../../src/lib/software-projects";
import { classifyFailure, logUnexpected } from "../../src/server/failure";
import {
	businessTypes,
	parseDraft,
	readDraft,
	resolveClientDetails,
	states,
} from "../../src/lib/agreement-draft-fields";
import { type Body, FieldsRefused, type RawValue } from "../../src/lib/fields";
import { validateSoftwareInquiry } from "../../src/lib/software-inquiry";
import { legacyClientAgreementSchema } from "../fixtures/legacy-validators/agreement-client-fields";
import {
	legacyAgreementDetailsSchema,
	legacyAttachmentQuery,
	legacyContractorSchema,
	legacyOwnerAgreementAction,
	legacyValidateAgreementDetails,
} from "../fixtures/legacy-validators/agreement-fields";
import {
	legacyDraftFieldErrors,
	legacyDraftSchema,
	legacyResolveClientDetails,
} from "../fixtures/legacy-validators/agreement-draft-fields";
import { legacyValidateIntake } from "../fixtures/legacy-validators/audio-intake";
import {
	legacyReadEvent,
	legacyReadInterest,
} from "../fixtures/legacy-validators/music-demand";
import { legacyValidateSoftwareInquiry } from "../fixtures/legacy-validators/software-inquiry";
import {
	legacyOfferTermsSchema,
	legacyValidateOfferTerms,
} from "../fixtures/legacy-validators/software-offers";
import { partial } from "../helpers/doubles";
import {
	readEventInput,
	readInterestInput,
} from "../../src/server/music-input";
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
	}, 60_000);

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
	}, 60_000);
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
	}, 60_000);

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
	}, 60_000);
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
	}, 60_000);

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
	}, 60_000);

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
	}, 60_000);

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
	}, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// The owner agreement details, the contractor's details and the owner's agreement requests

type Issues = readonly {
	path: readonly (string | number)[];
	message: string;
}[];

/** What the owner request route shows for a rejected payload: each failed path with its last sentence, in order. */
const errorsOf = (issues: Issues) =>
	Object.fromEntries(
		issues.map((issue) => [`agreement.${issue.path.join(".")}`, issue.message]),
	);

/**
 * Every issue, as a list: its path and sentence, in the order they were found (an issue is not dropped when a value fails
 * two checks). Each is its own entry, so two issues for one path both show.
 */
const rawOf = (issues: Issues) =>
	Object.fromEntries(
		issues.map((issue, index) => [
			String(index),
			JSON.stringify([issue.path, issue.message]),
		]),
	);

type Answer =
	| { ok: true; value: RawValue }
	| { ok: false; errors: Record<string, string> };

describe("the owner agreement schemas against the frozen Zod 3 schemas", () => {
	const attachment = {
		filename: "Statement of requirements.pdf",
		version: "v2",
		date: "2027-02-10",
		sha256: "a".repeat(64),
		key: "agreements/attachments/123e4567-e89b-42d3-a456-426614174000.pdf",
		bytes: 1234,
	};

	const milestone = {
		start: "2027-03-01",
		target: "2027-03-20",
		handoff: "Repository and notes",
	};

	const details = {
		planned_start: "2027-03-01",
		planned_end: "2027-04-15",
		environment: "Staging and production on the client's account",
		operating_responsibilities: "The client hosts and monitors it",
		update_rhythm: "Weekly",
		milestones: [milestone],
	};

	const full = {
		...details,
		update_channel: "Email",
		milestones: [
			{
				...milestone,
				checkpoint_criteria: "Login works",
				checkpoint_evidence: "Demo",
			},
			{
				start: "2027-03-21",
				target: "2027-04-10",
				handoff: "Everything",
				checkpoint_criteria: "None",
				checkpoint_evidence: "None",
			},
		],
		visual_approvals: "Home page",
		invoice_first_duration: 20,
		review_business_days: 35,
		longer_review_confirmed: true,
		correction_calendar_days: 60,
		po_requirement: "before_start",
		expenses_taxes: "Client pays",
		recurring_charges: "None",
		ai_permission: "Not allowed",
		sensitive_addenda: "None",
		support: "30 days",
		msa_changes: "None",
		data_retention: "Keep 90 days after the project page closes",
		project_retention_days: 90,
		handoff_access: "Keep for 45 days",
		handoff_access_days: 45,
		attachments: [attachment, { ...attachment, bytes: 10 * 1024 * 1024 }],
	};

	const contractor = {
		legal_name: "The Superhuman Group LLC",
		entity_jurisdiction: "Wyoming",
		signer_name: "Kazon Wilson",
		signer_title: "Manager",
		notice_email: "notices@example.com",
		business_address: "1 Registered Agent Way",
		registered_agent_confirmed: true,
	};

	const numbers: RawValue[] = [
		0,
		1,
		-1,
		4,
		5,
		6,
		29,
		30,
		31,
		35,
		60,
		89,
		90,
		91,
		364,
		365,
		366,
		3649,
		3650,
		3651,
		10485760,
		10485761,
		1.5,
		-0.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		1e21,
		"5",
		"",
		" 5 ",
		null,
		true,
		false,
		[],
		[5],
		{},
		undefined,
	];

	const dates = [
		"2027-03-01",
		"2027-03-20",
		"2027-04-15",
		"2027-04-16",
		"2027-02-29",
		"2028-02-29",
		"2027-13-01",
		"0000-01-01",
		"2027-3-1",
		"2027-03-01 ",
		" 2027-03-01",
		"2027-03-01\n",
		"",
		"soon",
		"2027-03-01T00:00:00Z",
		"2026-12-31",
		"2027-06-30",
		...notStrings,
	];

	const attachmentPool: RawValue[] = [
		attachment,
		{ ...attachment, extra: 1 },
		{ ...attachment, filename: "" },
		{ ...attachment, filename: "x".repeat(201) },
		{ ...attachment, filename: "a\u0000b" },
		{ ...attachment, version: "v".repeat(81) },
		{ ...attachment, date: "2027-02-30" },
		{ ...attachment, sha256: "A".repeat(64) },
		{ ...attachment, sha256: "a".repeat(63) },
		{ ...attachment, sha256: undefined },
		{ ...attachment, key: "agreements/attachments/x.pdf" },
		{ ...attachment, key: "agreements/attachments/abc-123.pdf" },
		{ ...attachment, key: "agreements/attachments/abc-123.pdf\n" },
		{ ...attachment, bytes: 0 },
		{ ...attachment, bytes: 10485760 },
		{ ...attachment, bytes: 10485761 },
		{ ...attachment, bytes: 1.5 },
		{ ...attachment, bytes: "5" },
		{ ...attachment, bytes: Number.NaN },
		null,
		"x",
		5,
		[],
	];

	const attachmentLists: RawValue[] = [
		undefined,
		null,
		[],
		[attachment],
		[attachment, attachment, attachment, attachment, attachment],
		[attachment, attachment, attachment, attachment, attachment, attachment],
		[
			{ ...attachment, bytes: 9 * 1024 * 1024 },
			{ ...attachment, bytes: 9 * 1024 * 1024 },
			{ ...attachment, bytes: 9 * 1024 * 1024 },
		],
		[
			{ ...attachment, bytes: 10485760 },
			{ ...attachment, bytes: 10485760 },
			{ ...attachment, bytes: 5242880 },
		],
		[
			{ ...attachment, bytes: 10485760 },
			{ ...attachment, bytes: 10485760 },
			{ ...attachment, bytes: 5242881 },
		],
		"x",
		5,
		{},
		{ 0: attachment, length: 1 },
		...attachmentPool.map((item) => [item]),
		...attachmentPool.map((item) => [attachment, item]),
	];

	const random = seeded(20261119);

	const milestoneVariants = (): RawValue[] => {
		const one = (): Body => {
			const base: Body = {
				...milestone,
				checkpoint_criteria: "Login works",
				checkpoint_evidence: "Demo",
			};

			const pools = {
				start: dates,
				target: dates,
				handoff: [...texts(4000), ...notStrings],
				checkpoint_criteria: [...texts(4000), ...notStrings],
				checkpoint_evidence: [...texts(4000), ...notStrings],
			};

			const [name, values] = random.pick(Object.entries(pools));
			const picked = random.pick(values);

			return random.chance(0.15)
				? { ...base, extra: "x" }
				: random.chance(0.1)
					? Object.fromEntries(Object.entries(base).filter(([k]) => k !== name))
					: { ...base, [name]: picked };
		};

		const out: RawValue[] = [
			[],
			[milestone],
			[milestone, milestone],
			[milestone, milestone, milestone],
			[milestone, milestone, milestone, milestone],
			null,
			"x",
			{},
			[null],
			[5],
			["x"],
			[[]],
		];

		for (let i = 0; i < 600; i += 1)
			out.push(Array.from({ length: 1 + random.below(3) }, one));

		return out;
	};

	const retentionTexts = [
		"MSA default, including one year for the private project page",
		"Keep 90 days",
		"90",
		"x90y",
		"90.5",
		"1.90",
		"90,5",
		"٩٠",
		"ninety",
		"",
		" ",
		"Keep 365 days",
		"MSA default",
		"MSA default 30",
		"for 45 days",
		"45",
		"a45",
		"45a",
		"1 year (365)",
	];

	const detailPools = {
		planned_start: dates,
		planned_end: dates,
		environment: [...texts(4000), ...notStrings],
		operating_responsibilities: [...texts(4000), ...notStrings],
		update_channel: [...texts(500), ...notStrings],
		update_rhythm: [...texts(500), ...notStrings],
		milestones: milestoneVariants(),
		visual_approvals: [...texts(4000), ...notStrings],
		invoice_first_duration: numbers,
		review_business_days: numbers,
		longer_review_confirmed: [
			true,
			false,
			"true",
			1,
			0,
			null,
			undefined,
			"",
			[],
			{},
		],
		correction_calendar_days: numbers,
		po_requirement: [
			"not_required",
			"before_start",
			"NOT_REQUIRED",
			" before_start",
			"",
			"x",
			"toString",
			"__proto__",
			...notStrings,
		],
		expenses_taxes: [...texts(4000), ...notStrings],
		recurring_charges: [...texts(4000), ...notStrings],
		ai_permission: [...texts(4000), ...notStrings],
		sensitive_addenda: [...texts(4000), ...notStrings],
		support: [...texts(4000), ...notStrings],
		msa_changes: [...texts(4000), ...notStrings],
		data_retention: [...retentionTexts, ...texts(4000), ...notStrings],
		project_retention_days: numbers,
		handoff_access: [...retentionTexts, ...texts(4000), ...notStrings],
		handoff_access_days: numbers,
		attachments: attachmentLists,
	} satisfies Pools;

	const detailsAnswer = (input: RawValue): Answer => {
		const read = readAgreementDetails(input);

		return read.ok
			? { ok: true, value: read.value }
			: { ok: false, errors: rawOf(read.issues) };
	};

	const legacyDetailsAnswer = (input: RawValue): Answer => {
		const read = legacyAgreementDetailsSchema.safeParse(input);

		return read.success
			? { ok: true, value: read.data }
			: { ok: false, errors: rawOf(read.error.issues) };
	};

	const answerLine = (answer: Answer) => fingerprint(answer, true);

	it("answers the agreement details as the Zod schema did: values in order, and every issue with its path and sentence, in order", () => {
		// The inputs reach both sides of the schema: many accepted, and many different sets of failures (including the
		// checks across fields, which run only when nothing stopped the details). Counted from the same runs.
		const outcomes = { accepted: 0, kinds: new Set<string>() };

		const found = differential(
			legacyDetailsAnswer,
			detailsAnswer,
			answerLine,
			(answer) => {
				if (answer.ok) outcomes.accepted += 1;
				else outcomes.kinds.add(Object.values(answer.errors).join("|"));
			},
		);

		for (const body of bodies([details, full], detailPools, 20261120, 9000))
			found.run(body);

		// Several fields wrong at once, so the order of paths and the stopping rules show.
		const entries = Object.entries(detailPools);

		for (let i = 0; i < 6000; i += 1) {
			const set: [string, RawValue][] = [];

			for (let n = 2 + random.below(5); n > 0; n -= 1) {
				const [name, values] = random.pick(entries);
				set.push([name, random.pick(values)]);
			}

			found.run(shuffled(changed(random.pick([details, full]), set), random));
		}

		expect(outcomes.accepted).toBeGreaterThan(50);
		expect(outcomes.kinds.size).toBeGreaterThan(300);
		expect(found.count).toBeGreaterThan(19000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`agreementDetails differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 60_000);

	it("answers the attachments alone as the Zod array did, missing as none", () => {
		const oracle = (input: RawValue): Answer => {
			const read = legacyAgreementDetailsSchema
				.innerType()
				.shape.attachments.safeParse(input);

			return read.success
				? { ok: true, value: read.data }
				: { ok: false, errors: rawOf(read.error.issues) };
		};

		const subject = (input: RawValue): Answer => {
			try {
				return { ok: true, value: parseAgreementAttachments(input) };
			} catch (error) {
				return {
					ok: false,
					errors: rawOf(error instanceof FieldsRefused ? error.issues : []),
				};
			}
		};

		const found = differential(oracle, subject, answerLine);

		for (const list of attachmentLists) found.run(list);

		for (let i = 0; i < 1500; i += 1)
			found.run(
				Array.from({ length: random.below(7) }, () =>
					random.pick(attachmentPool),
				),
			);

		expect(found.count).toBeGreaterThan(1500);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`agreementAttachments differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 60_000);

	it("throws from validateAgreementDetails exactly where the Zod version did, with the same sentences and the same plain errors", () => {
		// SAFETY: the function reads only the payment mode and each milestone's checkpoint; the rest of an offer's terms is not read.
		const termsFor = (count: number, mode: string, checkpoints: boolean[]) =>
			({
				paymentMode: mode,
				milestones: Array.from({ length: count }, (_, i) =>
					checkpoints[i] ? { checkpoint: { label: "x" } } : {},
				),
			}) as OfferTerms;

		const outcome = (run: () => RawValue): Answer => {
			try {
				return { ok: true, value: run() };
			} catch (error) {
				if (error instanceof FieldsRefused || error instanceof ZodError)
					return {
						ok: false,
						errors: {
							...errorsOf(error.issues),
							kind: error.message.startsWith("[") ? "[" : error.message,
						},
					};

				return {
					ok: false,
					errors: { plain: error instanceof Error ? error.message : "?" },
				};
			}
		};

		const found = differential(
			(input: [RawValue, OfferTerms]) =>
				outcome(() => legacyValidateAgreementDetails(input[0], input[1])),
			(input: [RawValue, OfferTerms]) =>
				outcome(() => validateAgreementDetails(input[0], input[1])),
			answerLine,
		);

		const termsList = [
			termsFor(1, "standard", [false]),
			termsFor(1, "invoice", [false]),
			termsFor(1, "standard", [true]),
			termsFor(2, "standard", [true, false]),
			termsFor(2, "invoice", [false, true]),
			termsFor(3, "standard", [true, true, true]),
			termsFor(3, "invoice", [false, false, false]),
		];

		for (const body of bodies([details, full], detailPools, 20261121, 2500))
			found.run([body, random.pick(termsList)]);

		for (const terms of termsList) {
			found.run([details, terms]);
			found.run([full, terms]);
			found.run([{ ...full, invoice_first_duration: 1 }, terms]);
			found.run([{ ...full, invoice_first_duration: 90 }, terms]);
			found.run([{ ...full, invoice_first_duration: null }, terms]);
		}

		// Larger than 64 KiB.
		found.run([{ ...details, environment: "x".repeat(70000) }, termsList[0]]);

		expect(found.count).toBeGreaterThan(2500);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`validateAgreementDetails differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 60_000);

	const contractorPools = {
		legal_name: [...texts(200), ...notStrings],
		entity_jurisdiction: [...texts(200), ...notStrings],
		signer_name: [...texts(200), ...notStrings],
		signer_title: [...texts(200), ...notStrings],
		notice_email: [...emails, ...notStrings],
		business_address: [...texts(1000), ...notStrings],
		registered_agent_confirmed: [
			true,
			false,
			"true",
			1,
			0,
			null,
			undefined,
			[],
			{},
			"",
		],
	} satisfies Pools;

	it("answers the contractor's details as the Zod schema did", () => {
		const subject = (input: RawValue): Answer => {
			const read = readContractor(input);

			return read.ok
				? { ok: true, value: read.value }
				: { ok: false, errors: rawOf(read.issues) };
		};

		const oracle = (input: RawValue): Answer => {
			const read = legacyContractorSchema.safeParse(input);

			return read.success
				? { ok: true, value: read.data }
				: { ok: false, errors: rawOf(read.error.issues) };
		};

		const found = differential(oracle, subject, answerLine);

		for (const body of bodies([contractor], contractorPools, 20261122, 4000))
			found.run(body);

		let threw = 0;

		for (const body of bodies([contractor], contractorPools, 20261123, 600)) {
			let message: string | undefined;

			try {
				parseContractor(body);
			} catch (error) {
				message = error instanceof Error ? error.message : "";
			}

			expect(message !== undefined).toBe(
				!legacyContractorSchema.safeParse(body).success,
			);

			if (message !== undefined) {
				threw += 1;
				expect(message.startsWith("[")).toBe(true);
			}
		}

		expect(found.count).toBeGreaterThan(4500);
		expect(threw).toBeGreaterThan(300);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`contractor differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 60_000);

	describe("the owner's agreement requests", () => {
		const id = "123e4567-e89b-42d3-a456-426614174000";
		const hash = "b".repeat(64);
		const docs = [{ id, hash }];

		const bases: Body[] = [
			{
				action: "countersign",
				documents: docs,
				typed_name: "Kazon Wilson",
				consent: true,
			},
			{
				action: "abandon",
				documents: [...docs, { id, hash }],
				reason: "Client withdrew",
				confirmed: true,
			},
			{ action: "retry-artifact", agreement_id: id },
			{
				action: "retry-copy",
				agreement_id: id,
				confirmedNotSent: true,
				expectedAttempt: id,
				confirmedStale: true,
			},
			{
				action: "record-alternate-copy",
				agreement_id: id,
				role: "client",
				method: "Printed",
				confirmed: true,
			},
			{ action: "hold", agreement_id: id, held: true },
			{
				action: "end",
				agreement_id: id,
				ended_on: "2027-05-01",
				confirmed: true,
			},
		];

		const actionPools = {
			action: [
				"countersign",
				"abandon",
				"retry-artifact",
				"retry-copy",
				"record-alternate-copy",
				"hold",
				"end",
				"Countersign",
				" hold",
				"toString",
				"__proto__",
				"constructor",
				"",
				"other",
				...notStrings,
			],
			documents: [
				docs,
				[],
				[docs[0], docs[0], docs[0]],
				[{ id, hash, extra: 1 }],
				[{ id: "x", hash }],
				[{ id, hash: "B".repeat(64) }],
				[{ id }],
				[null],
				[5],
				"x",
				null,
				undefined,
				{},
			],
			typed_name: [...texts(200), ...notStrings],
			reason: [...texts(1000), ...notStrings],
			method: [...texts(200), ...notStrings],
			consent: [true, false, "true", 1, null, undefined, [], {}],
			confirmed: [true, false, "true", 1, null, undefined, [], {}],
			confirmedNotSent: [true, false, "true", 1, null, undefined, [], {}],
			confirmedStale: [true, false, "true", 1, null, undefined, [], {}],
			held: [true, false, "true", 1, null, undefined, [], {}],
			role: [
				"client",
				"contractor",
				"Client",
				" client",
				"",
				"owner",
				"toString",
				...notStrings,
			],
			agreement_id: [id, id.toUpperCase(), ` ${id}`, "x", "", ...notStrings],
			expectedAttempt: [
				id,
				id.toUpperCase(),
				"x",
				"",
				null,
				undefined,
				...notStrings,
			],
			ended_on: [
				"2027-05-01",
				"2027-5-1",
				"2027-02-30",
				"2027-05-01\n",
				" 2027-05-01",
				"",
				"x",
				...notStrings,
			],
		} satisfies Pools;

		it("answers the action union as the Zod discriminated union did", () => {
			const oracle = (input: RawValue): Answer => {
				const read = legacyOwnerAgreementAction.safeParse(input);

				return read.success
					? { ok: true, value: read.data }
					: { ok: false, errors: {} };
			};

			const subject = (input: RawValue): Answer => {
				const read = readOwnerAgreementAction(input);

				return read.ok
					? { ok: true, value: read.value }
					: { ok: false, errors: {} };
			};

			const found = differential(oracle, subject, (answer) =>
				fingerprint(answer, true),
			);

			for (const body of bodies(bases, actionPools, 20261124, 6000))
				found.run(body);

			expect(found.count).toBeGreaterThan(6000);
			expect(take(found)).toEqual(noMismatch(found));
			console.info(
				`ownerAgreementAction differential: ${found.count} inputs, ${found.mismatches.length} differences`,
			);
		}, 60_000);

		it("answers the attachment upload's query as the Zod object did", () => {
			const oracle = (input: RawValue): Answer => {
				const read = legacyAttachmentQuery.safeParse(input);

				return read.success
					? { ok: true, value: read.data }
					: { ok: false, errors: {} };
			};

			const subject = (input: RawValue): Answer => {
				const read = readAttachmentQuery(input);

				return read.ok
					? { ok: true, value: read.value }
					: { ok: false, errors: {} };
			};

			const found = differential(oracle, subject, (answer) =>
				fingerprint(answer, true),
			);

			const base = { filename: "SOW.pdf", version: "v1", date: "2027-01-31" };

			const pools = {
				filename: [
					...texts(200),
					"a/b.pdf",
					"a\\b.pdf",
					"/",
					"\\",
					" / ",
					"a\u0000/b",
					...notStrings,
				],
				version: [...texts(80), ...notStrings],
				date: dates,
			} satisfies Pools;

			for (const body of bodies([base], pools, 20261125, 4000)) found.run(body);

			// A query string gives only text.
			for (const [name, values] of Object.entries(pools))
				for (const value of values)
					if (Predicate.isString(value)) found.run({ ...base, [name]: value });

			expect(found.count).toBeGreaterThan(3000);
			expect(take(found)).toEqual(noMismatch(found));
			console.info(
				`attachmentQuery differential: ${found.count} inputs, ${found.mismatches.length} differences`,
			);
		}, 60_000);
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// The public music routes' bodies (src/server/music-input.ts)

describe("the music interest body against the frozen Zod 3 schema", () => {
	const base = {
		releaseId: "old-news-single",
		email: "fan@example.com",
		interest: "both",
		merchandise: ["shirts", "stickers"],
		suggestion: "Please make hoodies",
		cityRegion: "Roanoke, VA",
		consent: true,
		turnstileToken: "token-1",
	};

	const bases: Body[] = [
		base,
		{ ...base, interest: "song", merchandise: [], suggestion: "" },
		{ ...base, interest: "merchandise" },
		{
			releaseId: "old-news-single",
			email: "fan@example.com",
			interest: "song",
			consent: true,
			turnstileToken: "t",
		},
	];

	const kinds = ["shirts", "hoodies", "stickers", "digital-art"];

	const pools = {
		releaseId: [
			...texts(100),
			"old-news-single",
			"Old News",
			"a-b-c",
			"-a",
			"a-",
			"a--b",
			...notStrings,
		],
		email: [...emails, ...notStrings],
		interest: [
			"song",
			"merchandise",
			"both",
			"tickets",
			"SONG",
			" song",
			"",
			"toString",
			"__proto__",
			...notStrings,
		],
		merchandise: [
			[],
			["shirts"],
			kinds,
			[...kinds, "shirts"],
			["shirts", "posters"],
			["posters", "shirts"],
			["posters", 3],
			[3, "posters"],
			["shirts", "shirts"],
			[null],
			[[]],
			["SHIRTS"],
			"shirts",
			...notStrings,
		],
		suggestion: [...texts(500), ...notStrings],
		cityRegion: [...texts(120), ...notStrings],
		consent: [true, false, "true", 1, 0, null, undefined, [], {}, "", "yes"],
		turnstileToken: [...texts(2048), ...notStrings],
	} satisfies Pools;

	it("answers every generated body as the Zod schema did, errors in the same order", () => {
		const found = differential(
			legacyReadInterest,
			readInterestInput,
			(answer) => fingerprint(answer, true),
		);

		for (const body of bodies(bases, pools, 20261114, 6000)) found.run(body);

		expect(found.count).toBeGreaterThan(6000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`music interest differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 60_000);
});

describe("the music event body against the frozen Zod 3 schema", () => {
	const base = {
		releaseId: "old-news-single",
		recordingId: "old-news-recording",
		sessionId: "22222222-2222-4222-8222-222222222222",
		playthroughId: "33333333-3333-4333-8333-333333333333",
		eventId: "00000000-0000-4000-8000-000000000001",
		sequence: 1,
		medium: "audio",
		event: "start",
		accumulatedSeconds: 0,
		mediaDurationSeconds: 160,
	};

	const bases: Body[] = [
		base,
		{
			...base,
			campaignId: "spring-launch",
			channel: "instagram",
			creative: "reel-1",
		},
	];

	const numbers = [
		0,
		1,
		2,
		9999,
		10_000,
		10_001,
		86_400,
		86_401,
		-1,
		1.5,
		0.5,
		"1",
		"",
		null,
		undefined,
		true,
		[],
		{},
		Number.NaN,
		Number.POSITIVE_INFINITY,
		-0,
	];

	const uuids = [
		"22222222-2222-4222-8222-222222222222",
		"22222222-2222-2222-2222-222222222222",
		"2222222222224222822222222222",
		"22222222-2222-4222-8222-22222222222",
		"22222222-2222-4222-8222-2222222222222",
		" 22222222-2222-4222-8222-222222222222",
		"22222222-2222-4222-8222-222222222222\n",
		"ZZZZZZZZ-2222-4222-8222-222222222222",
		"",
		...notStrings,
	];

	const ids = [
		...texts(100),
		"old-news-single",
		"a",
		"a-b",
		"-a",
		"A",
		...notStrings,
	];

	const pools = {
		releaseId: ids,
		recordingId: ids,
		sessionId: uuids,
		playthroughId: uuids,
		eventId: uuids,
		sequence: numbers,
		medium: ["audio", "video", "text", "AUDIO", "", ...notStrings],
		event: [
			"start",
			"progress",
			"listen30",
			"complete",
			"replay",
			"pause",
			"",
			...notStrings,
		],
		accumulatedSeconds: numbers,
		mediaDurationSeconds: numbers,
		campaignId: ids,
		channel: ids,
		creative: ids,
	} satisfies Pools;

	it("accepts and refuses every generated body as the Zod schema did, with the same values", () => {
		const found = differential(legacyReadEvent, readEventInput, (answer) =>
			answer.ok ? fingerprint(answer, true) : "refused",
		);

		for (const body of bodies(bases, pools, 20261115, 6000)) found.run(body);

		expect(found.count).toBeGreaterThan(6000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`music event differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// The software offer terms (src/lib/software-offers.ts): the owner's draft and send (validateOfferTerms), the client's
// view of a sent offer (clientOffer), and stored terms read back by the project, invoice and agreement code (projectTerms,
// which throws on terms that do not read, as the review and sign code does)

/** A value as JSON, keeping what `JSON.stringify` drops or folds: a key whose value is `undefined`, and -0. */
const exactly = (value: RawValue) =>
	JSON.stringify(value, (_key, inner: RawValue) => {
		if (inner === undefined) return "<undefined>";

		return Object.is(inner, -0) ? "<-0>" : inner;
	});

/** The terms as `JSON.stringify` stores them, or undefined for a value it cannot write (a bigint, a function, a symbol). */
function storedJson(value: RawValue): string | undefined {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

/**
 * How the routes and the failure log treat what reading stored terms threw: whether the review route refuses it (409) as
 * a validator's error, what `classifyFailure` makes of it, and the exact line `logUnexpected` writes for it.
 */
function treated<E>(error: E) {
	const lines: RawValue[][] = [];

	const spy = vi
		.spyOn(console, "error")
		.mockImplementation((...args: RawValue[]) => {
			lines.push(args);
		});

	try {
		logUnexpected("Software invoice", error);
	} finally {
		spy.mockRestore();
	}

	return {
		refused: error instanceof FieldsRefused || error instanceof ZodError,
		failure: classifyFailure(error).kind,
		logged: lines,
	};
}

/** What reading stored terms gave. The key is `failed`, not `threw`: `differential` reads `threw` as its own mark of a throw. */
type Stored =
	| { ok: true; value: RawValue }
	| { ok: false; failed: ReturnType<typeof treated> };

/** Stored terms read with `read`: the value, or how what it threw is treated. */
function storedRead(read: () => RawValue): Stored {
	try {
		return { ok: true, value: read() };
	} catch (error) {
		return { ok: false, failed: treated(error) };
	}
}

describe("the offer terms against the frozen Zod 3 validator", () => {
	const milestone = {
		name: "Tracker",
		deliverables: ["Status view", "Import script"],
		acceptance: ["Add a client and identify their next action."],
		feeCents: 240_000,
	};

	const checkpoint = { label: "Halfway review", cancellationPercent: 60 };

	const base = {
		outcome: "Onboarding",
		summary: "A shared view of every client and their next action.",
		milestones: [milestone],
		clientInputs: "",
		exclusions: "",
		timing: "",
		paymentMode: "standard",
	};

	// The total is 100,240,100 cents, which the low estimate equals.
	const full = {
		...base,
		milestones: [
			{ ...milestone, checkpoint },
			{ ...milestone, name: "Reports", feeCents: 100 },
			{ ...milestone, name: "Handoff", feeCents: 100_000_000 },
		],
		clientInputs: "Access to the staging account",
		exclusions: "Hosting\nSupport after handoff",
		timing: "Six weeks from the deposit",
		paymentMode: "invoice",
		projectRange: { lowCents: 100_240_100, highCents: 150_000_000 },
	};

	const amounts: RawValue[] = [
		0,
		-0,
		1,
		99,
		100,
		101,
		1.5,
		100.5,
		240_000,
		99_999_999,
		100_000_000,
		100_000_001,
		1e9,
		Number.MAX_SAFE_INTEGER,
		Number.MAX_SAFE_INTEGER + 2,
		-1,
		-100,
		-1.5,
		1e21,
		5e-324,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		"100",
		"",
		" 240000 ",
		"1e5",
		null,
		true,
		false,
		[],
		[100],
		{},
		undefined,
		100n,
		new Number(240_000),
		new Date(0),
	];

	const percents: RawValue[] = [
		50,
		51,
		52,
		60,
		94,
		95,
		96,
		0,
		-0,
		51.5,
		94.9,
		100,
		-60,
		1e21,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		"60",
		"",
		null,
		true,
		[],
		[60],
		{},
		undefined,
	];

	/** A list `length` long holding `values` at the positions given, every other position a hole. */
	const sparse = (length: number, values: Record<number, RawValue>) =>
		Object.assign(new Array<RawValue>(length), values);

	/** Lists of lines: empty, at the count and over it, blank and repeated lines, every awkward text, and not lists. */
	const lineLists = (max: number, count: number): RawValue[] => [
		[],
		["a"],
		["a", "b"],
		Array.from({ length: count }, (_, i) => `Line ${i}`),
		Array.from({ length: count + 1 }, (_, i) => `Line ${i}`),
		Array.from({ length: count + 3 }, () => ""),
		Array.from({ length: count + 1 }, () => "x".repeat(max + 1)),
		["Status view", "status view"],
		["Status view", " STATUS   VIEW "],
		["Status\tview", "status view"],
		["é", "é"],
		["ﬁle", "file"],
		["A", "a", "B", "b"],
		[""],
		[" "],
		["a", ""],
		["", "a"],
		["a\nb", "a b"],
		[null],
		["a", 5],
		[5, "a"],
		[[]],
		[{}],
		[undefined],
		["a", undefined],
		sparse(2, { 1: "a" }),
		sparse(3, {}),
		...texts(max).map((line) => [line]),
		...texts(max).map((line) => ["Status view", line]),
		...notStrings.map((line) => ["Status view", line]),
		"a",
		"",
		{ 0: "a", length: 1 },
		new Set(["a"]),
		...notStrings,
	];

	const checkpoints: RawValue[] = [
		undefined,
		null,
		{},
		checkpoint,
		{ ...checkpoint, extra: 1 },
		{ label: "Halfway review" },
		{ cancellationPercent: 60 },
		[],
		[checkpoint],
		"x",
		5,
		true,
		new Date(0),
		...percents.map((cancellationPercent) => ({
			...checkpoint,
			cancellationPercent,
		})),
		...texts(120).map((label) => ({ ...checkpoint, label })),
		...notStrings.map((label) => ({ ...checkpoint, label })),
	];

	const milestonePools = {
		name: [...texts(80), ...notStrings],
		deliverables: lineLists(200, 8),
		acceptance: lineLists(300, 5),
		feeCents: amounts,
		checkpoint: checkpoints,
	} satisfies Pools;

	const random = seeded(20261126);

	/** One milestone with one to three fields changed or removed, sometimes with a key the terms do not name. */
	const oneMilestone = (): RawValue => {
		const start = random.chance(0.5) ? milestone : { ...milestone, checkpoint };
		const set: [string, RawValue][] = [];
		const remove: string[] = [];

		for (let n = 1 + random.below(3); n > 0; n -= 1) {
			const [name, values] = random.pick(Object.entries(milestonePools));

			if (random.chance(0.08)) remove.push(name);
			else set.push([name, random.pick(values)]);
		}

		const changedMilestone = changed(start, set, remove);

		return random.chance(0.05)
			? { ...changedMilestone, extra: "x" }
			: changedMilestone;
	};

	const milestoneLists: RawValue[] = [
		[],
		[milestone, milestone],
		[milestone, milestone, milestone],
		[milestone, milestone, milestone, milestone],
		[{ ...milestone, checkpoint }],
		[{ ...milestone, checkpoint: undefined }],
		[{ ...milestone, extra: 1 }],
		null,
		"x",
		5,
		{},
		{ 0: milestone, length: 1 },
		[null],
		[5],
		["x"],
		[[]],
		[{}],
		[new Date(0)],
		[milestone, null],
		sparse(2, { 1: milestone }),
		sparse(1, {}),
		...Object.entries(milestonePools).flatMap(([name, values]) =>
			values.map((value) => [{ ...milestone, [name]: value }]),
		),
		...Array.from({ length: 1500 }, () =>
			Array.from({ length: 1 + random.below(4) }, oneMilestone),
		),
	];

	const ranges: RawValue[] = [
		undefined,
		null,
		{},
		[],
		"x",
		5,
		true,
		new Date(0),
		{ lowCents: 0, highCents: 0 },
		{ lowCents: 240_000, highCents: 240_000 },
		{ lowCents: 239_999, highCents: 500_000 },
		{ lowCents: 500_000, highCents: 400_000 },
		{ lowCents: 100, highCents: 50 },
		{ lowCents: 240_000 },
		{ highCents: 240_000 },
		{ lowCents: 240_000, highCents: 300_000, extra: 1 },
		Object.assign(new Number(5), { lowCents: 240_000, highCents: 300_000 }),
		...amounts.map((lowCents) => ({ lowCents, highCents: 500_000_000 })),
		...amounts.map((highCents) => ({ lowCents: 240_000, highCents })),
	];

	const pools = {
		outcome: [...texts(120), ...notStrings],
		summary: [...texts(300), ...notStrings],
		milestones: milestoneLists,
		clientInputs: [...texts(1000), ...notStrings],
		exclusions: [...texts(1000), ...notStrings],
		timing: [...texts(500), ...notStrings],
		paymentMode: [
			"standard",
			"invoice",
			"Standard",
			"INVOICE",
			" standard",
			"invoice ",
			"",
			"x",
			"toString",
			"__proto__",
			"constructor",
			...notStrings,
		],
		projectRange: ranges,
	} satisfies Pools;

	// Fees and estimates that vary together, some fees out of range and some lists too long, so the checks across fields
	// run on values that failed their own checks too (Zod ran them on any object that was not stopped).
	const fees = [
		0,
		-0,
		99,
		100,
		1.5,
		240_000,
		50_000_000,
		100_000_000,
		100_000_001,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];

	const bounds = [
		0,
		-0,
		-1,
		1.5,
		99,
		100,
		240_000,
		480_000,
		100_000_100,
		300_000_000,
		Number.MAX_SAFE_INTEGER,
		Number.MAX_SAFE_INTEGER + 2,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];

	const acrossFields: RawValue[] = Array.from({ length: 2500 }, () => {
		const terms = {
			...random.pick([base, full]),
			milestones: Array.from({ length: 1 + random.below(4) }, () => ({
				...milestone,
				feeCents: random.pick(fees),
			})),
			projectRange: random.chance(0.9)
				? { lowCents: random.pick(bounds), highCents: random.pick(bounds) }
				: undefined,
		};

		return random.chance(0.2)
			? { ...terms, outcome: random.pick(["", "x".repeat(121), "a\nb"]) }
			: terms;
	});

	// Bodies no generator above builds: fields inherited from a prototype (Zod read `data[key]`, which finds them), no
	// prototype at all, an optional key given as undefined (Zod kept the key), boxed values, a list with an extra
	// property, and an object that looks like a promise (Zod refused it as one).
	const odd: RawValue[] = [
		Object.create(base),
		Object.create(full),
		Object.assign(Object.create(null), full),
		{ ...base, projectRange: undefined },
		{ ...full, milestones: [{ ...milestone, checkpoint: undefined }] },
		{ ...base, outcome: new String("Onboarding") },
		{ ...base, milestones: [{ ...milestone, feeCents: new Number(240_000) }] },
		{ ...base, milestones: Object.assign([milestone], { extra: 1 }) },
		{ ...base, then: () => undefined, catch: () => undefined },
		{ ...base, then: 5 },
	];

	const inputs: RawValue[] = [
		...bodies([base, full], pools, 20261127, 10000),
		...acrossFields,
		...odd,
	];

	/** Every sentence the terms can give, so the inputs are shown to reach each check. */
	const sentences = [
		"This answer is required.",
		"Keep this under 80 characters.",
		"Keep this under 120 characters.",
		"Keep this under 200 characters.",
		"Keep this under 300 characters.",
		"Keep this under 500 characters.",
		"Keep this under 1000 characters.",
		"Remove control characters.",
		"Use one line.",
		"Use whole cents.",
		"The fee must be at least $1.",
		"The amount must be $1,000,000 or less.",
		"Use a non-negative amount.",
		"Use a safe whole-cent amount.",
		"Add at least one line.",
		"Add no more than 8 lines.",
		"Add no more than 5 lines.",
		"Add at least one milestone.",
		"Add no more than 3 milestones.",
		"Use a whole percentage.",
		"Use a percentage from 51 to 95.",
		"Choose a payment mode.",
		"The high estimate must be at least the low estimate.",
		"The estimate must be at least the offer total.",
		"Each deliverable needs to be different.",
	];

	/** An answer in one line: the value exactly (an undefined key and -0 kept, keys in order), or every error in order. */
	const said = (answer: Answer) =>
		answer.ok
			? `ok ${exactly(answer.value)}`
			: JSON.stringify(["errors", Object.entries(answer.errors)]);

	it("answers validateOfferTerms as the Zod version did: the decision, the value exactly, and every error in order", () => {
		const outcomes = {
			accepted: 0,
			kinds: new Set<string>(),
			sentences: new Set<string>(),
		};

		const found = differential(
			(input: RawValue): Answer => legacyValidateOfferTerms(input),
			(input: RawValue): Answer => validateOfferTerms(input),
			said,
			(answer) => {
				if (answer.ok) outcomes.accepted += 1;
				else {
					outcomes.kinds.add(JSON.stringify(Object.entries(answer.errors)));

					for (const sentence of Object.values(answer.errors))
						outcomes.sentences.add(sentence);
				}
			},
		);

		for (const input of inputs) found.run(input);

		expect(outcomes.accepted).toBeGreaterThan(500);
		expect(outcomes.kinds.size).toBeGreaterThan(1000);
		expect([...outcomes.sentences].sort()).toEqual([...sentences].sort());
		expect(found.count).toBeGreaterThan(18000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`validateOfferTerms differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 120_000);

	it("reads stored terms as Zod's parse did: the same value, or a throw the routes and the failure log treat the same", () => {
		const outcomes = { read: 0, failed: 0 };

		const found = differential(
			(json: string) =>
				storedRead(() => legacyOfferTermsSchema.parse(JSON.parse(json))),
			(json: string) => storedRead(() => projectTerms({ terms_json: json })),
			(answer) =>
				answer.ok
					? `ok ${exactly(answer.value)}`
					: `threw ${JSON.stringify(answer.failed)}`,
			(answer) => {
				if (answer.ok) outcomes.read += 1;
				else outcomes.failed += 1;
			},
		);

		for (const input of inputs) {
			const json = storedJson(input);

			if (json !== undefined) found.run(json);
		}

		expect(outcomes.read).toBeGreaterThan(500);
		expect(outcomes.failed).toBeGreaterThan(10000);
		expect(found.count).toBeGreaterThan(18000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`stored offer terms differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 120_000);

	it("shows a client the same terms of a sent offer, or none, as the Zod schema did", () => {
		const request = partial<OwnerRequest>({
			name: "Alex",
			details: {},
			serviceId: "workflow",
		});

		const found = differential(
			(json: string): Answer => {
				const read = legacyOfferTermsSchema.safeParse(JSON.parse(json));

				return read.success
					? { ok: true, value: read.data }
					: { ok: false, errors: {} };
			},
			(json: string): Answer => {
				const offer = clientOffer(
					request,
					partial<SoftwareOffer>({
						version: 1,
						status: "sent",
						terms_json: json,
					}),
				);

				return offer
					? { ok: true, value: offer.terms }
					: { ok: false, errors: {} };
			},
			said,
		);

		for (const input of inputs) {
			const json = storedJson(input);

			if (json !== undefined) found.run(json);
		}

		expect(found.count).toBeGreaterThan(18000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`clientOffer differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 120_000);

	it("finds every issue the Zod schema found under validateOfferTerms' error map, path and sentence, in order", () => {
		// Each issue is its own entry, so two issues on one path (which validateOfferTerms folds into the last) both show.
		// A path is compared joined with ".", as every reader of it joins it: the check across fields names
		// "projectRange.highCents" as one step where Zod named two.
		const listed = (issues: Issues) =>
			Object.fromEntries(
				issues.map((issue, index) => [
					String(index),
					JSON.stringify([issue.path.join("."), issue.message]),
				]),
			);

		const found = differential(
			(input: RawValue): Answer => {
				const read = legacyOfferTermsSchema.safeParse(input, {
					errorMap: (issue) => ({
						message:
							issue.path[0] === "paymentMode"
								? "Choose a payment mode."
								: "This answer is required.",
					}),
				});

				return read.success
					? { ok: true, value: read.data }
					: { ok: false, errors: listed(read.error.issues) };
			},
			(input: RawValue): Answer => {
				const read = readOfferTerms(input);

				return read.ok
					? { ok: true, value: read.value }
					: { ok: false, errors: listed(read.issues) };
			},
			said,
		);

		for (const input of inputs) found.run(input);

		expect(found.count).toBeGreaterThan(18000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`offer terms issues differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 120_000);

	it("parses any value, not only stored JSON, as Zod's parse did: the same value, or a throw treated the same", () => {
		const found = differential(
			(input: RawValue) =>
				storedRead(() => legacyOfferTermsSchema.parse(input)),
			(input: RawValue) => storedRead(() => parseOfferTerms(input)),
			(answer) =>
				answer.ok
					? `ok ${exactly(answer.value)}`
					: `threw ${JSON.stringify(answer.failed)}`,
		);

		for (const input of inputs) found.run(input);

		expect(found.count).toBeGreaterThan(18000);
		expect(take(found)).toEqual(noMismatch(found));
		console.info(
			`parseOfferTerms differential: ${found.count} inputs, ${found.mismatches.length} differences`,
		);
	}, 120_000);
});
