import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "~/pages/api/owner/requests/[id]/brief-copy";
import { boundStatement } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import { readJson } from "../helpers/json";
import { musicWorld } from "../helpers/music-world";
import type { TestRuntime } from "../helpers/runtime";

// What the owner's brief copy route answers when the database fails or the stored brief cannot be used, against the real
// schema. A failure of the database, and a failure of the mail provider (a refusal, an error answer, no answer), is the
// route's fixed sentence with 500, never the error's own text; a mail key or address this deployment does not have is a 503.

const SENTENCE = "The brief copy could not be sent. Please try again.";

const DETAILS = JSON.stringify({
	path: "webapp",
	appGoal: "Schedule rehearsals",
	firstVersion: "A calendar",
});

type World = ReturnType<typeof musicWorld>;

let world: World;

const seed = (details: string = DETAILS, email = "alex@example.com") =>
	world.sql
		.prepare(
			`INSERT INTO owner_requests (id,kind,name,email,summary,details_json,status,created_at,updated_at)
			VALUES ('r1','software','Alex Doe',?,'Build a tool',?,'new','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')`,
		)
		.run(email, details);

/** A database that fails each statement or batch whose SQL matches one of the patterns, and runs the others. */
const failing = (...patterns: RegExp[]) =>
	double<D1Database>({
		prepare: (query: string) => {
			if (patterns.some((pattern) => pattern.test(query)))
				throw new Error("d1 down: secret detail");

			return world.db.prepare(query);
		},
		batch: async <T>(items: D1PreparedStatement[]) => {
			if (
				items.some((item) =>
					patterns.some((pattern) => pattern.test(boundStatement(item).query)),
				)
			)
				throw new Error("d1 down: secret detail");

			return world.db.batch<T>(items);
		},
	});

const call = (
	db: D1Database,
	env: Partial<TestRuntime["env"]> = {},
	params: APIContext["params"] = { id: "r1" },
): Promise<Response> =>
	Promise.resolve(
		POST(
			partial<APIContext>({
				params,
				request: new Request(
					"https://thesuperhuman.us/api/owner/requests/r1/brief-copy",
					{
						method: "POST",
						headers: {
							origin: "https://thesuperhuman.us",
							"content-type": "application/json",
						},
						body: JSON.stringify({ action: "send" }),
					},
				),
				locals: partial<APIContext["locals"]>({
					owner: { email: "owner@example.com" },
					runtime: partial<TestRuntime>({
						env: partial<TestRuntime["env"]>({
							MUSIC_DB: db,
							RESEND_API_KEY: "test",
							CONTACT_FROM_EMAIL: "from@example.com",
							CONTACT_TO_EMAIL: "inbox@example.com",
							...env,
						}),
					}),
				}),
			}),
		),
	);

const stored = () => {
	const row = world.sql
		.prepare("SELECT details_json FROM owner_requests WHERE id='r1'")
		.get();

	return row ? JSON.parse(String(row.details_json)) : null;
};

const sent = () =>
	vi
		.mocked(fetch)
		.mock.calls.filter(([url]) => String(url).includes("api.resend.com"));

const answeredOnlyTheSentence = async (response: Response) => {
	const text = await response.text();

	expect(JSON.parse(text)).toEqual({ ok: false, error: SENTENCE });
	expect(text).not.toContain("secret");
};

beforeEach(() => {
	world = musicWorld();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("{}", { status: 200 })),
	);
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("a database failure answers 500 with the route's sentence", () => {
	it("when the request cannot be read", async () => {
		seed();

		const response = await call(failing(/FROM owner_requests WHERE id=\?/));

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
		expect(sent()).toHaveLength(0);
	});

	it("when the stored details are not JSON", async () => {
		seed("not json");

		const response = await call(world.db);

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
		expect(sent()).toHaveLength(0);
	});

	it("when the stored details are not an object, and no email is sent for a copy that cannot be recorded", async () => {
		seed("[]");

		const response = await call(world.db);

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
		expect(sent()).toHaveLength(0);
	});

	it("when the claim cannot be written", async () => {
		seed();

		const response = await call(failing(/clientCopyStatus','uncertain'/));

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
		expect(sent()).toHaveLength(0);
	});

	it("when the status cannot be written after the provider sent the copy", async () => {
		seed();

		const response = await call(
			failing(/json_set\(details_json,'\$\.clientCopyStatus',\?\)/),
		);

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
		expect(sent()).toHaveLength(1);
		// The claim stays: a copy that may have gone out is never sent again without the owner's confirmation.
		expect(stored().clientCopyStatus).toBe("uncertain");
	});

	it("when the status cannot be written after the provider refused the copy", async () => {
		seed();

		vi.mocked(fetch).mockImplementation(
			async () => new Response("{}", { status: 422 }),
		);

		const response = await call(
			failing(/json_set\(details_json,'\$\.clientCopyStatus',\?\)/),
		);

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
	});

	it("when no mail key is set and the status cannot be written", async () => {
		seed();

		const response = await call(
			failing(/json_set\(details_json,'\$\.clientCopyStatus',\?\)/),
			{ RESEND_API_KEY: undefined },
		);

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
		expect(sent()).toHaveLength(0);
	});
});

describe("a request with no id", () => {
	it.each([{}, { id: "" }])(
		"is no such request, as an unknown id is: %j",
		async (params) => {
			seed();
			const response = await call(world.db, {}, params);

			expect(response.status).toBe(404);
			expect(await readJson(response)).toEqual({ ok: false });
			expect(sent()).toHaveLength(0);
		},
	);
});

describe("answers that stay as they were", () => {
	it("answers 503 when no mail key is set", async () => {
		seed();

		const response = await call(world.db, { RESEND_API_KEY: undefined });

		expect(response.status).toBe(503);
		expect(stored().clientCopyStatus).toBe("failed");
	});

	it("answers ok when the copy was sent, and records it", async () => {
		seed();

		const response = await call(world.db);

		expect(response.status).toBe(200);
		expect(await readJson(response)).toEqual({ ok: true });
		expect(stored().clientCopyStatus).toBe("sent");
	});
});

describe("a failure of the mail provider answers 500 with the route's sentence", () => {
	it("when the provider refuses the copy, and the copy is recorded as failed", async () => {
		seed();

		vi.mocked(fetch).mockImplementation(
			async () => new Response("{}", { status: 422 }),
		);
		const response = await call(world.db);

		expect(response.status).toBe(500);
		await answeredOnlyTheSentence(response);
		expect(stored().clientCopyStatus).toBe("failed");
	});

	it.each([
		["answers an error", async () => new Response("{}", { status: 500 })],
		[
			"cannot be reached",
			async (): Promise<Response> => {
				throw new Error("network down: secret detail");
			},
		],
	])(
		"when the provider %s, the copy is recorded as uncertain, and not ok",
		async (_name, answer) => {
			seed();
			vi.mocked(fetch).mockImplementation(answer);
			const response = await call(world.db);

			expect(response.status).toBe(500);
			await answeredOnlyTheSentence(response);
			expect(stored().clientCopyStatus).toBe("uncertain");
			expect(sent()).toHaveLength(1);
		},
	);
});
