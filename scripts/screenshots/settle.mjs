// Decides when a captured page has settled, without waiting for requests that never end. Turnstile's
// script (challenges.cloudflare.com) keeps requesting in the background, so the requests to its hosts
// are not counted. Its widget is still drawn after its script runs, so a page with a widget also waits
// for the widget to hold a token before the screenshot.

/** Hosts whose requests never hold a page open. Exact host names only. */
export const IGNORED_HOSTS = ["challenges.cloudflare.com"];

/** A page is quiet once no counted request has started or finished for this long (Playwright's networkidle window). */
export const QUIET_MS = 500;

/** The most time settle may take, counted from when it starts. Reaching it is not an error. */
export const SETTLE_CAP_MS = 5_000;

/** Extra time after a widget holds its token, so its success state is painted. */
export const WIDGET_PAINT_MS = 500;

const POLL_MS = 25;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Counts requests in flight, with an injected clock (milliseconds). `start` takes the request's key (any
 * unique value) and its URL; `finish` takes the key. Only requests to hosts outside IGNORED_HOSTS count.
 */
export function createRequestTracker({
	now = () => performance.now(),
	ignoredHosts = IGNORED_HOSTS,
} = {}) {
	const pending = new Set();

	// When the last counted request started or finished. Undefined until one has, so a page that never
	// asked for anything is quiet at once.
	let lastChange;

	const counted = (url) => {
		try {
			return !ignoredHosts.includes(new URL(url).hostname);
		} catch {
			return true;
		}
	};

	return {
		now,
		start(key, url) {
			if (!counted(url)) return;

			pending.add(key);
			lastChange = now();
		},
		finish(key) {
			// A request that is not pending (ignored, or already finished) changes nothing.
			if (!pending.delete(key)) return;

			lastChange = now();
		},
		inFlight: () => pending.size,
		quiet(windowMs = QUIET_MS) {
			return (
				pending.size === 0 &&
				(lastChange === undefined || now() - lastChange >= windowMs)
			);
		},
	};
}

/** Counts a page's requests with `tracker` (a new one by default). Call before page.goto. */
export function trackRequests(page, tracker = createRequestTracker()) {
	page.on("request", (request) => tracker.start(request, request.url()));
	page.on("requestfinished", (request) => tracker.finish(request));
	page.on("requestfailed", (request) => tracker.finish(request));

	return tracker;
}

/**
 * Resolves when the page has settled, or at the cap. It never throws on the cap; a page that closes
 * while settling just stops waiting. `pause` is injectable so tests can move a fake clock.
 */
export async function settle(
	page,
	tracker,
	{ cap = SETTLE_CAP_MS, pause = sleep } = {},
) {
	const started = tracker.now();
	const left = () => cap - (tracker.now() - started);

	while (!tracker.quiet(QUIET_MS)) {
		if (left() <= 0) return;

		await pause(Math.min(POLL_MS, left()));
	}

	if (left() <= 0) return;

	try {
		const widgets = await page.evaluate(
			() => document.querySelectorAll(".cf-turnstile").length,
		);

		if (!widgets) return;

		await page.waitForFunction(
			() =>
				[...document.querySelectorAll(".cf-turnstile")].every(
					(widget) =>
						widget.querySelector("iframe") &&
						widget.querySelector('[name="cf-turnstile-response"]')?.value,
				),
			null,
			{ timeout: Math.max(1, left()) },
		);

		if (left() > 0) await pause(Math.min(WIDGET_PAINT_MS, left()));
	} catch {
		// Cap reached or page gone: carry on with the screenshot, as before.
	}
}
