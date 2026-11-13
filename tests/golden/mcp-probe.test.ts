import { ALL } from "~/pages/api/mcp-probe";
import type { JsonValue } from "../helpers/json";
import { defineCorpus, type Case, type Step } from "./harness";

// The golden corpus for /api/mcp-probe: a public MCP connectivity probe with one read-only tool that echoes a
// challenge. It touches no binding (no database, KV, secret or network), so the record is the status, headers and exact
// body of each answer, produced by the real MCP SDK transport (stateless, JSON responses).
//
// Every response branch (the handler has one path: build a server, hand the request to the transport, add no-store):
//
//   200 JSON-RPC result    initialize (current and older protocol version), tools/list, ping, tools/call with a valid
//                          challenge (1, 80 characters, unicode, markup, spaces, newlines), a batch, string ids
//   200 JSON-RPC error     unknown method, unsupported protocol version, malformed params, a jsonrpc version other than 2.0
//   200 tool error result  tools/call with each invalid argument (missing, empty, 81 characters, number, null, extra
//                          field, no arguments), an unknown tool
//   202 no body            a notification
//   400 parse error        a body that is not JSON, an empty body, an unsupported protocol version header
//   405                    GET, DELETE, PUT and other methods
//   406 / 415              no Accept header, JSON only, a content type that is not JSON
//   Cache-Control: no-store is added to each of them.

const HEADERS = {
	"content-type": "application/json",
	accept: "application/json, text/event-stream",
};

const rpc = (
	method: string,
	params: JsonValue = {},
	extra: Partial<Step> = {},
	id: JsonValue = 1,
): Step => ({
	path: "/api/mcp-probe",
	headers: HEADERS,
	json: { jsonrpc: "2.0", id, method, params },
	...extra,
});

const echo = (args: JsonValue, extra: Partial<Step> = {}, id: JsonValue = 1) =>
	rpc(
		"tools/call",
		{ name: "publication_connection_probe", arguments: args },
		extra,
		id,
	);

const raw = (
	body: string,
	headers: { [name: string]: string } = HEADERS,
): Step => ({
	path: "/api/mcp-probe",
	headers,
	body,
});

const only = (name: string, steps: Step[]): Case => ({ name, steps });

const init = {
	protocolVersion: "2025-03-26",
	capabilities: {},
	clientInfo: { name: "chat", version: "1" },
};

const cases: Case[] = [
	only("initialize with the current protocol version", [
		rpc("initialize", init),
	]),
	only("initialize with an older protocol version", [
		rpc("initialize", { ...init, protocolVersion: "2024-11-05" }),
	]),
	only("initialize with the newest protocol version the SDK knows", [
		rpc("initialize", { ...init, protocolVersion: "2025-06-18" }),
	]),
	only("initialize with an unknown protocol version", [
		rpc("initialize", { ...init, protocolVersion: "1999-01-01" }),
	]),
	only("initialize with no client info", [
		rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {} }),
	]),
	only("list the tools", [rpc("tools/list")]),
	only("ping", [rpc("ping")]),
	only("an unknown method", [rpc("resources/list")]),
	only("another unknown method", [rpc("prompts/list")]),
	only("echo a challenge", [echo({ challenge: "connection-123" })]),
	only("echo a challenge of one character", [echo({ challenge: "a" })]),
	only("echo a challenge of 80 characters", [
		echo({ challenge: "c".repeat(80) }),
	]),
	only("echo a challenge of 81 characters", [
		echo({ challenge: "c".repeat(81) }),
	]),
	only("echo an empty challenge", [echo({ challenge: "" })]),
	only("echo a challenge of only spaces", [echo({ challenge: "   " })]),
	only("echo a challenge with a newline and a tab", [
		echo({ challenge: "a\nb\tc" }),
	]),
	only("echo unicode and an emoji", [echo({ challenge: "café 中文 🚀" })]),
	only("echo markup, quotes and ampersands as given", [
		echo({ challenge: `<script>alert(1)</script> & "q" 'x'` }),
	]),
	only("echo with no challenge", [echo({})]),
	only("echo with a number for the challenge", [echo({ challenge: 5 })]),
	only("echo with a null challenge", [echo({ challenge: null })]),
	only("echo with an extra field", [echo({ challenge: "ok", extra: true })]),
	only("echo with no arguments", [
		rpc("tools/call", { name: "publication_connection_probe" }),
	]),
	only("echo with null arguments", [
		rpc("tools/call", {
			name: "publication_connection_probe",
			arguments: null,
		}),
	]),
	only("call a tool that does not exist", [
		rpc("tools/call", { name: "publish_project_update", arguments: {} }),
	]),
	only("tools/call with no params", [
		{
			path: "/api/mcp-probe",
			headers: HEADERS,
			json: { jsonrpc: "2.0", id: 1, method: "tools/call" },
		},
	]),
	only("a string request id", [echo({ challenge: "x" }, {}, "req-7")]),
	only("a null request id", [echo({ challenge: "x" }, {}, null)]),
	only("a request id of zero", [echo({ challenge: "x" }, {}, 0)]),
	only("a jsonrpc version that is not 2.0", [
		{
			path: "/api/mcp-probe",
			headers: HEADERS,
			json: { jsonrpc: "1.0", id: 1, method: "ping" },
		},
	]),
	only("a notification has no answer", [
		{
			path: "/api/mcp-probe",
			headers: HEADERS,
			json: { jsonrpc: "2.0", method: "notifications/initialized" },
		},
	]),
	only("a batch of two calls", [
		{
			path: "/api/mcp-probe",
			headers: HEADERS,
			json: [
				{ jsonrpc: "2.0", id: 1, method: "ping" },
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "publication_connection_probe",
						arguments: { challenge: "b" },
					},
				},
			],
		},
	]),
	only("an empty batch", [
		{ path: "/api/mcp-probe", headers: HEADERS, json: [] },
	]),
	only("a body that is not JSON", [raw("{bad")]),
	only("an empty body", [raw("")]),
	only("a JSON body that is not a JSON-RPC message", [
		raw('{"hello":"world"}'),
	]),
	only("a JSON null body", [raw("null")]),
	only("a challenge in a very large body", [
		echo({ challenge: "L".repeat(200000) }),
	]),
	only("a GET that asks for an event stream", [
		{
			method: "GET",
			path: "/api/mcp-probe",
			headers: { accept: "text/event-stream" },
		},
	]),
	only("a plain GET", [{ method: "GET", path: "/api/mcp-probe" }]),
	only("a DELETE", [{ method: "DELETE", path: "/api/mcp-probe" }]),
	only("a PUT", [
		{ method: "PUT", path: "/api/mcp-probe", headers: HEADERS, body: "{}" },
	]),
	only("no Accept header", [
		{
			path: "/api/mcp-probe",
			headers: { "content-type": "application/json" },
			json: { jsonrpc: "2.0", id: 1, method: "ping" },
		},
	]),
	only("Accept names only JSON", [
		{
			path: "/api/mcp-probe",
			headers: { ...HEADERS, accept: "application/json" },
			json: { jsonrpc: "2.0", id: 1, method: "ping" },
		},
	]),
	only("Accept names only an event stream", [
		{
			path: "/api/mcp-probe",
			headers: { ...HEADERS, accept: "text/event-stream" },
			json: { jsonrpc: "2.0", id: 1, method: "ping" },
		},
	]),
	only("a plain text content type", [
		{
			path: "/api/mcp-probe",
			headers: { ...HEADERS, "content-type": "text/plain" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
		},
	]),
	only("a JSON content type with a charset", [
		{
			path: "/api/mcp-probe",
			headers: {
				...HEADERS,
				"content-type": "application/json; charset=utf-8",
			},
			json: { jsonrpc: "2.0", id: 1, method: "ping" },
		},
	]),
	only("a protocol version header the SDK does not know", [
		rpc(
			"ping",
			{},
			{ headers: { ...HEADERS, "mcp-protocol-version": "1999-01-01" } },
		),
	]),
	only("a protocol version header it knows", [
		rpc(
			"ping",
			{},
			{ headers: { ...HEADERS, "mcp-protocol-version": "2025-03-26" } },
		),
	]),
	only("a session id header is ignored by the stateless transport", [
		rpc("ping", {}, { headers: { ...HEADERS, "mcp-session-id": "abc" } }),
	]),
	only("a query string on the probe URL", [
		rpc("ping", {}, { path: "/api/mcp-probe?x=1&y=%3Cb%3E" }),
	]),
	only("a visitor with an Origin header from another site", [
		rpc("ping", {}, { headers: { ...HEADERS, origin: "https://evil.test" } }),
	]),
	only("sequence: initialize, list, echo, echo again", [
		rpc("initialize", init),
		{
			path: "/api/mcp-probe",
			headers: HEADERS,
			json: { jsonrpc: "2.0", method: "notifications/initialized" },
		},
		rpc("tools/list", {}, {}, 2),
		echo({ challenge: "first" }, {}),
		echo({ challenge: "second" }, {}),
	]),
	only("sequence: a bad call then a good call", [
		echo({ challenge: "" }),
		echo({ challenge: "fine" }),
		raw("{bad"),
		rpc("ping"),
	]),
];

defineCorpus("mcp-probe", ALL, cases);
