import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { record } from "../recorder";
import {
	aiThrows,
	aiValue,
	asVisitor,
	byHost,
	json,
	networkDown,
	runCase,
	type Case,
	type Handler,
} from "./index";

// A declared trigger (a failure, an outage, a race) that never fires fails the case, when recording and when checking,
// because the case would otherwise record the happy path under a name that claims an outage.

const env = (context: APIContext) => context.locals.runtime.env;

const one = (extra: Partial<Case> = {}): Case => ({
	name: "trigger case",
	steps: [{ path: "/api/x", method: "POST", as: asVisitor() }],
	...extra,
});

/** Reads one row, so a statement about `owner_requests` is run once. */
const reads: Handler = async (context) => {
	await env(context)
		.MUSIC_DB?.prepare("SELECT id FROM owner_requests WHERE id = ?")
		.bind("r1")
		.all();

	return new Response("ok");
};

const message = async (handler: Handler, c: Case) => {
	try {
		await runCase(handler, c);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}

	return null;
};

describe("D1 failure triggers", () => {
	it("passes when the failure fires", async () => {
		const got = await runCase(
			async (context) => {
				try {
					await reads(context);
				} catch {
					return new Response("failed", { status: 500 });
				}

				return new Response("ok");
			},
			one({ failures: [{ on: /FROM owner_requests/, message: "boom" }] }),
		);

		expect(got.steps[0]?.answer).toMatchObject({ status: 500 });
	});

	it("fails and names the trigger and its pattern when nothing matches", async () => {
		const got = await message(
			reads,
			one({ failures: [{ on: /UPDATE owner_requests SET/, message: "boom" }] }),
		);

		expect(got).toContain("did not fire");
		expect(got).toContain("d1 failure on /UPDATE owner_requests SET/");
		expect(got).toContain("seen 0 times, declared 1");
	});

	it("fails when it matched fewer times than its nth", async () => {
		const got = await message(
			async (context) => {
				try {
					await reads(context);
				} catch {
					// the second match never comes
				}

				return new Response("ok");
			},
			one({
				failures: [{ on: /FROM owner_requests/, nth: 2, message: "boom" }],
			}),
		);

		expect(got).toContain("d1 failure on /FROM owner_requests/ (match 2)");
		expect(got).toContain("seen 1 time, declared 2");
	});

	it("fails for an interleave that never ran, naming its label", async () => {
		const got = await message(
			reads,
			one({
				interleave: [
					{
						on: /DELETE FROM nothing/,
						label: "a racing delete",
						run: () => {},
					},
				],
			}),
		);

		expect(got).toContain(
			'd1 interleave "a racing delete" on /DELETE FROM nothing/',
		);
	});
});

describe("optional triggers", () => {
	const quietFailure: Partial<Case> = {
		failures: [{ on: /UPDATE owner_requests SET/, message: "boom" }],
	};

	const id = "d1 failure on /UPDATE owner_requests SET/";

	it("passes when a trigger is marked optional with a reason", async () => {
		await expect(
			runCase(
				reads,
				one({
					...quietFailure,
					optionalTriggers: [{ trigger: id, reason: "only a race reaches it" }],
				}),
			),
		).resolves.toBeDefined();
	});

	it("fails when the reason is blank", async () => {
		const got = await message(
			reads,
			one({
				...quietFailure,
				optionalTriggers: [{ trigger: id, reason: " " }],
			}),
		);

		expect(got).toContain(`optional trigger "${id}" has no reason`);
	});

	it("fails when the text matches no declared trigger", async () => {
		const got = await message(
			reads,
			one({
				optionalTriggers: [{ trigger: "d1 failure on /nope/", reason: "why" }],
			}),
		);

		expect(got).toContain("matches no declared trigger");
	});
});

describe("R2, KV, fetch and AI triggers", () => {
	it("fires for an R2 failure that the route reaches, and fails for one it does not", async () => {
		const handler: Handler = async (context) => {
			try {
				await env(context).AUDIO.get("k");
			} catch {
				return new Response("failed", { status: 500 });
			}

			return new Response("ok");
		};

		await expect(
			runCase(handler, one({ r2: { fails: ["get"] } })),
		).resolves.toBeDefined();

		const got = await message(handler, one({ r2: { fails: ["put"] } }));

		expect(got).toContain("r2 AUDIO fails put");
	});

	it("fires for a KV failure that the route reaches, and fails for one it does not", async () => {
		const handler: Handler = async (context) => {
			try {
				await env(context).RATE_LIMIT.get("k");
			} catch {
				return new Response("failed", { status: 500 });
			}

			return new Response("ok");
		};

		await expect(
			runCase(handler, one({ kv: { RATE_LIMIT: { fails: ["get"] } } })),
		).resolves.toBeDefined();

		const got = await message(
			handler,
			one({ kv: { RATE_LIMIT: { fails: ["delete"] } } }),
		);

		expect(got).toContain("kv RATE_LIMIT fails delete");
	});

	it("fires for a fetch outage that a call gets, and fails for one no call gets", async () => {
		const handler: Handler = async () => {
			try {
				await fetch("https://api.stripe.com/v1/customers");
			} catch {
				return new Response("failed", { status: 500 });
			}

			return new Response("ok");
		};

		await expect(
			runCase(
				handler,
				one({ fetches: byHost({ stripe: networkDown("down") }) }),
			),
		).resolves.toBeDefined();

		const got = await message(
			handler,
			one({
				fetches: byHost({
					stripe: [json(200, {}), networkDown("second call down")],
				}),
			}),
		);

		expect(got).toContain('fetch stripe answer 2 throws "second call down"');
	});

	it("fires for an AI answer that throws once the route runs that answer, and fails when it never gets there", async () => {
		const handler: Handler = async (context) => {
			try {
				await env(context).AI?.run("@cf/meta/llama-3.2-1b-instruct", {
					prompt: "hi",
				});
			} catch {
				return new Response("failed", { status: 500 });
			}

			return new Response("ok");
		};

		await expect(
			runCase(handler, one({ ai: [aiThrows("ai down")] })),
		).resolves.toBeDefined();

		const got = await message(
			handler,
			one({ ai: [aiValue({}), aiThrows("later")] }),
		);

		expect(got).toContain('ai answer 2 throws "later"');
	});
});

describe("the older recorder (contact and resume routes)", () => {
	const handler: Handler = async (context) => {
		try {
			await env(context).RATE_LIMIT.get("k");
		} catch {
			return new Response("failed", { status: 500 });
		}

		return new Response("ok");
	};

	const named = (fails: { get?: boolean; put?: boolean }) => ({
		name: "legacy",
		steps: [{ url: "https://thesuperhuman.us/api/x" }],
		rateLimit: { fails },
	});

	it("passes when a declared KV failure fires and fails when it does not", async () => {
		await expect(record(handler, named({ get: true }))).resolves.toBeDefined();

		await expect(record(handler, named({ put: true }))).rejects.toThrow(
			"kv RATE_LIMIT fails put",
		);
	});
});
