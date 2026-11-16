import * as Context from "effect/Context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicationDb } from "../../src/server/services";
import { publicationTools } from "../../src/server/publication-mcp";

// A tool whose program dies (here: the database service is not provided, so the first read fails as a defect) answers its
// documented status word, logs once without what it was sent, and never rejects.

const setting = {
	ownerId: "1",
	allowlist: "threadline",
	connection: { ownerId: "1", scopes: ["publication:threadline"] },
};

// SAFETY: deliberately incomplete. The context holds no database, so the first read dies with "Service not found", which is the defect these tests need; no other code reads this value.
const noDatabase = Context.empty() as Context.Context<PublicationDb>;

const envelope = {
	version: 1 as const,
	projectId: "threadline",
	eventId: "e",
	entryId: "n",
	expectedRevision: 0,
	operation: "withdraw" as const,
	origin: "work" as const,
	occurredOn: "2026-11-12",
	threadId: null,
	milestoneId: null,
	story: null,
};

afterEach(() => vi.restoreAllMocks());

describe("the MCP tools when something dies", () => {
	it("answers unavailable for a read and pending for a delivery, and logs each once", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const tools = publicationTools(setting, noDatabase);

		await expect(tools.progress("threadline")).resolves.toEqual({
			value: { status: "unavailable" },
			isError: true,
		});
		await expect(
			tools.publish("threadline", { ...envelope, story: null }),
		).resolves.toEqual({ value: { status: "pending" }, isError: true });
		expect(log).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(log.mock.calls)).not.toContain("withdraw");
	});

	it("still answers forbidden before anything can die", async () => {
		const tools = publicationTools({ ...setting, ownerId: "2" }, noDatabase);

		await expect(tools.progress("threadline")).resolves.toEqual({
			value: { status: "forbidden" },
			isError: true,
		});
	});
});
