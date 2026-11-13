import { POST } from "~/pages/api/studio/software/[id]/messages";
import {
	ADA,
	ADA_TOKEN,
	EARLIER,
	GRACE,
	GRACE_TOKEN,
	NOW,
	ORIGIN,
	OTHER_TOKEN,
	clientMessages,
	message,
	session,
	softwareSeed,
	softwareUpdate,
} from "./areas/studio-messages";
import {
	asClient,
	asClientCookie,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";

// The golden corpus for POST /api/studio/software/[id]/messages: a signed-in client sends a message on a software
// project or marks an owner message read.
//
// Every response branch of the handler and of its library calls, and the cases that reach each:
//
//   handler (src/pages/api/studio/software/[id]/messages.ts)
//   404 text "Not found"      portal off (flag "false", flag missing)
//   503 "temporarily unavailable"  no MUSIC_DB
//   401 {ok:false}            no cookie, short cookie, cookie with another name, no id param, empty id param
//   musicRequest              403 no/foreign/ported Origin; 415 text/plain, urlencoded form, no content type, capitalised
//                             type; 400 Missing request; 413 over 8192 bytes; 400 Invalid JSON (bad JSON, empty body)
//   400 "Check your message"  null/array/string/number body, unknown or missing or non-text action, read without messageId,
//                             messageId 0, negative, fractional, text, null; send with no body key
//   404 {ok:false}            unknown session, capitals, revoked, expired, another client's project, project closed, request
//                             withdrawn, content deleted, blank email, unknown project
//   200 {ok:true}             read (marks an owner message read; no-op for a client message, a read one, an unknown id,
//                             another project's message, a decision message)
//   send
//   400 "Write up to 4,000"   body missing, blank, not text, over 4000, control character, a link that is not https
//   200 {ok:true,message}     plain, unicode, markup, https links, exactly 4000, line breaks, tabs, every project state but
//                             complete, an update id and decision of null in the returned message
//   409 {ok:false}            project complete, the rate limit (12 client messages in five minutes: this route has no 429),
//                             lost races (session gone, project closed, request withdrawn, project complete)
//   503 "could not be saved"  any database step that throws: project lookup, insert, read update
//
// Owner notification: none. The route sends no email; every case records no outgoing fetch.
//
// Multi-step sequences: thirteen sends in a row then one after five minutes, send then read then send, a client's message
// after the project completes.

const BASE = "/api/studio/software";
const GOOD = asClientCookie(GRACE_TOKEN);
const TABLES = ["software_project_messages"];
const WITH_PROJECT = ["software_project_messages", "software_projects"];

const ownerNote = { id: 1, ...message("r1", "owner") };

const post = (json: Step["json"], extra: Partial<Step> = {}): Step => ({
	as: GOOD,
	path: `${BASE}/r1/messages`,
	params: { id: "r1" },
	headers: { origin: ORIGIN },
	json,
	dump: { music: TABLES },
	...extra,
});

const raw = (body: string, extra: Partial<Step> = {}): Step =>
	post(undefined, {
		body,
		headers: { origin: ORIGIN, "content-type": "application/json" },
		...extra,
	});

const text = (body: Step["json"], extra: Partial<Step> = {}) =>
	post({ action: "send", body }, extra);

const read = (messageId: Step["json"], extra: Partial<Step> = {}) =>
	post({ action: "read", messageId }, extra);

type Options = {
	extra?: { [table: string]: SeedRow[] };
	project?: SeedRow;
	request?: SeedRow;
};

const swCase = (
	name: string,
	options: Options,
	steps: Step[],
	more: Partial<Case> = {},
): Case => ({
	name,
	music: {
		seed: softwareSeed(options.extra, options.project, options.request),
	},
	steps,
	...more,
});

const sendCase = (name: string, body: Step["json"], options: Options = {}) =>
	swCase(name, options, [text(body)]);

const race = (
	label: string,
	sql: string,
	on = /INSERT INTO software_project_messages/,
) => ({
	interleave: [
		{
			on,
			label,
			run: (sqlite: { exec: (sql: string) => void }) => sqlite.exec(sql),
		},
	],
});

const STATES = [
	"preparing",
	"building",
	"waiting_for_input",
	"ready_for_review",
	"complete",
] as const;

const cases: Case[] = [
	// ---- the first checks
	swCase("portal off: the flag is false", {}, [text("Hello")], {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	swCase("portal off: the flag is not set", {}, [text("Hello")], {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [text("Hello")],
	},
	swCase("no cookie at all", {}, [text("Hello", { as: asVisitor() })]),
	swCase("a cookie that is too short", {}, [
		text("Hello", { as: asClientCookie("abc") }),
	]),
	swCase("a cookie with another name", {}, [
		text("Hello", {
			as: asVisitor(),
			headers: { origin: ORIGIN, cookie: `session=${GRACE_TOKEN}` },
		}),
	]),
	swCase("a cookie among other cookies", {}, [
		text("Hello", {
			as: asVisitor(),
			headers: {
				origin: ORIGIN,
				cookie: `a=1; studio_session=${GRACE_TOKEN}; b=2`,
			},
		}),
	]),
	swCase("no id param", {}, [text("Hello", { params: {} })]),
	swCase("an empty id param", {}, [text("Hello", { params: { id: "" } })]),
	swCase("no cookie and a bad body: the cookie check comes first", {}, [
		raw("{bad", { as: asVisitor() }),
	]),
	// ---- refusals, each reason alone
	swCase("a session no one issued", {}, [
		text("Hello", { as: asClientCookie(OTHER_TOKEN) }),
	]),
	swCase("a session token in capitals", {}, [
		text("Hello", { as: asClientCookie(GRACE_TOKEN.toUpperCase()) }),
	]),
	swCase(
		"a revoked session",
		{
			extra: {
				audio_client_sessions: [
					session(GRACE_TOKEN, GRACE, { revoked_at: EARLIER }),
				],
			},
		},
		[text("Hello")],
	),
	swCase(
		"an expired session",
		{
			extra: {
				audio_client_sessions: [
					session(GRACE_TOKEN, GRACE, {
						expires_at: "2026-11-13T11:59:59.999Z",
					}),
				],
			},
		},
		[text("Hello")],
	),
	swCase(
		"a session that expires at this very moment",
		{
			extra: {
				audio_client_sessions: [
					session(GRACE_TOKEN, GRACE, { expires_at: NOW }),
				],
			},
		},
		[text("Hello")],
	),
	swCase("another client's project", {}, [
		text("Hello", { as: asClientCookie(ADA_TOKEN) }),
	]),
	swCase(
		"a project whose access was closed",
		{ project: { revoked_at: EARLIER } },
		[text("Hello")],
	),
	swCase("a withdrawn request", { request: { status: "withdrawn" } }, [
		text("Hello"),
	]),
	swCase(
		"a project whose content was deleted",
		{ project: { content_deleted_at: EARLIER } },
		[text("Hello")],
	),
	swCase(
		"a request with a blank email",
		{
			request: { email: "" },
			extra: { audio_client_sessions: [session(GRACE_TOKEN, "")] },
		},
		[text("Hello")],
	),
	swCase("a project id that does not exist", {}, [
		text("Hello", { path: `${BASE}/nope/messages`, params: { id: "nope" } }),
	]),
	swCase(
		"a resolved request still lets the client write",
		{ request: { status: "resolved" } },
		[text("Hello")],
	),
	{
		name: "a signed-in client through the real sign-in",
		music: { seed: softwareSeed() },
		steps: [
			text("Hello from a real session", {
				as: asClient(GRACE),
				dump: { music: [...TABLES, "audio_client_sessions"] },
			}),
		],
	},
	swCase(
		"the client of a second project writes on their own",
		{
			extra: {
				owner_requests: [
					rows.softwareRequest("r1", { status: "reviewed" }),
					rows.softwareRequest("r2", { status: "reviewed", email: ADA }),
				],
				software_offers: [
					rows.softwareOffer("o1", "r1"),
					rows.softwareOffer("o2", "r2"),
				],
				software_projects: [
					rows.softwareProject("r1", "o1", { state: "building" }),
					rows.softwareProject("r2", "o2", { state: "building" }),
				],
			},
		},
		[
			text("From Ada", {
				as: asClientCookie(ADA_TOKEN),
				path: `${BASE}/r2/messages`,
				params: { id: "r2" },
			}),
		],
	),
	// ---- Origin, content type, size, JSON
	swCase("no Origin header", {}, [text("Hello", { headers: {} })]),
	swCase("an Origin from another site", {}, [
		text("Hello", { headers: { origin: "https://evil.example" } }),
	]),
	swCase("an Origin with a port", {}, [
		text("Hello", { headers: { origin: `${ORIGIN}:8443` } }),
	]),
	swCase("content type text/plain", {}, [
		raw('{"action":"send","body":"Hello"}', {
			headers: { origin: ORIGIN, "content-type": "text/plain" },
		}),
	]),
	swCase("an urlencoded form", {}, [
		raw("action=send&body=Hello", {
			headers: {
				origin: ORIGIN,
				"content-type": "application/x-www-form-urlencoded",
			},
		}),
	]),
	swCase("no content type", {}, [
		raw('{"action":"send","body":"Hello"}', { headers: { origin: ORIGIN } }),
	]),
	swCase("a JSON content type in capitals", {}, [
		raw('{"action":"send","body":"Hello"}', {
			headers: { origin: ORIGIN, "content-type": "Application/JSON" },
		}),
	]),
	swCase("a lower-case JSON content type with a charset", {}, [
		raw('{"action":"send","body":"Hello"}', {
			headers: {
				origin: ORIGIN,
				"content-type": "application/json; charset=utf-8",
			},
		}),
	]),
	swCase("no request body", {}, [
		post(undefined, {
			headers: { origin: ORIGIN, "content-type": "application/json" },
		}),
	]),
	swCase("an empty body", {}, [raw("")]),
	swCase("bad JSON", {}, [raw("{not json")]),
	swCase("a body over 8192 bytes", {}, [text("a".repeat(8200))]),
	swCase("a null body", {}, [raw("null")]),
	swCase("an array body", {}, [raw("[]")]),
	swCase("a string body", {}, [raw('"send"')]),
	swCase("a number body", {}, [raw("5")]),
	swCase("an unknown action", {}, [post({ action: "respond" })]),
	swCase("no action", {}, [post({ body: "Hello" })]),
	swCase("an action that is not text", {}, [post({ action: 5 })]),
	// ---- the text
	sendCase("send with no body field", undefined),
	...[5, { text: "Hello" }, ["Hello"], null, "", "   \n\t  "].map(
		(value, index) =>
			sendCase(
				`a body that is ${["a number", "an object", "an array", "null", "empty", "spaces"][index]}`,
				value,
			),
	),
	sendCase("a message of 4001 characters", "a".repeat(4001)),
	sendCase("a message of exactly 4000 characters", "a".repeat(4000)),
	sendCase(
		"a message of 4000 characters inside spaces",
		` ${"a".repeat(4000)} `,
	),
	sendCase("a message with a control character", "bad\u0001text"),
	sendCase(
		"a message with a line break and a tab",
		"line one\n\tline two\r\nthree",
	),
	sendCase(
		"a message in several scripts and an emoji",
		"Merci 谢谢 مرحبا 🎧 é",
	),
	sendCase("a message with a lone surrogate", "a\ud800b"),
	sendCase(
		"a message with markup and quotes",
		`<script>alert("x")</script> & 'q' "dq" <b>bold</b>`,
	),
	sendCase(
		"a message with an https link",
		"See https://example.com/mix?x=1&y=2 thanks",
	),
	sendCase("a message with an http link", "See http://example.com/a"),
	sendCase("a message with a www link", "See www.example.com/a"),
	sendCase(
		"a message with a link carrying a password",
		"See https://user:pass@example.com/a",
	),
	sendCase(
		"a message with a good and a bad link",
		"https://example.com/a and ftp://example.com/b",
	),
	sendCase("a message with a javascript: URL", "javascript:alert(1)"),
	// ---- send by project state
	...STATES.map((state) =>
		swCase(`send while the project is ${state}`, { project: { state } }, [
			text("Hello", { dump: { music: WITH_PROJECT } }),
		]),
	),
	// ---- the rate limit
	swCase(
		"send with 11 client messages in the window",
		{ extra: { software_project_messages: clientMessages("r1", 11) } },
		[text("The twelfth")],
	),
	swCase(
		"send with 12 client messages in the window: 409, not 429",
		{ extra: { software_project_messages: clientMessages("r1", 12) } },
		[text("The thirteenth")],
	),
	swCase(
		"send with 12 client messages, all older than five minutes",
		{ extra: { software_project_messages: clientMessages("r1", 12, 400_000) } },
		[text("After the wait")],
	),
	swCase(
		"send with 12 client messages exactly five minutes old",
		{
			extra: {
				software_project_messages: Array.from({ length: 12 }, (_, index) =>
					message("r1", "client", {
						body: `edge ${index}`,
						created_at: "2026-11-13T11:55:00.000Z",
					}),
				),
			},
		},
		[text("On the edge")],
	),
	swCase(
		"send with 12 owner messages in the window",
		{
			extra: {
				software_project_messages: Array.from({ length: 12 }, (_, index) =>
					message("r1", "owner", {
						body: `owner ${index}`,
						created_at: "2026-11-13T11:59:00.000Z",
					}),
				),
			},
		},
		[text("Owner is chatty")],
	),
	swCase(
		"send with a decision message and 11 client messages in the window",
		{
			extra: {
				software_project_updates: [softwareUpdate("u1", "direction_review")],
				software_project_messages: [
					{
						...message("r1", "client", {
							body: "Confirmed",
							created_at: "2026-11-13T11:59:00.000Z",
						}),
						update_id: "u1",
						decision: "direction_confirmed",
					},
					...clientMessages("r1", 11),
				],
			},
		},
		[text("After a decision")],
	),
	swCase("a thirteenth send in a row and one five minutes later", {}, [
		...Array.from({ length: 13 }, (_, index) =>
			text(`message ${index + 1}`, {
				advanceMs: 1000,
				dump: index === 12 ? { music: TABLES } : undefined,
			}),
		),
		text("later", { advanceMs: 300_000 }),
	]),
	// ---- read
	swCase(
		"read an owner message",
		{ extra: { software_project_messages: [ownerNote] } },
		[read(1)],
	),
	swCase(
		"read an owner message twice",
		{ extra: { software_project_messages: [ownerNote] } },
		[read(1), read(1, { advanceMs: 60_000 })],
	),
	swCase(
		"read a message the client wrote",
		{
			extra: {
				software_project_messages: [{ id: 1, ...message("r1", "client") }],
			},
		},
		[read(1)],
	),
	swCase(
		"read a message that is already read",
		{
			extra: {
				software_project_messages: [{ ...ownerNote, read_at: EARLIER }],
			},
		},
		[read(1)],
	),
	swCase(
		"read a message id that does not exist",
		{ extra: { software_project_messages: [ownerNote] } },
		[read(99)],
	),
	swCase(
		"read an owner message that carries a decision",
		{
			extra: {
				software_project_updates: [softwareUpdate("u1", "direction_review")],
				software_project_messages: [
					{ ...ownerNote, update_id: "u1", decision: "direction_confirmed" },
				],
			},
		},
		[read(1)],
	),
	swCase(
		"read a message of another project",
		{
			extra: {
				owner_requests: [
					rows.softwareRequest("r1", { status: "reviewed" }),
					rows.softwareRequest("r2", { status: "reviewed", email: ADA }),
				],
				software_offers: [
					rows.softwareOffer("o1", "r1"),
					rows.softwareOffer("o2", "r2"),
				],
				software_projects: [
					rows.softwareProject("r1", "o1", { state: "building" }),
					rows.softwareProject("r2", "o2", { state: "building" }),
				],
				software_project_messages: [{ id: 5, ...message("r2", "owner") }],
			},
		},
		[read(5)],
	),
	...[0, -1, 1.5, "1", null].map((value) =>
		swCase(
			`read with messageId ${JSON.stringify(value)}`,
			{ extra: { software_project_messages: [ownerNote] } },
			[read(value)],
		),
	),
	swCase(
		"read with no messageId",
		{ extra: { software_project_messages: [ownerNote] } },
		[post({ action: "read" })],
	),
	swCase(
		"read on a closed project",
		{
			project: { revoked_at: EARLIER },
			extra: { software_project_messages: [ownerNote] },
		},
		[read(1)],
	),
	swCase(
		"read while the project is complete",
		{
			project: { state: "complete" },
			extra: { software_project_messages: [ownerNote] },
		},
		[read(1)],
	),
	swCase(
		"read as another client",
		{ extra: { software_project_messages: [ownerNote] } },
		[read(1, { as: asClientCookie(ADA_TOKEN) })],
	),
	// ---- sequences
	swCase(
		"send, read the owner's reply, send again",
		{ extra: { software_project_messages: [ownerNote] } },
		[
			text("First", { advanceMs: 1000 }),
			read(1, { advanceMs: 1000 }),
			text("Second", { advanceMs: 1000 }),
		],
	),
	swCase("send, the project completes, send again", {}, [
		text("Before", { advanceMs: 1000 }),
		text("After", {
			advanceMs: 1000,
			before: {
				label: "the project completes",
				run: (world) =>
					world.music.exec(`UPDATE software_projects SET state='complete'`),
			},
		}),
	]),
	swCase(
		"send, access is closed, send and read",
		{ extra: { software_project_messages: [ownerNote] } },
		[
			text("Before", { advanceMs: 1000 }),
			text("After", {
				advanceMs: 1000,
				before: {
					label: "the owner closes access",
					run: (world) =>
						world.music.exec(
							`UPDATE software_projects SET revoked_at='${EARLIER}'`,
						),
				},
			}),
			read(1, { advanceMs: 1000 }),
		],
	),
	// ---- races
	swCase(
		"send when the session is revoked after the lookup",
		{},
		[text("Hello")],
		race(
			"the session is revoked",
			`UPDATE audio_client_sessions SET revoked_at='${EARLIER}'`,
		),
	),
	swCase(
		"send when the session expires after the lookup",
		{},
		[text("Hello")],
		race(
			"the session expires",
			`UPDATE audio_client_sessions SET expires_at='${EARLIER}'`,
		),
	),
	swCase(
		"send when the project is closed after the lookup",
		{},
		[text("Hello", { dump: { music: WITH_PROJECT } })],
		race(
			"the project is closed",
			`UPDATE software_projects SET revoked_at='${EARLIER}'`,
		),
	),
	swCase(
		"send when the request is withdrawn after the lookup",
		{},
		[text("Hello")],
		race(
			"the request is withdrawn",
			`UPDATE owner_requests SET status='withdrawn'`,
		),
	),
	swCase(
		"send when the project completes after the lookup",
		{},
		[text("Hello")],
		race(
			"the project completes",
			`UPDATE software_projects SET state='complete'`,
		),
	),
	swCase(
		"send when the content is deleted after the lookup: the insert does not check",
		{},
		[text("Hello")],
		race(
			"the content is deleted",
			`UPDATE software_projects SET content_deleted_at='${EARLIER}'`,
		),
	),
	swCase(
		"send when the rate limit fills after the lookup",
		{},
		[text("Hello")],
		race(
			"twelve messages arrive",
			clientMessages("r1", 12)
				.map(
					(row) =>
						`INSERT INTO software_project_messages(request_id,actor,actor_id,body,created_at) VALUES ('r1','client','x','${row.body}','${row.created_at}')`,
				)
				.join(";"),
		),
	),
	swCase(
		"read when the session is revoked after the lookup",
		{ extra: { software_project_messages: [ownerNote] } },
		[read(1)],
		race(
			"the session is revoked",
			`UPDATE audio_client_sessions SET revoked_at='${EARLIER}'`,
			/UPDATE software_project_messages SET read_at/,
		),
	),
	// ---- outages
	swCase("the project lookup fails", {}, [text("Hello")], {
		failures: [
			{ on: /SELECT email FROM audio_client_sessions/, message: "D1 is down" },
		],
	}),
	swCase("the project list lookup fails", {}, [text("Hello")], {
		failures: [
			{ on: /WHERE r\.email=\? AND r\.email<>''/, message: "D1 is down" },
		],
	}),
	swCase("the send insert fails", {}, [text("Hello")], {
		failures: [
			{ on: /INSERT INTO software_project_messages/, message: "D1 is down" },
		],
	}),
	swCase(
		"the read update fails",
		{ extra: { software_project_messages: [ownerNote] } },
		[read(1)],
		{
			failures: [
				{
					on: /UPDATE software_project_messages SET read_at/,
					message: "D1 is down",
				},
			],
		},
	),
];

defineCorpus("studio-software-messages", POST, cases);
