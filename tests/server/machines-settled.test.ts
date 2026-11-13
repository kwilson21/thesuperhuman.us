import { createEffectActor, setupEffect } from "@xstate/effect";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";
import { settled } from "../../src/server/machines/settled";

// A machine that is already done when it starts: the actor completes, it does not error.
const finished = setupEffect({ actors: {} }).createMachine({
	id: "finished",
	initial: "done",
	states: { done: { type: "final" } },
});

describe("settled", () => {
	it("keeps a plain stop that is not an error as the typed ActorStoppedError", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				const actor = yield* createEffectActor(finished, {});

				return yield* settled(actor, () => false, { timeout: "1 second" });
			}).pipe(Effect.scoped),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const failure = Cause.findError(exit.cause);

			expect(failure._tag).toBe("Success");
			expect(failure._tag === "Success" && failure.success).toMatchObject({
				_tag: "ActorStoppedError",
			});
		}
	});
});
