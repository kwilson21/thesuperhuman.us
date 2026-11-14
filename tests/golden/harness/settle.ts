// Drives a request to its end, and decides for each outside effect whether the response waited for it.
//
// Every fake waits at the log's gate before it starts (see `EffectLog.start`). This driver lets the event loop go quiet (a
// real macrotask turn, so every microtask a route chains has run, however many turns that takes), then looks at what is
// waiting. It decides nothing while work that leaves the microtask queue is still in flight (a real timer, a WebCrypto
// digest: `EffectLog.begin`, wrapped in determinism.ts), so how fast the machine finishes that work never changes a label.
//
//   * The work being driven (the handler, then the reading of its answer) has not finished: what waits at the gate is
//     work the response may be waiting for. It is released and labelled "request", and the loop goes round again.
//   * The work has finished: nothing waited for what is still at the gate. It stays there, and the caller labels it
//     "background" when it drives the rest (ctx.waitUntil work and anything left floating).
//
// Because the decision is made only when everything but the gate is quiet, a route that takes two more promise turns to
// resolve (an Effect.runPromise wrapper, say), or that starts deferred work after a few turns, or that waits on a thread,
// records the same phases. No real-time wait decides anything: the only real timeout is the failure detector below, which
// throws.
import type { Determinism } from "./determinism";
import type { EffectLog, Phase } from "./log";

// The real timers, kept before any case wraps or fakes the global ones.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetImmediate = globalThis.setImmediate;

/** How long, in real milliseconds, a handler may be stuck (nothing in flight, nothing held, no timer to fire) before the harness says so. */
const STUCK_MS = 2000;

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
	let events = 0;
	let wake: (() => void) | undefined;

	/** Something changed that the loop may need to look at again. */
	const changed = () => {
		events += 1;
		wake?.();
	};

	const done = () => {
		settled = true;

		if (driving.phase === "request") log.answered = true;

		changed();
	};

	work.then(done, done);
	log.onHeld = changed;
	log.onChange = changed;

	try {
		for (;;) {
			await turn();

			const seen = events;

			// A request pass waits for work in flight before it labels anything; the background pass labels everything the same.
			if (log.waiting > 0 && (!settled || driving.flush)) {
				if (driving.flush || log.inflight === 0) {
					log.release(driving.phase);

					continue;
				}
			} else if (settled) break;

			if (log.inflight === 0 && driving.timers && (await clock.fireNextTimer()))
				continue;

			// Whatever happened while a timer fired is looked at before waiting.
			if (events !== seen) continue;

			// Nothing to do until something changes: an effect arrives, work in flight ends, or the work settles.
			let stuck: ReturnType<typeof realSetTimeout> | undefined;

			const quiet = new Promise<boolean>((resolve) => {
				wake = () => resolve(true);

				if (log.inflight === 0 && log.waiting === 0)
					stuck = realSetTimeout(() => resolve(false), STUCK_MS);
			});

			const woken = await quiet;

			wake = undefined;
			realClearTimeout(stuck);

			if (!woken)
				throw new Error(
					"golden harness: the handler never settled: nothing is in flight, nothing waits and no timer is pending.",
				);
		}
	} finally {
		log.onHeld = undefined;
		log.onChange = undefined;
	}

	return work;
}
