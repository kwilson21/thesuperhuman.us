import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export interface PublicationIdentity {
	ownerId: string;
	readonly scopes: readonly string[];
}

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);

const envelope = z
	.object({
		version: z.literal(1),
		projectId: id,
		eventId: id,
		entryId: id,
		expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
		operation: z.enum(["publish", "correct", "withdraw"]),
		origin: z.enum(["work", "shutdown", "backfill"]),
		occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		threadId: id.nullable(),
		milestoneId: id.nullable(),
		story: z
			.object({
				headline: z.string().min(1).max(140),
				summary: z.string().min(1).max(1000),
				technicalDetail: z.string().min(1).max(4000).nullable(),
				delivery: z.enum(["proposed", "implemented", "tested", "available"]),
				basis: z.enum([
					"agent-reported",
					"repository-verified",
					"human-confirmed",
				]),
			})
			.strict()
			.nullable(),
	})
	.strict();

const result = (answer: ToolAnswer) => ({
	content: [{ type: "text" as const, text: JSON.stringify(answer.value) }],
	isError: answer.isError,
});

/** The envelope as the tool's declared input shapes it; the commit reads it again as a publication before it is used. */
export type Envelope = z.infer<typeof envelope>;

/** What a tool answers: a value that becomes the tool result's JSON text, and whether it is an error result. */
export interface ToolAnswer {
	value: unknown;
	isError: boolean;
}

/**
 * What the two tools do. The decisions and the journal are in src/server (src/lib may not import it), so the route hands
 * them in; this file is the MCP transport and the tools' declared inputs, which the MCP SDK requires to be Zod schemas.
 */
export interface PublicationTools {
	progress(projectId: string): Promise<ToolAnswer>;
	publish(projectId: string, publication: Envelope): Promise<ToolAnswer>;
}

/** Called only after OAuth token verification. No public route calls this directly. */
export async function publicationMcp(
	request: Request,
	identity: PublicationIdentity,
	tools: PublicationTools,
): Promise<Response> {
	const server = new McpServer(
		{ name: "superhuman-publication", version: "1.0.0" },
		{
			instructions:
				"Follow docs/publication-agent-protocol.md in kwilson21/thesuperhuman.us. Reconcile the project roadmap and review public wording before delivery. Never send raw private evidence or secrets. Receipts confirm ingestion, not completion or website rendering. Retry identical envelopes; reconcile conflicts without blindly increasing revisions.",
		},
	);

	const scopes = identity.scopes.filter((scope) =>
		scope.startsWith("publication:"),
	);

	const security = { securitySchemes: [{ type: "oauth2", scopes }] };
	server.registerTool(
		"get_project_progress",
		{
			description:
				"Read published progress and the current revision for an authorized project. Use before preparing an update or resolving a conflict.",
			inputSchema: z.object({ projectId: id }).strict(),
			_meta: security,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ projectId }) => result(await tools.progress(projectId)),
	);
	server.registerTool(
		"publish_project_update",
		{
			description:
				"Publish, correct, backfill, or permanently withdraw public website progress after canonical reconciliation and audience review. Use plain-language outcomes and accurate delivery/basis. Preserve event identity on retries. A withdrawal removes the entry and blocks restoration. A conflict requires source reconciliation, not automatic revision advancement.",
			inputSchema: z.object({ publication: envelope }).strict(),
			_meta: security,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async ({ publication }) =>
			result(await tools.publish(publication.projectId, publication)),
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
}
