import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	createRequestTracker,
	QUIET_MS,
	SETTLE_CAP_MS,
	settle,
	trackRequests,
	WIDGET_PAINT_MS,
} from "../../scripts/screenshots/settle.mjs";

// A clock the test moves by hand. `pause` moves it too, so settle's own waiting is exact.
function fakeClock() {
	let now = 0;

	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		},
		pause: async (ms: number) => {
			now += ms;
		},
	};
}

const SITE = "https://thesuperhuman.us/app.js";
const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js";

describe("createRequestTracker", () => {
	it("is quiet immediately when nothing is in flight", () => {
		const clock = fakeClock();
		expect(createRequestTracker({ now: clock.now }).quiet()).toBe(true);
	});

	it("is not quiet while a counted request is in flight", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("a", SITE);
		clock.advance(60_000);

		expect(tracker.quiet()).toBe(false);
		expect(tracker.inFlight()).toBe(1);
	});

	it("is quiet only after the quiet window passes since the last request finished", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("a", SITE);
		clock.advance(100);
		tracker.finish("a");

		clock.advance(QUIET_MS - 1);
		expect(tracker.quiet()).toBe(false);

		clock.advance(1);
		expect(tracker.quiet()).toBe(true);
	});

	it("counts a request that failed as finished", () => {
		const clock = fakeClock();
		const page = new EventEmitter();

		const tracker = trackRequests(
			page,
			createRequestTracker({ now: clock.now }),
		);

		const request = { url: () => SITE };

		page.emit("request", request);
		page.emit("requestfailed", request);
		clock.advance(QUIET_MS);

		expect(tracker.inFlight()).toBe(0);
		expect(tracker.quiet()).toBe(true);
	});

	it.each([
		"https://challenges.cloudflare.com/turnstile/v0/api.js",
		"https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/orchestrate?x=1",
		"https://challenges.cloudflare.com:443/turnstile/v0/api.js?onload=x",
	])("never blocks on Turnstile's host: %s", (url) => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("t", url);

		expect(tracker.quiet(0)).toBe(true);
		expect(tracker.inFlight()).toBe(0);
	});

	it("does not count Turnstile requests as activity that restarts the window", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("a", SITE);
		clock.advance(100);
		tracker.finish("a");
		clock.advance(QUIET_MS);
		tracker.start("t", TURNSTILE);

		expect(tracker.quiet()).toBe(true);
	});

	it("restarts the window when a new counted request starts", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("a", SITE);
		clock.advance(1_000);
		tracker.finish("a");
		clock.advance(400);
		tracker.start("b", SITE);
		clock.advance(1_000);
		tracker.finish("b");

		expect(tracker.quiet()).toBe(false);

		clock.advance(QUIET_MS);
		expect(tracker.quiet()).toBe(true);
	});

	it("does not drive the count negative when a request finishes twice", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("a", SITE);
		tracker.finish("a");
		tracker.finish("a");

		expect(tracker.inFlight()).toBe(0);

		tracker.start("b", SITE);

		expect(tracker.inFlight()).toBe(1);
		expect(tracker.quiet()).toBe(false);
	});
});

describe("settle", () => {
	function fakePage({ widgets = 0, ready = true } = {}) {
		return {
			evaluate: vi.fn(async (_script: () => number) => widgets),
			waitForFunction: vi.fn(
				async (
					_script: () => boolean,
					_arg: null,
					_options: { timeout: number },
				) => {
					if (!ready) throw new Error("timeout");

					return true;
				},
			),
		};
	}

	it("returns at once when the page is quiet and has no Turnstile widget", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();

		await settle(page, tracker, { pause: clock.pause });

		expect(clock.now()).toBe(0);
		expect(page.waitForFunction).not.toHaveBeenCalled();
	});

	it("waits for in-flight requests and the quiet window, then returns", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();

		tracker.start("a", SITE);
		// The request finishes 200 ms in, so settle waits for it and then for the quiet window.

		const pause = async (ms: number) => {
			await clock.pause(ms);

			if (clock.now() >= 200) tracker.finish("a");
		};

		await settle(page, tracker, { pause });

		expect(clock.now()).toBe(200 + QUIET_MS);
	});

	it("gives up at the cap without throwing when a request never finishes", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();

		tracker.start("a", SITE);

		await expect(
			settle(page, tracker, { pause: clock.pause }),
		).resolves.toBeUndefined();
		expect(clock.now()).toBe(SETTLE_CAP_MS);
	});

	it("waits for each widget to hold a token, then a short paint pause", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage({ widgets: 1 });

		await settle(page, tracker, { pause: clock.pause });

		expect(page.waitForFunction).toHaveBeenCalledTimes(1);
		expect(page.waitForFunction.mock.calls[0][2]).toEqual({
			timeout: SETTLE_CAP_MS,
		});
		expect(clock.now()).toBe(WIDGET_PAINT_MS);
	});

	it("carries on silently when a widget never gets its token", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage({ widgets: 2, ready: false });

		await expect(
			settle(page, tracker, { pause: clock.pause }),
		).resolves.toBeUndefined();
		expect(clock.now()).toBe(0);
	});
});
