import { type AnyStateMachine, initialTransition, transition } from "xstate";

/** The row's own context for the guards: plain values, one per key. */
export type MachineContext = {
	readonly [key: string]: string | number | boolean | null;
};

// Asks a small state machine what it does next. Pure: no actors, no timers, no effects. The writes are SQL
// compare-and-set guards; these machines describe the rules so people can read them, and tests keep the two in step.
// Copied from kwilson21/tally `src/machines/next.ts`, with `sourcesOf` added.

/**
 * The state the machine moves to on this event, or null when it may not.
 *
 * Null covers an unknown event, an event that this state does not handle, a guard that
 * says no, and any event sent from a final state. XState ignores an unhandled event
 * silently, so this helper asks `can()` first and never relies on that.
 *
 * Throws when `state` is not one of the machine's states. A bad state string from the
 * database is a bug to surface, not a "not allowed" answer.
 *
 * `context`, when given, is the row's own context: the guards read it instead of the
 * machine's default. Without it the guards read the default, as they would at start.
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

	return String(after.value);
}

/**
 * The states the event is allowed from, in the order the machine declares them. This is what a save's SQL guard reads
 * (`status IN (...)`), so the guard comes from the machine and is not written a second time. A state whose guard says
 * no is left out, and a final state never appears. `context` is read as it is for `next`.
 */
export function sourcesOf(
	machine: AnyStateMachine,
	event: string,
	context?: MachineContext,
): string[] {
	return Object.keys(machine.config.states ?? {}).filter(
		(state) => next(machine, state, event, context) !== null,
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
