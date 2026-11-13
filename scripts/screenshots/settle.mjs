// Decides when a captured page has settled, without waiting for requests that never end. Turnstile's
// script (challenges.cloudflare.com) keeps requesting in the background, so the requests to its hosts
// are not counted. A widget that is drawn on load also gets its token before the screenshot. Widgets
// inside a hidden container (a later form step, a closed <details>) are not waited for: they are not
// in the image, and they may never get a token until someone opens them.
// settle returns why it stopped waiting: "quiet", or a "cap: ..." reason when it hit the cap.

/** Hosts whose requests never hold a page open. Exact host names only. */
export const IGNORED_HOSTS = ["challenges.cloudflare.com"];

/** A page is quiet once no counted request has started or finished for this long (Playwright's networkidle window). */
export const QUIET_MS = 500;

/** The most time settle may take, counted from when it starts. Reaching it is not an error. */
export const SETTLE_CAP_MS = 5_000;

/** Extra time after a widget holds its token, so its success state is painted. */
export const WIDGET_PAINT_MS = 500;

/** The longest URL a cap reason names. */
export const REASON_URL_LENGTH = 120;

const POLL_MS = 25;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The URL without its query string or fragment, which can carry tokens. */
export const withoutQuery = (url) => url.split(/[?#]/, 1)[0];

const BLOB = "blob:";

/**
 * The URL a blob wraps: "blob:https://a.test/<id>" gives "https://a.test/<id>". Undefined when it does not
 * parse (Chrome writes "blob:null/<id>" for an opaque origin).
 */
const wrappedUrl = (url) => {
	try {
		return new URL(url.slice(BLOB.length));
	} catch {
		return undefined;
	}
};

/**
 * The URL a settle reason names: a blob by its origin alone, since its id changes on every request, and any
 * other URL without its query string or fragment.
 */
const reasonUrl = (url) => {
	if (!url.startsWith(BLOB)) return withoutQuery(url);

	return `${BLOB}${wrappedUrl(url)?.origin ?? "null"}`;
};

/**
 * Counts requests in flight, with an injected clock (milliseconds). `start` takes the request's key (any
 * unique value) and its URL; `finish` takes the key. Only requests to hosts outside IGNORED_HOSTS count.
 */
export function createRequestTracker({
	now = () => performance.now(),
	ignoredHosts = IGNORED_HOSTS,
} = {}) {
	// Key to URL, in the order the requests started.
	const pending = new Map();

	// When the last counted request started or finished. Undefined until one has, so a page that never
	// asked for anything is quiet at once.
	let lastChange;

	// A blob counts by the host of the URL it wraps, so Turnstile's blobs are ignored like its other requests.
	const counted = (url) => {
		try {
			const host = url.startsWith(BLOB)
				? wrappedUrl(url)?.hostname
				: new URL(url).hostname;

			return !ignoredHosts.includes(host ?? "");
		} catch {
			return true;
		}
	};

	return {
		now,
		start(key, url) {
			if (!counted(url)) return;

			pending.set(key, url);
			lastChange = now();
		},
		finish(key) {
			// A request that is not pending (ignored, or already finished) changes nothing.
			if (!pending.delete(key)) return;

			lastChange = now();
		},
		inFlight: () => pending.size,
		// The URL of the request that has been in flight longest, or undefined when none is.
		firstUrl: () => pending.values().next().value,
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

// The two functions below run in the page, so each is self-contained. A widget counts when it is drawn:
// its element has layout boxes, which a hidden container's descendants do not.

/** Runs in the page: how many Turnstile widgets are drawn. */
export function countVisibleWidgets() {
	return [...document.querySelectorAll(".cf-turnstile")].filter(
		(widget) => widget.getClientRects().length > 0,
	).length;
}

/**
 * Runs in the page: every drawn Turnstile widget holds a token. The token input sits in the widget's light
 * DOM, so this reads it directly and does not depend on the widget's iframe.
 */
export function widgetsHoldTokens() {
	return [...document.querySelectorAll(".cf-turnstile")]
		.filter((widget) => widget.getClientRects().length > 0)
		.every((widget) =>
			Boolean(widget.querySelector('[name="cf-turnstile-response"]')?.value),
		);
}

function requestsReason(tracker) {
	const count = tracker.inFlight();
	const url = tracker.firstUrl();

	return url === undefined
		? `cap: ${count} requests in flight`
		: `cap: ${count} requests in flight, first ${reasonUrl(url).slice(0, REASON_URL_LENGTH)}`;
}

/**
 * Resolves with why settle stopped waiting: "quiet", "cap: N requests in flight, first <url>" or
 * "cap: turnstile token" when the cap ran out first. It never throws. A page that closes while settling
 * stops it with "stopped: <message>". `pause` is injectable so tests can move a fake clock.
 */
export async function settle(
	page,
	tracker,
	{ cap = SETTLE_CAP_MS, pause = sleep } = {},
) {
	const started = tracker.now();
	const left = () => cap - (tracker.now() - started);

	while (!tracker.quiet(QUIET_MS)) {
		if (left() <= 0) return requestsReason(tracker);

		await pause(Math.min(POLL_MS, left()));
	}

	try {
		const widgets = await page.evaluate(countVisibleWidgets);

		if (!widgets) return "quiet";

		await page.waitForFunction(widgetsHoldTokens, null, {
			timeout: Math.max(1, left()),
		});

		if (left() > 0) await pause(Math.min(WIDGET_PAINT_MS, left()));

		return "quiet";
	} catch (error) {
		if (error?.name === "TimeoutError") return "cap: turnstile token";

		const message = String(error?.message ?? error).split("\n")[0];

		return `stopped: ${message}`;
	}
}

/**
 * Keeps the settle reasons of a run that were not "quiet", with a count and the first file that hit each.
 * `lines()` gives one line per reason for the capture log.
 */
export function createSettleLog() {
	const reasons = new Map();

	return {
		record(reason, file) {
			if (reason === "quiet") return;

			if (!reasons.has(reason)) reasons.set(reason, { count: 0, file });

			reasons.get(reason).count += 1;
		},
		lines() {
			return [...reasons].map(
				([reason, { count, file }]) =>
					`Settle ${reason}: ${count} ${count === 1 ? "capture" : "captures"}, first ${file}`,
			);
		},
	};
}
