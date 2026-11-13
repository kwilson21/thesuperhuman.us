import { POST } from "~/pages/api/studio/projects/[id]/messages";
import {
	ADA,
	ADA_TOKEN,
	AUDIO_TABLES,
	EARLIER,
	GRACE,
	GRACE_TOKEN,
	NOW,
	OTHER_TOKEN,
	ORIGIN,
	audioFile,
	audioProjectState,
	audioRequest,
	audioSeed,
	clientMessages,
	message,
	revisionRounds,
	session,
} from "./areas/studio-messages";
import {
	asClient,
	asClientCookie,
	asVisitor,
	defineCorpus,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";

// The golden corpus for POST /api/studio/projects/[id]/messages: a signed-in studio client sends a message on an audio
// project, marks an owner message read, or answers the published review (approve, request changes, stop).
//
// Every response branch of the handler and of its library calls, and the cases that reach each:
//
//   handler (src/pages/api/studio/projects/[id]/messages.ts)
//   404 text "Not found"          portal off (flag "false", flag missing)
//   503 "temporarily unavailable" no MUSIC_DB
//   401 {ok:false}                no cookie, malformed cookie, wrong cookie name, no id param
//   musicRequest (src/lib/music-request.ts, reached only with a cookie)
//     403 Forbidden               no Origin, foreign Origin
//     415 JSON required           text/plain, urlencoded form, no content-type
//     400 Missing request         no body at all
//     413 Request too large       over 8192 bytes
//     400 Invalid JSON            bad JSON, empty body
//   400 "Check your message"      null, array, string, number, unknown action, no action, action not text, read without
//                                 messageId, messageId 0 / negative / fractional / text, respond without reviewId, empty
//                                 reviewId, reviewId over 100, decision unknown / missing / not text
//   404 {ok:false}                unknown session, uppercase token, revoked session, expired session, another client's
//                                 project, project revoked, request withdrawn, request with blank email, unknown project
//   200 {ok:true}                 read (marks an owner message read; no-op for a client message, a read one, an unknown id)
//   respond
//     400 "Write the changes"     changes with no body, whitespace, non-text body, an invalid body (http link)
//     400 "Write up to 4,000"     approved/stopped with an invalid body (http link, control character, over 4000)
//     200 {ok:true,message}       approved (own notes, default text, non-text body), changes with notes while rounds remain,
//                                 stopped once both rounds are used (revokes this project only, writes the audit row)
//     429 wait a few minutes      12 client messages in the window and the answer refused
//     409 "not available"         every stage but review_ready, no published review, already decided, review id of an older
//                                 or revoked or final file, changes with no rounds left, stopped with rounds left,
//                                 request withdrawn mid-flight, lost races
//   send
//     400 "Write up to 4,000"     body missing, blank, not text, over 4000, control character, a link that is not https
//     200 {ok:true,message}       plain, unicode, markup, https links, exactly 4000, line breaks and tabs
//     429                         12 client messages in the window
//     409 {ok:false}              project complete, lost races
//   503 "could not be saved"      any database step that throws: project lookup, insert, stop batch, rate-limit count,
//                                 read update
//   postClientReviewDecision      stage x decision (21 cases), rounds 0/1/2/3, the stopped batch, the answer window
//                                 (decision before publish, at publish), two reviews published (latest only)
//   owner notification            none: the route sends no email. Every case records no outgoing fetch.
//
// Multi-step sequences: repeated sends to the rate limit, approve then approve/stop/send, changes twice, a new review
// published between answers, a stopped project closes its access while the client's other project stays open.

const BASE = "/api/studio/projects";
const ROUNDS_USED = 2;

const GOOD = asClientCookie(GRACE_TOKEN);

const ownerNote = { id: 1, ...message("r1", "owner") };

const post = (json: Step["json"], extra: Partial<Step> = {}): Step => ({
	as: GOOD,
	path: `${BASE}/r1/messages`,
	params: { id: "r1" },
	headers: { origin: ORIGIN },
	json,
	dump: { music: AUDIO_TABLES },
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

const respond = (
	decision: Step["json"],
	body: Step["json"] = null,
	extra: Partial<Step> = {},
	reviewId: Step["json"] = "f1",
) => post({ action: "respond", reviewId, decision, body }, extra);

type Options = {
	stage?: string;
	revoked?: string | null;
	extra?: { [table: string]: SeedRow[] };
	request?: SeedRow;
	states?: { [id: string]: { stage?: string; revokedAt?: string | null } };
};

const audioCase = (
	name: string,
	options: Options,
	steps: Step[],
	more: Partial<Case> = {},
): Case => ({
	name,
	music: { seed: audioSeed(options.extra, options.request) },
	setup: audioProjectState(
		options.states ?? {
			r1: { stage: options.stage ?? "in_progress", revokedAt: options.revoked },
		},
	),
	steps,
	...more,
});

const STAGES = [
	"files_under_review",
	"accepted",
	"in_progress",
	"review_ready",
	"revision_in_progress",
	"final_files_ready",
	"complete",
] as const;

const DECISIONS = ["approved", "changes", "stopped"] as const;

const sendCase = (name: string, body: Step["json"], options: Options = {}) =>
	audioCase(name, options, [text(body)]);

const raceOnInsert = (
	label: string,
	sql: string,
	nth = 1,
	on = /INSERT INTO audio_project_messages/,
) => ({
	interleave: [
		{
			on,
			nth,
			label,
			run: (sqlite: { exec: (sql: string) => void }) => sqlite.exec(sql),
		},
	],
});

const sessionTables = [...AUDIO_TABLES, "audio_client_sessions"];

const cases: Case[] = [
	// ---- the first checks, before any database read
	audioCase("portal off: the flag is false", {}, [text("Hello")], {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	audioCase("portal off: the flag is not set", {}, [text("Hello")], {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [text("Hello")],
	},
	audioCase("no cookie at all", {}, [text("Hello", { as: asVisitor() })]),
	audioCase("a studio_session cookie that is too short", {}, [
		text("Hello", { as: asClientCookie("abc123") }),
	]),
	audioCase("a cookie with another name", {}, [
		text("Hello", {
			as: asVisitor(),
			headers: { origin: ORIGIN, cookie: `session=${GRACE_TOKEN}` },
		}),
	]),
	audioCase("a cookie followed by another cookie", {}, [
		text("Hello", {
			as: asVisitor(),
			headers: {
				origin: ORIGIN,
				cookie: `theme=dark; studio_session=${GRACE_TOKEN}; other=1`,
			},
		}),
	]),
	audioCase("no id param", {}, [text("Hello", { params: {} })]),
	audioCase("an empty id param", {}, [text("Hello", { params: { id: "" } })]),
	audioCase("no cookie and a bad body: the cookie check comes first", {}, [
		raw("{bad", { as: asVisitor() }),
	]),
	// ---- refusals, each reason alone (all 404)
	audioCase("a session no one issued", {}, [
		text("Hello", { as: asClientCookie(OTHER_TOKEN) }),
	]),
	audioCase("a session token in capitals", {}, [
		text("Hello", { as: asClientCookie(GRACE_TOKEN.toUpperCase()) }),
	]),
	audioCase(
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
	audioCase(
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
	audioCase(
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
	audioCase("another client's project", {}, [
		text("Hello", { as: asClientCookie(ADA_TOKEN) }),
	]),
	audioCase("a project whose access was closed", { revoked: EARLIER }, [
		text("Hello"),
	]),
	audioCase("a withdrawn request", { request: { status: "withdrawn" } }, [
		text("Hello"),
	]),
	audioCase(
		"a request with a blank email",
		{
			request: { email: "" },
			extra: { audio_client_sessions: [session(GRACE_TOKEN, "")] },
		},
		[text("Hello")],
	),
	audioCase("a project id that does not exist", {}, [
		text("Hello", { path: `${BASE}/nope/messages`, params: { id: "nope" } }),
	]),
	audioCase(
		"a resolved request still lets the client write",
		{
			stage: "in_progress",
			request: { status: "resolved" },
		},
		[text("Hello")],
	),
	{
		name: "a signed-in client through the real sign-in",
		music: { seed: audioSeed() },
		setup: audioProjectState({ r1: { stage: "in_progress" } }),
		steps: [
			text("Hello from a real session", {
				as: asClient(GRACE),
				dump: { music: sessionTables },
			}),
		],
	},
	// ---- Origin, content type, size and JSON
	audioCase("no Origin header", {}, [text("Hello", { headers: {} })]),
	audioCase("an Origin from another site", {}, [
		text("Hello", { headers: { origin: "https://evil.example" } }),
	]),
	audioCase("an Origin with a port", {}, [
		text("Hello", { headers: { origin: `${ORIGIN}:8443` } }),
	]),
	audioCase("content type text/plain", {}, [
		raw('{"action":"send","body":"Hello"}', {
			headers: { origin: ORIGIN, "content-type": "text/plain" },
		}),
	]),
	audioCase("an urlencoded form", {}, [
		raw("action=send&body=Hello", {
			headers: {
				origin: ORIGIN,
				"content-type": "application/x-www-form-urlencoded",
			},
		}),
	]),
	audioCase("no content type", {}, [
		raw('{"action":"send","body":"Hello"}', { headers: { origin: ORIGIN } }),
	]),
	audioCase("a JSON content type in capitals with a charset", {}, [
		raw('{"action":"send","body":"Hello"}', {
			headers: {
				origin: ORIGIN,
				"content-type": "Application/JSON; charset=utf-8",
			},
		}),
	]),
	audioCase("a lower-case JSON content type with a charset", {}, [
		raw('{"action":"send","body":"Hello"}', {
			headers: {
				origin: ORIGIN,
				"content-type": "application/json; charset=utf-8",
			},
		}),
	]),
	audioCase("no request body", {}, [
		post(undefined, {
			headers: { origin: ORIGIN, "content-type": "application/json" },
		}),
	]),
	audioCase("an empty body", {}, [raw("")]),
	audioCase("bad JSON", {}, [raw("{not json")]),
	audioCase("a body over 8192 bytes", {}, [text("a".repeat(8200))]),
	audioCase("a body of exactly 8192 bytes is not too large", {}, [
		raw(
			`{"action":"send","body":"${"a".repeat(8192 - '{"action":"send","body":""}'.length)}"}`,
		),
	]),
	audioCase("a null body", {}, [raw("null")]),
	audioCase("an array body", {}, [raw("[]")]),
	audioCase("a string body", {}, [raw('"send"')]),
	audioCase("a number body", {}, [raw("5")]),
	audioCase("an unknown action", {}, [post({ action: "delete" })]),
	audioCase("no action", {}, [post({ body: "Hello" })]),
	audioCase("an action that is not text", {}, [post({ action: 5 })]),
	// ---- send: validation of the text
	sendCase("send with no body field", undefined),
	sendCase("a body that is a number", 5),
	sendCase("a body that is an object", { text: "Hello" }),
	sendCase("a body that is an array", ["Hello"]),
	sendCase("a null body text", null),
	sendCase("an empty message", ""),
	sendCase("a message of spaces", "   \n\t  "),
	sendCase("a message of 4001 characters", "a".repeat(4001)),
	sendCase("a message of exactly 4000 characters", "a".repeat(4000)),
	sendCase(
		"a message of 4000 characters inside spaces",
		` ${"a".repeat(4000)} `,
	),
	sendCase("a message with a control character", "bad\u0001text"),
	sendCase("a message with a null character", "bad\u0000text"),
	sendCase(
		"a message with a line break and a tab",
		"line one\n\tline two\r\nthree",
	),
	sendCase("a message with a form feed", "a\u000cb"),
	sendCase("a message with a delete character", "a\u007fb"),
	sendCase(
		"a message in several scripts and an emoji",
		"Merci beaucoup 谢谢 مرحبا 🎧 é",
	),
	sendCase("a message with a lone surrogate", "a\ud800b"),
	sendCase(
		"a message with markup and quotes",
		`<script>alert("x")</script> & 'q' "dq" <b>bold</b>`,
	),
	sendCase(
		"a message with an https link",
		"Mix is at https://example.com/mix?x=1&y=2 thanks",
	),
	sendCase(
		"a message with an uppercase HTTPS link",
		"See HTTPS://EXAMPLE.COM/a",
	),
	sendCase(
		"a message with a link and trailing punctuation",
		"See https://example.com/a).",
	),
	sendCase("a message with an http link", "See http://example.com/a"),
	sendCase("a message with a www link", "See www.example.com/a"),
	sendCase("a message with an ftp link", "See ftp://example.com/a"),
	sendCase(
		"a message with a link carrying a password",
		"See https://user:pass@example.com/a",
	),
	sendCase(
		"a message with a link carrying a user name",
		"See https://user@example.com/a",
	),
	sendCase("a message with a bare https scheme", "See https:// for details"),
	sendCase(
		"a message with a good and a bad link",
		"https://example.com/a and http://example.com/b",
	),
	sendCase("a message with a javascript: URL", "javascript:alert(1)"),
	sendCase(
		"a message with a data: URL",
		"data:text/html,<script>alert(1)</script>",
	),
	sendCase("a message with a mailto: address", "mailto:a@example.com"),
	sendCase(
		"a message with a link in angle brackets",
		"<https://example.com/a>",
	),
	// ---- send by stage
	...STAGES.map((stage) =>
		audioCase(`send while the project is ${stage}`, { stage }, [text("Hello")]),
	),
	audioCase(
		"send on a project already in two revision rounds",
		{
			stage: "revision_in_progress",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[text("One more thing")],
	),
	// ---- the rate limit
	audioCase(
		"send with 11 client messages in the window",
		{
			extra: { audio_project_messages: clientMessages("r1", 11) },
		},
		[text("The twelfth")],
	),
	audioCase(
		"send with 12 client messages in the window",
		{
			extra: { audio_project_messages: clientMessages("r1", 12) },
		},
		[text("The thirteenth")],
	),
	audioCase(
		"send with 12 client messages, all older than five minutes",
		{
			extra: { audio_project_messages: clientMessages("r1", 12, 400_000) },
		},
		[text("After the wait")],
	),
	audioCase(
		"send with 12 client messages exactly five minutes old",
		{
			extra: {
				audio_project_messages: Array.from({ length: 12 }, (_, index) =>
					message("r1", "client", {
						body: `edge ${index}`,
						created_at: "2026-11-13T11:55:00.000Z",
					}),
				),
			},
		},
		[text("On the edge")],
	),
	audioCase(
		"send with 12 owner messages in the window",
		{
			extra: {
				audio_project_messages: Array.from({ length: 12 }, (_, index) =>
					message("r1", "owner", {
						body: `owner ${index}`,
						created_at: "2026-11-13T11:59:00.000Z",
					}),
				),
			},
		},
		[text("Owner is chatty")],
	),
	audioCase(
		"send with 12 client messages on another project",
		{
			extra: {
				owner_requests: [audioRequest("r1"), audioRequest("r2")],
				audio_project_messages: clientMessages("r2", 12),
			},
			states: { r1: { stage: "in_progress" }, r2: { stage: "in_progress" } },
		},
		[text("Different project")],
	),
	audioCase("a thirteenth send in a row and one five minutes later", {}, [
		...Array.from({ length: 13 }, (_, index) =>
			text(`message ${index + 1}`, {
				advanceMs: 1000,
				dump: index === 12 ? { music: AUDIO_TABLES } : undefined,
			}),
		),
		text("later", { advanceMs: 300_000 }),
	]),
	// ---- read
	audioCase(
		"read an owner message",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(1)],
	),
	audioCase(
		"read an owner message twice",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(1), read(1, { advanceMs: 60_000 })],
	),
	audioCase(
		"read a message the client wrote",
		{
			extra: {
				audio_project_messages: [{ id: 1, ...message("r1", "client") }],
			},
		},
		[read(1)],
	),
	audioCase(
		"read a message that is already read",
		{
			extra: {
				audio_project_messages: [{ ...ownerNote, read_at: EARLIER }],
			},
		},
		[read(1)],
	),
	audioCase(
		"read a message id that does not exist",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(99)],
	),
	audioCase(
		"read a message of another project",
		{
			extra: {
				owner_requests: [
					audioRequest("r1"),
					audioRequest("r2", { email: ADA }),
				],
				audio_project_messages: [{ id: 5, ...message("r2", "owner") }],
			},
			states: { r1: { stage: "in_progress" }, r2: { stage: "in_progress" } },
		},
		[read(5)],
	),
	...[0, -1, 1.5, "1", null].map((value) =>
		audioCase(
			`read with messageId ${JSON.stringify(value)}`,
			{
				extra: { audio_project_messages: [ownerNote] },
			},
			[read(value)],
		),
	),
	audioCase(
		"read with no messageId",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[post({ action: "read" })],
	),
	audioCase(
		"read on a closed project",
		{
			revoked: EARLIER,
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(1)],
	),
	audioCase(
		"read while the project is complete",
		{
			stage: "complete",
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(1)],
	),
	audioCase(
		"read as another client",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(1, { as: asClientCookie(ADA_TOKEN) })],
	),
	// ---- respond: validation
	audioCase("respond with no reviewId", { stage: "review_ready" }, [
		post({ action: "respond", decision: "approved" }),
	]),
	audioCase("respond with an empty reviewId", { stage: "review_ready" }, [
		respond("approved", undefined, {}, ""),
	]),
	audioCase(
		"respond with a reviewId of 101 characters",
		{ stage: "review_ready" },
		[respond("approved", undefined, {}, "f".repeat(101))],
	),
	audioCase(
		"respond with a reviewId that is a number",
		{ stage: "review_ready" },
		[respond("approved", undefined, {}, 1)],
	),
	...DECISIONS.map((decision) =>
		audioCase(
			`${decision} with no body key at all`,
			{ stage: "review_ready" },
			[post({ action: "respond", reviewId: "f1", decision })],
		),
	),
	audioCase("respond with an unknown decision", { stage: "review_ready" }, [
		respond("reject"),
	]),
	audioCase("respond with no decision", { stage: "review_ready" }, [
		post({ action: "respond", reviewId: "f1" }),
	]),
	audioCase(
		"respond with a decision that is not text",
		{ stage: "review_ready" },
		[respond(3)],
	),
	// ---- respond: every stage and every decision
	...STAGES.flatMap((stage) =>
		DECISIONS.map((decision) =>
			audioCase(
				`${decision} while the project is ${stage}`,
				{
					stage,
					extra: { audio_project_updates: revisionRounds("r1", ROUNDS_USED) },
				},
				[
					respond(
						decision,
						decision === "changes" ? "Lower the vocal" : undefined,
					),
				],
			),
		),
	),
	// ---- respond: the revision rounds
	...[0, 1, 2, 3].flatMap((rounds) =>
		DECISIONS.map((decision) =>
			audioCase(
				`${decision} with ${rounds} revision rounds used`,
				{
					stage: "review_ready",
					extra: { audio_project_updates: revisionRounds("r1", rounds) },
				},
				[
					respond(
						decision,
						decision === "changes" ? "Lower the vocal" : undefined,
					),
				],
			),
		),
	),
	audioCase(
		"a revision round of another project does not count",
		{
			extra: {
				owner_requests: [
					audioRequest("r1"),
					audioRequest("r2", { email: ADA }),
				],
				audio_project_updates: revisionRounds("r2", 2),
			},
			states: { r1: { stage: "review_ready" }, r2: { stage: "review_ready" } },
		},
		[respond("stopped")],
	),
	// ---- respond: the notes
	audioCase("approved with notes of its own", { stage: "review_ready" }, [
		respond("approved", "  Love it, thank you  "),
	]),
	audioCase("approved with an empty body", { stage: "review_ready" }, [
		respond("approved", ""),
	]),
	audioCase("approved with a body of spaces", { stage: "review_ready" }, [
		respond("approved", "   "),
	]),
	audioCase(
		"approved with a body that is a number",
		{ stage: "review_ready" },
		[respond("approved", 7)],
	),
	audioCase("approved with a null body", { stage: "review_ready" }, [
		respond("approved", null),
	]),
	audioCase(
		"approved with an http link in the notes",
		{ stage: "review_ready" },
		[respond("approved", "see http://example.com")],
	),
	audioCase(
		"approved with a control character in the notes",
		{ stage: "review_ready" },
		[respond("approved", "a\u0002b")],
	),
	audioCase(
		"approved with notes over 4000 characters",
		{ stage: "review_ready" },
		[respond("approved", "a".repeat(4001))],
	),
	audioCase("approved with markup in the notes", { stage: "review_ready" }, [
		respond("approved", `<img src=x onerror=alert(1)> & "q"`),
	]),
	audioCase("changes with a null body", { stage: "review_ready" }, [
		respond("changes"),
	]),
	audioCase("changes with a body of spaces", { stage: "review_ready" }, [
		respond("changes", "  \n "),
	]),
	audioCase("changes with a body that is a number", { stage: "review_ready" }, [
		respond("changes", 9),
	]),
	audioCase("changes with an http link", { stage: "review_ready" }, [
		respond("changes", "Like http://example.com/ref"),
	]),
	audioCase(
		"changes with an https link and unicode",
		{ stage: "review_ready" },
		[respond("changes", "Like https://example.com/ref, plus 🎧 more air")],
	),
	audioCase(
		"changes with notes of exactly 4000 characters",
		{ stage: "review_ready" },
		[respond("changes", "a".repeat(4000))],
	),
	audioCase(
		"changes with notes over 4000 characters",
		{ stage: "review_ready" },
		[respond("changes", "a".repeat(4001))],
	),
	audioCase(
		"stopped with notes of its own",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[respond("stopped", "Budget changed, sorry")],
	),
	audioCase(
		"stopped with an http link in the notes",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[respond("stopped", "http://example.com")],
	),
	// ---- respond: the review that is being answered
	audioCase(
		"respond with no published review",
		{
			stage: "review_ready",
			extra: { audio_project_files: [] },
		},
		[respond("approved")],
	),
	audioCase(
		"respond to a review file that is not published",
		{
			stage: "review_ready",
			extra: {
				audio_project_files: [
					audioFile("f1", "r1", { status: "uploaded", published_at: null }),
				],
			},
		},
		[respond("approved")],
	),
	audioCase(
		"respond to a revoked review file",
		{
			stage: "review_ready",
			extra: {
				audio_project_files: [
					audioFile("f1", "r1", { status: "revoked", revoked_at: EARLIER }),
				],
			},
		},
		[respond("approved")],
	),
	audioCase(
		"respond naming the final file instead of a review",
		{
			stage: "review_ready",
			extra: {
				audio_project_files: [
					audioFile("f1", "r1"),
					audioFile("fin", "r1", {
						version: "final",
						published_at: "2026-11-13T11:30:00.000Z",
					}),
				],
			},
		},
		[respond("approved", undefined, {}, "fin")],
	),
	audioCase(
		"respond naming a file that does not exist",
		{ stage: "review_ready" },
		[respond("approved", undefined, {}, "nope")],
	),
	audioCase(
		"respond naming a review file of another project",
		{
			stage: "review_ready",
			extra: {
				owner_requests: [
					audioRequest("r1"),
					audioRequest("r2", { email: ADA }),
				],
				audio_project_files: [audioFile("f1", "r1"), audioFile("g1", "r2")],
			},
			states: { r1: { stage: "review_ready" }, r2: { stage: "review_ready" } },
		},
		[respond("approved", undefined, {}, "g1")],
	),
	audioCase(
		"two reviews published: the latest one is answered",
		{
			stage: "review_ready",
			extra: {
				audio_project_files: [
					audioFile("f1", "r1"),
					audioFile("f2", "r1", { published_at: "2026-11-13T11:30:00.000Z" }),
				],
			},
		},
		[respond("approved", undefined, {}, "f2")],
	),
	audioCase(
		"two reviews published: the older one is not answered",
		{
			stage: "review_ready",
			extra: {
				audio_project_files: [
					audioFile("f1", "r1"),
					audioFile("f2", "r1", { published_at: "2026-11-13T11:30:00.000Z" }),
				],
			},
		},
		[respond("approved")],
	),
	audioCase(
		"a decision older than the review does not count",
		{
			stage: "review_ready",
			extra: {
				audio_project_files: [
					audioFile("f1", "r1", { published_at: "2026-11-13T11:30:00.000Z" }),
				],
				audio_project_messages: [
					{
						...message("r1", "client", { created_at: EARLIER }),
						review_decision: "approved",
					},
				],
			},
		},
		[respond("approved")],
	),
	audioCase(
		"a decision made the same instant the review was published counts",
		{
			stage: "review_ready",
			extra: {
				audio_project_messages: [
					{
						...message("r1", "client", { created_at: EARLIER }),
						review_decision: "approved",
					},
				],
			},
		},
		[respond("approved")],
	),
	audioCase(
		"a plain message after the review is not a decision",
		{
			stage: "review_ready",
			extra: {
				audio_project_messages: [
					message("r1", "client", { created_at: "2026-11-13T11:30:00.000Z" }),
				],
			},
		},
		[respond("approved")],
	),
	audioCase(
		"respond with 12 client messages in the window",
		{
			stage: "review_ready",
			extra: { audio_project_messages: clientMessages("r1", 12) },
		},
		[respond("approved")],
	),
	audioCase(
		"respond with 11 client messages in the window",
		{
			stage: "review_ready",
			extra: { audio_project_messages: clientMessages("r1", 11) },
		},
		[respond("approved")],
	),
	audioCase(
		"respond with 12 messages while the project is complete: 429 wins over 409",
		{
			stage: "complete",
			extra: { audio_project_messages: clientMessages("r1", 12) },
		},
		[respond("approved")],
	),
	audioCase(
		"stopped with 12 client messages in the window",
		{
			stage: "review_ready",
			extra: {
				audio_project_updates: revisionRounds("r1", 2),
				audio_project_messages: clientMessages("r1", 12),
			},
		},
		[respond("stopped")],
	),
	audioCase(
		"respond on a closed project",
		{ stage: "review_ready", revoked: EARLIER },
		[respond("approved")],
	),
	audioCase("respond as another client", { stage: "review_ready" }, [
		respond("approved", undefined, { as: asClientCookie(ADA_TOKEN) }),
	]),
	// ---- sequences
	audioCase(
		"approved, then approved again, then stopped, then a message",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[
			respond("approved", "Great", { advanceMs: 1000 }),
			respond("approved", "Great again", { advanceMs: 1000 }),
			respond("stopped", undefined, { advanceMs: 1000 }),
			text("Still here", { advanceMs: 1000 }),
		],
	),
	audioCase(
		"changes, the same changes again, a new review, changes on the old and new review",
		{
			stage: "review_ready",
		},
		[
			respond("changes", "More bass", { advanceMs: 1000 }),
			respond("changes", "More bass", { advanceMs: 1000 }),
			respond("changes", "On the new one", {
				advanceMs: 1000,
				before: {
					label: "the owner publishes a new review",
					run: (world) =>
						world.music.exec(
							`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at,published_at) VALUES ('f2','r1','review','projects/r1/f2','Mix2.mp3','audio/mpeg',1000,0,'published','2026-11-13T12:00:01.000Z','2026-11-13T12:00:02.000Z')`,
						),
				},
			}),
			respond("changes", "On the new one", { advanceMs: 1000 }, "f2"),
		],
	),
	audioCase(
		"changes twice across two reviews, then a third is refused",
		{
			stage: "review_ready",
		},
		[
			respond("changes", "Round one", { advanceMs: 1000 }),
			text("Revision begins", {
				advanceMs: 1000,
				before: {
					label: "the owner starts revision 1 and publishes review 2",
					run: (world) =>
						world.music.exec(
							`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone) VALUES ('r1','progress','Revision started','o','2026-11-13T12:00:01.000Z','revision_started');
             INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at,published_at) VALUES ('f2','r1','review','projects/r1/f2','Mix2.mp3','audio/mpeg',1000,0,'published','2026-11-13T12:00:01.000Z','2026-11-13T12:00:02.000Z')`,
						),
				},
			}),
			respond(
				"changes",
				"Round two",
				{
					advanceMs: 1000,
					before: {
						label: "the owner starts revision 2 and publishes review 3",
						run: (world) =>
							world.music.exec(
								`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone) VALUES ('r1','progress','Revision started','o','2026-11-13T12:00:04.000Z','revision_started');
             INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at,published_at) VALUES ('f3','r1','review','projects/r1/f3','Mix3.mp3','audio/mpeg',1000,0,'published','2026-11-13T12:00:04.000Z','2026-11-13T12:00:05.000Z')`,
							),
					},
				},
				"f3",
			),
			respond("changes", "Round three", { advanceMs: 1000 }, "f3"),
			respond("stopped", undefined, { advanceMs: 1000 }, "f3"),
		],
	),
	audioCase(
		"stopping one project leaves the client's other project open",
		{
			extra: {
				owner_requests: [audioRequest("r1"), audioRequest("r2")],
				audio_project_files: [audioFile("f1", "r1"), audioFile("g1", "r2")],
				audio_project_updates: revisionRounds("r1", 2),
			},
			states: { r1: { stage: "review_ready" }, r2: { stage: "in_progress" } },
		},
		[
			respond("stopped", undefined, {
				dump: { music: [...AUDIO_TABLES, "audio_client_sessions"] },
			}),
			text("On the closed one", { advanceMs: 1000 }),
			text("On the open one", {
				advanceMs: 1000,
				path: `${BASE}/r2/messages`,
				params: { id: "r2" },
			}),
		],
	),
	audioCase(
		"send, read the owner's reply, send again",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[
			text("First", { advanceMs: 1000 }),
			read(1, { advanceMs: 1000 }),
			text("Second", { advanceMs: 1000 }),
		],
	),
	// ---- races
	audioCase(
		"send when the session is revoked after the lookup",
		{},
		[text("Hello")],
		raceOnInsert(
			"the session is revoked",
			`UPDATE audio_client_sessions SET revoked_at='${EARLIER}'`,
		),
	),
	audioCase(
		"send when the session expires after the lookup",
		{},
		[text("Hello")],
		raceOnInsert(
			"the session expires",
			`UPDATE audio_client_sessions SET expires_at='${EARLIER}'`,
		),
	),
	audioCase(
		"send when the project is closed after the lookup",
		{},
		[text("Hello")],
		raceOnInsert(
			"the project is closed",
			`UPDATE audio_projects SET revoked_at='${EARLIER}'`,
		),
	),
	audioCase(
		"send when the request is withdrawn after the lookup",
		{},
		[text("Hello")],
		raceOnInsert(
			"the request is withdrawn",
			`UPDATE owner_requests SET status='withdrawn'`,
		),
	),
	audioCase(
		"send when the project completes after the lookup",
		{},
		[text("Hello")],
		raceOnInsert(
			"the project completes",
			`UPDATE audio_projects SET stage='complete'`,
		),
	),
	audioCase(
		"send when the rate limit fills after the lookup",
		{},
		[text("Hello")],
		raceOnInsert(
			"twelve messages arrive",
			clientMessages("r1", 12)
				.map(
					(row) =>
						`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at) VALUES ('r1','client','x','${row.body}','${row.created_at}')`,
				)
				.join(";"),
		),
	),
	audioCase(
		"approve when the project leaves review after the lookup",
		{ stage: "review_ready" },
		[respond("approved")],
		raceOnInsert(
			"the owner moves the stage",
			`UPDATE audio_projects SET stage='revision_in_progress'`,
		),
	),
	audioCase(
		"approve when a second tab answers first",
		{ stage: "review_ready" },
		[respond("approved")],
		raceOnInsert(
			"another answer lands",
			`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at,review_decision) VALUES ('r1','client','x','Approved elsewhere','2026-11-13T11:59:59.000Z','approved')`,
		),
	),
	audioCase(
		"approve when a newer review is published after the lookup",
		{ stage: "review_ready" },
		[respond("approved")],
		raceOnInsert(
			"a newer review is published",
			`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,downloadable,status,uploaded_at,published_at) VALUES ('f2','r1','review','projects/r1/f2','Mix2.mp3','audio/mpeg',1000,0,'published','2026-11-13T11:59:00.000Z','2026-11-13T11:59:30.000Z')`,
		),
	),
	audioCase(
		"changes when the last revision round is begun after the lookup",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 1) },
		},
		[respond("changes", "More air")],
		raceOnInsert(
			"the second round begins",
			`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone) VALUES ('r1','progress','Revision started','o','${EARLIER}','revision_started')`,
		),
	),
	audioCase(
		"stopped when the project is closed after the lookup",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[respond("stopped")],
		raceOnInsert(
			"the owner closes access",
			`UPDATE audio_projects SET revoked_at='${EARLIER}'`,
		),
	),
	audioCase(
		"stopped when the request is withdrawn after the lookup",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[respond("stopped")],
		raceOnInsert(
			"the request is withdrawn",
			`UPDATE owner_requests SET status='withdrawn'`,
		),
	),
	audioCase(
		"read when the session is revoked after the lookup",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(1)],
		raceOnInsert(
			"the session is revoked",
			`UPDATE audio_client_sessions SET revoked_at='${EARLIER}'`,
			1,
			/UPDATE audio_project_messages SET read_at/,
		),
	),
	// ---- outages
	audioCase("the project lookup fails", {}, [text("Hello")], {
		failures: [
			{
				on: /FROM audio_client_sessions s\s+JOIN owner_requests r ON r\.email/,
				message: "D1 is down",
			},
		],
	}),
	audioCase("the send insert fails", {}, [text("Hello")], {
		failures: [
			{ on: /INSERT INTO audio_project_messages/, message: "D1 is down" },
		],
	}),
	audioCase(
		"the rate-limit count fails after a refused send",
		{ stage: "complete" },
		[text("Hello")],
		{
			failures: [
				{
					on: /SELECT count\(\*\) AS total FROM audio_project_messages/,
					message: "D1 is down",
				},
			],
		},
	),
	audioCase(
		"the rate-limit count fails after a refused answer",
		{ stage: "in_progress" },
		[respond("approved")],
		{
			failures: [
				{
					on: /SELECT count\(\*\) AS total FROM audio_project_messages/,
					message: "D1 is down",
				},
			],
		},
	),
	audioCase(
		"the approve insert fails",
		{ stage: "review_ready" },
		[respond("approved")],
		{
			failures: [
				{ on: /INSERT INTO audio_project_messages/, message: "D1 is down" },
			],
		},
	),
	audioCase(
		"the changes insert fails",
		{ stage: "review_ready" },
		[respond("changes", "More air")],
		{
			failures: [
				{ on: /INSERT INTO audio_project_messages/, message: "D1 is down" },
			],
		},
	),
	audioCase(
		"the stop batch fails",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[respond("stopped")],
		{
			failures: [
				{ on: /UPDATE audio_projects SET revoked_at/, message: "D1 is down" },
			],
		},
	),
	audioCase(
		"the read update fails",
		{
			extra: { audio_project_messages: [ownerNote] },
		},
		[read(1)],
		{
			failures: [
				{
					on: /UPDATE audio_project_messages SET read_at/,
					message: "D1 is down",
				},
			],
		},
	),
	audioCase(
		"the audit insert in the stop batch is rejected",
		{
			stage: "review_ready",
			extra: { audio_project_updates: revisionRounds("r1", 2) },
		},
		[respond("stopped")],
		{
			setup: (world) => {
				audioProjectState({ r1: { stage: "review_ready" } })(world);
				world.music.exec(
					`CREATE TRIGGER golden_break_audit BEFORE INSERT ON audio_project_audit WHEN NEW.action='revoked' BEGIN SELECT RAISE(ABORT,'audit is down'); END`,
				);
			},
		},
	),
];

defineCorpus("studio-projects-messages", POST, cases);
