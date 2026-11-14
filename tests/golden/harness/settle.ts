// Drives a request to its end, and decides for each outside effect whether the response waited for it.
//
// Every fake waits at the log's gate before it starts (see `EffectLog.start`). Threaded WebCrypto operations and
// setImmediate callbacks take a place in a delivery order when they start, and their results reach the route one at a
// time, oldest first, at a driver turn (sequencer.ts). This driver lets the event loop go quiet (a real macrotask turn,
// so every microtask a route chains has run), delivers the next finished operation, and then looks at what waits.
//
//   * The work being driven (the handler, then the reading of its answer) has not finished: what waits at the gate is
//     work the response may be waiting for. It is released and labelled "request", and the loop goes round again.
//   * The work has finished: nothing waited for what is still at the gate. It stays there, and the caller labels it
//     "background" when it drives the rest (ctx.waitUntil work and anything left floating).
//
// Nothing here depends on real time. The order in which the route sees its results is the order it started them, so a
// route's timers and effects come in the same order on every machine. Two cases are not a label but an error, and they
// are the only places a real timer is read: a handler that nothing can move (STUCK_MS), and tracked work that never
// finishes (IN_FLIGHT_MS). A handler that yields to the event loop without end (a setImmediate loop with nothing waiting
// at the gate) is counted, not timed: YIELD_LIMIT in a row, then an error.
import type { Determinism } from "./determinism";
import type { EffectLog, Phase } from "./log";

// The real timers, kept before any case wraps or fakes the global ones.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetImmediate = globalThis.setImmediate;

/** How long, in real milliseconds, a handler may be stuck (nothing in flight, nothing held, no timer to fire) before the harness says so. */
const STUCK_MS = 2000;

/** How long, in real milliseconds, tracked work may stay unfinished before the harness says so. A digest takes far less. */
const IN_FLIGHT_MS = 30_000;

/** setImmediate deliveries in a row with effects waiting at the gate: the route is treated as waiting for them (a poll loop). */
const POLL_LIMIT = 100;

/** setImmediate deliveries in a row with no effect released and no answer: a route that yields to the event loop forever. */
const YIELD_LIMIT = 50_000;

export type Driving = {
	/** The phase given to the effects released while the work runs. */
	readonly phase: Phase;
	/** Keep releasing until nothing waits at the gate once the work is done too (the background pass), instead of leaving what waits for the caller. */
	readonly flush: boolean;
	/** Fire virtual timers when nothing else is happening, so a route's timeout comes without the test waiting for it. */
	readonly timers: boolean;
	/** What is being driven, named in an error (the case and the step). */
	readonly where: string;
};

/** A failure of the harness itself (a handler nothing can move, tracked work that never ends, a route that never stops yielding): never a rejected answer. */
export class HarnessError extends Error {}

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
	let yields = 0;
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

			// The oldest tracked operation is handed over once it has finished, and nothing else is looked at meanwhile.
			const delivered = log.threads.deliverNext();

			if (delivered !== undefined) {
				yields = delivered === "immediate" ? yields + 1 : 0;

				if (yields > YIELD_LIMIT)
					throw new HarnessError(
						`golden harness: ${driving.where}: the route yielded to the event loop ${YIELD_LIMIT} times in a row without an answer or an effect, so it never ends.`,
					);

				// A setImmediate loop waits for the effects at the gate (the route cannot finish without them): with no
				// threaded operation left, they are released, as the answer is still pending.
				if (
					delivered === "immediate" &&
					yields >= POLL_LIMIT &&
					(!settled || driving.flush) &&
					log.waiting > 0 &&
					log.threads.onlyImmediates
				) {
					log.release(driving.phase);

					yields = 0;
				}

				continue;
			}

			// Gated effects are released only when no tracked operation is undelivered, in both passes: a release while a
			// digest is still running would let the machine's speed decide which effect comes first. The work's own status
			// decides whether a pass still waits for effects (`!settled`), and the background pass also releases.
			if (log.waiting > 0 && log.inflight === 0 && (!settled || driving.flush)) {
				log.release(driving.phase);
				yields = 0;

				continue;
			}

			// The request pass ends once its answer has been read. The background pass ends only when nothing waits at the
			// gate and no tracked operation is undelivered, so floating work at the end of a step is recorded like any other.
			if (settled && (!driving.flush || (log.waiting === 0 && log.inflight === 0)))
				break;

			if (log.inflight === 0 && driving.timers && (await clock.fireNextTimer()))
				continue;

			// Whatever happened while a timer fired is looked at before waiting.
			if (events !== seen) continue;

			// Nothing to do until something changes: an effect arrives, tracked work finishes, or the work settles.
			let stuck: ReturnType<typeof realSetTimeout> | undefined;

			const quiet = new Promise<boolean>((resolve) => {
				wake = () => resolve(true);

				const idle = log.inflight === 0 && log.waiting === 0;

				stuck = realSetTimeout(
					() => resolve(false),
					idle ? STUCK_MS : IN_FLIGHT_MS,
				);
			});

			const woken = await quiet;

			wake = undefined;
			realClearTimeout(stuck);

			if (!woken)
				throw new HarnessError(
					log.inflight > 0
						? `golden harness: ${driving.where}: tracked work never finished (${log.inflight} operation${log.inflight === 1 ? "" : "s"} still undelivered after ${IN_FLIGHT_MS / 1000} seconds).`
						: `golden harness: ${driving.where}: the handler never settled: nothing is in flight, nothing waits and no timer is pending.`,
				);
		}
	} finally {
		log.onHeld = undefined;
		log.onChange = undefined;
	}

	return work;
}
