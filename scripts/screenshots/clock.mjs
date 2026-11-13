// The clock every screenshot run reads. Time is frozen at CLOCK_BASE and only moves when the capture moves it:
// each scenario step advances it by STEP_MS (see stepTime). Real elapsed time never reaches the clock, so the
// same scenario script gives the same times on a fast run and a slow one, and on any day.
// The base must be later than every date the scenarios treat as past (the latest is 2026-10-20), and earlier
// than the dates they treat as still ahead (2026-12-01 in the website brief). Otherwise the server refuses a
// past date as being in the future.
// Noon UTC is 7 am in New York in November, so a run never crosses a date line in either zone.
// Changing CLOCK_BASE changes scripts/screenshots, a global input, so every image is captured again.
export const CLOCK_BASE = "2026-11-12T12:00:00.000Z";

// Each scenario step moves the clock forward one second, so rows made in different steps keep their order and
// every time shown is decided by the step's position in the scenario.
export const STEP_MS = 1000;

/** The instant for a step: the base plus `step` steps. Pure, so the capture and the dev server agree. */
export const stepTime = (step) => Date.parse(CLOCK_BASE) + step * STEP_MS;

/**
 * Freezes `scope`'s Date, and the no-argument form of Intl's date formatting, at `startMs`.
 *
 * Self-contained on purpose: the browser receives this function's source through Playwright's
 * addInitScript, so it must not refer to anything outside its own body.
 *
 * Returns `{ set, restore }`. `set(ms)` moves the frozen instant to exactly `ms`; nothing else moves it.
 * `restore` puts the real Date back. Installing again on the same scope replaces the earlier install
 * without stacking on it, and a handle from a replaced install changes nothing.
 *
 * The constructor of a date made by the shim is still the real Date: the shim's prototype is the real one,
 * so dates made before the install stay `instanceof` the shim. Pointing `constructor` at the shim would mean
 * editing the real Date.prototype, which other code shares.
 */
export function installClock(scope, startMs) {
	// Where an install keeps its state on the scope, so a later install can find and replace it.
	const STATE = Symbol.for("thesuperhuman.screenshots.clock");
	const previous = scope[STATE];

	if (previous) previous.restore();

	const RealDate = previous ? previous.RealDate : scope.Date;
	let frozen = startMs;
	const pinnedNow = () => frozen;

	function PinnedDate(...args) {
		if (!new.target) return new RealDate(pinnedNow()).toString();

		return Reflect.construct(
			RealDate,
			args.length ? args : [pinnedNow()],
			new.target,
		);
	}

	PinnedDate.prototype = RealDate.prototype;

	for (const key of Reflect.ownKeys(RealDate))
		if (!["length", "name", "prototype", "now"].includes(key))
			Object.defineProperty(
				PinnedDate,
				key,
				Object.getOwnPropertyDescriptor(RealDate, key),
			);

	Object.defineProperty(PinnedDate, "now", {
		value: function now() {
			return pinnedNow();
		},
		writable: true,
		configurable: true,
	});
	Object.defineProperty(PinnedDate, "name", { value: RealDate.name });
	Object.defineProperty(PinnedDate, "length", { value: RealDate.length });

	const undo = [];
	const Intl = scope.Intl;

	if (Intl?.DateTimeFormat) {
		const proto = Intl.DateTimeFormat.prototype;
		const format = Object.getOwnPropertyDescriptor(proto, "format");
		const parts = Object.getOwnPropertyDescriptor(proto, "formatToParts");

		Object.defineProperty(proto, "format", {
			configurable: true,
			get() {
				const bound = format.get.call(this);

				return (date) => bound(date === undefined ? pinnedNow() : date);
			},
		});
		Object.defineProperty(proto, "formatToParts", {
			configurable: true,
			writable: true,
			value: function formatToParts(date) {
				return parts.value.call(this, date === undefined ? pinnedNow() : date);
			},
		});
		undo.push(() => {
			Object.defineProperty(proto, "format", format);
			Object.defineProperty(proto, "formatToParts", parts);
		});
	}

	const state = {
		RealDate,
		restore() {
			if (scope[STATE] !== state) return;

			scope.Date = RealDate;

			for (const revert of undo) revert();
			delete scope[STATE];
		},
	};

	scope[STATE] = state;
	scope.Date = PinnedDate;

	return {
		set(ms) {
			if (scope[STATE] === state) frozen = ms;
		},
		restore: state.restore,
	};
}

/**
 * The init script that freezes a page's clock at `instantMs`, on the preview's own origin only (third-party
 * frames keep the real clock). Capture passes the instant its own clock holds when it sets the page up, which is
 * the scenario step the server is at, so the page and the server agree on the time.
 */
export function browserClockScript(origin, instantMs) {
	return `if (location.origin === ${JSON.stringify(origin)}) (${installClock.toString()})(globalThis, ${instantMs});`;
}
