import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/updates";
import {
	asClient,
	asVisitor,
	defineCorpus,
	generatedBody,
	type Case,
} from "./harness";
import {
	EARLIER,
	command,
	input,
	post,
	raw,
	scene,
	SITE,
	U1,
	update,
} from "./areas/software-updates";

// The golden corpus for POST /api/owner/requests/[id]/updates, the front door: who may call it, what the body must be,
// and every limit of the update schema. The project rules, drafts and races are in owner-request-updates-draft.test.ts,
// sharing in owner-request-updates-share.test.ts and the client notice in owner-request-updates-notices.test.ts.
//
// Response branches handled here (every case name starts with its topic):
//
//   403 {ok:false}                       "who": visitor, signed-in studio client
//   404 {ok:false}                       "flag": portal flag unset, "false", "TRUE"; flag off wins over no database
//   503 {ok:false}                       "unavailable": no MUSIC_DB, no id param, empty id param
//   musicRequest (src/lib/music-request.ts, 40000 byte cap)
//     403 Forbidden                      "origin": missing, another site, http scheme
//     415 JSON required                  "content type": missing, text/plain, charset suffix accepted, upper case refused
//     400 Missing request                "no body"
//     413 Request too large              "body size": 40001 bytes; exactly 40000 reaches the schema
//     400 Invalid JSON                   "invalid JSON": bad text, empty text
//   400 "Choose save or share ..."       "command": non-object bodies, action missing/unknown/wrong type, updateId not a
//                                        UUID, expectedUpdatedAt missing/number, expectedProjectUpdatedAt missing/null,
//                                        confirmed not a boolean
//   400 "Check the fields ..."           "update": missing, null, string, array; each field of the update schema missing,
//                                        wrong type, over its limit or malformed (kind, milestone, title, version, evidence,
//                                        alt, preview link, texts, next date, email flag, criteria, deliverables, links,
//                                        review window, paid flag); control characters; a lone surrogate
//   200 saved                            "accepts": every field at its limit; trimmed text; markup, unicode and
//                                        emoji stored as sent; extra fields dropped; a past or leap-day next date
//
// The input errors carry the messages of the schema, so a changed sentence shows in "errors".

const draft = (update: JsonValue | undefined, over = {}) =>
	command("draft", update, over);

const send = (name: string, body: JsonValue | undefined): Case => ({
	name,
	...scene(),
	steps: [post(body)],
});

const bad = (label: string, key: string, value: JsonValue): Case =>
	send(`update: ${label}`, draft(input({ [key]: value })));

const ok = (label: string, key: string, value: JsonValue): Case =>
	send(`accepts: ${label}`, draft(input({ [key]: value })));

/** The update with a key removed. */
const without = (key: string) =>
	Object.fromEntries(Object.entries(input()).filter(([name]) => name !== key));

const long = (n: number, ch = "a") => ch.repeat(n);

const link = (n: number) => `https://example.test/${long(n - 21)}`;

const JSON_PAD = JSON.stringify({ action: "draft" });

const cases: Case[] = [
	// who
	{
		name: "who: a visitor",
		...scene(),
		steps: [post(draft(input()), { as: asVisitor() })],
	},
	{
		name: "who: a signed-in studio client",
		...scene({ extra: {} }),
		steps: [post(draft(input()), { as: asClient("grace@example.test") })],
	},
	// flag and bindings
	{
		name: "flag: portal flag unset",
		...scene(),
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
		steps: [post(draft(input()))],
	},
	{
		name: "flag: portal flag false",
		...scene(),
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
		steps: [post(draft(input()))],
	},
	{
		name: "flag: portal flag TRUE in capitals",
		...scene(),
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" },
		steps: [post(draft(input()))],
	},
	{
		name: "flag: off wins over a missing database",
		music: { missing: true },
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
		steps: [post(draft(input()))],
	},
	{
		name: "unavailable: no MUSIC_DB",
		music: { missing: true },
		steps: [post(draft(input()))],
	},
	{
		name: "unavailable: no id param",
		...scene(),
		steps: [post(draft(input()), { params: {} })],
	},
	{
		name: "unavailable: an empty id param",
		...scene(),
		steps: [post(draft(input()), { params: { id: "" } })],
	},
	{
		name: "unavailable: an unknown project id",
		...scene(),
		steps: [post(draft(input()), { params: { id: "nope" } })],
	},
	// origin and content type
	{
		name: "origin: missing",
		...scene(),
		steps: [post(draft(input()), { headers: {} })],
	},
	{
		name: "origin: another site",
		...scene(),
		steps: [post(draft(input()), { headers: { origin: "https://evil.test" } })],
	},
	{
		name: "origin: http scheme",
		...scene(),
		steps: [
			post(draft(input()), { headers: { origin: "http://thesuperhuman.us" } }),
		],
	},
	{
		name: "content type: missing",
		...scene(),
		steps: [post(undefined, { body: "{}", headers: { origin: SITE } })],
	},
	{
		name: "content type: text/plain",
		...scene(),
		steps: [
			post(undefined, {
				body: JSON.stringify(draft(input())),
				headers: { origin: SITE, "content-type": "text/plain" },
			}),
		],
	},
	{
		name: "content type: upper case is refused",
		...scene(),
		steps: [
			post(undefined, {
				body: JSON.stringify(draft(input())),
				headers: { origin: SITE, "content-type": "Application/JSON" },
			}),
		],
	},
	{
		name: "content type: a charset suffix is accepted",
		...scene(),
		steps: [
			post(undefined, {
				body: JSON.stringify(draft(input())),
				headers: {
					origin: SITE,
					"content-type": "application/json; charset=utf-8",
				},
			}),
		],
	},
	// body
	{
		name: "no body: a POST with no body",
		...scene(),
		steps: [
			post(undefined, {
				headers: { origin: SITE, "content-type": "application/json" },
			}),
		],
	},
	{
		name: "body size: 40001 bytes",
		...scene(),
		steps: [
			post(undefined, {
				body: generatedBody(40_001, (i) =>
					i < JSON_PAD.length ? JSON_PAD.charCodeAt(i) : 0x20,
				),
				headers: { origin: SITE, "content-type": "application/json" },
			}),
		],
	},
	{
		name: "body size: exactly 40000 bytes reaches the schema",
		...scene(),
		steps: [
			post(undefined, {
				body: generatedBody(40_000, (i) =>
					i < JSON_PAD.length ? JSON_PAD.charCodeAt(i) : 0x20,
				),
				headers: { origin: SITE, "content-type": "application/json" },
			}),
		],
	},
	{
		name: "invalid JSON: bad text",
		...scene(),
		steps: [raw("{bad")],
	},
	{
		name: "invalid JSON: empty text",
		...scene(),
		steps: [raw("")],
	},
	// the command
	send("command: null", null),
	send("command: an array", []),
	send("command: a string", "draft"),
	send("command: a number", 7),
	send("command: an empty object", {}),
	send("command: action missing", {
		expectedUpdatedAt: null,
		expectedProjectUpdatedAt: "x",
		update: input(),
	}),
	send("command: action unknown", draft(input(), { action: "save" })),
	send("command: action is a number", draft(input(), { action: 1 })),
	send("command: action in capitals", draft(input(), { action: "DRAFT" })),
	send("command: updateId is not a UUID", draft(input(), { updateId: "u1" })),
	send("command: updateId is a number", draft(input(), { updateId: 7 })),
	send("command: updateId is null", draft(input(), { updateId: null })),
	send("command: expectedUpdatedAt missing", {
		action: "draft",
		expectedProjectUpdatedAt: "x",
		update: input(),
	}),
	send(
		"command: expectedUpdatedAt is a number",
		draft(input(), { expectedUpdatedAt: 5 }),
	),
	send("command: expectedProjectUpdatedAt missing", {
		action: "draft",
		expectedUpdatedAt: null,
		update: input(),
	}),
	send(
		"command: expectedProjectUpdatedAt is null",
		draft(input(), { expectedProjectUpdatedAt: null }),
	),
	send("command: confirmed is a string", draft(input(), { confirmed: "yes" })),
	// the update as a whole
	send("update: missing", {
		action: "draft",
		expectedUpdatedAt: null,
		expectedProjectUpdatedAt: EARLIER,
	}),
	send("update: null", draft(null)),
	send("update: a string", draft("First look")),
	send("update: an array", draft([])),
	send("update: an empty object", draft({})),
	// field by field
	bad("kind missing", "kind", null),
	bad("kind unknown", "kind", "status"),
	bad("kind is a number", "kind", 2),
	bad("milestone below zero", "milestone_index", -1),
	bad("milestone above two", "milestone_index", 3),
	bad("milestone is fractional", "milestone_index", 1.5),
	bad("milestone is text", "milestone_index", "0"),
	bad("title over 120", "title", long(121)),
	bad("title with a control character", "title", "bell\u0007"),
	bad("title is a number", "title", 5),
	bad("title is null", "title", null),
	bad("title with a lone surrogate", "title", "half \ud800"),
	bad("artifact_version over 60", "artifact_version", long(61)),
	bad("evidence_type unknown", "evidence_type", "video"),
	bad("evidence_type is null", "evidence_type", null),
	bad("visual_alt over 300", "visual_alt", long(301)),
	bad("preview_url over 2000", "preview_url", link(2001)),
	bad("preview_url is http", "preview_url", "http://example.test/a"),
	bad(
		"preview_url has a password",
		"preview_url",
		"https://u:p@example.test/a",
	),
	bad("preview_url has a user name", "preview_url", "https://u@example.test/a"),
	bad("preview_url is javascript", "preview_url", "javascript:alert(1)"),
	bad("preview_url is not a URL", "preview_url", "example dot test"),
	bad("preview_url is ftp", "preview_url", "ftp://example.test/a"),
	bad("what_changed over 1000", "what_changed", long(1001)),
	bad("checks_limitations over 1000", "checks_limitations", long(1001)),
	bad("next_step over 300", "next_step", long(301)),
	bad("client_request over 300", "client_request", long(301)),
	bad("next_update_on is not a date", "next_update_on", "tomorrow"),
	bad("next_update_on has no leading zeros", "next_update_on", "2026-1-1"),
	bad("next_update_on is 30 February", "next_update_on", "2026-02-30"),
	bad("next_update_on is month 13", "next_update_on", "2026-13-01"),
	bad("next_update_on is not a leap day", "next_update_on", "2027-02-29"),
	bad("next_update_on has a time", "next_update_on", "2026-11-13T00:00:00Z"),
	bad("email_client is text", "email_client", "yes"),
	bad("email_client is a number", "email_client", 1),
	bad(
		"criteria over 20",
		"criteria",
		Array.from({ length: 21 }, () => "x"),
	),
	bad("criteria item over 300", "criteria", [long(301)]),
	bad("criteria is not an array", "criteria", "x"),
	bad("criteria item is a number", "criteria", [3]),
	bad(
		"delivered_deliverables over 20",
		"delivered_deliverables",
		Array.from({ length: 21 }, () => 0),
	),
	bad("delivered_deliverables number above 7", "delivered_deliverables", [8]),
	bad("delivered_deliverables negative", "delivered_deliverables", [-1]),
	bad("delivered_deliverables fractional", "delivered_deliverables", [0.5]),
	bad("delivered_deliverables item over 300", "delivered_deliverables", [
		long(301),
	]),
	bad(
		"links over 10",
		"links",
		Array.from({ length: 11 }, () => ({ label: "a", url: "b" })),
	),
	bad("links label over 80", "links", [
		{ label: long(81), url: "https://example.test/" },
	]),
	bad("links url over 2000", "links", [{ label: "a", url: long(2001) }]),
	bad("links item without a label", "links", [
		{ url: "https://example.test/" },
	]),
	bad("links item is text", "links", ["https://example.test/"]),
	bad("review_window_days below 5", "review_window_days", 4),
	bad("review_window_days above 365", "review_window_days", 366),
	bad("review_window_days is fractional", "review_window_days", 5.5),
	bad("review_window_days is text", "review_window_days", "5"),
	bad("paid_confirmed is text", "paid_confirmed", "true"),
	send("update: email_client key absent", draft(without("email_client"))),
	send("update: kind key absent", draft(without("kind"))),
	send("update: title key absent", draft(without("title"))),
	send(
		"update: criteria key absent takes its default",
		draft(without("criteria")),
	),
	// what is accepted
	ok("title exactly 120", "title", long(120)),
	ok("artifact_version exactly 60", "artifact_version", long(60)),
	ok("visual_alt exactly 300", "visual_alt", long(300)),
	ok("preview_url exactly 2000", "preview_url", link(2000)),
	ok("what_changed exactly 1000", "what_changed", long(1000)),
	ok("title is trimmed", "title", "   spaced out   "),
	ok("title of only spaces", "title", "     "),
	ok("title with markup", "title", `<script>alert("x")</script> & 'q' <b>`),
	ok("title with unicode and emoji", "title", "Café ☃ 🚀 שלום"),
	ok(
		"what_changed with newlines and tabs",
		"what_changed",
		"line one\n\tline two\r\nline three",
	),
	ok("next_update_on in the past", "next_update_on", "2020-01-01"),
	ok("next_update_on on a leap day", "next_update_on", "2028-02-29"),
	ok("next_update_on today", "next_update_on", "2026-11-13"),
	ok(
		"criteria at 20",
		"criteria",
		Array.from({ length: 20 }, (_, i) => `c${i}`),
	),
	ok("links with unfinished rows", "links", [{ label: "", url: "not a link" }]),
	ok(
		"links at 10",
		"links",
		Array.from({ length: 10 }, (_, i) => ({
			label: `l${i}`,
			url: `https://example.test/${i}`,
		})),
	),
	ok(
		"preview_url https with a port and query",
		"preview_url",
		"https://example.test:8443/a?b=c#d",
	),
	ok("review_window_days at 5", "review_window_days", 5),
	send(
		"accepts: extra fields in the update are dropped",
		draft(input({ extra: "x", nested: { a: 1 } })),
	),
	send(
		"accepts: extra fields in the command are ignored",
		draft(input(), { surprise: true, confirmed: false }),
	),
	{
		name: "accepts: a seeded draft is untouched by a refused body",
		...scene({ updates: [update(U1, "draft")] }),
		steps: [
			post(
				draft(input({ title: long(121) }), {
					expectedUpdatedAt: "2026-11-13T11:00:00.000Z",
				}),
			),
		],
	},
];

defineCorpus("owner-request-updates-gates", POST, cases);
