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

// WebCrypto runs on a thread and a real timer fires on a later macrotask, so how long they take depends on the machine.
// The runner waits for them (EffectLog.begin) and fires timers itself (Determinism.fireNextTimer), so a label never
// depends on speed or load. Each scenario is therefore recorded at every point of a spread of work: digests from a
// fraction of a millisecond to tens of milliseconds, each followed by a different number of queued timer turns, so the
// tracked work resolves early, late and in between. Every recording of a scenario must give one record.

const env = (context: APIContext) => context.locals.runtime.env;
const ctxOf = (context: APIContext) => context.locals.runtime.ctx;

const mail = () =>
	fetch("https://api.resend.com/emails", { method: "POST", body: "{}" });

const one = (): Case => ({
	name: "case",
	fetches: byHost({ resend: json(200, { id: "em_1" }) }),
	steps: [{ path: "/api/x", method: "POST", as: asVisitor() }],
});

const phases = (got: CaseRecord) =>
	got.effects
		.filter((effect) => effect.kind !== "waitUntil-settled")
		.map((effect) => `${effect.kind}:${effect.phase}`);

const bytes = (got: CaseRecord) => JSON.stringify(asFixture(got));

/** One unit of tracked work: a digest of `size` bytes, then `turns` queued timer turns before it resolves for the route. */
type Work = { readonly size: number; readonly turns: number };

const WORK: readonly Work[] = [
	{ size: 1_000, turns: 0 },
	{ size: 64_000, turns: 1 },
	{ size: 4_000_000, turns: 0 },
	{ size: 40_000_000, turns: 2 },
];

/** Recordings per scenario: each point of WORK is recorded this many times in turn. */
const RUNS = 40;

const turns = async (count: number) => {
	for (let turn = 0; turn < count; turn += 1)
		await new Promise<void>((resolve) => setTimeout(resolve, 1));
};

const work = async ({ size, turns: pause }: Work) => {
	await crypto.subtle.digest("SHA-256", new Uint8Array(size));
	await turns(pause);
};

type Scenario = {
	readonly name: string;
	readonly handler: (point: Work) => Handler;
	readonly expected: string[];
	/** The points of work the scenario is recorded at. */
	readonly points?: readonly Work[];
};

const scenarios: Scenario[] = [
	{
		name: "work in the awaited path",
		expected: ["fetch:request", "waitUntil:request", "kv:background"],
		handler: (point) => async (context) => {
			await work(point);
			await mail();

			ctxOf(context).waitUntil(
				(async () => {
					await env(context).RATE_LIMIT.put("k", "1");
				})(),
			);

			return new Response("ok");
		},
	},
	{
		name: "work in the deferred path",
		expected: ["waitUntil:request", "fetch:background", "kv:background"],
		handler: (point) => async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await work(point);
					await mail();
					await env(context).RATE_LIMIT.put("k", "1");
				})(),
			);

			return new Response("ok");
		},
	},
	{
		name: "work in both paths (the route keeps awaiting after waitUntil, so the deferred write is request: the known limit)",
		expected: ["waitUntil:request", "kv:request", "fetch:request"],
		// The deferred digest here races the answer, so its extra timer turns are left out (see the test below).
		points: WORK.map((point) => ({ ...point, turns: 0 })),
		handler: (point) => async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await work(point);
					await env(context).RATE_LIMIT.put("k", "1");
				})(),
			);

			await work({ ...point, size: point.size / 10 });
			await mail();

			return new Response("ok");
		},
	},
	{
		name: "a real timer in the deferred path",
		expected: ["waitUntil:request", "kv:background"],
		handler: (point) => async (context) => {
			ctxOf(context).waitUntil(
				new Promise<void>((resolve) => setTimeout(resolve, 3))
					.then(() => turns(point.turns))
					.then(async () => {
						await env(context).RATE_LIMIT.put("k", "1");
					}),
			);

			return new Response("ok");
		},
	},
	{
		name: "a real timer that the answer waits for",
		expected: ["kv:request"],
		handler: (point) => async (context) => {
			await new Promise((resolve) => setTimeout(resolve, 3));
			await turns(point.turns);
			await env(context).RATE_LIMIT.put("k", "1");

			return new Response("ok");
		},
	},
];

describe("work that leaves the microtask queue does not change a label", () => {
	for (const scenario of scenarios)
		it(`${scenario.name}: ${RUNS} recordings across every point of the work are identical`, async () => {
			const seen = new Set<string>();
			const points = scenario.points ?? WORK;

			for (let run = 0; run < RUNS; run += 1) {
				const point = points[run % points.length] ?? points[0];

				if (!point) throw new Error("WORK is empty");

				const got = await runCase(scenario.handler(point), one());

				seen.add(bytes(got));

				if (run === 0) expect(phases(got)).toEqual(scenario.expected);
			}

			expect(seen.size).toBe(1);
		}, 120_000);
	// The known limit, pinned: a deferred digest that outlives the answer by two queued timer turns is recorded as
	// background, while the same digest with no extra turns races the answer and is recorded as request. The label
	// depends on how the deferred work compares with the answer, so a route that keeps awaiting after waitUntil must
	// call waitUntil last (tests/golden/README.md).
	it("the deferred write of a route that keeps awaiting is background when it outlives the answer", async () => {
		const outlives = { size: 40_000_000, turns: 2 };

		for (let run = 0; run < 3; run += 1) {
			const got = await runCase(
				scenarios[2]?.handler(outlives) ??
					(() => {
						throw new Error("missing scenario");
					})(),
				one(),
			);

			expect(phases(got)).toEqual([
				"waitUntil:request",
				"fetch:request",
				"kv:background",
			]);
		}
	}, 120_000);
});
