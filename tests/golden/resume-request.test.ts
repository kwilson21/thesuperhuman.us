import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "~/pages/api/resume-request";
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

// The golden corpus for POST /api/resume-request: what the route answered, and every outside effect it made, before it
// was converted to Effect. See recorder.ts. The fixture (fixtures/resume-request.json) is written only with UPDATE_GOLDEN=1.

const URL_ = "https://thesuperhuman.us/api/resume-request";

const good = {
	name: "Grace Hopper",
	email: "grace@example.com",
	company: "Navy",
	audience: "general",
	note: "For the open role.",
	turnstileToken: "token-1",
};

const send = (
	body: JsonObject | JsonValue,
	headers: Record<string, string> = {},
	url = URL_,
): Step => ({
	url,
	headers: {
		"content-type": "application/json",
		origin: "https://thesuperhuman.us",
		"cf-connecting-ip": "203.0.113.7",
		...headers,
	},
	body: JSON.stringify(body),
});

const raw = (text: string): Step => ({ ...send(null), body: text });

const bodyCase = (name: string, body: JsonObject | JsonValue): Case => ({
	name,
	steps: [send(body)],
});

const turnstile =
	(answer: ReturnType<typeof ok>): Responder =>
	({ host }) =>
		host === "turnstile" ? answer : ok({ id: "em_1" });

const resend =
	(answer: ReturnType<typeof ok>): Responder =>
	({ host }) =>
		host === "turnstile" ? ok({ success: true }) : answer;

const cases: Case[] = [
	{ name: "a valid request", steps: [send(good)] },
	{
		name: "a valid request with no company and no note",
		steps: [send({ ...good, company: undefined, note: undefined })],
	},
	{
		name: "every text field has whitespace around it",
		steps: [
			send({
				...good,
				name: "  Grace  ",
				email: " grace@example.com ",
				company: " Navy ",
				audience: " general ",
				note: "  hi  ",
				turnstileToken: " t ",
			}),
		],
	},
	{
		name: "extra keys in the body are ignored",
		steps: [send({ ...good, admin: true })],
	},
	{
		name: "a note of exactly 1000 characters",
		steps: [send({ ...good, note: "n".repeat(1000) })],
	},
	{
		name: "a request from a Pages preview takes its approval link from that origin",
		steps: [
			send(
				good,
				{ origin: "https://abc-123.thesuperhuman-us.pages.dev" },
				"https://abc-123.thesuperhuman-us.pages.dev/api/resume-request",
			),
		],
	},
	{
		name: "a request whose URL origin differs from its Origin header",
		steps: [send(good, {}, "https://www.thesuperhuman.us/api/resume-request")],
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
		name: "a nested Pages preview origin",
		steps: [send(good, { origin: "https://a.b.thesuperhuman-us.pages.dev" })],
	},
	{
		name: "the plain http origin",
		steps: [send(good, { origin: "http://thesuperhuman.us" })],
	},
	{
		name: "a wrong origin and an invalid body",
		steps: [send({ name: "" }, { origin: "https://evil.example.com" })],
	},
	{
		name: "a content type that is not JSON still parses",
		steps: [send(good, { "content-type": "text/plain" })],
	},

	// Bodies that are not objects.
	{ name: "text that is not JSON", steps: [raw("not json")] },
	{ name: "an empty body", steps: [raw("")] },
	bodyCase("a null body", null),
	bodyCase("an array body", []),
	bodyCase("a string body", "hello"),
	bodyCase("a number body", 42),
	bodyCase("a boolean body", false),
	bodyCase("an empty object body", {}),

	// Fields.
	bodyCase("name missing", { ...good, name: undefined }),
	bodyCase("name only whitespace", { ...good, name: "   " }),
	bodyCase("name 101 characters", { ...good, name: "n".repeat(101) }),
	bodyCase("name a number", { ...good, name: 5 }),
	bodyCase("email missing", { ...good, email: undefined }),
	bodyCase("email without a domain", { ...good, email: "grace@" }),
	bodyCase("email 121 characters", {
		...good,
		email: `${"e".repeat(117)}@x.co`,
	}),
	bodyCase("email null", { ...good, email: null }),
	bodyCase("company 121 characters", { ...good, company: "c".repeat(121) }),
	bodyCase("company an array", { ...good, company: ["a"] }),
	bodyCase("audience missing", { ...good, audience: undefined }),
	bodyCase("audience empty", { ...good, audience: "" }),
	bodyCase("audience dod", { ...good, audience: "dod" }),
	bodyCase("audience sales", { ...good, audience: "sales" }),
	bodyCase("audience in capitals", { ...good, audience: "General" }),
	bodyCase("audience a number", { ...good, audience: 1 }),
	bodyCase("note 1001 characters", { ...good, note: "n".repeat(1001) }),
	bodyCase("note an object", { ...good, note: {} }),
	bodyCase("token missing", { ...good, turnstileToken: undefined }),
	bodyCase("token empty", { ...good, turnstileToken: "" }),
	bodyCase("token only whitespace", { ...good, turnstileToken: "  " }),
	bodyCase("every field wrong", {
		name: "",
		email: "x",
		company: "c".repeat(200),
		audience: "x",
		note: "n".repeat(2000),
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

	// Storage and mail.
	{
		name: "the resume store fails to write",
		steps: [send(good)],
		resumeStore: { fails: { put: true } },
	},
	{
		name: "the resume store is not bound",
		steps: [send(good)],
		resumeStore: { missing: true },
	},
	{
		name: "the approval email is refused with 400",
		steps: [send(good)],
		fetches: resend(status(400)),
	},
	{
		name: "the approval email fails with 500",
		steps: [send(good)],
		fetches: resend(status(500)),
	},
	{
		name: "the approval email cannot be sent",
		steps: [send(good)],
		fetches: resend(throws()),
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
		name: "a request with HTML and a new line in the note",
		steps: [send({ ...good, name: "<b>G</b>", note: "line one\nline two" })],
	},
];

beforeEach(freeze);

afterEach(thaw);

afterAll(() =>
	settleFixture(
		"resume-request",
		cases.map((c) => c.name),
	),
);

describe("golden: POST /api/resume-request", () => {
	it("covers at least 40 requests", () => {
		expect(cases.length).toBeGreaterThanOrEqual(40);
		expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
	});

	for (const c of cases) {
		it(`answers ${c.name} as recorded`, async () => {
			expectRecorded("resume-request", await record(POST, c));
		});
	}
});
