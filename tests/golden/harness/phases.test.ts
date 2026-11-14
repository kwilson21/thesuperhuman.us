import type { APIContext } from "astro";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { compareFixture } from "../../../scripts/golden-neutral.mjs";
import {
	aiAfter,
	asFixture,
	asVisitor,
	byHost,
	json,
	runCase,
	type Case,
	type CaseRecord,
	type Handler,
} from "./index";
import { EffectLog } from "./log";

// The phase of an effect says whether the response waited for it. It is decided by what the answer needed, never by how
// many promise turns a route takes (settle.ts), so a conversion that adds turns records the same phases, and a change
// that moves work across the response does not.

const env = (context: APIContext) => context.locals.runtime.env;
const ctxOf = (context: APIContext) => context.locals.runtime.ctx;

const mail = () =>
	fetch("https://api.resend.com/emails", { method: "POST", body: "{}" });

const turns = async (count: number) => {
	for (let index = 0; index < count; index += 1) await Promise.resolve();
};

const budget = (context: APIContext, day: string) =>
	env(context)
		.MUSIC_DB?.prepare(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, 's', 1)",
		)
		.bind(day)
		.run();

const one = (extra: Partial<Case> = {}): Case => ({
	name: "case",
	fetches: byHost({ resend: json(200, { id: "em_1" }) }),
	steps: [{ path: "/api/x", method: "POST", as: asVisitor() }],
	...extra,
});

/** The phases of the effects that are outside calls or statements, in order: "kind:phase". */
const phases = (got: CaseRecord) =>
	got.effects
		.filter((effect) => effect.kind !== "waitUntil-settled")
		.map((effect) => `${effect.kind}:${effect.phase}`);

const record = (handler: Handler, c: Case = one()) => runCase(handler, c);

/** The bytes of a record, so two records are compared in every field. */
const bytes = (got: CaseRecord) => JSON.stringify(asFixture(got));

const verdict = (before: CaseRecord, after: CaseRecord) =>
	compareFixture([asFixture(before)], [asFixture(after)]);

/** How a handler's body is run: directly, or through an Effect runtime as `runRoute` does. */
const wrappers = {
	plain: (body: () => Promise<Response>) => body(),
	effect: (body: () => Promise<Response>) =>
		Effect.runPromise(Effect.promise(body)),
	"effect, twice": (body: () => Promise<Response>) =>
		Effect.runPromise(
			Effect.promise(() => Effect.runPromise(Effect.promise(body))),
		),
} as const;

const EXTRA = [0, 1, 2, 10];

describe("the phase says whether the response waited for the effect", () => {
	it("an effect the route awaits is request", async () => {
		const got = await record(async () => {
			await mail();

			return new Response("ok");
		});

		expect(phases(got)).toEqual(["fetch:request"]);
	});

	it("an effect handed to waitUntil and not awaited is background, and the call itself is request", async () => {
		const got = await record(async (context) => {
			ctxOf(context).waitUntil(mail().then(() => {}));

			return new Response("ok");
		});

		expect(phases(got)).toEqual(["waitUntil:request", "fetch:background"]);
	});

	it("an effect started inside the argument of waitUntil, before the route returns, is background", async () => {
		const got = await record(async (context) => {
			const pending = (async () => {
				await mail();
				await mail();
			})();

			ctxOf(context).waitUntil(pending);

			return new Response("ok");
		});

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"fetch:background",
			"fetch:background",
		]);
	});

	it("without a context the route awaits its own deferred work, so it is request", async () => {
		const got = await record(
			async () => {
				await mail();

				return new Response("ok");
			},
			one({ noContext: true }),
		);

		expect(phases(got)).toEqual(["fetch:request"]);
	});

	it("work that is neither awaited nor handed to waitUntil is background, and still runs and is recorded", async () => {
		const got = await record(async () => {
			void mail().catch(() => {});

			return new Response("ok");
		});

		expect(phases(got)).toEqual(["fetch:background"]);
	});

	it("a route that calls waitUntil and then awaits other work: both are request, because nothing separates them from outside", async () => {
		const got = await record(async (context) => {
			ctxOf(context).waitUntil(mail().then(() => {}));
			await budget(context, "d1");

			return new Response("ok");
		});

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"fetch:request",
			"d1:request",
		]);
	});

	it("effects inside Promise.all are all request, in the order they started", async () => {
		const got = await record(async (context) => {
			await Promise.all([
				mail(),
				budget(context, "a"),
				env(context).RATE_LIMIT.put("k", "1"),
				env(context).RATE_LIMIT.get("k"),
			]);

			return new Response("ok");
		});

		expect(
			got.effects.map((effect) => `${effect.kind}:${effect.phase}`).sort(),
		).toEqual(["d1:request", "fetch:request", "kv:request", "kv:request"]);

		const kv = got.effects.filter((effect) => effect.kind === "kv");

		expect(kv.map((effect) => (effect.kind === "kv" ? effect.op : ""))).toEqual(
			["put", "get"],
		);
	});

	it("a deferred effect that starts after more effects of the deferred work is background, and keeps their order", async () => {
		const got = await record(async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await env(context).RATE_LIMIT.put("a", "1");
					await mail();
					await env(context).RATE_LIMIT.put("b", "1");
				})(),
			);

			return new Response("ok");
		});

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"kv:background",
			"fetch:background",
			"kv:background",
		]);
	});

	it("a handler that rejects: the deferred mail and the awaited write are both request, because the answer was still waiting", async () => {
		const got = await record(async (context) => {
			ctxOf(context).waitUntil(mail().then(() => {}));
			await env(context).RATE_LIMIT.put("k", "1");

			throw new Error("boom");
		});

		expect(got.steps[0]?.answer).toEqual({ outcome: "rejected" });

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"kv:request",
			"fetch:request",
		]);
	});

	it("an answer that is read from a stream waits for what the stream does: that is request", async () => {
		const got = await record(async (context) => {
			ctxOf(context).waitUntil(
				(async () => {
					await mail();
				})(),
			);

			return new Response(
				new ReadableStream<Uint8Array>({
					async pull(controller) {
						await env(context).RATE_LIMIT.get("streamed");
						controller.enqueue(new TextEncoder().encode("body"));
						controller.close();
					},
				}),
				{ headers: { "content-type": "text/plain" } },
			);
		});

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"kv:request",
			"fetch:request",
		]);

		expect(got.steps[0]?.answer).toMatchObject({ body: "body" });
	});

	it("a deferred statement that an interleave or a failure hits is background, markers included", async () => {
		const got = await record(
			async (context) => {
				ctxOf(context).waitUntil(
					(async () => {
						await Promise.resolve(budget(context, "late")).catch(() => {});
					})(),
				);

				return new Response("ok");
			},
			one({
				failures: [
					{
						on: /INSERT INTO brief_suggestion_budget/,
						message: "late failure",
					},
				],
			}),
		);

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"trigger-hit:background",
			"d1:background",
		]);
	});

	it("virtual timers: a route that awaits a timeout while it waits records the effects it waited for as request", async () => {
		const got = await record(
			async (context) => {
				await Promise.race([
					env(context).AI?.run("@cf/meta/llama-3.2-1b-instruct", {
						prompt: "p",
					}),
					new Promise((resolve) => setTimeout(resolve, 1_000)),
				]);

				ctxOf(context).waitUntil(mail().then(() => {}));

				return new Response("ok");
			},
			one({ ai: [aiAfter(5_000, "late")] }),
		);

		expect(phases(got)).toEqual([
			"ai:request",
			"waitUntil:request",
			"advance:request",
			"fetch:background",
		]);
	});

	it("an effect that arrives while the route waits on a timer is request, because the response is still waiting", async () => {
		const got = await record(
			async (context) => {
				ctxOf(context).waitUntil(mail().then(() => {}));
				await new Promise((resolve) => setTimeout(resolve, 1_000));

				return new Response("ok");
			},
			one({ virtualTimers: true }),
		);

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"fetch:request",
			"advance:request",
		]);
	});

	it("the state at the response is the state before what was never waited for", async () => {
		const handler =
			(deferred: boolean): Handler =>
			async (context) => {
				if (deferred)
					ctxOf(context).waitUntil(
						Promise.resolve(budget(context, "d")).then(() => {}),
					);
				else await budget(context, "d");

				return new Response("ok");
			};

		const awaited = await record(handler(false));
		const deferred = await record(handler(true));
		const idle = await record(async () => new Response("ok"));

		expect(deferred.steps[0]?.digest.atResponse.music).toBe(
			idle.steps[0]?.digest.music,
		);

		expect(awaited.steps[0]?.digest.atResponse.music).toBe(
			awaited.steps[0]?.digest.music,
		);

		expect(deferred.steps[0]?.digest.music).toBe(
			awaited.steps[0]?.digest.music,
		);

		expect(awaited.steps[0]?.digest.atResponse.music).not.toBe(
			deferred.steps[0]?.digest.atResponse.music,
		);
	});
});

describe("a change that moves work across the response is caught", () => {
	const awaiting: Handler = async () => {
		await mail();

		return new Response("ok");
	};

	const deferring: Handler = async (context) => {
		ctxOf(context).waitUntil(mail().then(() => {}));

		return new Response("ok");
	};

	const writeAwaited: Handler = async (context) => {
		await budget(context, "w");

		return new Response("ok");
	};

	const writeDeferred: Handler = async (context) => {
		ctxOf(context).waitUntil(
			Promise.resolve(budget(context, "w")).then(() => {}),
		);

		return new Response("ok");
	};

	it("a route changed to defer what it awaited is NOT neutral", async () => {
		const before = await record(awaiting);
		const after = await record(deferring);
		const result = verdict(before, after);

		expect(phases(before)).toEqual(["fetch:request"]);
		expect(phases(after)).toEqual(["waitUntil:request", "fetch:background"]);
		expect(result.neutral).toBe(false);
		expect(result.nonNeutral).toHaveLength(1);
	});

	it("a route changed to await what it deferred is NOT neutral", async () => {
		const result = verdict(await record(deferring), await record(awaiting));

		expect(result.neutral).toBe(false);
		expect(result.nonNeutral).toHaveLength(1);
	});

	it("a write moved across the response is NOT neutral, though every statement and effect is the same", async () => {
		const before = await record(writeAwaited);
		const after = await record(writeDeferred);

		expect(before.steps[0]?.digest.music).toBe(after.steps[0]?.digest.music);
		expect(before.finalState).toEqual(after.finalState);

		expect(before.steps[0]?.digest.atResponse.music).not.toBe(
			after.steps[0]?.digest.atResponse.music,
		);

		expect(verdict(before, after).neutral).toBe(false);
		expect(verdict(after, before).neutral).toBe(false);
	});

	it("the same route recorded twice is identical, so the verdict above is the move and nothing else", async () => {
		const result = verdict(await record(deferring), await record(deferring));

		expect(result.neutral).toBe(true);
		expect(result.identical).toHaveLength(1);
	});
});

describe("extra promise turns change nothing", () => {
	type Scenario = {
		readonly name: string;
		/** The handler, with `extra` turns between the points the test varies and `wrap` around its body. */
		readonly handler: (
			extra: number,
			wrap: (typeof wrappers)[keyof typeof wrappers],
		) => Handler;
		readonly expected: string[];
	};

	const scenarios: Scenario[] = [
		{
			name: "turns between deciding the answer and resolving",
			expected: ["waitUntil:request", "fetch:background", "kv:background"],
			handler: (extra, wrap) => (context) =>
				wrap(async () => {
					ctxOf(context).waitUntil(
						(async () => {
							await mail();
							await env(context).RATE_LIMIT.put("k", "1");
						})(),
					);

					await turns(extra);

					return new Response("ok");
				}),
		},
		{
			name: "turns between waitUntil and the first effect of the deferred work",
			expected: ["waitUntil:request", "fetch:background", "kv:background"],
			handler: (extra, wrap) => (context) =>
				wrap(async () => {
					ctxOf(context).waitUntil(
						(async () => {
							await turns(extra);
							await mail();
							await turns(extra);
							await env(context).RATE_LIMIT.put("k", "1");
						})(),
					);

					return new Response("ok");
				}),
		},
		{
			name: "turns before the awaited effect, with deferred work after it",
			expected: ["kv:request", "waitUntil:request", "fetch:background"],
			handler: (extra, wrap) => (context) =>
				wrap(async () => {
					await turns(extra);
					await env(context).RATE_LIMIT.put("k", "1");
					await turns(extra);
					ctxOf(context).waitUntil(mail().then(() => {}));
					await turns(extra);

					return new Response("ok");
				}),
		},
		{
			name: "a statement deferred from inside the route, then the answer decided late",
			expected: ["waitUntil:request", "d1:background"],
			handler: (extra, wrap) => (context) =>
				wrap(async () => {
					await turns(extra);
					ctxOf(context).waitUntil(
						(async () => {
							await turns(extra);
							await budget(context, "turns");
						})(),
					);
					await turns(extra * 2);

					return new Response("ok");
				}),
		},
		{
			name: "a line the route writes after an effect was released stays after it",
			expected: ["kv:request", "fetch:request", "waitUntil:request"],
			handler: (extra, wrap) => (context) =>
				wrap(async () => {
					const started = mail();

					await env(context).RATE_LIMIT.put("k", "1");
					await turns(extra);
					ctxOf(context).waitUntil(started.then(() => {}));

					return new Response("ok");
				}),
		},
		{
			name: "an effect the route awaits stays request when the turns around it change",
			expected: ["fetch:request", "d1:request"],
			handler: (extra, wrap) => (context) =>
				wrap(async () => {
					await turns(extra);
					await mail();
					await turns(extra);
					await budget(context, "awaited");
					await turns(extra);

					return new Response("ok");
				}),
		},
	];

	for (const scenario of scenarios)
		describe(scenario.name, () => {
			it(`records ${scenario.expected.join(", ")}`, async () => {
				const got = await record(scenario.handler(0, wrappers.plain));

				expect(phases(got)).toEqual(scenario.expected);
			});

			for (const [wrapper, wrap] of Object.entries(wrappers))
				for (const extra of EXTRA)
					it(`is byte for byte the same with ${extra} extra turns, ${wrapper}`, async () => {
						const base = await record(scenario.handler(0, wrappers.plain));
						const got = await record(scenario.handler(extra, wrap));

						expect(bytes(got)).toBe(bytes(base));
						expect(verdict(base, got).neutral).toBe(true);
					});
		});

	it("the real move is still told apart at every number of turns", async () => {
		for (const extra of EXTRA) {
			const awaited = await record(async () => {
				await turns(extra);
				await mail();

				return new Response("ok");
			});

			const deferred = await record(async (context) => {
				await turns(extra);
				ctxOf(context).waitUntil(mail().then(() => {}));
				await turns(extra);

				return new Response("ok");
			});

			expect(verdict(awaited, deferred).neutral).toBe(false);
		}
	});
});

describe("the gate", () => {
	it("passes straight through when it is not driven, and when the work is off the record", async () => {
		const log = new EffectLog();

		expect((await log.start()).phase).toBe("request");

		log.gating = true;

		await log.unrecorded(async () => {
			expect((await log.start()).phase).toBe("request");
		});

		expect(log.waiting).toBe(0);
	});

	it("holds an effect until it is released, and says which phase it was released as", async () => {
		const log = new EffectLog();

		log.gating = true;

		const first = log.start();
		const second = log.start();

		expect(log.waiting).toBe(2);

		log.release("background");

		expect((await first).phase).toBe("background");
		expect((await second).phase).toBe("background");
		expect(log.waiting).toBe(0);
	});
});

describe("known limit: a route that calls waitUntil and then keeps awaiting", () => {
	// From outside, deferred work that is already in flight cannot be told from work the response waits for, so what
	// starts before the answer is read is request. It is stable under extra promise turns but not under a change that
	// splits the awaited work into more sequential steps: keep the deferred work to one step, or call waitUntil last
	// (every route in the corpus but one does; the exception defers a single statement).
	const deferredTwice = (context: APIContext) =>
		ctxOf(context).waitUntil(
			(async () => {
				await mail();
				await mail();
			})(),
		);

	it("one awaited step after waitUntil: the deferred work's later step is background", async () => {
		const got = await record(async (context) => {
			deferredTwice(context);
			await budget(context, "one");

			return new Response("ok");
		});

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"fetch:request",
			"d1:request",
			"fetch:background",
		]);
	});

	it("two awaited steps after waitUntil: the deferred work's later step is request too", async () => {
		const got = await record(async (context) => {
			deferredTwice(context);
			await budget(context, "one");
			await budget(context, "two");

			return new Response("ok");
		});

		expect(phases(got)).toEqual([
			"waitUntil:request",
			"fetch:request",
			"d1:request",
			"fetch:request",
			"d1:request",
		]);
	});

	it("work started and not awaited, while the route awaits other work, is request", async () => {
		const got = await record(async (context) => {
			void mail().catch(() => {});
			await budget(context, "one");

			return new Response("ok");
		});

		expect(phases(got)).toEqual(["fetch:request", "d1:request"]);
	});
});

describe("macrotask yields change nothing", () => {
	// A route that yields to the event loop with a macrotask (setImmediate, which the Effect scheduler uses) has tracked
	// work in flight, so the answer waits for it. Each case records the route with and without the yield and must give
	// one record.
	const yieldMacrotask = () =>
		new Promise<void>((resolve) => setImmediate(resolve));

	const flow = (steps: number) =>
		Effect.runPromise(
			Effect.forEach(
				Array.from({ length: steps }, (_, index) => index),
				() => Effect.void,
				{ discard: true },
			),
		);

	const scenarios: {
		readonly name: string;
		readonly expected: string[];
		readonly handler: (yielded: boolean) => Handler;
	}[] = [
		{
			name: "a setImmediate yield between waitUntil and the return",
			expected: ["fetch:request", "waitUntil:request", "kv:background"],
			handler: (yielded) => async (context) => {
				await mail();
				ctxOf(context).waitUntil(
					(async () => {
						await env(context).RATE_LIMIT.put("k", "1");
					})(),
				);

				if (yielded) await yieldMacrotask();

				return new Response("ok");
			},
		},
		{
			name: "an Effect.yieldNow between waitUntil and the return",
			expected: ["fetch:request", "waitUntil:request", "kv:background"],
			handler: (yielded) => async (context) => {
				await mail();
				ctxOf(context).waitUntil(
					(async () => {
						await env(context).RATE_LIMIT.put("k", "1");
					})(),
				);

				if (yielded) await Effect.runPromise(Effect.yieldNow);

				return new Response("ok");
			},
		},
		{
			name: "a 3,000-step Effect flow before the return, after waitUntil",
			expected: ["fetch:request", "waitUntil:request", "kv:background"],
			handler: (yielded) => async (context) => {
				await mail();
				ctxOf(context).waitUntil(
					(async () => {
						await env(context).RATE_LIMIT.put("k", "1");
					})(),
				);

				if (yielded) await flow(3_000);

				return new Response("ok");
			},
		},
		{
			name: "a 3,000-step Effect flow inside the deferred work",
			expected: ["waitUntil:request", "fetch:background", "kv:background"],
			handler: (yielded) => async (context) => {
				ctxOf(context).waitUntil(
					(async () => {
						if (yielded) await flow(3_000);

						await mail();
						await env(context).RATE_LIMIT.put("k", "1");
					})(),
				);

				return new Response("ok");
			},
		},
	];

	for (const scenario of scenarios)
		it(`${scenario.name}: the same phases with and without the yield`, async () => {
			const plain = await record(scenario.handler(false));
			const yielded = await record(scenario.handler(true));

			expect(phases(yielded)).toEqual(scenario.expected);
			expect(bytes(yielded)).toBe(bytes(plain));
		});
});

describe("known limit: an answer read from a Blob or a compressed stream", () => {
	// Node runs macrotasks inside the read of a Blob body or a compressed stream. The harness cannot see them: they do
	// not go through the global setImmediate or timers. Tracking the read as work in flight would hold the gate shut
	// against a stream that reads an effect (see the stream test above), so this is a limit, not a fix. Answers whose body
	// is a Blob or a stream are the case here: src/lib/audio-project-files.ts returns an R2 object body, which is a stream.
	// A deferred effect of such an answer is labelled request, unlike a string answer.
	const answer =
		(kind: "text" | "blob" | "gzip") => async (context: APIContext) => {
			ctxOf(context).waitUntil(
				(async () => {
					await mail();
					await env(context).RATE_LIMIT.put("k", "1");
				})(),
			);

			if (kind === "blob") return new Response(new Blob(["ok"]));

			if (kind === "gzip")
				return new Response(
					new Blob(["ok"]).stream().pipeThrough(new CompressionStream("gzip")),
				);

			return new Response("ok");
		};

	it("a string answer records the background phases", async () => {
		expect(phases(await record(answer("text")))).toEqual([
			"waitUntil:request",
			"fetch:background",
			"kv:background",
		]);
	});

	it("a Blob answer records its deferred fetch as request (the limit)", async () => {
		expect(phases(await record(answer("blob")))).toEqual([
			"waitUntil:request",
			"fetch:request",
			"kv:background",
		]);
	});

	it("a compressed stream answer records its deferred fetch as request (the limit)", async () => {
		expect(phases(await record(answer("gzip")))).toEqual([
			"waitUntil:request",
			"fetch:request",
			"kv:background",
		]);
	});
});
