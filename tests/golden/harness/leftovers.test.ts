import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import {
	asFixture,
	asVisitor,
	byHost,
	json,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
} from "./index";

// Work a route leaves behind while it waits on a timer. A timer still queued when its step ends is abandoned (settle.ts):
// it never fires in a later step, so no effect is recorded under a step that did not start it. Work that needs only
// tracked crypto or immediates still runs in its own step. A ctx.waitUntil registered late is drained like any other.

/** Runs of a scenario that must each give the same record. */
const RUNS = 20;

/** A recording takes about 20 ms; 30 s leaves room for a loaded runner. */
const BUDGET_MS = 30_000;

const env = (context: APIContext) => context.locals.runtime.env;
const ctxOf = (context: APIContext) => context.locals.runtime.ctx;

const budget = (context: APIContext, day: string) =>
	env(context)
		.MUSIC_DB?.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, 's', 1)",
		)
		.bind(day)
		.run();

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const one = (extra: Partial<Case> = {}): Case => ({
	name: "case",
	fetches: byHost({ resend: json(200, { id: "em_1" }) }),
	steps: [{ path: "/api/x", method: "POST", as: asVisitor() }],
	...extra,
});

const bytes = (got: CaseRecord) => JSON.stringify(asFixture(got));

const d1Effects = (got: CaseRecord) =>
	got.effects.filter((effect) => effect.kind === "d1");

/** The ids of the waitUntil entries a case registered, in order. */
const registeredIds = (got: CaseRecord) =>
	got.effects.flatMap((effect) =>
		effect.kind === "waitUntil" ? [effect.id] : [],
	);

/** A route that answers at once and leaves a put behind a 10 ms timer. */
const putAfterTimer: Handler = (context) => {
	void (async () => {
		await sleep(10);
		await budget(context, "t");
	})();

	return new Response("ok");
};

/** A route that answers after its own 50 ms timer. */
const waitsFiftyMs: Handler = async () => {
	await sleep(50);

	return new Response("ok");
};

/** A route that answers at once, with nothing left behind. */
const idle: Handler = () => new Response("ok");

describe("a timer left queued when its step ends is abandoned", () => {
	it(
		"last step: the put behind a timer is not recorded, and the case ends cleanly",
		async () => {
			const seen = new Set<string>();

			for (let run = 0; run < RUNS; run += 1) {
				const got = await runCase(putAfterTimer, one());

				seen.add(bytes(got));
				expect(d1Effects(got)).toEqual([]);
				expect(got.steps[0]?.answer).toMatchObject({ outcome: "response" });
			}

			expect(seen.size).toBe(1);
		},
		BUDGET_MS,
	);

	it(
		"middle step, next step idle: the put is not recorded in any step",
		async () => {
			const c = one({
				steps: [
					{
						path: "/api/a",
						method: "POST",
						as: asVisitor(),
						handler: putAfterTimer,
					},
					{ path: "/api/b", method: "POST", as: asVisitor(), handler: idle },
				],
			});

			const seen = new Set<string>();

			for (let run = 0; run < RUNS; run += 1) {
				const got = await runCase(idle, c);

				seen.add(bytes(got));
				expect(d1Effects(got)).toEqual([]);
			}

			expect(seen.size).toBe(1);
		},
		BUDGET_MS,
	);

	it(
		"middle step, next step waits on its own 50 ms timer: step 0's put is not recorded in step 1",
		async () => {
			const c = one({
				steps: [
					{
						path: "/api/a",
						method: "POST",
						as: asVisitor(),
						handler: putAfterTimer,
					},
					{
						path: "/api/b",
						method: "POST",
						as: asVisitor(),
						handler: waitsFiftyMs,
					},
				],
			});

			const seen = new Set<string>();

			for (let run = 0; run < RUNS; run += 1) {
				const got = await runCase(idle, c);

				seen.add(bytes(got));
				expect(d1Effects(got)).toEqual([]);
			}

			expect(seen.size).toBe(1);
		},
		BUDGET_MS,
	);
});

describe("a timer loop is an error, not a wait", () => {
	it(
		"a handler that awaits a timer forever: an error naming the case and step",
		async () => {
			await expect(
				runCase(async () => {
					for (;;) await sleep(1000);
				}, one()),
			).rejects.toThrow(/case "case", step 0.*timers/);
		},
		BUDGET_MS,
	);

	it(
		"a waitUntil that awaits a timer forever: an error naming the case and step",
		async () => {
			await expect(
				runCase((context) => {
					ctxOf(context).waitUntil(
						(async () => {
							for (;;) await sleep(1000);
						})(),
					);

					return new Response("ok");
				}, one()),
			).rejects.toThrow(/case "case", step 0.*timers/);
		},
		BUDGET_MS,
	);
});

describe("a waitUntil registered after the background pass has begun is drained", () => {
	// The digest is tracked work, so the background pass is still running when the floating work calls waitUntil.
	const lateWaitUntil =
		(work: () => Promise<void>): Handler =>
		(context) => {
			void (async () => {
				await crypto.subtle.digest("SHA-256", new Uint8Array(1));
				ctxOf(context).waitUntil(work());
			})();

			return new Response("ok");
		};

	it(
		"a late waitUntil that resolves is recorded as fulfilled",
		async () => {
			const got = await runCase(
				lateWaitUntil(async () => {}),
				one(),
			);

			const [id] = registeredIds(got);

			expect(registeredIds(got)).toHaveLength(1);
			expect(
				got.effects.filter((effect) => effect.kind === "waitUntil-settled"),
			).toEqual([expect.objectContaining({ id, outcome: "fulfilled" })]);
		},
		BUDGET_MS,
	);

	it(
		"a late waitUntil that rejects is recorded as rejected, with its error",
		async () => {
			const got = await runCase(
				lateWaitUntil(async () => {
					throw new Error("late");
				}),
				one(),
			);

			const [id] = registeredIds(got);

			expect(registeredIds(got)).toHaveLength(1);
			expect(
				got.effects.filter((effect) => effect.kind === "waitUntil-settled"),
			).toEqual([
				expect.objectContaining({
					id,
					outcome: "rejected",
					error: "Error: late",
				}),
			]);
		},
		BUDGET_MS,
	);
});
