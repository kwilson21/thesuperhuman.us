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
// depends on speed or load: each scenario is recorded many times, at several sizes of work, and must give one record.

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

const SIZES = [1_000, 64_000, 300_000];
const RUNS = 200;

const work = (size: number) =>
	crypto.subtle.digest("SHA-256", new Uint8Array(size));

type Scenario = {
	readonly name: string;
	readonly handler: (size: number) => Handler;
	readonly expected: string[];
};

const scenarios: Scenario[] = [
	{
		name: "work in the awaited path",
		expected: ["fetch:request", "waitUntil:request", "kv:background"],
		handler: (size) => async (context) => {
			await work(size);
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
		handler: (size) => async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await work(size);
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
		handler: (size) => async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await work(size);
					await env(context).RATE_LIMIT.put("k", "1");
				})(),
			);

			await work(size / 10);
			await mail();

			return new Response("ok");
		},
	},
	{
		name: "a real timer in the deferred path",
		expected: ["waitUntil:request", "kv:background"],
		handler: () => async (context) => {
			ctxOf(context).waitUntil(
				new Promise<void>((resolve) => setTimeout(resolve, 3)).then(
					async () => {
						await env(context).RATE_LIMIT.put("k", "1");
					},
				),
			);

			return new Response("ok");
		},
	},
	{
		name: "a real timer that the answer waits for",
		expected: ["kv:request"],
		handler: () => async (context) => {
			await new Promise((resolve) => setTimeout(resolve, 3));
			await env(context).RATE_LIMIT.put("k", "1");

			return new Response("ok");
		},
	},
];

describe("work that leaves the microtask queue does not change a label", () => {
	for (const scenario of scenarios)
		it(`${scenario.name}: ${RUNS} recordings, the work growing and shrinking, are identical`, async () => {
			const seen = new Set<string>();

			for (let run = 0; run < RUNS; run += 1) {
				const size = SIZES[run % SIZES.length] ?? 0;
				const got = await runCase(scenario.handler(size), one());

				seen.add(bytes(got));

				if (run === 0) expect(phases(got)).toEqual(scenario.expected);
			}

			expect(seen.size).toBe(1);
		}, 120_000);
});
