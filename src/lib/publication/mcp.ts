import {
	mcpChoice,
	mcpInteger,
	mcpLiteral,
	mcpObjectSentences,
	mcpSized,
	mcpText,
} from "../mcp-readers";
import {
	defineTool,
	type PublishedInput,
	serveTools,
	type ToolResult,
} from "../mcp-tools";
import { nullable, record, type Value } from "../readers";

export interface PublicationIdentity {
	ownerId: string;
	readonly scopes: readonly string[];
}

const object = { strict: true, says: mcpObjectSentences };

const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

// What the readers and the published JSON Schema below both say, written once.
const headline = { least: 1, most: 140 };
const summary = { least: 1, most: 1000 };
const technicalDetail = { least: 1, most: 4000 };
const revision = { least: 0, most: Number.MAX_SAFE_INTEGER };

const deliveries = ["proposed", "implemented", "tested", "available"] as const;

const bases = [
	"agent-reported",
	"repository-verified",
	"human-confirmed",
] as const;

const operations = ["publish", "correct", "withdraw"] as const;
const origins = ["work", "shutdown", "backfill"] as const;

const id = mcpText([{ pattern: idPattern }]);

const storyFields = {
	headline: mcpSized(headline),
	summary: mcpSized(summary),
	technicalDetail: nullable(mcpSized(technicalDetail)),
	delivery: mcpChoice(deliveries),
	basis: mcpChoice(bases),
};

const story = record(storyFields, object);

const envelopeFields = {
	version: mcpLiteral(1),
	projectId: id,
	eventId: id,
	entryId: id,
	expectedRevision: mcpInteger(revision),
	operation: mcpChoice(operations),
	origin: mcpChoice(origins),
	occurredOn: mcpText([{ pattern: datePattern }]),
	threadId: nullable(id),
	milestoneId: nullable(id),
	story: nullable(story),
};

const envelope = record(envelopeFields, object);

/** The envelope as the tool's declared input shapes it; the commit reads it again as a publication before it is used. */
export type Envelope = Value<typeof envelope>;

/** What a tool answers: a value that becomes the tool result's JSON text, and whether it is an error result. */
export interface ToolAnswer {
	value: unknown;
	isError: boolean;
}

const result = (answer: ToolAnswer): ToolResult => ({
	content: [{ type: "text", text: JSON.stringify(answer.value) }],
	isError: answer.isError,
});

// The tools' input as JSON Schema, written out as plain data. It is what the tool list has always shown a client (the
// differential test compares it with what Zod made of the schemas these readers replaced), so keep the keys in this order.

const idSchema = { type: "string", pattern: idPattern.source };

const orNull = (schema: PublishedInput) => ({
	anyOf: [schema, { type: "null" }],
});

const choice = (values: readonly string[]) => ({
	type: "string",
	enum: [...values],
});

const sized = (limit: { least: number; most: number }) => ({
	type: "string",
	minLength: limit.least,
	maxLength: limit.most,
});

const storySchema = {
	type: "object",
	properties: {
		headline: sized(headline),
		summary: sized(summary),
		technicalDetail: orNull(sized(technicalDetail)),
		delivery: choice(deliveries),
		basis: choice(bases),
	},
	required: Object.keys(storyFields),
	additionalProperties: false,
};

const envelopeSchema = {
	type: "object",
	properties: {
		version: { type: "number", const: 1 },
		projectId: idSchema,
		eventId: idSchema,
		entryId: idSchema,
		expectedRevision: {
			type: "integer",
			minimum: revision.least,
			maximum: revision.most,
		},
		operation: choice(operations),
		origin: choice(origins),
		occurredOn: { type: "string", pattern: datePattern.source },
		threadId: orNull(idSchema),
		milestoneId: orNull(idSchema),
		story: orNull(storySchema),
	},
	required: Object.keys(envelopeFields),
	additionalProperties: false,
};

/**
 * What the two tools do. The decisions and the journal are in src/server (src/lib may not import it), so the route hands
 * them in; the MCP transport is src/lib/mcp-tools.ts, and this file holds the tools' declared inputs.
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
	const scopes = identity.scopes.filter((scope) =>
		scope.startsWith("publication:"),
	);

	const meta = { securitySchemes: [{ type: "oauth2", scopes }] };

	return serveTools(
		request,
		{
			name: "superhuman-publication",
			version: "1.0.0",
			instructions:
				"Follow docs/publication-agent-protocol.md in kwilson21/thesuperhuman.us. Reconcile the project roadmap and review public wording before delivery. Never send raw private evidence or secrets. Receipts confirm ingestion, not completion or website rendering. Retry identical envelopes; reconcile conflicts without blindly increasing revisions.",
		},
		[
			defineTool({
				name: "get_project_progress",
				description:
					"Read published progress and the current revision for an authorized project. Use before preparing an update or resolving a conflict.",
				inputSchema: {
					$schema: "http://json-schema.org/draft-07/schema#",
					type: "object",
					properties: { projectId: idSchema },
					required: ["projectId"],
					additionalProperties: false,
				},
				meta,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
				read: record({ projectId: id }, object),
				call: async ({ projectId }) => result(await tools.progress(projectId)),
			}),
			defineTool({
				name: "publish_project_update",
				description:
					"Publish, correct, backfill, or permanently withdraw public website progress after canonical reconciliation and audience review. Use plain-language outcomes and accurate delivery/basis. Preserve event identity on retries. A withdrawal removes the entry and blocks restoration. A conflict requires source reconciliation, not automatic revision advancement.",
				inputSchema: {
					$schema: "http://json-schema.org/draft-07/schema#",
					type: "object",
					properties: { publication: envelopeSchema },
					required: ["publication"],
					additionalProperties: false,
				},
				meta,
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: true,
					openWorldHint: true,
				},
				read: record({ publication: envelope }, object),
				call: async ({ publication }) =>
					result(await tools.publish(publication.projectId, publication)),
			}),
		],
	);
}
