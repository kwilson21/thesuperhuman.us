import { EffectFailure } from "@xstate/effect";
import * as Cause from "effect/Cause";
import * as Result from "effect/Result";

/** A typed failure: an error value an Effect program fails with on purpose, named by `_tag`. */
export type TaggedFailure = { readonly _tag: string };

function isTaggedFailure(value: unknown): value is TaggedFailure {
	return (
		typeof value === "object" &&
		value !== null &&
		"_tag" in value &&
		typeof value._tag === "string"
	);
}

/**
 * Reads the error event the XState and Effect bridge hands to a state's `onError` and gives the typed, tagged failure
 * the work failed with. The bridge wraps the whole Cause in an `EffectFailure`, and routes a defect (`Effect.die`, a
 * thrown error) and an interruption to `onError` too. Those are bugs or cancellations, never an outcome to save, so
 * this throws them: the program rejects and the request fails with a 500, instead of a bug being saved as a refused
 * state. Use it as the first thing in every `onError`:
 *
 *     onError: ({ event }) => Predicate.isTagged(failureOf(event), "StripeRefused") ? { target: "void_failed" } : undefined
 */
export function failureOf(event: { readonly error: unknown }): TaggedFailure {
	const { error } = event;

	if (!EffectFailure.is(error)) throw error;

	const { cause } = error;

	// A defect or an interruption anywhere in the Cause wins over a typed failure beside it.
	const defect = Cause.findDefect(cause);

	if (Result.isSuccess(defect)) throw defect.success;

	if (Cause.hasInterrupts(cause)) throw Cause.squash(cause);

	const found = Cause.findError(cause);

	if (Result.isFailure(found) || !isTaggedFailure(found.success))
		throw Cause.squash(cause);

	return found.success;
}
