import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "~/pages/api/contact";
import {
	type Case,
	type Responder,
	type Step,
	expectRecorded,
	freeze,
	ok,
	record,
	settleFixture,
	status,
	thaw,
	throws,
	unreadable,
} from "./recorder";
import type { JsonObject, JsonValue } from "../helpers/json";

// The golden corpus for POST /api/contact: what the route answered, and every outside effect it made, before it was
// converted to Effect. See recorder.ts. The fixture (fixtures/contact.json) is written only with UPDATE_GOLDEN=1.

const URL_ = "https://thesuperhuman.us/api/contact";

const good = {
	name: "Ada Lovelace",
	email: "ada@example.com",
	company: "Analytical Engines",
	description: "I would like to talk about a project.",
	turnstileToken: "token-1",
};

const send = (
	body: JsonObject | JsonValue,
	headers: Record<string, string> = {},
): Step => ({
	url: URL_,
	headers: {
		"content-type": "application/json",
		origin: "https://thesuperhuman.us",
		"cf-connecting-ip": "203.0.113.7",
		...headers,
	},
	body: JSON.stringify(body),
});

const raw = (text: string, headers: Record<string, string> = {}): Step => ({
	...send(null, headers),
	body: text,
});

const bodyCase = (name: string, body: JsonObject | JsonValue): Case => ({
	name,
	steps: [send(body)],
});

/** Turnstile answers as given; Resend sends. */
const turnstile =
	(answer: ReturnType<typeof ok>): Responder =>
	({ host }) =>
		host === "turnstile" ? answer : ok({ id: "em_1" });

/** Turnstile passes; Resend answers each call as the list says (the last answer repeats). */
const resend =
	(...answers: ReturnType<typeof ok>[]): Responder =>
	({ host, n }) =>
		host === "turnstile"
			? ok({ success: true })
			: (answers[n] ?? answers[answers.length - 1] ?? ok());

const cases: Case[] = [
	{ name: "a valid message", steps: [send(good)] },
	{
		name: "a valid message with no company",
		steps: [send({ ...good, company: undefined })],
	},
	{
		name: "a valid message with an empty company",
		steps: [send({ ...good, company: "" })],
	},
	{
		name: "every text field has whitespace around it",
		steps: [
			send({
				name: "  Ada  ",
				email: "  ada@example.com  ",
				company: "  Acme  ",
				description: "  Hello  ",
				turnstileToken: "  token  ",
			}),
		],
	},
	{
		name: "extra keys in the body are ignored",
		steps: [send({ ...good, admin: true })],
	},
	{
		name: "a message of exactly 4000 characters",
		steps: [send({ ...good, description: "d".repeat(4000) })],
	},

	// Origin.
	{
		name: "no Origin header",
		steps: [
			{
				url: URL_,
				headers: { "content-type": "application/json" },
				body: JSON.stringify(good),
			},
		],
	},
	{
		name: "an Origin that is another site",
		steps: [send(good, { origin: "https://evil.example.com" })],
	},
	{
		name: "the www origin",
		steps: [send(good, { origin: "https://www.thesuperhuman.us" })],
	},
	{
		name: "a Pages preview origin",
		steps: [
			send(good, { origin: "https://abc-123.thesuperhuman-us.pages.dev" }),
		],
	},
	{
		name: "a nested Pages preview origin",
		steps: [send(good, { origin: "https://a.b.thesuperhuman-us.pages.dev" })],
	},
	{
		name: "the plain http origin",
		steps: [send(good, { origin: "http://thesuperhuman.us" })],
	},
	{
		name: "an origin with a trailing slash",
		steps: [send(good, { origin: "https://thesuperhuman.us/" })],
	},
	{
		name: "a wrong origin and an invalid body",
		steps: [send({ name: "" }, { origin: "https://evil.example.com" })],
	},
	{
		name: "a content type that is not JSON still parses",
		steps: [send(good, { "content-type": "text/plain" })],
	},
	{
		name: "no content type still parses",
		steps: [
			{
				url: URL_,
				headers: {
					origin: "https://thesuperhuman.us",
					"cf-connecting-ip": "203.0.113.7",
				},
				body: JSON.stringify(good),
			},
		],
	},

	// Bodies that are not objects.
	{ name: "text that is not JSON", steps: [raw("not json")] },
	{ name: "an empty body", steps: [raw("")] },
	bodyCase("a null body", null),
	bodyCase("an array body", []),
	bodyCase("an array with a string", ["a"]),
	bodyCase("a string body", "hello"),
	bodyCase("a number body", 42),
	bodyCase("a boolean body", true),
	bodyCase("an empty object body", {}),

	// Fields.
	bodyCase("name missing", { ...good, name: undefined }),
	bodyCase("name empty", { ...good, name: "" }),
	bodyCase("name only whitespace", { ...good, name: "   " }),
	bodyCase("name 101 characters", { ...good, name: "n".repeat(101) }),
	bodyCase("name a number", { ...good, name: 5 }),
	bodyCase("name null", { ...good, name: null }),
	bodyCase("email missing", { ...good, email: undefined }),
	bodyCase("email without a domain", { ...good, email: "ada@" }),
	bodyCase("email with a space", { ...good, email: "a da@example.com" }),
	bodyCase("email 121 characters", {
		...good,
		email: `${"e".repeat(117)}@x.co`,
	}),
	bodyCase("email an array", { ...good, email: ["a@b.co"] }),
	bodyCase("company 121 characters", { ...good, company: "c".repeat(121) }),
	bodyCase("company an object", { ...good, company: { a: 1 } }),
	bodyCase("description missing", { ...good, description: undefined }),
	bodyCase("description only whitespace", { ...good, description: "\n\t " }),
	bodyCase("description 4001 characters", {
		...good,
		description: "d".repeat(4001),
	}),
	bodyCase("token missing", { ...good, turnstileToken: undefined }),
	bodyCase("token empty", { ...good, turnstileToken: "" }),
	bodyCase("token only whitespace", { ...good, turnstileToken: "   " }),
	bodyCase("token a boolean", { ...good, turnstileToken: true }),
	bodyCase("every field wrong", {
		name: "",
		email: "x",
		company: "c".repeat(200),
		description: "",
		turnstileToken: "",
	}),

	// Rate limit.
	{ name: "the same address twice", steps: [send(good), send(good)] },
	{
		name: "a different address after the first",
		steps: [send(good), send(good, { "cf-connecting-ip": "203.0.113.8" })],
	},
	{
		name: "an address already counted",
		steps: [send(good)],
		rateLimit: { seed: { "rl:203.0.113.7": "1" } },
	},
	{
		name: "a stored count that is not a number",
		steps: [send(good)],
		rateLimit: { seed: { "rl:203.0.113.7": "abc" } },
	},
	{
		name: "a stored count of zero",
		steps: [send(good)],
		rateLimit: { seed: { "rl:203.0.113.7": "0" } },
	},
	{
		name: "no cf-connecting-ip header",
		steps: [
			{
				url: URL_,
				headers: { origin: "https://thesuperhuman.us" },
				body: JSON.stringify(good),
			},
		],
	},
	{
		name: "an invalid body does not count against the limit",
		steps: [send({ ...good, name: "" }), send(good)],
	},
	{
		name: "the rate limit store fails to read",
		steps: [send(good)],
		rateLimit: { fails: { get: true } },
	},
	{
		name: "the rate limit store fails to write",
		steps: [send(good)],
		rateLimit: { fails: { put: true } },
	},
	{
		name: "the rate limit store is not bound",
		steps: [send(good)],
		rateLimit: { missing: true },
	},
	{
		name: "the rate limit store is not bound and the body is invalid",
		steps: [send({ ...good, name: "" })],
		rateLimit: { missing: true },
	},

	// Turnstile.
	{
		name: "Turnstile says no",
		steps: [send(good)],
		fetches: turnstile(ok({ success: false })),
	},
	{
		name: "Turnstile answers success as text",
		steps: [send(good)],
		fetches: turnstile(ok({ success: "true" })),
	},
	{
		name: "Turnstile answers something without success",
		steps: [send(good)],
		fetches: turnstile(ok({ other: 1 })),
	},
	{
		name: "Turnstile answers null",
		steps: [send(good)],
		fetches: turnstile(ok(null)),
	},
	{
		name: "Turnstile answers an error status",
		steps: [send(good)],
		fetches: turnstile(status(500, { success: true })),
	},
	{
		name: "Turnstile answers unreadable JSON",
		steps: [send(good)],
		fetches: turnstile(unreadable()),
	},
	{
		name: "Turnstile cannot be reached",
		steps: [send(good)],
		fetches: turnstile(throws()),
	},
	{
		name: "the Turnstile secret is not set",
		steps: [send(good)],
		omit: ["TURNSTILE_SECRET_KEY"],
	},
	{
		name: "Turnstile fails and then the same address tries again",
		steps: [send(good), send(good)],
		fetches: turnstile(ok({ success: false })),
	},

	// Mail.
	{
		name: "the owner email is refused with 400",
		steps: [send(good)],
		fetches: resend(status(400)),
	},
	{
		name: "the owner email fails with 500",
		steps: [send(good)],
		fetches: resend(status(500)),
	},
	{
		name: "the owner email cannot be sent",
		steps: [send(good)],
		fetches: resend(throws()),
	},
	{
		name: "the owner email goes and the reply is refused",
		steps: [send(good)],
		fetches: resend(ok(), status(422)),
	},
	{
		name: "the owner email goes and the reply cannot be sent",
		steps: [send(good)],
		fetches: resend(ok(), throws()),
	},
	{
		name: "the Resend key is not set",
		steps: [send(good)],
		omit: ["RESEND_API_KEY"],
	},
	{
		name: "the owner address is not set",
		steps: [send(good)],
		omit: ["CONTACT_TO_EMAIL"],
	},
	{
		name: "the sender address is not set",
		steps: [send(good)],
		omit: ["CONTACT_FROM_EMAIL"],
	},
	{
		name: "a message with a long company and long text",
		steps: [
			send({
				...good,
				company: "c".repeat(120),
				description: "line one\nline two",
			}),
		],
	},
	{
		name: "a message with HTML in the name",
		steps: [send({ ...good, name: "<b>Ada</b> & Co" })],
	},
];

beforeEach(freeze);

afterEach(thaw);

afterAll(() =>
	settleFixture(
		"contact",
		cases.map((c) => c.name),
	),
);

describe("golden: POST /api/contact", () => {
	it("covers at least 40 requests", () => {
		expect(cases.length).toBeGreaterThanOrEqual(40);
		expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
	});

	for (const c of cases) {
		it(`answers ${c.name} as recorded`, async () => {
			expectRecorded("contact", await record(POST, c));
		});
	}
});
