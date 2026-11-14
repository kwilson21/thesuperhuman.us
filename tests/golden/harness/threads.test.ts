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
// The harness does not deliver a finished threaded operation (or a finished setImmediate) when it finishes: it holds
// the result and delivers the operations in the order they STARTED, one per driver turn (tests/golden/README.md). So
// the timers a route creates, and every label, follow from the route's structure, not from which digest was faster.
// Each scenario is recorded at every point of a spread of work, and every recording must give one record.

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
	{ size: 1_000_000, turns: 2 },
	{ size: 4_000_000, turns: 0 },
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

const yieldMacrotask = () =>
	new Promise<void>((resolve) => setImmediate(resolve));

type Scenario = {
	readonly name: string;
	readonly handler: (point: Work) => Handler;
	readonly expected: string[];
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
		name: "a yield to the event loop (setImmediate) before the answer",
		expected: ["fetch:request", "waitUntil:request", "kv:background"],
		handler: (point) => async (context) => {
			await work(point);
			await mail();

			ctxOf(context).waitUntil(
				(async () => {
					await env(context).RATE_LIMIT.put("k", "1");
				})(),
			);

			await yieldMacrotask();

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

			for (let run = 0; run < RUNS; run += 1) {
				const point = WORK[run % WORK.length] ?? WORK[0];

				if (!point) throw new Error("WORK is empty");

				const got = await runCase(scenario.handler(point), one());

				seen.add(bytes(got));

				if (run === 0) expect(phases(got)).toEqual(scenario.expected);
			}

			expect(seen.size).toBe(1);
		}, 120_000);

	// The pairings that made the record depend on machine speed before the delivery order was fixed: a deferred digest
	// of several megabytes against an awaited one of a kilobyte, and the reverse, with and without load.
	const pairs: [deferred: number, awaited: number][] = [
		[8_500_000, 1_000],
		[9_500_000, 1_000],
		[9_000_000, 6_000_000],
	];

	for (const [deferred, awaited] of pairs)
		it(`deferred ${deferred} bytes, awaited ${awaited} bytes, then a timer turn: ${RUNS} recordings are identical`, async () => {
			const seen = new Set<string>();

			for (let run = 0; run < RUNS; run += 1) {
				const got = await runCase(async (context) => {
					ctxOf(context).waitUntil(
						(async () => {
							await crypto.subtle.digest("SHA-256", new Uint8Array(deferred));
							await turns(1);
							await env(context).RATE_LIMIT.put("k", "1");
						})(),
					);

					await crypto.subtle.digest("SHA-256", new Uint8Array(awaited));
					await turns(1);
					await mail();

					return new Response("ok");
				}, one());

				seen.add(bytes(got));

				if (run === 0)
					expect(phases(got)).toEqual([
						"waitUntil:request",
						"kv:request",
						"fetch:request",
					]);
			}

			expect(seen.size).toBe(1);
		}, 240_000);
});
