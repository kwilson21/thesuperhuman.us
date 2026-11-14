import type { APIContext } from "astro";
import { afterEach, describe, it, expect } from "vitest";
import { partial } from "../helpers/doubles";
import { testRuntime, type TestRuntime } from "../helpers/runtime";
import type { JsonValue } from "../helpers/json";
import {
	closePublicationDbs,
	publicationD1,
	unmigratedD1,
} from "../helpers/publication-d1";
import { GET, POST } from "~/pages/api/work-feed";

const body = {
	version: 1,
	projectId: "threadline",
	eventId: "one",
	entryId: "first",
	expectedRevision: 0,
	operation: "withdraw",
	origin: "work",
	occurredOn: "2026-09-05",
	threadId: null,
	milestoneId: null,
	story: null,
};

const story = {
	headline: "Shipped the first update",
	summary: "The first update is in the feed.",
	technicalDetail: null,
	delivery: "tested",
	basis: "repository-verified",
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The receipt the receiver gives for the first event of threadline. publishedAt is stamped by the database. */
function receiptFor(eventId: string, revision: number) {
	return {
		projectId: "threadline",
		eventId,
		revision,
		publishedAt: expect.stringMatching(ISO_TIME),
	};
}

function ctx(
	value: JsonValue = body,
	env: Partial<TestRuntime["env"]> = {},
	token = "secret",
): APIContext {
	return partial<APIContext>({
		locals: {
			runtime: testRuntime({
				PUBLICATION_DB: publicationD1(),
				PUBLICATION_PROJECTS: "threadline",
				PUBLICATION_TOKEN: "secret",
				...env,
			}),
		},
		url: new URL("https://example.com/api/work-feed?project=threadline"),
		request: new Request("https://example.com/api/work-feed", {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
			body: JSON.stringify(value),
		}),
	});
}

async function expectReply(
	reply: Response | Promise<Response>,
	status: number,
	error: string,
) {
	const response = await reply;

	expect(response.status).toBe(status);
	expect(await response.json()).toEqual({ error });
}

afterEach(closePublicationDbs);

describe("publication receiver", () => {
	it("fails closed without authorization or a binding", async () => {
		await expectReply(POST(ctx(body, {}, "wrong")), 401, "Unauthorized.");
		await expectReply(
			POST(ctx(body, { PUBLICATION_TOKEN: undefined })),
			401,
			"Unauthorized.",
		);
		await expectReply(
			POST(ctx(body, { PUBLICATION_DB: undefined })),
			503,
			"Delivery unavailable.",
		);
	});
	it("rejects private extra fields, unlisted projects and oversized envelopes", async () => {
		await expectReply(
			POST(ctx({ ...body, privatePrompt: "hidden" })),
			400,
			"Invalid publication.",
		);
		await expectReply(
			POST(ctx({ ...body, projectId: "private" })),
			403,
			"Project unavailable.",
		);
		expect((await POST(ctx("x".repeat(40000)))).status).toBe(413);
	});
	it.each<[string, number, JsonValue[], JsonValue, unknown]>([
		[
			"accepted",
			200,
			[],
			body,
			{ status: "accepted", receipt: receiptFor("one", 1) },
		],
		[
			"duplicate",
			200,
			[body],
			body,
			{ status: "duplicate", receipt: receiptFor("one", 1) },
		],
		[
			"conflict",
			409,
			[body],
			{ ...body, eventId: "two", entryId: "second" },
			{ status: "conflict" },
		],
		[
			"withdrawn",
			410,
			[body],
			{
				...body,
				eventId: "three",
				operation: "publish",
				expectedRevision: 1,
				story,
			},
			{ status: "withdrawn" },
		],
		[
			"rejected",
			400,
			[],
			{ ...body, expectedRevision: Number.MAX_SAFE_INTEGER },
			{ status: "rejected" },
		],
	])(
		"maps %s to %s without claiming delivery on failure",
		async (_name, code, earlier, request, expected) => {
			const database = publicationD1();

			for (const value of earlier)
				expect(
					(await POST(ctx(value, { PUBLICATION_DB: database }))).status,
				).toBe(200);

			const response = await POST(ctx(request, { PUBLICATION_DB: database }));
			expect(response.status).toBe(code);
			expect(await response.json()).toEqual(expected);
		},
	);
	it("does not expose storage errors and serves only listed public projects", async () => {
		const response = await POST(ctx(body, { PUBLICATION_DB: unmigratedD1() }));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: "Delivery pending. Retry the same event.",
		});
		expect((await GET(ctx(body, { PUBLICATION_PROJECTS: "" }))).status).toBe(
			404,
		);
		const result = await GET(ctx());
		expect(result.headers.get("cache-control")).toBe("no-store");
		expect(await result.json()).toMatchObject({ current: null });
	});
});
