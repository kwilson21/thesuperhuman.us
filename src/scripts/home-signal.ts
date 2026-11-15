// How Home follows the A/B comparison: home-worlds.ts draws the waveform edge and the sun's glow from what this hands it.
import { COMPARISON_SIGNAL, ComparisonSignal } from "./comparison-signal";

/** What follows the comparison: each frame's level while it plays, and the stop. */
export interface SignalFollower {
	/** The music's level, smoothed (0 to 1), at a frame while the comparison plays. */
	playing(level: number): void;
	/** The comparison stopped: back to rest. */
	stopped(): void;
}

/**
 * Hears the comparison's signal on `target` until `signal` aborts. The level is smoothed as a meter's needle moves, quick
 * to rise and slower to fall, and starts from silence each time the music starts.
 */
export function followComparison(
	target: EventTarget,
	follower: SignalFollower,
	signal: AbortSignal,
) {
	let level = 0;

	target.addEventListener(
		COMPARISON_SIGNAL,
		(event) => {
			if (!(event instanceof ComparisonSignal)) return;

			if (!event.playing) {
				level = 0;
				follower.stopped();

				return;
			}

			level += (event.level - level) * (event.level > level ? 0.5 : 0.12);
			follower.playing(level);
		},
		{ signal },
	);
}
