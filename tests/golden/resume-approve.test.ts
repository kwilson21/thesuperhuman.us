import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "~/pages/api/resume-approve";
import {
	type Case,
	type Responder,
	type Seed,
	expectRecorded,
	freeze,
	ok,
	record,
	settleFixture,
	status,
	thaw,
	throws,
} from "./recorder";
import type { JsonObject } from "../helpers/json";

// The golden corpus for GET /api/resume-approve: what the route answered, and every outside effect it made, before it
// was converted to Effect. See recorder.ts. The fixture (fixtures/resume-approve.json) is written only with UPDATE_GOLDEN=1.

const BASE = "https://thesuperhuman.us/api/resume-approve";

const get = (query: string) => ({ url: `${BASE}${query}`, method: "GET" });

const stored = (extra: JsonObject = {}) =>
	JSON.stringify({
		name: "Grace Hopper",
		email: "grace@example.com",
		company: "Navy",
		audience: "general",
		note: "",
		ts: 1_700_000_000_000,
		...extra,
	});

const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 200, 255, 0])
	.buffer;

const withRequest = (extra: JsonObject = {}): Seed => ({
	"req:abc": stored(extra),
});

const withPdfs = (...audiences: string[]): Seed =>
	Object.fromEntries(audiences.map((a) => [`pdf:${a}`, PDF]));

const resend =
	(answer: ReturnType<typeof ok>): Responder =>
	() =>
		answer;

const cases: Case[] = [
	{
		name: "an approved general request",
		steps: [get("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an approved legacy dod request",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: { ...withRequest({ audience: "dod" }), ...withPdfs("dod") },
		},
	},
	{
		name: "a link used twice",
		steps: [get("?id=abc"), get("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an approved request with other query parameters",
		steps: [get("?foo=1&id=abc&id=other")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an approved request with a url-encoded id",
		steps: [get("?id=a%62c")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "a name and address with HTML characters",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({ name: '<i>G</i> & "Co"', email: "g+x@example.com" }),
				...withPdfs("general"),
			},
		},
	},
	{
		name: "a request from a preview host",
		steps: [
			{
				url: "https://abc.thesuperhuman-us.pages.dev/api/resume-approve?id=abc",
				method: "GET",
			},
		],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},

	// The id.
	{ name: "no id parameter", steps: [get("")] },
	{ name: "an empty id parameter", steps: [get("?id=")] },
	{ name: "an id with no stored request", steps: [get("?id=unknown")] },
	{
		name: "an id that looks like a path",
		steps: [get("?id=../pdf:general")],
		resumeStore: { seed: withPdfs("general") },
	},
	{
		name: "an expired request (no longer stored)",
		steps: [get("?id=abc")],
		resumeStore: { seed: withPdfs("general") },
	},
	{
		name: "a stored request that is not JSON",
		steps: [get("?id=abc")],
		resumeStore: { seed: { "req:abc": "not json" } },
	},
	{
		name: "a stored request that is JSON null",
		steps: [get("?id=abc")],
		resumeStore: { seed: { "req:abc": "null", ...withPdfs("general") } },
	},
	{
		name: "a stored request with an empty string",
		steps: [get("?id=abc")],
		resumeStore: { seed: { "req:abc": "" } },
	},
	{
		name: "a stored request with an unknown audience",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: { ...withRequest({ audience: "sales" }), ...withPdfs("general") },
		},
	},
	{
		name: "a stored request with no audience",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: {
				"req:abc": JSON.stringify({ name: "G", email: "g@example.com" }),
				...withPdfs("general"),
			},
		},
	},
	{
		name: "a stored request with no name",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: {
				"req:abc": JSON.stringify({
					email: "g@example.com",
					audience: "general",
				}),
				...withPdfs("general"),
			},
		},
	},

	// The PDF.
	{
		name: "the general resume is not in storage",
		steps: [get("?id=abc")],
		resumeStore: { seed: withRequest() },
	},
	{
		name: "the dod resume is not in storage",
		steps: [get("?id=abc")],
		resumeStore: { seed: withRequest({ audience: "dod" }) },
	},
	{
		name: "only the other resume is in storage",
		steps: [get("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("dod") } },
	},
	{
		name: "the stored PDF is empty",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: { ...withRequest(), "pdf:general": new ArrayBuffer(0) },
		},
	},
	{
		name: "the stored PDF is large",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest(),
				"pdf:general": new Uint8Array(70_000).fill(65).buffer,
			},
		},
	},

	// Mail.
	{
		name: "the delivery is refused with 400",
		steps: [get("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: resend(status(400)),
	},
	{
		name: "the delivery fails with 500",
		steps: [get("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: resend(status(500)),
	},
	{
		name: "the delivery cannot be sent",
		steps: [get("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: resend(throws()),
	},
	{
		name: "a failed delivery can be tried again",
		steps: [get("?id=abc"), get("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: ({ n }) => (n === 0 ? status(500) : ok({ id: "em_1" })),
	},
	{
		name: "the Resend key is not set",
		steps: [get("?id=abc")],
		omit: ["RESEND_API_KEY"],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "the sender address is not set",
		steps: [get("?id=abc")],
		omit: ["CONTACT_FROM_EMAIL"],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},

	// Storage failures.
	{
		name: "the resume store is not bound",
		steps: [get("?id=abc")],
		resumeStore: { missing: true },
	},
	{
		name: "the resume store is not bound and there is no id",
		steps: [get("")],
		resumeStore: { missing: true },
	},
	{
		name: "the stored request cannot be read",
		steps: [get("?id=abc")],
		resumeStore: { fails: { get: true } },
	},
	{
		name: "the request cannot be deleted after it is sent",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: { ...withRequest(), ...withPdfs("general") },
			fails: { delete: true },
		},
	},

	// Methods and the rest.
	{
		name: "a POST with an id",
		steps: [{ url: `${BASE}?id=abc`, method: "POST", body: "{}" }],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "a request with a fragment-like id",
		steps: [get("?id=abc%23x")],
		resumeStore: { seed: { "req:abc#x": stored(), ...withPdfs("general") } },
	},
	{
		name: "a stored request with a very long note and company",
		steps: [get("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({ note: "n".repeat(1000), company: "c".repeat(120) }),
				...withPdfs("general"),
			},
		},
	},
	{
		name: "an id of one character",
		steps: [get("?id=x")],
		resumeStore: { seed: { "req:x": stored(), ...withPdfs("general") } },
	},
	{
		name: "an id with spaces",
		steps: [get("?id=a%20b")],
		resumeStore: { seed: { "req:a b": stored(), ...withPdfs("general") } },
	},
	{
		name: "an id given twice uses the first",
		steps: [get("?id=abc&id=zzz")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an uppercase id differs from the stored one",
		steps: [get("?id=ABC")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "two different links, each used once",
		steps: [get("?id=abc"), get("?id=def")],
		resumeStore: {
			seed: {
				...withRequest(),
				"req:def": stored({ email: "other@example.com", name: "Other" }),
				...withPdfs("general"),
			},
		},
	},
];

beforeEach(freeze);

afterEach(thaw);

afterAll(() =>
	settleFixture(
		"resume-approve",
		cases.map((c) => c.name),
	),
);

describe("golden: GET /api/resume-approve", () => {
	it("covers at least 40 requests", () => {
		expect(cases.length).toBeGreaterThanOrEqual(40);
		expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
	});

	for (const c of cases) {
		it(`answers ${c.name} as recorded`, async () => {
			expectRecorded("resume-approve", await record(GET, c));
		});
	}
});
