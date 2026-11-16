// The two MCP tools as flows: read a project's progress, and deliver an envelope. Each checks that the connection may use
// the project first (the answer for a connection that may not is `forbidden`, before anything is read or validated),
// then does the work. A tool answers in the MCP protocol's own shape, a result with a status word, never an HTTP status:
// an unexpected failure is `unavailable` (a read) or `pending` (a delivery, to be retried with the same envelope), as
// docs/publication-agent-protocol.md tells the agent. The protocol wins over the site's 500 rule here: the HTTP answer is
// always 200 with the result inside.
import * as Effect from "effect/Effect";
import { parsePublication } from "../../lib/publication/contract";
import type { Envelope, ToolAnswer } from "../../lib/publication/mcp";
import { allowConnection, type Connection } from "../rules/publication-access";
import { commit } from "./publication-commit";
import { readFeed } from "./publication-feed";

const failed = (status: string): ToolAnswer => ({
	value: { status },
	isError: true,
});

export type ToolSetting = {
	readonly ownerId: string | undefined;
	readonly allowlist: string | undefined;
	readonly connection: Connection;
};

const may = (setting: ToolSetting, project: string) =>
	allowConnection.decide({ ...setting, project }, {});

export const progressTool = (setting: ToolSetting, projectId: string) =>
	may(setting, projectId).pipe(
		Effect.flatMap(() => readFeed(projectId)),
		Effect.map((feed): ToolAnswer => ({ value: feed, isError: false })),
		Effect.catchTags({
			ProjectForbidden: () => Effect.succeed(failed("forbidden")),
			PublicationStoreFailed: () => Effect.succeed(failed("unavailable")),
			StoredPublicationInvalid: () => Effect.succeed(failed("unavailable")),
		}),
	);

export const publishTool = (
	setting: ToolSetting,
	projectId: string,
	input: Envelope,
) =>
	Effect.gen(function* () {
		yield* may(setting, projectId);
		const publication = parsePublication(input);

		if (!publication) return failed("invalid");
		const outcome = yield* commit(publication);

		return {
			value: { status: "delivered", receipt: outcome.receipt },
			isError: false,
		} satisfies ToolAnswer;
	}).pipe(
		Effect.catchTags({
			ProjectForbidden: () => Effect.succeed(failed("forbidden")),
			PublicationRejected: () => Effect.succeed(failed("rejected")),
			PublicationConflict: () => Effect.succeed(failed("conflict")),
			SaveKeptChanging: () => Effect.succeed(failed("conflict")),
			PublicationWithdrawn: () => Effect.succeed(failed("withdrawn")),
			PublicationStoreFailed: () => Effect.succeed(failed("pending")),
		}),
	);
