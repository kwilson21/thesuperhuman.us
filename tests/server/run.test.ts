import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { runRoute } from "../../src/server/run";
import { RateLimit } from "../../src/server/services";
import { fakeKv } from "../helpers/doubles";
import { fakeLocals } from "../helpers/runtime";

class Refused extends Data.TaggedError("Refused") {
	readonly say = "Not allowed.";
}

const locals = () =>
	fakeLocals({ RATE_LIMIT: fakeKv({ get: async () => "5" }) });

describe("runRoute", () => {
	it("provides the live services and runs the program to a Response", async () => {
		const response = await runRoute(
			locals(),
			Effect.gen(function* () {
				const limit = yield* RateLimit;

				const seen = yield* Effect.promise(() => limit.get("k"));

				return Response.json({ seen });
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ seen: "5" });
	});

	it("answers with the Response a route maps a refusal to", async () => {
		const response = await runRoute(
			locals(),
			Effect.fail(new Refused()).pipe(
				Effect.catchTags({
					Refused: (refusal) =>
						Effect.succeed(
							Response.json({ error: refusal.say }, { status: 403 }),
						),
				}),
			),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Not allowed." });
	});

	it("rejects when the program has a defect", async () => {
		await expect(
			runRoute(locals(), Effect.die(new Error("broken"))),
		).rejects.toThrow("broken");
	});

	it("reads the bindings from the request's own env, and nothing else", async () => {
		const first = fakeLocals({ RATE_LIMIT: fakeKv({ get: async () => "a" }) });
		const second = fakeLocals({ RATE_LIMIT: fakeKv({ get: async () => "b" }) });

		const read = (target: App.Locals) =>
			runRoute(
				target,
				RateLimit.use((limit) =>
					Effect.promise(async () => new Response(await limit.get("k"))),
				),
			).then((response) => response.text());

		expect([await read(first), await read(second)]).toEqual(["a", "b"]);
	});

	it("does not accept a program with an unmapped refusal", () => {
		const unmapped = Effect.fail(new Refused()).pipe(
			Effect.as(new Response(null)),
		);

		// @ts-expect-error the program's error type must be never
		const attempt = () => runRoute(locals(), unmapped);

		expect(attempt).toBeTypeOf("function");
	});
});
