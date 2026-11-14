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
