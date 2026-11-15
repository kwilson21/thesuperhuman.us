// The full A/B player's loudness meters: one thin bar per version, at its measured whole-song loudness, so the gap
// between the exports shows, and Match loudness visibly closes it. Shared by the component's first render and the
// player, which redraws them when Match loudness changes.

/** The meter's scale, in LUFS: the bar is empty at the quiet end and full at the loud end. */
const QUIETEST = -20;
const LOUDEST = -6;

/** How much of the bar a loudness fills, from 0 to 1. */
export function meterShare(lufs: number) {
	return Math.max(0, Math.min(1, (lufs - QUIETEST) / (LOUDEST - QUIETEST)));
}

/** A loudness as the page writes it: one decimal, with a true minus sign. */
const lufsText = (lufs: number) =>
	`${lufs < 0 ? "−" : ""}${Math.abs(lufs).toFixed(1)} LUFS`;

/** The meter's line: the loudness the version plays at, and how far Match loudness turned it down. */
export function meterLine(played: number, turnedDown = 0) {
	return turnedDown >= 0.05
		? `${lufsText(played)}, turned down ${turnedDown.toFixed(1)} dB`
		: lufsText(played);
}
