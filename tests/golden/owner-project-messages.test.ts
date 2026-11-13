import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/projects/[id]/messages";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type Step,
} from "./harness";
import {
	atStage,
	EARLIER,
	message,
	rawStep,
	routeStep,
	service,
	sql,
	STAGES,
	world,
	type Parts,
} from "./areas/owner-audio";

// The golden corpus for POST /api/owner/projects/[id]/messages: the owner sends a message to the client of a project
// ({action:"send", body}) or marks one of the client's messages read ({action:"read", messageId}). The project row is
// looked up first (404), then a send is validated (validateProjectMessage in src/lib/audio-project-messages.ts: text of
// 1 to 4000 characters after trimming, no control characters other than tab, newline and carriage return, and every
// link with a scheme or "www." must be https:// with a host and no credentials) and saved by an INSERT that needs the
// project not complete, not revoked and its request not withdrawn. Nothing is escaped: the text is stored as typed.
//
// Response branches, and the cases that reach them (names start with the topic):
//
//   403 {ok:false}                      "not the owner": visitor, signed-in studio client
//   404 "Not found"                     "portal flag": off, "True", unset, flag off wins over no database
//   503 "Project messages ..."         "unavailable": no MUSIC_DB (no ctx is not needed)
//   404 {ok:false}                      "no id param": no id, empty id; "project": unknown id, not a service request (read and
//                                       send; the lookup comes before validation, so an invalid message to an unknown
//                                       project is a 404)
//   musicRequest (8192 byte cap)        "origin" 403, "content type" 415, "no request body" 400, "body over 8192 bytes" 413,
//                                       "invalid JSON" 400
//   400 "Check your message ..."       "schema": non-objects, action missing/unknown, send with no body key (accepted by the
//                                       schema, refused by the validation), read with messageId missing/0/-1/1.5/text/null
//   400 "Write up to 4,000 ..."        "send": not text (number, null, boolean, array, object), empty, spaces only, 4001
//                                       characters, a NUL or other control character, http://, www., ftp://, a javascript://
//                                       link, a link with credentials, "https://" with no host, a link in capitals
//   200 {ok:true,message}               "send": plain text, 4000 characters, trimmed, unicode, markup, https links (with
//                                       trailing punctuation), mailto: and javascript: with no "//", tab and newline, from
//                                       every stage but complete, new or resolved requests, a blank owner email
//   409 {ok:false}                      "send": a complete project, access revoked, a withdrawn request, losing a race
//   200 {ok:true} (read)                "read": a client message (stamped read), an already read one (kept), an owner message,
//                                       another project's message, an unknown id, a huge id
//   503 catch                           "outage": the project lookup, the insert, the read update
//   sequences                           "send", "read twice", "after complete", "outage then repeat"

const step = routeStep("messages");

const TABLES = ["audio_project_messages"];

const act = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	step(body, { dump: { music: TABLES }, ...extra });

const send = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	act({ action: "send", body }, extra);

const read = (
	messageId: JsonValue | undefined,
	extra: Partial<Step> = {},
): Step => act({ action: "read", messageId }, extra);

/** A project at `stage` with one unread client message (id 1) and one owner message (id 2). */
const talk = (stage = "in_progress", parts: Parts = {}): Partial<Case> =>
	world({
		project: atStage(stage),
		messages: [
			message({ body: "Can you add more reverb?" }),
			message({
				actor: "owner",
				actor_id: "owner@example.test",
				body: "Sure, on it.",
			}),
		],
		...parts,
	});

const named = (name: string, base: Partial<Case>, ...steps: Step[]): Case => ({
	...base,
	name,
	steps,
});

const flag = (name: string, env: Case["env"], omit?: Case["omit"]): Case => ({
	name,
	...talk(),
	env,
	omit,
	steps: [send("hello")],
});

const schema = (name: string, body: JsonValue | undefined): Case =>
	named(`schema: ${name}`, talk(), act(body));

const text = (
	name: string,
	value: JsonValue | undefined,
	parts: Parts = {},
): Case => named(`send: ${name}`, talk("in_progress", parts), send(value));

const long = (n: number) => "a".repeat(n);

const SELECT_PROJECT = /SELECT request_id FROM audio_projects/;
const INSERT = /INSERT INTO audio_project_messages/;
const MARK = /UPDATE audio_project_messages SET read_at/;

const matrix: Case[] = STAGES.map((stage) =>
	named(
		`send: from a project at ${stage}`,
		talk(stage),
		send("A note for you."),
	),
);

const cases: Case[] = [
	named("not the owner: a visitor", talk(), send("hello", { as: asVisitor() })),
	named(
		"not the owner: a signed-in studio client",
		talk(),
		send("hello", { as: asClient("grace@example.test") }),
	),
	flag("portal flag: off", { AUDIO_CLIENT_PORTAL_ENABLED: "false" }),
	flag("portal flag: 'True' is not 'true'", {
		AUDIO_CLIENT_PORTAL_ENABLED: "True",
	}),
	flag("portal flag: not set", undefined, ["AUDIO_CLIENT_PORTAL_ENABLED"]),
	{
		name: "portal flag: off wins over a missing database",
		music: { missing: true },
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
		steps: [send("hello")],
	},
	{
		name: "unavailable: no database binding",
		music: { missing: true },
		steps: [send("hello")],
	},
	{
		...named(
			"unavailable: no execution context is not needed",
			talk(),
			send("hello"),
		),
		noContext: true,
	},
	named("no id param: 404", talk(), send("hello", { params: {} })),
	named(
		"no id param: an empty id param",
		talk(),
		send("hello", { params: { id: "" } }),
	),
	// musicRequest
	named("origin: missing", talk(), send("hello", { headers: {} })),
	named(
		"origin: another site",
		talk(),
		send("hello", { headers: { origin: "https://example.test" } }),
	),
	named(
		"origin: the right host over http",
		talk(),
		send("hello", { headers: { origin: "http://thesuperhuman.us" } }),
	),
	named(
		"content type: missing",
		talk(),
		rawStep("messages", '{"action":"send","body":"hi"}', {
			headers: { origin: "https://thesuperhuman.us" },
		}),
	),
	named(
		"content type: text/plain",
		talk(),
		rawStep("messages", '{"action":"send","body":"hi"}', {
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "text/plain",
			},
		}),
	),
	named(
		"content type: a charset suffix is accepted",
		talk(),
		rawStep("messages", '{"action":"send","body":"hi"}', {
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "application/json; charset=utf-8",
			},
			dump: { music: TABLES },
		}),
	),
	named("no request body", talk(), {
		...rawStep("messages", ""),
		body: undefined,
	}),
	named(
		"body over 8192 bytes",
		talk(),
		rawStep("messages", JSON.stringify({ action: "send", body: long(8200) })),
	),
	named("invalid JSON: bad text", talk(), rawStep("messages", "{not json")),
	named("invalid JSON: empty text", talk(), rawStep("messages", "")),
	// schema
	schema("null", null),
	schema("an array", []),
	schema("a string", "send"),
	schema("no action", {}),
	schema("an unknown action", { action: "delete", messageId: 1 }),
	schema("action in capitals", { action: "SEND", body: "hi" }),
	schema("send with no body key", { action: "send" }),
	schema("read with no messageId", { action: "read" }),
	schema("read with messageId 0", { action: "read", messageId: 0 }),
	schema("read with messageId -1", { action: "read", messageId: -1 }),
	schema("read with messageId 1.5", { action: "read", messageId: 1.5 }),
	schema("read with messageId as text", { action: "read", messageId: "1" }),
	schema("read with messageId null", { action: "read", messageId: null }),
	// the project lookup comes first
	named(
		"project: unknown id (send)",
		talk(),
		send("hello", {
			params: { id: "nope" },
			path: "/api/owner/projects/nope/messages",
		}),
	),
	named(
		"project: unknown id (read)",
		talk(),
		read(1, {
			params: { id: "nope" },
			path: "/api/owner/projects/nope/messages",
		}),
	),
	named(
		"project: unknown id with an invalid message is still a 404",
		talk(),
		send("", {
			params: { id: "nope" },
			path: "/api/owner/projects/nope/messages",
		}),
	),
	named(
		"project: a request that is not a service request has no project",
		talk("in_progress", {
			request: rows.ownerRequest("r1", {
				kind: "purchase",
				status: "reviewed",
			}),
			payment: null,
			messages: [],
		}),
		send("hello"),
	),
	// send: not text
	text("a number", 5),
	text("null", null),
	text("a boolean", true),
	text("a list", ["hello"]),
	text("an object", { text: "hello" }),
	text("an empty string", ""),
	text("only spaces and newlines", "  \n\t "),
	text("4001 characters", long(4001)),
	text("4000 characters", long(4000)),
	text("4001 characters with padding that trims to 4000", ` ${long(4000)} `),
	// control characters
	text("a NUL character", "before\u0000after"),
	text("a backspace character", "before\u0008after"),
	text("a vertical tab", "before\u000bafter"),
	text("a form feed", "before\u000cafter"),
	text("a unit separator", "before\u001fafter"),
	text("a tab, newline and carriage return are allowed", "line1\tcol\r\nline2"),
	text("a DEL character is allowed", "before\u007fafter"),
	// links
	text("an https link", "Listen here https://example.com/mix?x=1&y=2 please"),
	text(
		"an https link with trailing punctuation",
		"See https://example.com/a), then https://example.com/b.",
	),
	text("an https link in capitals", "HTTPS://EXAMPLE.COM/Path"),
	text("two https links", "https://a.example.com and https://b.example.com"),
	text("an http link", "Listen here http://example.com/mix"),
	text(
		"an http link after an https link",
		"https://ok.example.com then http://bad.example.com",
	),
	text("a www link with no scheme", "Listen at www.example.com/mix"),
	text("an ftp link", "ftp://example.com/file"),
	text("a javascript:// link", "javascript://example.com/%0Aalert(1)"),
	text("a link with credentials", "https://user:pass@example.com/mix"),
	text("a link with a username only", "https://user@example.com/mix"),
	text("https:// with nothing after it", "see https:// for details"),
	text("https:// followed by a dot", "see https://. now"),
	text(
		"mailto: with no slashes is not a link",
		"mail me: mailto:someone@example.com",
	),
	text("javascript: with no slashes is not a link", "javascript:alert(1)"),
	text(
		"a data: URI with no slashes is not a link",
		"data:text/html,<script>alert(1)</script>",
	),
	text("a link in angle brackets", "<https://example.com/a>"),
	text(
		"a link followed by a quote",
		`"https://example.com/a" and 'https://example.com/b'`,
	),
	text("a host with an IP and a port", "https://127.0.0.1:8080/x"),
	text("a link with unicode in the host", "https://bücher.example/straße"),
	// accepted text
	text("plain text", "Your mix is ready for a listen."),
	text("padding is trimmed", "   trimmed   "),
	text("unicode and emoji", "Café \u{1F3B5} 日本語 ñ"),
	text(
		"markup, ampersands and quotes are stored as typed",
		`<script>alert("x")</script> & <b>bold</b> 'single' "double"`,
	),
	text("a SQL-looking text", `'); DROP TABLE audio_project_messages; --`),
	text("a request with a withdrawn status", "hello", {
		request: service({ status: "withdrawn" }),
	}),
	text("a request with a resolved status", "hello", {
		request: service({ status: "resolved" }),
	}),
	text("a request with a new status", "hello", {
		request: service({ status: "new" }),
	}),
	text("access revoked", "hello", {
		project: atStage("in_progress", { revoked_at: EARLIER }),
	}),
	named(
		"send: a blank owner email is stored as the sender id",
		talk(),
		send("hello", { as: asOwner("   ") }),
	),
	named(
		"send: a mixed-case owner email is stored as given",
		talk(),
		send("hello", { as: asOwner("Owner@Example.TEST") }),
	),
	...matrix,
	// read
	named("read: a client's unread message is stamped read", talk(), read(1)),
	named(
		"read: an already read message keeps its first read time",
		talk("in_progress", { messages: [message({ read_at: EARLIER })] }),
		read(1, { advanceMs: 60_000 }),
	),
	named("read: the owner's own message is not changed", talk(), read(2)),
	named("read: an unknown message id still answers ok", talk(), read(999)),
	named("read: a huge message id still answers ok", talk(), read(2 ** 53 - 1)),
	named(
		"read: another project's message is not changed",
		talk("in_progress", {
			moreRequests: [
				rows.ownerRequest("r2", {
					service_id: "vocal-mix",
					status: "reviewed",
					email: "ada@example.test",
				}),
			],
			messages: [
				message(),
				message({ request_id: "r2", actor_id: "ada@example.test" }),
			],
		}),
		read(2),
	),
	named(
		"read: works on a revoked project",
		talk("in_progress", {
			project: atStage("in_progress", { revoked_at: EARLIER }),
		}),
		read(1),
	),
	named("read: works on a complete project", talk("complete"), read(1)),
	named(
		"read: works on a withdrawn request",
		talk("in_progress", { request: service({ status: "withdrawn" }) }),
		read(1),
	),
	named(
		"read: a blank owner email still reads",
		talk(),
		read(1, { as: asOwner("   ") }),
	),
	// races and outages
	{
		...named(
			"send: the project completes just before the insert",
			talk(),
			send("hello"),
		),
		interleave: [
			{
				on: INSERT,
				label: "the project completes",
				run: sql(`UPDATE audio_projects SET stage='complete'`),
			},
		],
	},
	{
		...named(
			"send: access is revoked just before the insert",
			talk(),
			send("hello"),
		),
		interleave: [
			{
				on: INSERT,
				label: "access is revoked",
				run: sql(
					`UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'`,
				),
			},
		],
	},
	{
		...named(
			"send: the request is withdrawn just before the insert",
			talk(),
			send("hello"),
		),
		interleave: [
			{
				on: INSERT,
				label: "the request is withdrawn",
				run: sql(`UPDATE owner_requests SET status='withdrawn'`),
			},
		],
	},
	{
		...named(
			"read: the message is read elsewhere just before the update",
			talk(),
			read(1),
		),
		interleave: [
			{
				on: MARK,
				label: "the message is read elsewhere",
				run: sql(
					`UPDATE audio_project_messages SET read_at='2026-11-13T11:30:00.000Z' WHERE id=1`,
				),
			},
		],
	},
	{
		...named("outage: the project lookup fails (send)", talk(), send("hello")),
		failures: [{ on: SELECT_PROJECT, message: "D1 is down" }],
	},
	{
		...named("outage: the project lookup fails (read)", talk(), read(1)),
		failures: [{ on: SELECT_PROJECT, message: "D1 is down" }],
	},
	{
		...named("outage: the insert fails", talk(), send("hello")),
		failures: [{ on: INSERT, message: "D1 is down" }],
	},
	{
		...named("outage: the read update fails", talk(), read(1)),
		failures: [{ on: MARK, message: "D1 is down" }],
	},
	// sequences
	named(
		"sequence: two messages in a row get two ids",
		talk(),
		send("first"),
		send("second", { advanceMs: 1000 }),
	),
	named(
		"sequence: read the client's message twice",
		talk(),
		read(1),
		read(1, { advanceMs: 60_000 }),
	),
	named(
		"sequence: send, then read the owner's own new message",
		talk(),
		send("first"),
		read(3, { advanceMs: 1000 }),
	),
	named(
		"sequence: the project completes, then a send is refused but a read works",
		talk(),
		send("last words"),
		read(1, {
			advanceMs: 1000,
			before: {
				label: "the project completes",
				run: (w) => w.music.exec(`UPDATE audio_projects SET stage='complete'`),
			},
		}),
		send("too late", { advanceMs: 1000 }),
	),
	{
		...named(
			"sequence: the first send fails, the second saves",
			talk(),
			send("again"),
			send("again", { advanceMs: 1000 }),
		),
		failures: [{ on: INSERT, message: "D1 is down" }],
	},
	named(
		"sequence: an invalid message, then a valid one",
		talk(),
		send("http://nope.example"),
		send("https://yes.example", { advanceMs: 1000 }),
	),
];

defineCorpus("owner-project-messages", POST, cases);
