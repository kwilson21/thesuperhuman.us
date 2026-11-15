// The two MCP tools as the transport calls them: a Promise of the tool's answer. The programs are in
// src/server/flows/publication-tools.ts and fail with nothing (error type `never`); a defect (a bug, a service that is not
// there) is caught here once, logged through `logUnexpected` (which never logs a message that can quote what was sent) and
// answered with the tool's documented status word, so the MCP SDK never sees a rejection and never sends a raw message to the
// client. The words are the protocol's (docs/publication-agent-protocol.md): `unavailable` for a read, `pending` for a delivery.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { PublicationTools, ToolAnswer } from "../lib/publication/mcp";
import { logUnexpected } from "./failure";
import {
	progressTool,
	publishTool,
	type ToolSetting,
} from "./flows/publication-tools";
import type { PublicationDb } from "./services";

const word = (status: string): ToolAnswer => ({
	value: { status },
	isError: true,
});

/** Runs a tool program with the request's services; a defect is logged once and answered with `status`. */
const runTool = (
	services: Context.Context<PublicationDb>,
	program: Effect.Effect<ToolAnswer, never, PublicationDb>,
	status: "unavailable" | "pending",
) =>
	Effect.runPromise(
		program.pipe(
			Effect.catchDefect((defect) =>
				Effect.sync(() => {
					logUnexpected("/api/publication/mcp", defect);

					return word(status);
				}),
			),
			Effect.provideContext(services),
		),
	);

export const publicationTools = (
	setting: ToolSetting,
	services: Context.Context<PublicationDb>,
): PublicationTools => ({
	progress: (projectId) =>
		runTool(services, progressTool(setting, projectId), "unavailable"),
	publish: (projectId, publication) =>
		runTool(services, publishTool(setting, projectId, publication), "pending"),
});
