import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Refusal } from "../../src/server/terms";

// A rule's answer in a story's words: what to save, nothing to do, or a named refusal with its sentence.

export const write = <W>(save: W) => ({ kind: "write" as const, save });
export const nothingToDo = () => ({ kind: "nothingToDo" as const });

export const refuse = (type: string, say: string) => ({
	kind: "refuse" as const,
	type,
	say,
});

/** Runs what a rule's `decide` answered, which needs nothing handed in, and puts it in those words. */
export const answerOf = <W, E extends Refusal>(
	decided: Effect.Effect<Option.Option<W>, E>,
) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => refuse(refusal._tag, refusal.say),
			onSuccess: (save) =>
				Option.isSome(save) ? write(save.value) : nothingToDo(),
		}),
	);

// For a rule that reads services (a KV namespace, Resend, Turnstile) rather than being handed its facts: it finishes, with
// what it answers, or fails with a named refusal. The services are provided by the test, so it runs asynchronously.

export const done = <V>(value: V) => ({ kind: "done" as const, value });

/** Runs a rule whose services the test has provided and puts what it answered in a story's words. */
export const answerOfRun = <V, E extends Refusal>(rule: Effect.Effect<V, E>) =>
	Effect.runPromise(
		Effect.match(rule, {
			onFailure: (refusal) => refuse(refusal._tag, refusal.say),
			onSuccess: (value) => done(value),
		}),
	);
