import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/messages";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";
import {
	BASE,
	EARLIER,
	OWNER,
	owner,
	running,
	update,
} from "./areas/software-projects";

// The golden corpus for POST /api/owner/requests/[id]/messages: the owner sends a software client a message on the
// project, or marks a client's message read.
//
// Every response branch of the handler, of validateProjectMessage (src/lib/audio-project-messages.ts) and of
// postOwnerSoftwareProjectMessage / markProjectMessagesRead (src/lib/software-project-messages.ts), and the cases:
//
//   handler
//   403 {ok:false}              a visitor, a signed-in client
//   404 text "Not found"        portal flag "false", flag missing, flag "TRUE" (capitals)
//   503 "temporarily unavailable"  no MUSIC_DB
//   404 {ok:false}              no id param, empty id param, no project for the id (unknown id, request with no project)
//   musicRequest (8192 bytes)   403 no/foreign Origin; 415 text/plain, form; 400 no body; 413 over 8192 bytes, and 4000
//                               three-byte characters (12000 bytes: a valid-length message the byte limit refuses);
//                               400 Invalid JSON (bad JSON, empty body)
//   400 "Check your message"    null, array, string, number body; no action, unknown action, non-text action; read with no
//                               messageId, 0, negative, fractional, text, null
//   read -> 200 {ok:true}       marks a client message read; no change for an owner message, a message already read, an
//                               unknown id, another project's message; a decision message is marked read like any client
//                               message
//   send
//   400 "Write up to 4,000"     body key missing (fails the schema), body null (passes it), blank, whitespace only, not text (number,
//                               array, object, true), 4001 characters, a control character, an http://, ftp:// or www.
//                               link, https with credentials, an https link with no host
//   200 {ok:true,message}       plain, trimmed, unicode, markup (stored as typed), https links (trailing punctuation,
//                               several), exactly 4000, line breaks, a tab, every project state but complete, a resolved
//                               request, content deleted, a mixed-case owner email
//   409 {ok:false}              project complete, access revoked, request withdrawn, a race that closes the project
//   503 "could not be saved"    the project lookup, the insert, or the read update throws
//
// The route sends no email; every case records no outgoing fetch.
//
// Multi-step: send, send, read the client's reply; send after the project completes; send, revoke, send; a read twice.

const PATH = "messages";
const TABLES = ["software_project_messages"];

const one = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	owner(body, { route: PATH, dump: { music: TABLES }, ...extra });

const send = (body: JsonValue | undefined, extra: Partial<Step> = {}) =>
	one({ action: "send", body }, extra);

const read = (messageId: JsonValue | undefined, extra: Partial<Step> = {}) =>
	one({ action: "read", messageId }, extra);

const clientNote = (over: SeedRow = {}): SeedRow => ({
	request_id: "r1",
	actor: "client",
	actor_id: "client-hash",
	body: "Looks good",
	created_at: EARLIER,
	...over,
});

const ownerNote = (over: SeedRow = {}): SeedRow =>
	clientNote({ actor: "owner", actor_id: OWNER, body: "Update", ...over });

const withMessages = (extra: { [t: string]: SeedRow[] } = {}) =>
	running({
		extra: { software_project_messages: [clientNote(), ownerNote()], ...extra },
	});

const plain = (name: string, step: Step, extra: Partial<Case> = {}): Case => ({
	name,
	music: { seed: running() },
	steps: [step],
	...extra,
});

const state = (name: string, project: SeedRow, request: SeedRow = {}): Case =>
	plain(name, send("Hello"), {
		music: { seed: running({ project, request }) },
	});

const LONG = "a".repeat(4000);

const base = running();

const cases: Case[] = [
	// actor and gates
	plain("a visitor", send("Hello", { as: asVisitor() })),
	{
		name: "a signed-in client",
		music: { seed: running() },
		steps: [send("Hello", { as: asClient("grace@example.test") })],
	},
	plain("the portal flag is false", send("Hello"), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	plain("the portal flag is missing", send("Hello"), {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
	}),
	plain("the portal flag in capitals", send("Hello"), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" },
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [send("Hello")],
	},
	plain("no id param", send("Hello", { params: {} })),
	plain("an empty id param", send("Hello", { params: { id: "" } })),
	plain(
		"no project for the id",
		send("Hello", { path: `${BASE}/nope/${PATH}`, params: { id: "nope" } }),
	),
	{
		name: "a request that has no project",
		music: { seed: { owner_requests: [rows.softwareRequest("r1")] } },
		steps: [send("Hello")],
	},
	// musicRequest
	plain("an empty origin header", send("Hello", { headers: { origin: "" } })),
	plain(
		"a foreign origin",
		send("Hello", { headers: { origin: "https://evil.example" } }),
	),
	plain(
		"a text/plain body",
		one(undefined, {
			body: '{"action":"read","messageId":1}',
			headers: { "content-type": "text/plain" },
		}),
	),
	plain(
		"a urlencoded form body",
		one(undefined, {
			body: "action=read&messageId=1",
			headers: { "content-type": "application/x-www-form-urlencoded" },
		}),
	),
	plain("no body at all", one(undefined)),
	plain("bad JSON", one(undefined, { body: "{nope" })),
	plain("an empty body", one(undefined, { body: "" })),
	plain("a body over 8192 bytes", send("a".repeat(9000))),
	plain(
		"4000 three-byte characters are over the byte limit",
		send("€".repeat(4000)),
	),
	plain("4000 two-byte characters fit the byte limit", send("é".repeat(4000))),
	// schema
	plain("a null body", one(null)),
	plain("an array body", one([])),
	plain("a string body", one("send")),
	plain("a number body", one(3)),
	plain("no action", one({ body: "Hello" })),
	plain("an unknown action", one({ action: "delete" })),
	plain("an action that is not text", one({ action: 1 })),
	plain("read with no messageId", one({ action: "read" })),
	plain("read with messageId 0", read(0)),
	plain("read with a negative messageId", read(-1)),
	plain("read with a fractional messageId", read(1.5)),
	plain("read with a text messageId", read("1")),
	plain("read with a null messageId", read(null)),
	plain("send with no body key", one({ action: "send" })),
	plain(
		"extra fields are ignored on send",
		one({ action: "send", body: "Hi", extra: 1 }),
	),
	// read
	{
		name: "read marks a client message read",
		music: { seed: withMessages() },
		steps: [read(1)],
	},
	{
		name: "read leaves an owner message unread",
		music: { seed: withMessages() },
		steps: [read(2)],
	},
	{
		name: "read of an unknown message",
		music: { seed: withMessages() },
		steps: [read(99)],
	},
	{
		name: "read of a message already read",
		music: {
			seed: running({
				extra: {
					software_project_messages: [clientNote({ read_at: EARLIER })],
				},
			}),
		},
		steps: [read(1)],
	},
	{
		name: "read of a message on another project",
		music: {
			seed: {
				...base,
				owner_requests: [
					...base.owner_requests,
					rows.softwareRequest("r2", { status: "reviewed" }),
				],
				software_offers: [
					...base.software_offers,
					rows.softwareOffer("o2", "r2"),
				],
				software_projects: [
					...base.software_projects,
					rows.softwareProject("r2", "o2"),
				],
				software_project_messages: [clientNote({ request_id: "r2" })],
			},
		},
		steps: [read(1)],
	},
	{
		name: "read of a client decision message",
		music: {
			seed: running({
				extra: {
					software_project_updates: [update("u1")],
					software_project_messages: [
						clientNote({
							update_id: "u1",
							decision: "milestone_accepted",
							body: "Accepted Delivery v1 for milestone 1.",
						}),
					],
				},
			}),
		},
		steps: [read(1)],
	},
	{
		name: "read on a completed project",
		music: {
			seed: running({
				project: { state: "complete", completed_at: EARLIER },
				extra: { software_project_messages: [clientNote()] },
			}),
		},
		steps: [read(1)],
	},
	{
		name: "read on a revoked project",
		music: {
			seed: running({
				project: { revoked_at: EARLIER },
				extra: { software_project_messages: [clientNote()] },
			}),
		},
		steps: [read(1)],
	},
	// send validation
	plain("send null", send(null)),
	plain("send an empty message", send("")),
	plain("send only whitespace", send("  \n\t ")),
	plain("send a number", send(5)),
	plain("send an array", send(["Hello"])),
	plain("send an object", send({ text: "Hello" })),
	plain("send true", send(true)),
	plain("send 4001 characters", send(`${LONG}a`)),
	plain("send exactly 4000 characters", send(LONG)),
	plain("send 4000 characters with spaces around them", send(`  ${LONG}  `)),
	plain("send a control character", send("Hello\u0007there")),
	plain("send a null character", send("Hello\u0000there")),
	plain(
		"send a tab and line breaks",
		send("Line one\n\tLine two\r\nLine three"),
	),
	plain("send a form feed", send("Hello\u000cthere")),
	plain("send with spaces trimmed", send("   Hello   ")),
	plain("send unicode and emoji", send("Café ☃ 😀 你好")),
	plain("send a lone surrogate", send("Hello \ud800 there")),
	plain(
		"send markup and quotes",
		send("<b>Hi</b> & \"you\" <script>alert('x')</script>"),
	),
	plain(
		"send an https link",
		send("Preview: https://preview.example/app?x=1&y=2#top"),
	),
	plain(
		"send several https links with trailing punctuation",
		send(
			"See https://a.example/x. Then (https://b.example/y), or https://c.example/z!",
		),
	),
	plain("send an http link", send("Preview: http://preview.example")),
	plain("send an ftp link", send("Files: ftp://files.example/x")),
	plain("send a www link", send("Go to www.example.com now")),
	plain(
		"send a link with an uppercase scheme",
		send("Go to HTTPS://EXAMPLE.COM/x"),
	),
	plain(
		"send a link with credentials",
		send("Go to https://user:pw@example.com/x"),
	),
	plain("send an https link with no host", send("Go to https:// now")),
	plain(
		"send a mailto and a javascript scheme",
		send("mailto:a@b.example and javascript:alert(1)"),
	),
	plain("send a custom scheme link", send("Open slack://channel?id=1")),
	// send by state
	state("send while preparing", { state: "preparing" }),
	state("send while building", { state: "building" }),
	state("send while waiting for input", {
		state: "waiting_for_input",
		waiting_for: "Logo",
	}),
	state("send while ready for review", { state: "ready_for_review" }),
	state("send after completion", { state: "complete", completed_at: EARLIER }),
	state("send when access is revoked", { revoked_at: EARLIER }),
	state("send when content is deleted", { content_deleted_at: EARLIER }),
	state("send on a resolved request", {}, { status: "resolved" }),
	state("send on a withdrawn request", {}, { status: "withdrawn" }),
	state("send on a request that is new", {}, { status: "new" }),
	plain(
		"send as an owner with a mixed-case email",
		send("Hello", { as: asOwner("Owner@Example.TEST") }),
	),
	// outages and races
	plain("the project lookup throws", send("Hello"), {
		failures: [
			{ on: /SELECT request_id FROM software_projects/, message: "d1 down" },
		],
	}),
	plain("the insert throws", send("Hello"), {
		failures: [
			{ on: /INSERT INTO software_project_messages/, message: "d1 down" },
		],
	}),
	{
		name: "the read update throws",
		music: { seed: withMessages() },
		failures: [
			{
				on: /UPDATE software_project_messages SET read_at/,
				message: "d1 down",
			},
		],
		steps: [read(1)],
	},
	plain("the project completes before the insert", send("Hello"), {
		interleave: [
			{
				on: /INSERT INTO software_project_messages/,
				label: "the project completes",
				run: (sqlite) =>
					sqlite.exec(`UPDATE software_projects SET state='complete'`),
			},
		],
	}),
	plain("access is revoked before the insert", send("Hello"), {
		interleave: [
			{
				on: /INSERT INTO software_project_messages/,
				label: "access is revoked",
				run: (sqlite) =>
					sqlite.exec(`UPDATE software_projects SET revoked_at='${EARLIER}'`),
			},
		],
	}),
	plain("the request is withdrawn before the insert", send("Hello"), {
		interleave: [
			{
				on: /INSERT INTO software_project_messages/,
				label: "the request is withdrawn",
				run: (sqlite) =>
					sqlite.exec(`UPDATE owner_requests SET status='withdrawn'`),
			},
		],
	}),
	// sequences
	plain("send, send, then read the client's reply", send("First"), {
		music: { seed: withMessages() },
		steps: [
			send("First"),
			send("Second", { advanceMs: 1000 }),
			read(1, { advanceMs: 1000 }),
		],
	}),
	plain("a read twice", read(1), {
		music: { seed: withMessages() },
		steps: [read(1), read(1, { advanceMs: 5000 })],
	}),
	plain("send, the project completes, send again", send("Before"), {
		steps: [
			send("Before"),
			send("After", {
				advanceMs: 1000,
				before: {
					label: "the project completes",
					run: (world) => {
						world.music.exec(`UPDATE software_projects SET state='complete'`);
					},
				},
			}),
		],
	}),
	plain("send, revoke access, send again", send("Before"), {
		steps: [
			send("Before"),
			send("After", {
				advanceMs: 1000,
				before: {
					label: "access is revoked",
					run: (world) => {
						world.music.exec(
							`UPDATE software_projects SET revoked_at='${EARLIER}'`,
						);
					},
				},
			}),
		],
	}),
	plain("the same message sent twice is stored twice", send("Same"), {
		steps: [send("Same"), send("Same")],
	}),
];

defineCorpus("owner-request-messages", POST, cases);
