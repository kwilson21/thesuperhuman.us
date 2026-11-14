import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { runRoute } from "~/server/run";

export const prerender = false;

/** The MCP transport failed while it read or answered the request. */
class ProbeFailed extends Data.TaggedError("ProbeFailed") {}

/** Public connectivity probe only. No credentials, database access, or publication. Zod stays here: the MCP SDK requires it for the tool's input. */
const probe = async (request: Request) => {
	const server = new McpServer({
		name: "superhuman-connectivity-probe",
		version: "1.0.0",
	});

	server.registerTool(
		"publication_connection_probe",
		{
			description:
				"Test this chat connection by echoing a short nonsecret challenge. Does not publish or read project data.",
			inputSchema: z.object({ challenge: z.string().min(1).max(80) }).strict(),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async (args) => {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							service: "thesuperhuman.us",
							challenge: args.challenge,
							publishingEnabled: false,
						}),
					},
				],
			};
		},
	);

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	try {
		await server.connect(transport);
		const response = await transport.handleRequest(request);
		response.headers.set("Cache-Control", "no-store");

		return response;
	} finally {
		await server.close();
	}
};

export const ALL: APIRoute = ({ request }) =>
	runRoute(
		Context.empty(),
		Effect.tryPromise({
			try: () => probe(request),
			catch: () => new ProbeFailed(),
		}).pipe(
			// The probe has no fixed sentence: a transport failure answers a bare 500, as it did when it threw.
			Effect.catchTags({
				ProbeFailed: () => Effect.succeed(new Response(null, { status: 500 })),
			}),
		),
	);
