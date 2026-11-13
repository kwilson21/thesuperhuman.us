import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	countVisibleWidgets,
	createRequestTracker,
	createSettleLog,
	QUIET_MS,
	SETTLE_CAP_MS,
	settle,
	trackRequests,
	WIDGET_PAINT_MS,
	widgetsHoldTokens,
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

afterEach(() => {
	vi.unstubAllGlobals();
});

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

	it("never blocks on a blob URL that Turnstile's host created", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start(
			"b",
			"blob:https://challenges.cloudflare.com/bd88ee6f-9642-4041-9a7d-c690637446d6",
		);

		expect(tracker.quiet(0)).toBe(true);
		expect(tracker.inFlight()).toBe(0);
	});

	it("counts a blob URL of the preview's own origin", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start(
			"b",
			"blob:http://127.0.0.1:4321/bd88ee6f-9642-4041-9a7d-c690637446d6",
		);

		expect(tracker.quiet(0)).toBe(false);
		expect(tracker.inFlight()).toBe(1);
	});

	it("counts a URL it cannot parse, including a blob with an opaque origin", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("n", "not a url");
		tracker.start("o", "blob:null/bd88ee6f-9642-4041-9a7d-c690637446d6");

		expect(tracker.inFlight()).toBe(2);
	});

	it("keeps counting data and about URLs as before", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		tracker.start("d", "data:text/plain,hello");
		tracker.start("a", "about:blank");

		expect(tracker.inFlight()).toBe(2);
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

	it("remembers the URL of the first request still in flight", () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		expect(tracker.firstUrl()).toBeUndefined();

		tracker.start("a", SITE);
		tracker.start("b", "https://thesuperhuman.us/other.js");
		expect(tracker.firstUrl()).toBe(SITE);

		tracker.finish("a");
		expect(tracker.firstUrl()).toBe("https://thesuperhuman.us/other.js");
	});
});

// Stands in for the page's document: the widgets a selector finds, and whether each is drawn.
type FakeWidget = ReturnType<typeof widget>;

function fakeDocument(widgets: FakeWidget[]) {
	vi.stubGlobal("document", {
		querySelectorAll: (selector: string) => {
			expect(selector).toBe(".cf-turnstile");

			return widgets;
		},
	});
}

// A widget as the page holds it: drawn (has layout boxes) or inside a hidden container (none), with
// its token input in the light DOM. An iframe is never reachable from here, so none is given.
function widget({
	drawn = true,
	token = "",
}: {
	drawn?: boolean;
	token?: string;
} = {}) {
	return {
		getClientRects: () => (drawn ? [{}] : []),
		querySelector: (selector: string) =>
			selector === '[name="cf-turnstile-response"]' ? { value: token } : null,
	};
}

describe("widget checks that run in the page", () => {
	it("counts only the widgets that are drawn", () => {
		fakeDocument([
			widget({ drawn: true }),
			widget({ drawn: false }),
			widget({ drawn: true }),
		]);

		expect(countVisibleWidgets()).toBe(2);
	});

	it("holds when every drawn widget has its token, even with no iframe reachable", () => {
		fakeDocument([widget({ token: "0.abc" })]);

		expect(widgetsHoldTokens()).toBe(true);
	});

	it("does not hold while a drawn widget has an empty token", () => {
		fakeDocument([widget({ token: "0.abc" }), widget({ token: "" })]);

		expect(widgetsHoldTokens()).toBe(false);
	});

	it("ignores a hidden widget that never gets a token", () => {
		fakeDocument([widget({ token: "0.abc" }), widget({ drawn: false })]);

		expect(widgetsHoldTokens()).toBe(true);
	});
});

describe("createSettleLog", () => {
	it("prints nothing when every capture settled quietly", () => {
		const log = createSettleLog();

		log.record("quiet", "home-desktop.png");

		expect(log.lines()).toEqual([]);
	});

	it("prints one line per distinct reason with its count and its first file", () => {
		const log = createSettleLog();

		log.record("cap: turnstile token", "studio-sign-in-desktop.png");
		log.record("quiet", "home-desktop.png");
		log.record("cap: turnstile token", "offer-sign-phone.png");
		log.record("cap: 1 requests in flight, first https://a.test/x.js", "x.png");

		expect(log.lines()).toEqual([
			"Settle cap: turnstile token: 2 captures, first studio-sign-in-desktop.png",
			"Settle cap: 1 requests in flight, first https://a.test/x.js: 1 capture, first x.png",
		]);
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
					if (!ready) {
						const timeout = new Error("Timeout 5000ms exceeded.");
						timeout.name = "TimeoutError";

						throw timeout;
					}

					return true;
				},
			),
		};
	}

	it("returns at once when the page is quiet and has no drawn Turnstile widget", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();

		await expect(settle(page, tracker, { pause: clock.pause })).resolves.toBe(
			"quiet",
		);

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

		await expect(settle(page, tracker, { pause })).resolves.toBe("quiet");
		expect(clock.now()).toBe(200 + QUIET_MS);
	});

	it("gives up at the cap without throwing when a request never finishes", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();

		tracker.start("a", SITE);

		await expect(settle(page, tracker, { pause: clock.pause })).resolves.toBe(
			`cap: 1 requests in flight, first ${SITE}`,
		);
		expect(clock.now()).toBe(SETTLE_CAP_MS);
	});

	it("strips the query string and fragment from the reason, since they can carry tokens", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();

		tracker.start(
			"a",
			"https://thesuperhuman.us/api/owner/file.json?token=secret-value#frag",
		);

		const reason = await settle(page, tracker, { pause: clock.pause });

		expect(reason).toBe(
			"cap: 1 requests in flight, first https://thesuperhuman.us/api/owner/file.json",
		);
		expect(reason).not.toContain("secret-value");
		expect(reason).not.toContain("#frag");
	});

	it("names a pending blob by its origin, without the id", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();

		tracker.start(
			"b",
			"blob:http://127.0.0.1:4321/bd88ee6f-9642-4041-9a7d-c690637446d6",
		);

		await expect(settle(page, tracker, { pause: clock.pause })).resolves.toBe(
			"cap: 1 requests in flight, first blob:http://127.0.0.1:4321",
		);
	});

	it("gives two blobs of one origin the same reason, so the log groups them", async () => {
		const reasonFor = async (id: string) => {
			const clock = fakeClock();
			const tracker = createRequestTracker({ now: clock.now });

			tracker.start("b", `blob:http://127.0.0.1:4321/${id}`);

			return settle(fakePage(), tracker, { pause: clock.pause });
		};

		const first = await reasonFor("bd88ee6f-9642-4041-9a7d-c690637446d6");
		const second = await reasonFor("0a1b2c3d-0000-4000-8000-000000000000");

		expect(first).toBe(second);
		expect(first).not.toContain("bd88ee6f");
	});

	it("truncates the URL in the reason to 120 characters", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage();
		const long = `https://thesuperhuman.us/${"a".repeat(200)}`;

		tracker.start("a", long);

		const reason = await settle(page, tracker, { pause: clock.pause });

		expect(reason).toBe(
			`cap: 1 requests in flight, first ${long.slice(0, 120)}`,
		);
	});

	it("waits for each drawn widget to hold a token, then a short paint pause", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage({ widgets: 1 });

		await expect(settle(page, tracker, { pause: clock.pause })).resolves.toBe(
			"quiet",
		);

		expect(page.evaluate.mock.calls[0][0]).toBe(countVisibleWidgets);
		expect(page.waitForFunction).toHaveBeenCalledTimes(1);
		expect(page.waitForFunction.mock.calls[0][0]).toBe(widgetsHoldTokens);
		expect(page.waitForFunction.mock.calls[0][2]).toEqual({
			timeout: SETTLE_CAP_MS,
		});
		expect(clock.now()).toBe(WIDGET_PAINT_MS);
	});

	it("reports the cap when a widget never gets its token, and carries on", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });
		const page = fakePage({ widgets: 2, ready: false });

		await expect(settle(page, tracker, { pause: clock.pause })).resolves.toBe(
			"cap: turnstile token",
		);
	});

	it("reports a page error while settling as stopped, without throwing", async () => {
		const clock = fakeClock();
		const tracker = createRequestTracker({ now: clock.now });

		const page = {
			evaluate: vi.fn(async () => {
				throw new Error("Target page, context or browser has been closed");
			}),
			waitForFunction: vi.fn(),
		};

		await expect(settle(page, tracker, { pause: clock.pause })).resolves.toBe(
			"stopped: Target page, context or browser has been closed",
		);
	});
});
