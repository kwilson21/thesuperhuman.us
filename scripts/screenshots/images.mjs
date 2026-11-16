// Waits for the page's images before a full-page capture. A lazy image that has not loaded has no intrinsic
// size, so the page height, and the pixels below it, change from run to run. The capture makes lazy images
// eager (a property change only, so the page is not scrolled), waits until every image is complete, then
// decodes them. A broken image is complete too, so it does not hold the wait. The wait has a cap: when an image
// is still loading at the cap, the capture goes on and logs the reason, as settle does.
import { REASON_URL_LENGTH, withoutQuery } from "./settle.mjs";

/** The longest an image wait may take. Reaching it is logged, not an error. */
export const IMAGE_CAP_MS = 3_000;

/** Runs in the page: every lazy image is loaded eagerly. Self-contained. */
export function eagerLazyImages() {
	for (const image of document.querySelectorAll('img[loading="lazy"]'))
		image.loading = "eager";
}

/** Runs in the page: every image is complete. A broken image is complete, so it does not hold the page. */
export function imagesLoaded() {
	return [...document.images].every((image) => image.complete);
}

/** Runs in the page: what each image is and whether it has finished loading. Self-contained. */
export function imageStates() {
	return [...document.images].map((image) => ({
		src: image.currentSrc || image.src,
		complete: image.complete,
		naturalWidth: image.naturalWidth,
	}));
}

/** Runs in the page: decodes every loaded image, so a decode does not change the screenshot. Self-contained. */
export async function decodeImages() {
	await Promise.all(
		[...document.images].flatMap((image) =>
			image.complete && image.naturalWidth > 0
				? [image.decode().catch(() => {})]
				: [],
		),
	);
}

/** The images that have not finished loading, from the states imageStates gives. */
export function pendingImages(states) {
	return states.filter((state) => !state.complete);
}

/**
 * The reason for the log when the wait hits its cap: how many images were still loading and the first one's
 * URL without its query string, cut to REASON_URL_LENGTH.
 */
export function imagesReason(pending) {
	const first = withoutQuery(pending[0].src).slice(0, REASON_URL_LENGTH);

	return `images: ${pending.length} still loading, first ${first}`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// The messages Playwright gives when the page's document is replaced during a wait. A closed page is not one of them.
const NAVIGATION_MESSAGES = ["execution context was destroyed", "navigat"];

const isNavigation = (error) => {
	const message = String(error?.message ?? error).toLowerCase();

	return NAVIGATION_MESSAGES.some((text) => message.includes(text));
};

// One pass of the wait: the images to complete within the cap, then the decode with the time left.
async function attempt(page, { file, cap, now, pause, record }) {
	const started = now();

	await page.evaluate(eagerLazyImages);

	try {
		await page.waitForFunction(imagesLoaded, null, { timeout: cap });
	} catch (error) {
		if (error?.name !== "TimeoutError") throw error;

		const pending = pendingImages(await page.evaluate(imageStates));

		// The last image may have finished between the timeout and this read.
		if (pending.length) record(imagesReason(pending));
	}

	// A decode that never ends would otherwise hold the capture, so it is raced against the time left.
	const left = Math.max(0, cap - (now() - started));
	const decoded = page.evaluate(decodeImages).then(() => true);
	const finished = await Promise.race([decoded, pause(left).then(() => false)]);

	if (!finished) record("images: decode still running at cap");
}

/**
 * Waits for a page's images before its capture (see the file's header). `record(reason)` logs a reason that the
 * wait hit its cap. A navigation during the wait is retried once when the capture has no `prepare` step, since
 * the page is then just loaded again; a capture with one throws, since a reload would lose its prepared state.
 * Any other error throws, naming the capture. `now` and `pause` are injectable so tests can move a fake clock.
 */
export async function waitForImages(
	page,
	{
		file,
		prepared = false,
		record,
		cap = IMAGE_CAP_MS,
		now = () => performance.now(),
		pause = sleep,
	},
) {
	const options = { file, cap, now, pause, record };

	try {
		await attempt(page, options);
	} catch (error) {
		if (!isNavigation(error))
			throw new Error(`${file}: the image wait failed: ${error.message}`, {
				cause: error,
			});

		if (prepared)
			throw new Error(
				`${file}: the page navigated during the image wait, after its prepare step, so it cannot be captured as prepared: ${error.message}`,
				{ cause: error },
			);

		try {
			await page.waitForLoadState("load");
			record("images: page navigated during the wait");
			await attempt(page, options);
		} catch (retry) {
			throw new Error(
				`${file}: the image wait failed after a retry: ${retry.message}`,
				{ cause: retry },
			);
		}
	}
}
