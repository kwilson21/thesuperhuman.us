import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { mcpObjectSentences, mcpText } from "~/lib/mcp-readers";
import { defineTool, serveTools } from "~/lib/mcp-tools";
import { record } from "~/lib/readers";
import { runRoute } from "~/server/run";

export const prerender = false;

/** The MCP transport failed while it read or answered the request. */
class ProbeFailed extends Data.TaggedError("ProbeFailed") {}

/** Public connectivity probe only. No credentials, database access, or publication. */
const probe = (request: Request) =>
	serveTools(
		request,
		{ name: "superhuman-connectivity-probe", version: "1.0.0" },
		[
			defineTool({
				name: "publication_connection_probe",
				description:
					"Test this chat connection by echoing a short nonsecret challenge. Does not publish or read project data.",
				inputSchema: {
					$schema: "http://json-schema.org/draft-07/schema#",
					type: "object",
					properties: {
						challenge: { type: "string", minLength: 1, maxLength: 80 },
					},
					required: ["challenge"],
					additionalProperties: false,
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
				read: record(
					{ challenge: mcpText([{ least: 1 }, { most: 80 }]) },
					{ strict: true, says: mcpObjectSentences },
				),
				call: async (args) => ({
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
				}),
			}),
		],
	);

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
