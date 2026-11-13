import { POST } from "~/pages/api/audio-intake";
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
import type { JsonObject, JsonValue } from "../helpers/json";
import {
	allGood,
	IP,
	ORIGIN,
	outside,
	rawVisit,
	requestTables,
	resend,
	visit,
} from "./areas/public";

// The golden corpus for POST /api/audio-intake: a visitor asks for a mix, a master or a custom job. The route stores an
// owner request (and, by trigger, a studio project), then tells the owner and, when the client portal is on, the visitor.
//
// Every response branch and effect path, and the cases that reach them:
//
//   musicRequest (src/lib/music-request.ts)
//   403 Forbidden                       no Origin, another site, www, http, trailing slash
//   415 JSON required                   text/plain, no content type, form content type
//   400 Missing request                 no body at all
//   413 Request too large               more than 32768 bytes (cancelled mid-read)
//   400 Invalid JSON                    broken text, empty body
//   400 { errors }  validateIntake      every schema field missing, wrong type, too long, malformed; every service;
//                                       preference mismatches; judgment with a choice; missing file link; missing
//                                       note for a specific direction and for a custom job; last issue per field wins
//   503 "Sending is unavailable"        no MUSIC_DB, no Turnstile secret, no RATE_LIMIT (after validation, so a bad
//                                       body with a missing binding is still 400)
//   429 attempt limit                   10 attempts per address, a stored count that is not a number
//   403 Turnstile                       refused, 5xx, network down, malformed answer, success as text
//   429 request limit                   second send from one address; the attempt counter still rose
//   503 storage failed                  insert batch throws, read-back throws (row stays stored), details too large;
//                                       the request counter is cleared; the urgent alert goes out (200, 5xx, network
//                                       down, no key, no sender, no owner address) or the delete throws first
//   503 "temporarily unavailable"       the outer catch: KV read, KV write or KV delete throws
//   200 { ok: true }                    all four services, both directions, unicode, markup characters
//
//   effects after the 200
//   owner email                         sent, refused 400, 5xx, network down, no key, no sender, no recipient, no site
//                                       origin; the text carries every visitor value unescaped (it is plain text)
//   studio invitation                   portal flag on, off, absent; sent, refused, 5xx (stays "sending"), network down,
//                                       no key or sender (failed); project revoked in a race, claim throws, recipient
//                                       lookup throws, final update throws
//   background work                     waitUntil with a context; awaited inline without one
//
//   sequences                           second send, different address twice, retry after a storage failure, retry
//                                       after a read-back failure (two rows), eleven refused challenges

const PATH = "/api/audio-intake";

const good: JsonObject = {
	service: "vocal-mix",
	title: "Night Drive",
	direction: "judgment",
	preferences: {},
	preserve: "",
	referenceUrl: "",
	referenceNote: "",
	name: "Ada Lovelace",
	email: "Ada@Example.com",
	permission: true,
	turnstileToken: "token-1",
	fileLink: "https://files.example.test/night-drive",
};

const FINAL: Dump = {
	music: requestTables,
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
const goodText = JSON.stringify(good);

const fails = (on: RegExp, message = "d1 down", nth = 1) => ({
	failures: [{ on, message, nth }],
});

const invitationState = (sql: string) => ({
	interleave: [
		{
			on: /UPDATE audio_projects SET invitation_status='sending'/,
			label: sql,
			run: (sqlite: { exec: (statement: string) => void }) => sqlite.exec(sql),
		},
	],
});

const mastering = {
	...good,
	service: "mastering",
	title: "Finished mix",
	fileLink: "https://files.example.test/mix",
};

const cases: Case[] = [
	// --- 200, each service and direction
	single("a vocal mix with every field", {
		...good,
		direction: "preferences",
		preferences: { vocal: "natural", space: "decide", tuning: "stylized" },
		preserve: "Keep the ad-libs",
		referenceUrl: "https://reference.example.test/song",
		referenceNote: "Like the 2019 record",
	}),
	single("a mastering request with tone and dynamics", {
		...mastering,
		direction: "preferences",
		preferences: { tone: "warm", dynamics: "dense" },
	}),
	withBody("a bundle request", { service: "bundle" }),
	single("a custom request with a note and no files", {
		...good,
		service: "custom",
		fileLink: "",
		referenceNote: "Full mix of a six track EP",
	}),
	single("a custom request with a file link", {
		...good,
		service: "custom",
		referenceNote: "Recording support",
	}),
	withBody("a specific direction with a note", {
		direction: "specific",
		referenceNote: "Dry and close",
	}),
	withBody("the judgment path with every choice left to me", {
		preferences: { vocal: "decide", space: "decide" },
	}),
	withBody("text with unicode", {
		title: "夜のドライブ 🎵",
		name: "Zoë Ångström",
		preserve: "Keep the café ambience",
	}),
	withBody("text with markup characters and quotes", {
		title: `<b>"Night" & 'Day'</b>`,
		name: "<script>alert(1)</script> Ada",
		preserve: "a < b > c & d",
		referenceNote: "<img src=x onerror=1>",
	}),
	withBody("padding around every text field is trimmed", {
		title: "  Night Drive  ",
		name: "  Ada  ",
		email: "  ada@example.com  ",
		preserve: "  keep  ",
		turnstileToken: "token-1",
	}),
	withBody("a long title, name and note at their limits", {
		title: "t".repeat(120),
		name: "n".repeat(100),
		preserve: "p".repeat(1200),
		referenceNote: "r".repeat(2000),
		direction: "specific",
	}),
	withBody("extra keys in the body are dropped", { admin: true, id: "x" }),

	// --- musicRequest
	raw("no Origin header", goodText, { "content-type": "application/json" }),
	raw("an Origin that is another site", goodText, {
		origin: "https://evil.example.com",
		"content-type": "application/json",
	}),
	raw("the www origin", goodText, {
		origin: "https://www.thesuperhuman.us",
		"content-type": "application/json",
	}),
	raw("the plain http origin", goodText, {
		origin: "http://thesuperhuman.us",
		"content-type": "application/json",
	}),
	raw("an origin with a trailing slash", goodText, {
		origin: "https://thesuperhuman.us/",
		"content-type": "application/json",
	}),
	raw("a text/plain content type", goodText, {
		origin: ORIGIN,
		"content-type": "text/plain",
	}),
	raw("a form content type", "a=1", {
		origin: ORIGIN,
		"content-type": "application/x-www-form-urlencoded",
	}),
	raw("a JSON content type with a charset", goodText, {
		origin: ORIGIN,
		"content-type": "application/json; charset=utf-8",
	}),
	raw("no body at all", undefined, jsonHeaders),
	raw(
		"a body over 32768 bytes",
		JSON.stringify({ ...good, preserve: "x".repeat(33_000) }),
		jsonHeaders,
	),
	raw("text that is not JSON", "{not json", jsonHeaders),
	raw("an empty body", "", jsonHeaders),
	single(
		"a wrong origin and an invalid body",
		{ name: "" },
		{},
		{
			headers: { origin: "https://evil.example.com" },
		},
	),

	// --- validation, bodies that are not objects
	single("a null body", null),
	single("an array body", []),
	single("a string body", "hello"),
	single("a number body", 42),
	single("an empty object body", {}),

	// --- validation, field by field
	withBody("service missing", { service: undefined }),
	withBody("service unknown", { service: "podcast" }),
	withBody("service not text", { service: 4 }),
	withBody("title missing", { title: undefined }),
	withBody("title only whitespace", { title: "   " }),
	withBody("title 121 characters", { title: "t".repeat(121) }),
	withBody("title with a newline", { title: "a\nb" }),
	withBody("title not text", { title: 5 }),
	withBody("direction missing", { direction: undefined }),
	withBody("direction unknown", { direction: "surprise" }),
	withBody("preferences not an object", { preferences: "natural" }),
	withBody("preferences value not text", { preferences: { vocal: 3 } }),
	withBody("preferences value 31 characters", {
		direction: "preferences",
		preferences: { vocal: "v".repeat(31) },
	}),
	withBody("preferences key 31 characters", {
		direction: "preferences",
		preferences: { ["k".repeat(31)]: "natural" },
	}),
	withBody("preferences for another service", {
		direction: "preferences",
		preferences: { tone: "warm" },
	}),
	withBody("a preference choice that does not exist", {
		direction: "preferences",
		preferences: { vocal: "robotic" },
	}),
	withBody("a choice sent with the judgment direction", {
		preferences: { vocal: "natural" },
	}),
	single("preferences on a custom job", {
		...good,
		service: "custom",
		fileLink: "",
		direction: "preferences",
		preferences: { vocal: "natural" },
		referenceNote: "x",
	}),
	withBody("preserve 1201 characters", { preserve: "p".repeat(1201) }),
	withBody("referenceUrl that is http", {
		referenceUrl: "http://a.example.test/x",
	}),
	withBody("referenceUrl with a password", {
		referenceUrl: "https://u:p@a.example.test/x",
	}),
	withBody("referenceUrl that is not a link", { referenceUrl: "not a link" }),
	withBody("referenceUrl 2049 characters", {
		referenceUrl: `https://a.example.test/${"x".repeat(2030)}`,
	}),
	withBody("referenceNote 2001 characters", {
		direction: "specific",
		referenceNote: "r".repeat(2001),
	}),
	withBody("name missing", { name: undefined }),
	withBody("name with a newline", { name: "Ada\nLovelace" }),
	withBody("name 101 characters", { name: "n".repeat(101) }),
	withBody("email invalid", { email: "ada@" }),
	withBody("email 121 characters", { email: `${"e".repeat(117)}@x.co` }),
	withBody("email not text", { email: ["a@b.co"] }),
	withBody("permission false", { permission: false }),
	withBody("permission missing", { permission: undefined }),
	withBody("permission as text", { permission: "true" }),
	withBody("turnstileToken missing", { turnstileToken: undefined }),
	withBody("turnstileToken empty", { turnstileToken: "" }),
	withBody("turnstileToken 2049 characters", {
		turnstileToken: "t".repeat(2049),
	}),
	withBody("fileLink missing for a vocal mix", { fileLink: "" }),
	withBody("fileLink that is http", {
		fileLink: "http://files.example.test/a",
	}),
	single("a custom job with no note", {
		...good,
		service: "custom",
		fileLink: "",
	}),
	withBody("a specific direction with no note", { direction: "specific" }),
	single("every field wrong at once", {
		service: "x",
		title: "",
		direction: "y",
		preferences: 1,
		preserve: 2,
		referenceUrl: 3,
		referenceNote: 4,
		name: "",
		email: "x",
		permission: false,
		turnstileToken: "",
		fileLink: 5,
	}),

	// --- bindings and secrets
	single("no database binding", good, { music: { missing: true } }),
	single("no Turnstile secret", good, { omit: ["TURNSTILE_SECRET_KEY"] }),
	single("no rate limit store", good, {
		kv: { RATE_LIMIT: { missing: true } },
	}),
	single(
		"an invalid body with no database binding",
		{ name: "" },
		{
			music: { missing: true },
		},
	),

	// --- rate limits
	single("ten attempts already counted", good, {
		kv: { RATE_LIMIT: { seed: { [`rl:audio-attempt:${IP}`]: "10" } } },
	}),
	single("nine attempts already counted", good, {
		kv: { RATE_LIMIT: { seed: { [`rl:audio-attempt:${IP}`]: "9" } } },
	}),
	single("a stored attempt count that is not a number", good, {
		kv: { RATE_LIMIT: { seed: { [`rl:audio-attempt:${IP}`]: "abc" } } },
	}),
	single("a request already counted for this address", good, {
		kv: { RATE_LIMIT: { seed: { [`rl:audio:${IP}`]: "1" } } },
	}),
	single("no cf-connecting-ip header", good, {}, { as: asVisitor() }),
	single("the rate limit store fails to read", good, {
		kv: { RATE_LIMIT: { fails: ["get"] } },
	}),
	single("the rate limit store fails to write", good, {
		kv: { RATE_LIMIT: { fails: ["put"] } },
	}),

	// --- Turnstile
	single("Turnstile says no", good, {
		fetches: outside(json(200, { success: false })),
	}),
	single("Turnstile answers success as text", good, {
		fetches: outside(json(200, { success: "true" })),
	}),
	single("Turnstile answers an error status", good, {
		fetches: outside(json(500, { success: true })),
	}),
	single("Turnstile answers unreadable text", good, {
		fetches: outside(text(200, "<html>")),
	}),
	single("Turnstile cannot be reached", good, {
		fetches: outside(networkDown()),
	}),

	// --- storage failures
	single("the insert batch fails", good, fails(/INSERT INTO owner_requests/)),
	single("the insert batch fails and the alert is refused", good, {
		...fails(/INSERT INTO owner_requests/),
		fetches: resend(json(500, {})),
	}),
	single("the insert batch fails and Resend is down", good, {
		...fails(/INSERT INTO owner_requests/),
		fetches: outside(json(200, { success: true }), networkDown()),
	}),
	single("the insert batch fails with no Resend key", good, {
		...fails(/INSERT INTO owner_requests/),
		omit: ["RESEND_API_KEY"],
	}),
	single("the insert batch fails with no sender address", good, {
		...fails(/INSERT INTO owner_requests/),
		omit: ["CONTACT_FROM_EMAIL"],
	}),
	single("the insert batch fails with no owner address", good, {
		...fails(/INSERT INTO owner_requests/),
		omit: ["CONTACT_TO_EMAIL"],
	}),
	single("the insert batch fails and clearing the counter fails too", good, {
		...fails(/INSERT INTO owner_requests/),
		kv: { RATE_LIMIT: { fails: ["delete"] } },
	}),
	single(
		"the read-back after the insert fails (the row stays stored)",
		good,
		fails(/SELECT id,kind,release_id,service_id/),
	),
	single("details too large after escaping", {
		...good,
		title: "\u0001".repeat(100),
		preserve: "\u0001".repeat(1200),
		referenceNote: "\u0001".repeat(2000),
		direction: "specific",
	}),

	// --- the owner email (the first Resend call) and the studio invitation (the second)
	single("the owner email is refused with 400", good, {
		fetches: resend(json(400, {}), json(200, {})),
	}),
	single("the owner email fails with 500", good, {
		fetches: resend(json(500, {}), json(200, {})),
	}),
	single("the owner email cannot be sent", good, {
		fetches: resend(networkDown(), json(200, {})),
	}),
	single("no Resend key", good, { omit: ["RESEND_API_KEY"] }),
	single("no sender address", good, { omit: ["CONTACT_FROM_EMAIL"] }),
	single("no owner address", good, { omit: ["CONTACT_TO_EMAIL"] }),
	single("no site origin", good, { omit: ["SITE_ORIGIN"] }),
	single("a site origin that is a preview host", good, {
		env: { SITE_ORIGIN: "https://preview.example.test" },
	}),
	single("no execution context, so the notices are awaited", good, {
		noContext: true,
	}),

	// --- the studio invitation
	single("the client portal is switched off", good, {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	single("the client portal flag is absent", good, {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
	}),
	single("the invitation is refused with 422", good, {
		fetches: resend(json(200, {}), json(422, {})),
	}),
	single("the invitation gets a 500 and stays sending", good, {
		fetches: resend(json(200, {}), json(500, {})),
	}),
	single("the invitation cannot be sent", good, {
		fetches: resend(json(200, {}), networkDown()),
	}),
	single("the invitation has no Resend key", good, {
		omit: ["RESEND_API_KEY"],
	}),
	single("the invitation has no sender address", good, {
		omit: ["CONTACT_FROM_EMAIL"],
	}),
	single(
		"the project is revoked before the invitation is claimed",
		good,
		invitationState(
			"UPDATE audio_projects SET revoked_at='2026-11-13T12:00:00.000Z'",
		),
	),
	single(
		"the request is withdrawn before the invitation is claimed",
		good,
		invitationState("UPDATE owner_requests SET status='withdrawn'"),
	),
	single(
		"the invitation was already claimed by another worker",
		good,
		invitationState("UPDATE audio_projects SET invitation_status='sending'"),
	),
	single(
		"claiming the invitation throws",
		good,
		fails(/UPDATE audio_projects SET invitation_status='sending'/),
	),
	single(
		"looking up the invitation recipient throws",
		good,
		fails(/SELECT r.email FROM owner_requests r JOIN audio_projects/),
	),
	single(
		"recording the invitation result throws",
		good,
		fails(/UPDATE audio_projects SET invitation_status=\?,invitation_sent_at/),
	),

	// --- sequences
	{
		name: "the same address sends twice",
		steps: [send(good), send(good)],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "two addresses send the same request",
		steps: [send(good), send(good, { as: asVisitor({ ip: "203.0.113.8" }) })],
		fetches: allGood,
		final: FINAL,
	},
	{
		name: "a storage failure, then the same visitor retries",
		steps: [send(good), send(good)],
		fetches: allGood,
		...fails(/INSERT INTO owner_requests/),
		final: FINAL,
	},
	{
		name: "a read-back failure, then the same visitor retries (two rows)",
		steps: [send(good), send(good)],
		fetches: allGood,
		...fails(/SELECT id,kind,release_id,service_id/),
		final: FINAL,
	},
	{
		name: "eleven refused challenges from one address",
		steps: Array.from({ length: 11 }, () => send(good)),
		fetches: outside(json(200, { success: false })),
		final: FINAL,
	},
	{
		name: "a mix and then a master from different addresses",
		steps: [
			send(good),
			send(mastering, { as: asVisitor({ ip: "198.51.100.4" }) }),
		],
		fetches: allGood,
		final: FINAL,
	},
];

defineCorpus("audio-intake", POST, cases);
