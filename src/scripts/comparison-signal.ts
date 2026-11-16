// The A/B comparison tells the page how it sounds, so other drawings can move with it: Home's waveform edge and its
// horizon sun. The player sends one at each frame it draws while playing, and one more when it stops.

export const COMPARISON_SIGNAL = "comparison-signal";

/** How loud the comparison sounds now (0 to 1, as ComparisonTransport.level reads it), and whether it is playing. */
export class ComparisonSignal extends Event {
	constructor(
		readonly level: number,
		readonly playing: boolean,
	) {
		super(COMPARISON_SIGNAL, { bubbles: true });
	}
}
