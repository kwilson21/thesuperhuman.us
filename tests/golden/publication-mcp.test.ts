import { ALL } from "~/pages/api/publication/[...path]";
import type { JsonObject } from "../helpers/json";
import {
	event,
	Flow,
	pub,
	rpc,
	story,
	TABLES,
	toolCall,
	withdraw,
	oauthKit,
} from "./areas/publication";
import { defineCorpus, type Case } from "./harness";

// The golden corpus for the MCP endpoint behind the OAuth login of /api/publication/[...path] (src/lib/publication/mcp.ts):
// the bearer token check by the library, the owner check, the transport's own answers, get_project_progress and
// publish_project_update with valid and invalid arguments, the scope check (token scope, the project allowlist, an
// allowlist that changes after the token was issued), and every journal outcome (delivered, conflict, withdrawn,
// rejected, invalid, pending). Every case first connects a client through the whole login, using a Flow (tests/golden/areas/publication.ts).
//
// Branches: 401 bearer challenge (missing, invalid, expired token, wrong scheme), 403 "Forbidden" (owner id changed),
// 413 over the size limit, transport 200/202/400/405/406/415, tool results {status: forbidden | unavailable | delivered |
// conflict | withdrawn | rejected | invalid | pending} and validation errors from the tool schemas.
//
// Not reachable through the harness: publicationMcp's own 503 "Publication unavailable" (a missing PUBLICATION_DB is
// stopped earlier by isConfigured), and the apiHandler 403 for a token whose props lack an ownerId (the library always
// sets props from tokenExchangeCallback).

const JSON_HEADERS = { "content-type": "application/json" };

const FUTURE = 3_601_000;

const { run, oc, connect } = oauthKit(ALL);

// ---------------------------------------------------------------- MCP

const progress = (
	f: Flow,
	projectId: string,
	extra: Parameters<typeof toolCall>[3] = {},
) => toolCall(f, "get_project_progress", { projectId }, extra);

const publishTool = (
	f: Flow,
	publication: JsonObject,
	extra: Parameters<typeof toolCall>[3] = {},
) =>
	toolCall(
		f,
		"publish_project_update",
		{ publication },
		{ dump: { publication: TABLES }, ...extra },
	);

const events = {
	publication: { seed: { publication_events: [event(pub(), 1)] } },
};

const mcpAccess: Case[] = [
	oc(
		"mcp: no bearer token",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "tools/list", {}, { token: null }),
		]),
	),
	oc(
		"mcp: an invalid bearer token",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "tools/list", {}, { token: "not-a-token" }),
		]),
	),
	oc(
		"mcp: a token shaped like a real one that was never issued",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "tools/list", {}, { token: "10987837:grant:secret" }),
		]),
	),
	oc(
		"mcp: the Basic scheme",
		run((f, c) => [
			...connect(f, c),
			f.step({
				method: "POST",
				path: "/api/publication/mcp",
				headers: {
					authorization: "Basic ~access~",
					...JSON_HEADERS,
					accept: "application/json, text/event-stream",
				},
				body: "{}",
			}),
		]),
	),
	oc(
		"mcp: the access token after an hour",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "tools/list", {}, { advanceMs: FUTURE }),
		]),
	),
	oc(
		"mcp: the access token just inside the hour",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "tools/list", {}, { advanceMs: 3_599_000 }),
		]),
	),
	oc(
		"mcp: the owner id changed after the token was issued",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "tools/list", {}, { env: { PUBLICATION_OWNER_ID: "999" } }),
		]),
	),
	oc(
		"mcp: initialize",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "initialize", {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "chat", version: "1" },
			}),
		]),
	),
	oc(
		"mcp: tools/list",
		run((f, c) => [...connect(f, c), rpc(f, "tools/list")]),
	),
	oc(
		"mcp: ping",
		run((f, c) => [...connect(f, c), rpc(f, "ping")]),
	),
	oc(
		"mcp: an unknown method",
		run((f, c) => [...connect(f, c), rpc(f, "resources/list")]),
	),
	oc(
		"mcp: a body that is not JSON",
		run((f, c) => [
			...connect(f, c),
			f.step({
				method: "POST",
				path: "/api/publication/mcp",
				headers: {
					authorization: "Bearer ~access~",
					...JSON_HEADERS,
					accept: "application/json, text/event-stream",
				},
				body: "{bad",
			}),
		]),
	),
	oc(
		"mcp: a GET",
		run((f, c) => [
			...connect(f, c),
			f.step({
				path: "/api/publication/mcp",
				headers: {
					authorization: "Bearer ~access~",
					accept: "text/event-stream",
				},
			}),
		]),
	),
	oc(
		"mcp: a DELETE",
		run((f, c) => [
			...connect(f, c),
			f.step({
				method: "DELETE",
				path: "/api/publication/mcp",
				headers: { authorization: "Bearer ~access~" },
			}),
		]),
	),
	oc(
		"mcp: no Accept header",
		run((f, c) => [
			...connect(f, c),
			f.step({
				method: "POST",
				path: "/api/publication/mcp",
				headers: { authorization: "Bearer ~access~", ...JSON_HEADERS },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			}),
		]),
	),
	oc(
		"mcp: a plain text content type",
		run((f, c) => [
			...connect(f, c),
			f.step({
				method: "POST",
				path: "/api/publication/mcp",
				headers: {
					authorization: "Bearer ~access~",
					"content-type": "text/plain",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			}),
		]),
	),
	oc(
		"mcp: a notification has no answer",
		run((f, c) => [
			...connect(f, c),
			f.step({
				method: "POST",
				path: "/api/publication/mcp",
				headers: {
					authorization: "Bearer ~access~",
					...JSON_HEADERS,
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "notifications/initialized",
				}),
			}),
		]),
	),
	oc(
		"mcp: an MCP body over the limit with a valid token",
		run((f, c) => [
			...connect(f, c),
			f.step({
				method: "POST",
				path: "/api/publication/mcp",
				headers: {
					authorization: "Bearer ~access~",
					...JSON_HEADERS,
					accept: "application/json, text/event-stream",
				},
				body: "z".repeat(40000),
			}),
		]),
	),
	oc(
		"mcp: an unknown tool",
		run((f, c) => [...connect(f, c), toolCall(f, "delete_everything", {})]),
	),
];

const mcpRead: Case[] = [
	oc(
		"mcp read: an empty project",
		run((f, c) => [...connect(f, c), progress(f, "threadline")]),
	),
	oc(
		"mcp read: a project with an entry",
		run((f, c) => [...connect(f, c), progress(f, "threadline")]),
		events,
	),
	oc(
		"mcp read: the other project",
		run((f, c) => [...connect(f, c), progress(f, "other")]),
	),
	oc(
		"mcp read: a project that is not on the allowlist",
		run((f, c) => [...connect(f, c), progress(f, "stranger")]),
	),
	oc(
		"mcp read: a project outside the token's scope",
		run((f, c) => [
			...connect(f, c, "publication:threadline"),
			progress(f, "other"),
		]),
	),
	oc(
		"mcp read: a project removed from the allowlist after the token was issued",
		run((f, c) => [
			...connect(f, c),
			progress(f, "other", { env: { PUBLICATION_PROJECTS: "threadline" } }),
		]),
	),
	oc(
		"mcp read: the allowlist is not set",
		run((f, c) => [
			...connect(f, c),
			progress(f, "threadline", { env: { PUBLICATION_PROJECTS: undefined } }),
		]),
	),
	oc(
		"mcp read: a project id with a bad shape",
		run((f, c) => [...connect(f, c), progress(f, "Thread Line")]),
	),
	oc(
		"mcp read: no project id",
		run((f, c) => [...connect(f, c), toolCall(f, "get_project_progress", {})]),
	),
	oc(
		"mcp read: an extra argument",
		run((f, c) => [
			...connect(f, c),
			toolCall(f, "get_project_progress", {
				projectId: "threadline",
				extra: 1,
			}),
		]),
	),
	oc(
		"mcp read: a project id that is not text",
		run((f, c) => [
			...connect(f, c),
			toolCall(f, "get_project_progress", { projectId: 5 }),
		]),
	),
	oc(
		"mcp read: no arguments at all",
		run((f, c) => [
			...connect(f, c),
			rpc(f, "tools/call", { name: "get_project_progress" }),
		]),
	),
	oc(
		"mcp read: the read fails",
		run((f, c) => [...connect(f, c), progress(f, "threadline")]),
		{
			failures: [
				{ on: /SELECT COALESCE\(MAX\(revision\),0\)/, message: "d1 down" },
			],
		},
	),
	oc(
		"mcp read: a stored payload that is not valid",
		run((f, c) => [...connect(f, c), progress(f, "threadline")]),
		{
			publication: {
				seed: { publication_events: [{ ...event(pub(), 1), payload: "{}" }] },
			},
		},
	),
	oc(
		"mcp read: unicode and markup in a story",
		run((f, c) => [...connect(f, c), progress(f, "threadline")]),
		{
			publication: {
				seed: {
					publication_events: [
						event(
							pub({
								story: story({
									headline: "<b>café</b> & 中",
									summary: '"quoted" 🚀',
								}),
							}),
							1,
						),
					],
				},
			},
		},
	),
];

const mcpPublish: Case[] = [
	oc(
		"mcp publish: a first entry",
		run((f, c) => [...connect(f, c), publishTool(f, pub())]),
	),
	oc(
		"mcp publish: the same event again",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub()),
			publishTool(f, pub()),
		]),
	),
	oc(
		"mcp publish: a correction",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub()),
			publishTool(
				f,
				pub({
					eventId: "evt-2",
					operation: "correct",
					expectedRevision: 1,
					story: story({ headline: "Corrected" }),
				}),
			),
			progress(f, "threadline"),
		]),
	),
	oc(
		"mcp publish: a withdrawal",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub()),
			publishTool(f, withdraw({ eventId: "evt-2", expectedRevision: 1 })),
			progress(f, "threadline"),
		]),
	),
	oc(
		"mcp publish: a stale revision is a conflict",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub()),
			publishTool(
				f,
				pub({ eventId: "evt-2", entryId: "entry-2", expectedRevision: 0 }),
			),
		]),
	),
	oc(
		"mcp publish: an entry that was withdrawn is gone",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, withdraw()),
			publishTool(f, pub({ eventId: "evt-2", expectedRevision: 1 })),
		]),
	),
	oc(
		"mcp publish: expectedRevision of the largest safe integer is rejected",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ expectedRevision: Number.MAX_SAFE_INTEGER })),
		]),
	),
	oc(
		"mcp publish: a day that does not exist passes the tool schema and fails the contract",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ occurredOn: "2026-02-30" })),
		]),
	),
	oc(
		"mcp publish: a control character passes the tool schema and fails the contract",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ story: story({ headline: "a\u0001b" }) })),
		]),
	),
	oc(
		"mcp publish: a headline of only spaces passes the tool schema and fails the contract",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ story: story({ headline: "   " }) })),
		]),
	),
	oc(
		"mcp publish: a project outside the token's scope",
		run((f, c) => [
			...connect(f, c, "publication:threadline"),
			publishTool(f, pub({ projectId: "other" })),
		]),
	),
	oc(
		"mcp publish: a project that is not on the allowlist",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ projectId: "stranger" })),
		]),
	),
	oc(
		"mcp publish: the other project",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ projectId: "other" })),
			progress(f, "other"),
		]),
	),
	oc(
		"mcp publish: the journal fails",
		run((f, c) => [...connect(f, c), publishTool(f, pub())]),
		{
			failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
		},
	),
	oc(
		"mcp publish: a failure and then a retry of the same event",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub()),
			publishTool(f, pub()),
		]),
		{
			failures: [{ on: /INSERT INTO publication_events/, message: "d1 down" }],
		},
	),
	oc(
		"mcp publish: the version is wrong",
		run((f, c) => [...connect(f, c), publishTool(f, pub({ version: 2 }))]),
	),
	oc(
		"mcp publish: an extra field in the envelope",
		run((f, c) => [...connect(f, c), publishTool(f, pub({ extra: 1 }))]),
	),
	oc(
		"mcp publish: a missing story member",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ story: story({ basis: undefined }) })),
		]),
	),
	oc(
		"mcp publish: a headline over 140 characters",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ story: story({ headline: "h".repeat(141) }) })),
		]),
	),
	oc(
		"mcp publish: an unknown delivery value",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ story: story({ delivery: "shipped" }) })),
		]),
	),
	oc(
		"mcp publish: a withdrawal that carries a story",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, withdraw({ story: story() })),
		]),
	),
	oc(
		"mcp publish: a publish with no story",
		run((f, c) => [...connect(f, c), publishTool(f, pub({ story: null }))]),
	),
	oc(
		"mcp publish: the envelope is not wrapped in publication",
		run((f, c) => [
			...connect(f, c),
			toolCall(f, "publish_project_update", pub()),
		]),
	),
	oc(
		"mcp publish: markup and unicode are stored as given",
		run((f, c) => [
			...connect(f, c),
			publishTool(
				f,
				pub({
					story: story({
						headline: "<b>café</b> & 中",
						summary: "\"quoted\" 'x' 🚀",
					}),
				}),
			),
			progress(f, "threadline"),
		]),
	),
	oc(
		"mcp publish: a token for one project publishes only there, then reads both",
		run((f, c) => [
			...connect(f, c, "publication:threadline"),
			publishTool(f, pub()),
			progress(f, "threadline"),
			progress(f, "other"),
		]),
	),
	oc(
		"mcp publish: a backfill entry",
		run((f, c) => [
			...connect(f, c),
			publishTool(f, pub({ origin: "backfill" })),
			progress(f, "threadline"),
		]),
	),
];

const cases: Case[] = [...mcpAccess, ...mcpRead, ...mcpPublish];

defineCorpus("publication-mcp", ALL, cases);
