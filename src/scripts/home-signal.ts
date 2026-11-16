// How Home follows the A/B comparison: home-worlds.ts draws the waveform edge and the sun's glow from what this hands it.
import { COMPARISON_SIGNAL, ComparisonSignal } from "./comparison-signal";

/** What follows the comparison: each frame's level while it plays, and the stop. */
export interface SignalFollower {
	/** The music's level, smoothed (0 to 1), at a frame while the comparison plays. */
	playing(level: number): void;
	/** The comparison stopped: back to rest. */
	stopped(): void;
}

/** One frame at 60 Hz, in milliseconds: the smoothing below is stated per such frame. */
const FRAME = 1000 / 60;

/**
 * Hears the comparison's signal on `target` until `signal` aborts. The level is smoothed as a meter's needle moves, quick
 * to rise and slower to fall, by the time since the last frame so it moves alike at any refresh rate, and starts from
 * silence each time the music starts. `now` reads the clock in milliseconds.
 */
export function followComparison(
	target: EventTarget,
	follower: SignalFollower,
	signal: AbortSignal,
	now: () => number = () => performance.now(),
) {
	let level = 0;
	let last: number | undefined;

	target.addEventListener(
		COMPARISON_SIGNAL,
		(event) => {
			if (!(event instanceof ComparisonSignal)) return;

			if (!event.playing) {
				level = 0;
				last = undefined;
				follower.stopped();

				return;
			}

			const at = now();

			// Frames at 60 Hz since the last one, the first counted as one; a long gap (a hidden page) counts as ten.
			const frames =
				last === undefined ? 1 : Math.min(10, Math.max(0, (at - last) / FRAME));

			const rate = event.level > level ? 0.5 : 0.12;

			last = at;
			level += (event.level - level) * (1 - (1 - rate) ** frames);
			follower.playing(level);
		},
		{ signal },
	);
}
