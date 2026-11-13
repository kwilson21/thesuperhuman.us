// The clock every screenshot run reads. Each run pins time to CLOCK_BASE, so the same inputs give the
// same images on any day. Time still moves forward at the real rate from the base.
// The base must be later than every date the scenarios treat as past (the latest is 2026-10-20), and earlier
// than the dates they treat as still ahead (2026-12-01 in the website brief). Otherwise the server refuses a
// past date as being in the future.
// Noon UTC is 7 am in New York in November, so a run never crosses a date line in either zone.
// Changing CLOCK_BASE changes scripts/screenshots, a global input, so every image is captured again.
export const CLOCK_BASE = "2026-11-12T12:00:00.000Z";

/**
 * Pins `scope`'s Date, and the no-argument form of Intl's date formatting, to `baseMs`.
 *
 * Self-contained on purpose: the browser receives this function's source through Playwright's
 * addInitScript, so it must not refer to anything outside its own body.
 *
 * Returns `{ reset, restore }`. `reset` moves the clock back to exactly the base. `restore` puts the
 * real Date back. Installing again on the same scope replaces the earlier install without stacking on it.
 */
export function installClock(scope, baseMs) {
	// Where an install keeps its state on the scope, so a later install can find and replace it.
	const STATE = Symbol.for("thesuperhuman.screenshots.clock");
	const previous = scope[STATE];

	if (previous) previous.restore();

	const RealDate = previous ? previous.RealDate : scope.Date;
	let anchor = RealDate.now();
	const pinnedNow = () => baseMs + (RealDate.now() - anchor);

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
		reset() {
			if (scope[STATE] === state) anchor = RealDate.now();
		},
		restore: state.restore,
	};
}

/**
 * The init script that pins a page's clock to `baseMs`, on the preview's own origin only (third-party frames
 * keep the real clock). Capture passes its own pinned Date.now(): the server is reset to CLOCK_BASE before each
 * scenario and moves on from there, so the page starts from the same moment as the server and never runs behind it.
 */
export function browserClockScript(origin, baseMs) {
	return `if (location.origin === ${JSON.stringify(origin)}) (${installClock.toString()})(globalThis, ${baseMs});`;
}
