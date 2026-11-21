import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "~/pages/api/resume-approve";
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

// The golden corpus for explicit POST /api/resume-approve approvals. The fixture records the prior delivery behavior
// for the existing edge cases, now submitted through the deliberate same-origin confirmation form.
//
// The fixture was re-recorded once, from the route on main after PR #245 (the route before the conversion, with escaping
// of visitor text on the three pages). Against the unescaped recording only bodies that show a name, an address or an
// audience containing & < > " or \' differ, by escaping alone; the one other change is a stored request with no audience,
// which main's fix now throws on (an unanswered 500) where the unescaped route printed "pdf:undefined" on a 500 page.

const BASE = "https://thesuperhuman.us/api/resume-approve";

const approve = (query: string) => {
	const requested = new URL(
		query.startsWith("http") ? query : `${BASE}${query}`,
	);

	const id = requested.searchParams.get("id") ?? "";

	return {
		url: requested.origin + requested.pathname,
		method: "POST",
		headers: {
			origin: requested.origin,
			"content-type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({ id }).toString(),
	};
};

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
		steps: [approve("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an approved legacy dod request",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: { ...withRequest({ audience: "dod" }), ...withPdfs("dod") },
		},
	},
	{
		name: "a link used twice",
		steps: [approve("?id=abc"), approve("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an approved request with other query parameters",
		steps: [approve("?foo=1&id=abc&id=other")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an approved request with a url-encoded id",
		steps: [approve("?id=a%62c")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "a name and address with HTML characters",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({ name: '<i>G</i> & "Co"', email: "g+x@example.com" }),
				...withPdfs("general"),
			},
		},
	},
	{
		name: "an approved request with markup in the name and address",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({
					name: "<img src=x onerror=alert(1)>",
					email: "<svg/onload=alert(1)>@x.co",
				}),
				...withPdfs("general"),
			},
		},
	},
	{
		name: "a refused delivery for a request with markup in the name and address",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({
					name: "<img src=x onerror=alert(1)>",
					email: "<svg/onload=alert(1)>@x.co",
				}),
				...withPdfs("general"),
			},
		},
		fetches: resend(status(400)),
	},
	{
		name: "a refused delivery for a name with an apostrophe, an ampersand and quotes",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({ name: `O'Neil & "Sons" <ops>` }),
				...withPdfs("general"),
			},
		},
		fetches: resend(status(400)),
	},
	{
		name: "an approved request whose stored audience has markup",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({
					name: "<img src=x onerror=alert(1)>",
					email: "<svg/onload=alert(1)>@x.co",
					audience: "<b>dod</b>",
				}),
				"pdf:<b>dod</b>": PDF,
			},
		},
	},
	{
		name: "a request whose stored audience has markup and whose resume is not in storage",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: withRequest({
				name: "<img src=x onerror=alert(1)>",
				email: "<svg/onload=alert(1)>@x.co",
				audience: "<b>dod</b>",
			}),
		},
	},
	{
		name: "a request from a preview host",
		steps: [
			approve(
				"https://abc.thesuperhuman-us.pages.dev/api/resume-approve?id=abc",
			),
		],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},

	// The id.
	{ name: "no id parameter", steps: [approve("")] },
	{ name: "an empty id parameter", steps: [approve("?id=")] },
	{ name: "an id with no stored request", steps: [approve("?id=unknown")] },
	{
		name: "an id that looks like a path",
		steps: [approve("?id=../pdf:general")],
		resumeStore: { seed: withPdfs("general") },
	},
	{
		name: "an expired request (no longer stored)",
		steps: [approve("?id=abc")],
		resumeStore: { seed: withPdfs("general") },
	},
	{
		name: "a stored request that is not JSON",
		steps: [approve("?id=abc")],
		resumeStore: { seed: { "req:abc": "not json" } },
	},
	{
		name: "a stored request that is JSON null",
		steps: [approve("?id=abc")],
		resumeStore: { seed: { "req:abc": "null", ...withPdfs("general") } },
	},
	{
		name: "a stored request with an empty string",
		steps: [approve("?id=abc")],
		resumeStore: { seed: { "req:abc": "" } },
	},
	{
		name: "a stored request with an unknown audience",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: { ...withRequest({ audience: "sales" }), ...withPdfs("general") },
		},
	},
	{
		name: "a stored request with no audience",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: {
				"req:abc": JSON.stringify({ name: "G", email: "g@example.com" }),
				...withPdfs("general"),
			},
		},
	},
	{
		name: "a stored request with no name",
		steps: [approve("?id=abc")],
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
		steps: [approve("?id=abc")],
		resumeStore: { seed: withRequest() },
	},
	{
		name: "the dod resume is not in storage",
		steps: [approve("?id=abc")],
		resumeStore: { seed: withRequest({ audience: "dod" }) },
	},
	{
		name: "only the other resume is in storage",
		steps: [approve("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("dod") } },
	},
	{
		name: "the stored PDF is empty",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: { ...withRequest(), "pdf:general": new ArrayBuffer(0) },
		},
	},
	{
		name: "the stored PDF is large",
		steps: [approve("?id=abc")],
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
		steps: [approve("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: resend(status(400)),
	},
	{
		name: "the delivery fails with 500",
		steps: [approve("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: resend(status(500)),
	},
	{
		name: "the delivery cannot be sent",
		steps: [approve("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: resend(throws()),
	},
	{
		name: "a failed delivery can be tried again",
		steps: [approve("?id=abc"), approve("?id=abc")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
		fetches: ({ n }) => (n === 0 ? status(500) : ok({ id: "em_1" })),
	},
	{
		name: "the Resend key is not set",
		steps: [approve("?id=abc")],
		omit: ["RESEND_API_KEY"],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "the sender address is not set",
		steps: [approve("?id=abc")],
		omit: ["CONTACT_FROM_EMAIL"],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},

	// Storage failures.
	{
		name: "the resume store is not bound",
		steps: [approve("?id=abc")],
		resumeStore: { missing: true },
	},
	{
		name: "the resume store is not bound and there is no id",
		steps: [approve("")],
		resumeStore: { missing: true },
	},
	{
		name: "the stored request cannot be read",
		steps: [approve("?id=abc")],
		resumeStore: { fails: { get: true } },
	},
	{
		name: "the request cannot be deleted after it is sent",
		steps: [approve("?id=abc")],
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
		steps: [approve("?id=abc%23x")],
		resumeStore: { seed: { "req:abc#x": stored(), ...withPdfs("general") } },
	},
	{
		name: "a stored request with a very long note and company",
		steps: [approve("?id=abc")],
		resumeStore: {
			seed: {
				...withRequest({ note: "n".repeat(1000), company: "c".repeat(120) }),
				...withPdfs("general"),
			},
		},
	},
	{
		name: "an id of one character",
		steps: [approve("?id=x")],
		resumeStore: { seed: { "req:x": stored(), ...withPdfs("general") } },
	},
	{
		name: "an id with spaces",
		steps: [approve("?id=a%20b")],
		resumeStore: { seed: { "req:a b": stored(), ...withPdfs("general") } },
	},
	{
		name: "an id given twice uses the first",
		steps: [approve("?id=abc&id=zzz")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "an uppercase id differs from the stored one",
		steps: [approve("?id=ABC")],
		resumeStore: { seed: { ...withRequest(), ...withPdfs("general") } },
	},
	{
		name: "two different links, each used once",
		steps: [approve("?id=abc"), approve("?id=def")],
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

describe("golden: POST /api/resume-approve", () => {
	it("covers at least 40 requests", () => {
		expect(cases.length).toBeGreaterThanOrEqual(40);
		expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
	});

	for (const c of cases) {
		it(`answers ${c.name} as recorded`, async () => {
			expectRecorded("resume-approve", await record(POST, c));
		});
	}
});
