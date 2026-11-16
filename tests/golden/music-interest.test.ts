import { POST } from "~/pages/api/music-interest";
import type { JsonObject, JsonValue } from "../helpers/json";
import {
	asVisitor,
	defineCorpus,
	json,
	networkDown,
	text,
	type Case,
	type Dump,
	type Step,
} from "./harness";
import {
	allGood,
	IP,
	ORIGIN,
	outside,
	rawVisit,
	resend,
	visit,
} from "./areas/public";

// The golden corpus for POST /api/music-interest: a listener says they want a release (the song, merchandise or both).
// The route validates the body, checks the release against the real catalog (src/content: one release,
// "old-news-single", reached here through the astro:content test alias), counts the address's attempts, verifies the Turnstile
// challenge, counts the address's allowance, then upserts the interest and opens one owner request per kind in a single batch. A failed write clears the
// address's counter and sends the urgent owner alert.
//
// Every response branch, and the cases that reach it:
//
//   musicRequest (src/lib/music-request.ts, 8192-byte limit)
//   403 Forbidden                       no Origin, another site, www, http, trailing slash
//   415 JSON required                   text/plain, no content type, form content type, "application/json; charset" is fine
//   400 Missing request                 no body at all
//   413 Request too large               over 8192 bytes (cancelled mid-read), exactly at the limit is read
//   400 Invalid JSON                    broken text, empty body
//   400 { errors }  interestSchema      every field missing, wrong type, malformed, too long; consent false; the token
//                                       empty; a song with merchandise or a suggestion; an unknown merchandise kind; five
//                                       merchandise kinds; a body that is null, a list or a string (the "_form" key)
//   404 { ok: false }                   an unknown release id, the release's slug (not its id), a hidden-looking id
//   503 "could not be saved"            no MUSIC_DB, no RATE_LIMIT, no Turnstile secret (after the 404 check, so an
//                                       unknown release with a missing binding is still 404)
//   500 "could not be saved"            KV read or write throws; a failed write (batch throws), whose cleanup either
//                                       finishes or throws (the alert is sent either way)
//   429 limit                           the address already has a count, a count that is not a number, KV count high
//   403 Turnstile                       refused, 5xx, network down, malformed answer, success sent as text
//   200 { ok: true }                    song, merchandise, both; repeated merchandise choices; the same listener twice
//                                       (an upsert, from two addresses); markup and unicode in free text; mixed-case and
//                                       padded email; a conflicting row that appears just before the batch (a race)
//
//   effects after a failed write
//   rate counter                        deleted before the alert; a delete that throws does not skip the alert
//   urgent owner alert                  sent, refused 400, 5xx, network down, no key, no sender, no owner address
//
//   sequences                           the same listener changes their mind; two listeners; a retry after a storage failure
//                                       (the failure is injected on the first write only)

const PATH = "/api/music-interest";
const RELEASE = "old-news-single";
const COUNTER = `rl:music-interest:${IP}`;

const good: JsonObject = {
	releaseId: RELEASE,
	email: "Fan@Example.com",
	interest: "both",
	merchandise: ["shirts", "stickers"],
	suggestion: "Please make hoodies",
	cityRegion: "Roanoke, VA",
	consent: true,
	turnstileToken: "token-1",
};

const FINAL: Dump = {
	music: ["music_interest", "owner_requests", "owner_request_audit"],
	kv: ["RATE_LIMIT"],
};

const send = (body: JsonValue | undefined, over: Partial<Step> = {}): Step =>
	visit(PATH, body, over);

const single = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({
	name,
	steps: [send(body, over)],
	fetches: allGood,
	final: FINAL,
	...extra,
});

const withBody = (
	name: string,
	change: JsonObject,
	extra: Partial<Case> = {},
) => single(name, { ...good, ...change }, extra);

const raw = (
	name: string,
	body: string | undefined,
	headers: { [name: string]: string },
	extra: Partial<Case> = {},
): Case => ({
	name,
	steps: [rawVisit(PATH, body, headers)],
	fetches: allGood,
	final: FINAL,
	...extra,
});

const jsonHeaders = { origin: ORIGIN, "content-type": "application/json" };

const writeFails = (message = "d1 down") => ({
	failures: [{ on: /INSERT INTO music_interest/, message }],
});

const cases: Case[] = [
	// musicRequest
	raw("no Origin header", JSON.stringify(good), {
		"content-type": "application/json",
	}),
	raw("another site's Origin", JSON.stringify(good), {
		...jsonHeaders,
		origin: "https://example.com",
	}),
	raw("the www host as Origin", JSON.stringify(good), {
		...jsonHeaders,
		origin: "https://www.thesuperhuman.us",
	}),
	raw("an http Origin", JSON.stringify(good), {
		...jsonHeaders,
		origin: "http://thesuperhuman.us",
	}),
	raw("a text/plain body", JSON.stringify(good), {
		origin: ORIGIN,
		"content-type": "text/plain",
	}),
	raw("no content type", JSON.stringify(good), { origin: ORIGIN }),
	raw("a form content type", "a=1", {
		origin: ORIGIN,
		"content-type": "application/x-www-form-urlencoded",
	}),
	raw("no body at all", undefined, jsonHeaders),
	raw("an empty body", "", jsonHeaders),
	raw("broken JSON", '{"releaseId":', jsonHeaders),
	raw("a JSON content type with a charset is accepted", JSON.stringify(good), {
		origin: ORIGIN,
		"content-type": "application/json; charset=utf-8",
	}),
	single("a body over 8192 bytes", { ...good, padding: "x".repeat(9000) }),

	// the schema
	single("a body that is null", null),
	single("a body that is a list", [1, 2]),
	single("a body that is a string", "hello"),
	single("an empty object", {}),
	withBody("a release id that is not a slug shape", { releaseId: "Old News!" }),
	withBody("no email", { email: undefined }),
	withBody("an email that is not an address", { email: "not-an-email" }),
	withBody("an email over 120 characters", {
		email: `${"a".repeat(120)}@example.com`,
	}),
	withBody("an interest that is not one of the three", { interest: "tickets" }),
	withBody("consent false", { consent: false }),
	withBody("consent as text", { consent: "true" }),
	withBody("an empty Turnstile token", { turnstileToken: "" }),
	withBody("a Turnstile token over 2048 characters", {
		turnstileToken: "t".repeat(2049),
	}),
	withBody("a song interest with merchandise", { interest: "song" }),
	withBody("a song interest with only a suggestion", {
		interest: "song",
		merchandise: [],
	}),
	withBody("an unknown merchandise kind", { merchandise: ["posters"] }),
	withBody("five merchandise kinds", {
		merchandise: ["shirts", "hoodies", "stickers", "digital-art", "shirts"],
	}),
	withBody("a suggestion over 500 characters", { suggestion: "s".repeat(501) }),
	withBody("a city over 120 characters", { cityRegion: "c".repeat(121) }),

	// the catalog
	withBody("an unknown release", { releaseId: "no-such-release" }),
	withBody("the release's slug instead of its id", { releaseId: "old-news" }),
	withBody(
		"an unknown release with no database is still not found",
		{ releaseId: "no-such-release" },
		{ music: { missing: true } },
	),

	// bindings
	withBody("no MUSIC_DB", {}, { music: { missing: true } }),
	withBody("no Turnstile secret", {}, { omit: ["TURNSTILE_SECRET_KEY"] }),
	withBody(
		"no RATE_LIMIT namespace",
		{},
		{ kv: { RATE_LIMIT: { missing: true } } },
	),
	withBody(
		"the rate limit read throws",
		{},
		{ kv: { RATE_LIMIT: { fails: ["get"] } } },
	),
	withBody(
		"the rate limit write throws",
		{},
		{ kv: { RATE_LIMIT: { fails: ["put"] } } },
	),

	// the rate limit
	withBody(
		"the address already sent one",
		{},
		{
			kv: { RATE_LIMIT: { seed: { [COUNTER]: "1" } } },
		},
	),
	withBody(
		"the address count is not a number",
		{},
		{
			kv: { RATE_LIMIT: { seed: { [COUNTER]: "abc" } } },
		},
	),
	withBody(
		"a count from another address does not block this one",
		{},
		{
			kv: { RATE_LIMIT: { seed: { "rl:music-interest:198.51.100.4": "1" } } },
		},
	),
	withBody(
		"the count has run out by the next step",
		{},
		{
			kv: {
				RATE_LIMIT: { seed: { [COUNTER]: { value: "1", expirationTtl: 60 } } },
			},
			steps: [send(good, { advanceMs: 61_000 })],
		},
	),
	{
		name: "a request with no address header counts against 0.0.0.0",
		steps: [
			visit(PATH, good, { as: asVisitor() }),
			visit(PATH, good, { as: asVisitor() }),
		],
		fetches: allGood,
		final: FINAL,
	},

	// Turnstile
	single("Turnstile refuses the token", good, {
		fetches: outside(json(200, { success: false })),
	}),
	single("Turnstile answers 500", good, { fetches: outside(json(500, {})) }),
	single("Turnstile is unreachable", good, { fetches: outside(networkDown()) }),
	single("Turnstile answers without a success flag", good, {
		fetches: outside(json(200, { ok: true })),
	}),
	single("Turnstile answers text", good, {
		fetches: outside(text(200, "yes")),
	}),
	single("Turnstile answers success as text", good, {
		fetches: outside(json(200, { success: "true" })),
	}),

	// stored
	single("a song interest", {
		...good,
		interest: "song",
		merchandise: [],
		suggestion: "",
	}),
	single("a merchandise interest", { ...good, interest: "merchandise" }),
	single("both song and merchandise", good),
	withBody("merchandise choices repeated", {
		merchandise: ["shirts", "shirts", "stickers", "shirts"],
	}),
	withBody("all four merchandise kinds", {
		merchandise: ["shirts", "hoodies", "stickers", "digital-art"],
	}),
	withBody("the email in capitals with spaces", {
		email: "  FAN@EXAMPLE.COM  ",
	}),
	withBody("the suggestion with markup", {
		suggestion: "<script>alert(1)</script> & \"quotes\" 'too'",
	}),
	withBody("unicode in every free-text field", {
		email: "fan@example.com",
		suggestion: "Más música, por favor. 音楽 🎵 ‮",
		cityRegion: "Zürich, 東京",
	}),
	withBody("only the required fields", {
		merchandise: undefined,
		suggestion: undefined,
		cityRegion: undefined,
	}),
	withBody("a suggestion of spaces is trimmed to nothing", {
		interest: "song",
		merchandise: [],
		suggestion: "   ",
	}),
	withBody(
		"a row for the same listener appears just before the batch",
		{},
		{
			interleave: [
				{
					on: /INSERT INTO music_interest/,
					label: "the same listener sent a song-only interest first",
					run: (sqlite) =>
						sqlite.exec(
							"INSERT INTO music_interest (release_id,email,interest,merchandise,suggestion,consent_version,updated_at) VALUES ('old-news-single','fan@example.com','song','[]','','availability-v0','2026-11-01T00:00:00.000Z')",
						),
				},
			],
		},
	),
	{
		name: "the same listener again from another address changes their interest",
		steps: [
			send({ ...good, interest: "song", merchandise: [], suggestion: "" }),
			send(
				{ ...good, interest: "merchandise", suggestion: "Hoodies" },
				{ as: asVisitor({ ip: "198.51.100.4" }), advanceMs: 5_000 },
			),
		],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "two listeners from two addresses",
		steps: [
			send(good),
			send(
				{ ...good, email: "second@example.com" },
				{ as: asVisitor({ ip: "198.51.100.4" }) },
			),
		],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "the same address sends twice and the second is limited",
		steps: [send(good), send(good)],
		fetches: allGood,
		final: FINAL,
	},

	// a failed write
	single("the interest write fails and the alert is sent", good, {
		...writeFails(),
	}),
	single("the batch fails on the request insert", good, {
		failures: [{ on: /INSERT INTO owner_requests/, message: "d1 down" }],
	}),
	single("the batch fails on the audit insert", good, {
		failures: [{ on: /INSERT INTO owner_request_audit/, message: "d1 down" }],
	}),
	single("a failed write and Resend answers 400", good, {
		...writeFails(),
		fetches: resend(json(400, { message: "bad" })),
	}),
	single("a failed write and Resend answers 500", good, {
		...writeFails(),
		fetches: resend(json(500, {})),
	}),
	single("a failed write and Resend is unreachable", good, {
		...writeFails(),
		fetches: resend(networkDown()),
	}),
	single("a failed write and no Resend key", good, {
		...writeFails(),
		omit: ["RESEND_API_KEY"],
	}),
	single("a failed write and no sender address", good, {
		...writeFails(),
		omit: ["CONTACT_FROM_EMAIL"],
	}),
	single("a failed write and no owner address", good, {
		...writeFails(),
		omit: ["CONTACT_TO_EMAIL"],
	}),
	single("a failed write and the counter delete throws first", good, {
		...writeFails(),
		kv: { RATE_LIMIT: { fails: ["delete"] } },
	}),
	{
		name: "a storage failure, then the same listener retries and is stored",
		steps: [send(good), send(good, { advanceMs: 1_000 })],
		fetches: allGood,
		failures: [
			{ on: /INSERT INTO music_interest/, message: "d1 down", nth: 1 },
		],
		final: FINAL,
	},
];

defineCorpus("music-interest", POST, cases);
