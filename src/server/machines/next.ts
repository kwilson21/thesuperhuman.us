import * as Predicate from "effect/Predicate";
import { type AnyStateMachine, initialTransition, transition } from "xstate";

/** The row's own context for the guards: plain values, one per key. */
export type MachineContext = {
	readonly [key: string]: string | number | boolean | null;
};

// Asks a small state machine what it does next. Pure: no actors, no timers, no effects. The writes are SQL
// compare-and-set guards; these machines describe the rules so people can read them, and tests keep the two in step.
// Copied from kwilson21/tally `src/machines/next.ts`, with `sourcesOf` added.
//
// A state saved to a row is only ever a settled, top-level state. Restoring the XState and Effect bridge into a state
// that invokes work (`createEffectActor` with that state in its snapshot) does not start the work: the invoke starts on
// entering the state, and a restore is not an entry (tests/server/effect-bridge-proof.test.ts proves it). So a state
// that invokes outside work is never one to save: the machine must move on from it, to its success or its refusal state,
// before the row is written.
//
// Guards and context. Without a `context`, a guard reads the machine's default context, as it would at start (this is
// deliberate and tested). A guard that depends on data a row holds therefore answers from the DEFAULT, which can read as
// "not allowed" (null) for a row that is allowed. XState offers no way to tell that a guard needed the row, so this is
// not detected: a machine whose guards read the row passes the row's context to `next` and `sourcesOf` every time.
//
// A defect in a step (a thrown error, `Effect.die`) or an interruption does not land in a refusal state: `failureOf`
// rethrows it inside `onError`, which errors the actor. `waitFor` alone would report that as a typed
// `ActorStoppedError`; `settled` (settled.ts) fails the program with the original error instead.

/**
 * The state the machine moves to on this event, or null when it may not.
 *
 * Null covers an unknown event, an event that this state does not handle, a guard that
 * says no, and any event sent from a final state. XState ignores an unhandled event
 * silently, so this helper asks `can()` first and never relies on that.
 *
 * Throws when `state` is not one of the machine's states. A bad state string from the
 * database is a bug to surface, not a "not allowed" answer. It also throws when the event
 * lands on a compound state (one with child states), whose value is not a string: a row
 * stores one string, so such a machine is a design error to surface, not "[object Object]".
 *
 * `context`, when given, is the row's own context: the guards read it instead of the
 * machine's default. It REPLACES the default entirely, it is not merged into it: a key the
 * row's context lacks reads as undefined in a guard, even when the default has it. Without
 * it the guards read the default, as they would at start.
 */
export function next(
	machine: AnyStateMachine,
	state: string,
	event: string,
	context?: MachineContext,
): string | null {
	const current = restoreState(machine, state, context);

	if (!current.can({ type: event })) return null;
	const [after] = transition(machine, current, { type: event });

	if (!Predicate.isString(after.value)) {
		throw new Error(
			`Event "${event}" from "${state}" lands on a compound state in machine "${machine.id}": ${JSON.stringify(after.value)}`,
		);
	}

	return after.value;
}

const INTEGER_NAME = /^(0|[1-9]\d*)$/;

/**
 * The states the event is allowed from, in the order the machine declares them. This is what a save's SQL guard reads:
 * the result is used to build a `status IN (...)` list, so the guard comes from the machine and is not written a second
 * time. A state whose guard says no is left out, a final state never appears, and a state named `*` is never listed.
 * `context` is read as it is for `next`.
 *
 * Throws for a machine with a compound state (child states, or parallel), as `next` throws when an event lands on one: a
 * parent would otherwise be listed as a source that no saved row can hold.
 *
 * The order is read from the machine's `states` object, and JavaScript lists integer-like keys first, whatever the
 * order they were written in. A state named like an integer ("10") would therefore move, so such a name is rejected with
 * an error instead.
 */
export function sourcesOf(
	machine: AnyStateMachine,
	event: string,
	context?: MachineContext,
): string[] {
	const names = Object.keys(machine.config.states ?? {});
	const compound = names.find((name) => isCompound(machine, name));

	if (compound !== undefined) {
		throw new Error(
			`State "${compound}" of machine "${machine.id}" is a compound state (it has child states or is parallel): a row stores one top-level state string, so it cannot be listed as a source`,
		);
	}

	const integer = names.find((name) => INTEGER_NAME.test(name));

	if (integer !== undefined) {
		throw new Error(
			`State name "${integer}" looks like an integer, which JavaScript orders first, so the declared order of machine "${machine.id}" is lost`,
		);
	}

	return names
		.filter((state) => state !== "*")
		.filter((state) => next(machine, state, event, context) !== null);
}

// True when a top-level state has child states, or is parallel.
function isCompound(machine: AnyStateMachine, state: string): boolean {
	const config = machine.config.states?.[state];

	return (
		config !== undefined &&
		(config.type === "parallel" || Object.keys(config.states ?? {}).length > 0)
	);
}

// Turns a state string into a snapshot the machine can reason about. Without a context of
// its own, the default comes from the machine itself, so guards read the same values they
// would at start.
function restoreState(
	machine: AnyStateMachine,
	state: string,
	context?: MachineContext,
) {
	if (!isKnownState(machine, state)) {
		throw new Error(`Unknown state "${state}" for machine "${machine.id}"`);
	}

	if (context) return machine.resolveState({ value: state, context });
	const [initial] = initialTransition(machine);

	return machine.resolveState({ value: state, context: initial.context });
}

// True when the string names one of the machine's top-level states.
function isKnownState(machine: AnyStateMachine, state: string): boolean {
	return Object.hasOwn(machine.config.states ?? {}, state);
}
