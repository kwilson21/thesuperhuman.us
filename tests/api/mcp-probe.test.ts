import type { APIContext } from "astro";
import { expect, it } from "vitest";
import { ALL } from "~/pages/api/mcp-probe";
import { double } from "../helpers/doubles";
import { jsonBody, type JsonValue } from "../helpers/tests-api-json";

/** The JSON-RPC reply fields these tests read. A reply without one fails the expect() that reads it. */
type RpcReply = {
	result: {
		serverInfo: { name: string };
		tools: { name: string; annotations: { readOnlyHint: boolean } }[];
		isError?: boolean;
		content: { text: string }[];
	};
};

async function rpc(method: string, params: JsonValue = {}) {
	const response = await ALL(
		double<APIContext>({
			request: new Request("https://thesuperhuman.us/api/mcp-probe", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			}),
		}),
	);

	expect(response.headers.get("cache-control")).toBe("no-store");

	return jsonBody<RpcReply>(response);
}

it("negotiates MCP and lists only the read-only probe", async () => {
	const init = await rpc("initialize", {
		protocolVersion: "2025-03-26",
		capabilities: {},
		clientInfo: { name: "test", version: "1" },
	});

	expect(init.result.serverInfo.name).toBe("superhuman-connectivity-probe");
	const list = await rpc("tools/list");
	expect(list.result.tools.map((t) => t.name)).toEqual([
		"publication_connection_probe",
	]);
	expect(list.result.tools[0].annotations.readOnlyHint).toBe(true);
});

it("echoes a challenge without publication and rejects unsupported calls", async () => {
	const reply = await rpc("tools/call", {
		name: "publication_connection_probe",
		arguments: { challenge: "connection-123" },
	});

	expect(JSON.parse(reply.result.content[0].text)).toEqual({
		service: "thesuperhuman.us",
		challenge: "connection-123",
		publishingEnabled: false,
	});
	const bad = await rpc("tools/call", { name: "publish", arguments: {} });
	expect(bad.result.isError).toBe(true);
});
