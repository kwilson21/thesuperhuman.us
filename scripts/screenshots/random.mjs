// Gives the preview's pages the same Math.random sequence on every capture. The 404 page, for one, picks
// a scene with Math.random, so an unseeded page could photograph either scene. This is the browser side only:
// the site's own randomness is not changed, and the server process is not touched.
export const RANDOM_SEED = 0x5c4ee7;

/**
 * Replaces `scope.Math.random` with a mulberry32 generator started from `seed`, so each install gives the same
 * sequence. Returns nothing.
 *
 * Self-contained on purpose: the browser receives this function's source through Playwright's addInitScript, so
 * it must not refer to anything outside its own body. `scope.Math.imul` is read from the scope's own Math.
 */
export function installRandom(scope, seed = 0x5c4ee7) {
	const { imul } = scope.Math;
	let state = seed >>> 0;

	scope.Math.random = function random() {
		state = (state + 0x6d2b79f5) | 0;

		let t = imul(state ^ (state >>> 15), 1 | state);

		t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * The init script that seeds Math.random on the preview's own origin only. Third-party frames, such as
 * Turnstile's, keep real randomness.
 */
export function seededRandomScript(origin) {
	return `if (location.origin === ${JSON.stringify(origin)}) (${installRandom.toString()})(globalThis, ${RANDOM_SEED});`;
}
