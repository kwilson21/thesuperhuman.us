import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	type CallToolResult,
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { RawValue } from "./fields";
import type { JsonValue } from "./json-value";
import { mcpRefusal } from "./mcp-readers";
import { type Reader, readWith } from "./readers";

// The MCP tools of the site, on the SDK's lower-level server (`McpServer.server`; no tool is registered with the
// high-level API, so its tool handlers are never installed). The high-level server (`registerTool`) takes only a
// Zod schema for a tool's input, and our code gives no library a Zod schema (docs/plans/2026-11-effect-conversion.md,
// "Library boundaries"). Here a tool publishes its input as JSON Schema written out as plain data, and checks its
// arguments with the Effect Schema reader it was given. Everything else the high-level server did for a tool is done as it
// did it, so that a client sees the same `initialize`, `tools/list` and `tools/call` answers: the same capabilities, the
// same `execution` marks, and an argument that is refused answers a tool result with `isError` and the SDK's own text
// (`MCP error -32602: ...`), not a JSON-RPC error.

/** What a tool answers: text, and whether it is an error result. */
export type ToolResult = CallToolResult;

/** A tool's input as JSON Schema, written out as plain data: the keys in the order a client has always seen them. */
export interface PublishedInput {
	readonly [key: string]: JsonValue;
}

export interface ToolDefinition<A> {
	name: string;
	description: string;
	inputSchema: PublishedInput;
	annotations: {
		readOnlyHint: boolean;
		destructiveHint: boolean;
		idempotentHint: boolean;
		openWorldHint: boolean;
	};
	/** Extra data the tool list carries for the client, when the tool has any. */
	meta?: PublishedInput;
	/** Reads the arguments the client sent; a refusal answers the client with every sentence it gave. */
	read: Reader<A>;
	call(args: A): Promise<ToolResult>;
}

/** A tool with the type of its arguments closed over, so tools with different arguments can be served together. */
export interface Tool {
	readonly name: string;
	readonly listing: {
		name: string;
		description: string;
		inputSchema: PublishedInput;
		annotations: ToolDefinition<never>["annotations"];
		execution: { taskSupport: "forbidden" };
		_meta?: PublishedInput;
	};
	run(args: RawValue): Promise<ToolResult>;
}

export function defineTool<A>(definition: ToolDefinition<A>): Tool {
	const listing: Tool["listing"] = {
		name: definition.name,
		description: definition.description,
		inputSchema: definition.inputSchema,
		annotations: definition.annotations,
		execution: { taskSupport: "forbidden" },
	};

	if (definition.meta) listing._meta = definition.meta;

	return {
		name: definition.name,
		listing,
		run: async (args) => {
			const read = readWith(definition.read, args ?? {});

			if (!read.ok)
				return refused(
					`Input validation error: Invalid arguments for tool ${definition.name}: ${mcpRefusal(read.issues)}`,
				);

			// This reproduces the SDK's answer for a tool that fails (a rejection, or a throw before its promise): a tool result
			// that carries the failure's own message, or the failure as text when it is not an `Error`. The site's tools
			// catch their own defects (src/server/publication-mcp.ts), so none reaches here today.
			try {
				return await definition.call(read.value);
			} catch (failure) {
				return toolError(
					failure instanceof Error ? failure.message : String(failure),
				);
			}
		},
	};
}

const toolError = (text: string): ToolResult => ({
	content: [{ type: "text", text }],
	isError: true,
});

/** A refusal of a call, in the words of the SDK's `McpError` for invalid parameters. */
const refused = (message: string) =>
	toolError(new McpError(ErrorCode.InvalidParams, message).message);

/**
 * Hands one request to a stateless MCP server that has these tools and answers it with JSON. The server and its transport
 * live for this request only.
 */
export async function serveTools(
	request: Request,
	about: {
		readonly name: string;
		readonly version: string;
		readonly instructions?: string;
	},
	tools: readonly Tool[],
): Promise<Response> {
	const capabilities = { tools: { listChanged: true } };

	const mcp = new McpServer(
		{ name: about.name, version: about.version },
		about.instructions
			? { capabilities, instructions: about.instructions }
			: { capabilities },
	);

	const byName = new Map(tools.map((tool) => [tool.name, tool]));

	mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((tool) => tool.listing),
	}));
	mcp.server.setRequestHandler(CallToolRequestSchema, async (call) => {
		const tool = byName.get(call.params.name);

		if (tool) return tool.run(call.params.arguments);

		// The SDK's server kept its tools in a plain object, so a name that object has of its own (`constructor`,
		// `toString`, `__proto__`) found something that was not a tool and answered that it was disabled.
		return refused(
			call.params.name in Object.prototype
				? `Tool ${call.params.name} disabled`
				: `Tool ${call.params.name} not found`,
		);
	});

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	try {
		await mcp.connect(transport);
		const response = await transport.handleRequest(request);
		response.headers.set("Cache-Control", "no-store");

		return response;
	} finally {
		await mcp.close();
	}
}
