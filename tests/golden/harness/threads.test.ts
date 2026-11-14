import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import {
	asFixture,
	asVisitor,
	byHost,
	CASE_TIMEOUT_MS,
	json,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
} from "./index";

/**
 * The timeout of a test that makes `recordings` recordings: the corpus's per-case budget (CASE_TIMEOUT_MS, 20 s) for each
 * one. A loaded CI runner takes several times longer than an idle one, so a test that counts on a shorter limit fails at random.
 */
const recordingTimeout = (recordings: number) => CASE_TIMEOUT_MS * recordings;

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
		it(
			`${scenario.name}: ${RUNS} recordings across every point of the work are identical`,
			async () => {
				const seen = new Set<string>();

				for (let run = 0; run < RUNS; run += 1) {
					const point = WORK[run % WORK.length] ?? WORK[0];

					if (!point) throw new Error("WORK is empty");

					const got = await runCase(scenario.handler(point), one());

					seen.add(bytes(got));

					if (run === 0) expect(phases(got)).toEqual(scenario.expected);
				}

				expect(seen.size).toBe(1);
			},
			recordingTimeout(RUNS),
		);

	// The pairings that made the record depend on machine speed before the delivery order was fixed: a deferred digest
	// of several megabytes against an awaited one of a kilobyte, and the reverse, with and without load.
	const pairs: [deferred: number, awaited: number][] = [
		[8_500_000, 1_000],
		[9_500_000, 1_000],
		[9_000_000, 6_000_000],
	];

	for (const [deferred, awaited] of pairs)
		it(
			`deferred ${deferred} bytes, awaited ${awaited} bytes, then a timer turn: ${RUNS} recordings are identical`,
			async () => {
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
			},
			recordingTimeout(RUNS),
		);
});

describe("the background pass waits for every undelivered slot before it releases an effect", () => {
	// Two deferred chains: the first digests and then writes "a", the second reads and then writes "b". The digest takes a
	// slot in the delivery order, so "b" must wait for it (its gate stays shut until the slot is delivered), whatever the
	// machine's speed. Each size is recorded RUNS times and every recording must give one record.
	const pair =
		(size: number): Handler =>
		async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await crypto.subtle.digest("SHA-256", new Uint8Array(size));
					await env(context).RATE_LIMIT.put("a", "1");
				})(),
			);

			ctxOf(context).waitUntil(
				(async () => {
					await env(context).RATE_LIMIT.get("g");
					await env(context).RATE_LIMIT.put("b", "1");
				})(),
			);

			return new Response("ok");
		};

	const triple =
		(size: number): Handler =>
		async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await crypto.subtle.digest("SHA-256", new Uint8Array(size));
					await env(context).RATE_LIMIT.put("a", "1");
				})(),
			);

			ctxOf(context).waitUntil(
				(async () => {
					await env(context).RATE_LIMIT.get("g");
					await env(context).RATE_LIMIT.put("b", "1");
				})(),
			);

			ctxOf(context).waitUntil(
				(async () => {
					await env(context).RATE_LIMIT.get("h");
					await env(context).RATE_LIMIT.put("c", "1");
				})(),
			);

			return new Response("ok");
		};

	const sizes = [300_000, 3_000_000, 6_000_000];

	for (const size of sizes) {
		it(
			`two deferred chains, digest of ${size} bytes: ${RUNS} recordings are identical`,
			async () => {
				const seen = new Set<string>();

				for (let run = 0; run < RUNS; run += 1)
					seen.add(bytes(await runCase(pair(size), one())));

				expect(seen.size).toBe(1);
			},
			recordingTimeout(RUNS),
		);

		it(
			`three deferred chains, digest of ${size} bytes: ${RUNS} recordings are identical`,
			async () => {
				const seen = new Set<string>();

				for (let run = 0; run < RUNS; run += 1)
					seen.add(bytes(await runCase(triple(size), one())));

				expect(seen.size).toBe(1);
			},
			recordingTimeout(RUNS),
		);
	}
});

describe("the yield threshold: a waitUntil write followed by setImmediate yields", () => {
	// A route that keeps yielding to the event loop after waitUntil is a known limit (tests/golden/README.md). The
	// threshold is structural and deterministic: a gated effect that waits while the route yields is released as request
	// at the POLL_LIMIT-th yield (100) in a row, so 99 yields leave it background and 100 make it request. Both sides are
	// pinned here, so a change to the limit cannot pass unnoticed.
	const yieldsAfterWaitUntil =
		(count: number): Handler =>
		async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await env(context).RATE_LIMIT.put("k", "1");
				})(),
			);

			for (let index = 0; index < count; index += 1) await yieldMacrotask();

			return new Response("ok");
		};

	it("99 yields after waitUntil: the deferred write is background", async () => {
		const got = await runCase(yieldsAfterWaitUntil(99), one());

		expect(phases(got)).toEqual(["waitUntil:request", "kv:background"]);
	});

	it("100 yields after waitUntil: the deferred write is request", async () => {
		const got = await runCase(yieldsAfterWaitUntil(100), one());

		expect(phases(got)).toEqual(["waitUntil:request", "kv:request"]);
	});
});

describe("no deadlock: the oldest tracked result is awaited together with a gated effect", () => {
	// The route waits for a digest (the oldest slot) and a KV read (a gated effect) in one Promise.all. The driver must
	// deliver the digest while the read waits at the gate, and the read is then request, the answer waited for it.
	it("completes, and the gated read is request", async () => {
		const got = await runCase(async (context) => {
			await Promise.all([
				crypto.subtle.digest("SHA-256", new Uint8Array(1_000_000)),
				env(context).RATE_LIMIT.get("g"),
			]);

			return new Response("ok");
		}, one());

		expect(got.steps[0]?.answer).toMatchObject({
			outcome: "response",
			status: 200,
		});
		expect(phases(got)).toEqual(["kv:request"]);
	});

	it("completes when the gated read comes before the digest in the same chain", async () => {
		const got = await runCase(async (context) => {
			const read = env(context).RATE_LIMIT.get("g");
			await crypto.subtle.digest("SHA-256", new Uint8Array(3_000_000));
			await read;

			return new Response("ok");
		}, one());

		expect(got.steps[0]?.answer).toMatchObject({
			outcome: "response",
			status: 200,
		});
		expect(phases(got)).toEqual(["kv:request"]);
	});
});

describe("floating work that is still running when a step ends is delivered, in the last step too", () => {
	// A floating step starts `void (async () => { await digest(); await put(f) })()` and returns. The background pass must
	// not end while the digest is undelivered, so the put is recorded in the step that started it, in every run, and it is
	// in the final KV state.
	const floating = (context: APIContext, size: number, key: string) => {
		void (async () => {
			await crypto.subtle.digest("SHA-256", new Uint8Array(size));
			await env(context).RATE_LIMIT.put(key, "1");
		})();

		return new Response("ok");
	};

	const steps = (paths: string[]): Case["steps"] =>
		paths.map((path) => ({ path, method: "POST", as: asVisitor() }));

	const putsIn = (got: CaseRecord, step: number) =>
		got.effects.filter(
			(effect) =>
				effect.kind === "kv" && effect.op === "put" && effect.step === step,
		).length;

	for (const size of [300_000, 3_000_000]) {
		it(
			`the last step's floating put is recorded in every one of 30 runs at ${size} bytes`,
			async () => {
				for (let run = 0; run < 30; run += 1) {
					const got = await runCase(
						(context) =>
							context.url.pathname === "/last"
								? floating(context, size, "f")
								: new Response("ok"),
						{
							...one(),
							steps: steps(["/first", "/last"]),
							final: { kv: ["RATE_LIMIT"] },
						},
					);

					expect(putsIn(got, 1)).toBe(1);
					expect(JSON.stringify(got.final)).toContain('"f"');
				}
			},
			recordingTimeout(30),
		);

		it(
			`a middle step's floating put is recorded in its own step in every one of 30 runs at ${size} bytes`,
			async () => {
				for (let run = 0; run < 30; run += 1) {
					const got = await runCase(
						(context) =>
							context.url.pathname === "/middle"
								? floating(context, size, "m")
								: new Response("ok"),
						{
							...one(),
							steps: steps(["/first", "/middle", "/last"]),
							final: { kv: ["RATE_LIMIT"] },
						},
					);

					expect(putsIn(got, 1)).toBe(1);
					expect(JSON.stringify(got.final)).toContain('"m"');
				}
			},
			recordingTimeout(30),
		);
	}
});
