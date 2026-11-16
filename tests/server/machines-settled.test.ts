import {
	createEffectActor,
	createEffectLogic,
	setupEffect,
} from "@xstate/effect";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import { settled } from "../../src/server/machines/settled";

// A machine that is already done when it starts: the actor completes, it does not error.
const finished = setupEffect({ actors: {} }).createMachine({
	id: "finished",
	initial: "done",
	states: { done: { type: "final" } },
});

class Refused extends Data.TaggedError("Refused") {}

// A machine whose work fails with a typed failure that its onError does not land on a state: the actor errors with it.
const unhandled = setupEffect({
	actors: { work: createEffectLogic(() => Effect.fail(new Refused())) },
}).createMachine({
	id: "unhandled",
	initial: "working",
	states: {
		working: {
			invoke: { src: "work", onError: () => undefined },
		},
		done: {},
	},
});

describe("settled", () => {
	it("dies with a typed failure the machine did not land on a state: a bug in the machine, not a failure to answer", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				const actor = yield* createEffectActor(unhandled, {});

				return yield* settled(actor, (snapshot) => snapshot.matches("done"), {
					timeout: "1 second",
				});
			}).pipe(Effect.scoped),
		);

		expect(Exit.isFailure(exit)).toBe(true);

		if (Exit.isFailure(exit)) {
			expect(Result.isFailure(Cause.findError(exit.cause))).toBe(true);

			const defect = Cause.findDefect(exit.cause);

			expect(
				Result.isSuccess(defect) &&
					Predicate.isTagged(defect.success, "Refused"),
			).toBe(true);
		}
	});

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

			expect(Result.isSuccess(failure)).toBe(true);
			expect(
				Result.isSuccess(failure) &&
					Predicate.isTagged(failure.success, "ActorStoppedError"),
			).toBe(true);
		}
	});
});
