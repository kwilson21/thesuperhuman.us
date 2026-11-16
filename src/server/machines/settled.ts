import {
	type ActorStoppedError,
	EffectFailure,
	type WaitForOptions,
	waitFor,
} from "@xstate/effect";
import * as Effect from "effect/Effect";
import type { AnyActorRef, SnapshotFrom } from "xstate";

/**
 * `waitFor` from `@xstate/effect`, except that an actor which ERRORED fails the program with what it errored with.
 *
 * `waitFor` answers every actor error, and every plain stop, with the same typed `ActorStoppedError`. An errored actor
 * is how a defect in a step (`Effect.die`, a thrown error) or an interruption arrives once `failureOf` has rethrown it
 * inside `onError`: the original error survives only on the actor's snapshot. Left as it is, every route would have to
 * map `ActorStoppedError` to a response, which would turn a bug into a handled 409 or 502. This helper reads the
 * snapshot instead: when its status is "error", the program dies with the original error (an error the bridge wrapped in
 * an `EffectFailure` fails with the original Cause, its defects and interruptions as they were), so the request rejects
 * with the bug itself. A typed failure in that Cause is one the machine's `onError` did not land on a state: that is a bug
 * in the machine too, so it is a defect, and the program's error type stays exactly the two below rather than `unknown`.
 * A stop that is not an error stays the typed `ActorStoppedError`; a timeout stays the typed `TimeoutError`.
 */
export const settled = <TActor extends AnyActorRef>(
	actor: TActor,
	predicate: (snapshot: SnapshotFrom<TActor>) => boolean,
	options: WaitForOptions,
) =>
	waitFor(actor, predicate, options).pipe(
		Effect.catchTag("ActorStoppedError", (stopped: ActorStoppedError) => {
			const { snapshot } = stopped;

			if (snapshot.status !== "error") return Effect.fail(stopped);

			return EffectFailure.is(snapshot.error)
				? Effect.failCause(snapshot.error.cause).pipe(Effect.orDie)
				: Effect.die(snapshot.error);
		}),
	);
