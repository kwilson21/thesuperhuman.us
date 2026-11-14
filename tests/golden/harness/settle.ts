// Drives a request to its end, and decides for each outside effect whether the response waited for it.
//
// Every fake waits at the log's gate before it starts (see `EffectLog.start`). This driver lets the event loop go quiet (a
// real macrotask turn, so every microtask a route chains has run, however many turns that takes), then looks at what is
// waiting:
//
//   * The work being driven (the handler, then the reading of its answer) has not finished: what waits at the gate is
//     work the response may be waiting for. It is released and labelled "request", and the loop goes round again.
//   * The work has finished: nothing waited for what is still at the gate. It stays there, and the caller labels it
//     "background" when it drives the rest (ctx.waitUntil work and anything left floating).
//
// Because the decision is made only when the loop is quiet, a route that takes two more promise turns to resolve (an
// Effect.runPromise wrapper, say), or that starts deferred work after a few turns, records the same phases.
import type { Determinism } from "./determinism";
import type { EffectLog, Phase } from "./log";

// The real timers, kept before any case fakes the global ones, for the short real waits below.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetImmediate = globalThis.setImmediate;

/** How long, in real milliseconds, nothing may happen before a virtual timer is fired. */
const IDLE_MS = 5;

/** How many idle waits with no timer to fire, on virtual timers, before the handler is called stuck (about a second). */
const IDLE_LIMIT = 200;

export type Driving = {
	/** The phase given to the effects released while the work runs. */
	readonly phase: Phase;
	/** Keep releasing until nothing waits at the gate once the work is done too (the background pass), instead of leaving what waits for the caller. */
	readonly flush: boolean;
	/** Fire virtual timers when nothing else is happening, so a route's timeout comes without the test waiting for it. */
	readonly timers: boolean;
};

const turn = () => new Promise<void>((resolve) => realSetImmediate(resolve));

/**
 * Waits for `work` to settle, releasing what waits at the gate as `driving` says. Resolves or rejects as `work` does.
 * The log must be gating (`log.gating = true`).
 */
export async function drive<T>(
	log: EffectLog,
	clock: Determinism,
	work: Promise<T>,
	driving: Driving,
): Promise<T> {
	let settled = false;
	let wake: (() => void) | undefined;

	const done = () => {
		settled = true;
		wake?.();
	};

	work.then(done, done);
	log.onHeld = () => wake?.();

	try {
		for (let idle = 0; ; ) {
			await turn();

			if (log.waiting > 0 && (!settled || driving.flush)) {
				log.release(driving.phase);
				idle = 0;

				continue;
			}

			if (settled) break;

			const woken = await new Promise<boolean>((resolve) => {
				const timer = realSetTimeout(() => resolve(false), IDLE_MS);

				wake = () => {
					realClearTimeout(timer);
					resolve(true);
				};
			});

			wake = undefined;

			if (woken) {
				idle = 0;

				continue;
			}

			if (driving.timers && (await clock.fireNextTimer())) {
				idle = 0;

				continue;
			}

			idle += 1;

			if (clock.virtualTimers && driving.timers && idle > IDLE_LIMIT)
				throw new Error(
					"golden harness: the handler never settled and no timer is pending.",
				);
		}
	} finally {
		log.onHeld = undefined;
	}

	return work;
}
