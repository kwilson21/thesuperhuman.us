import { isCompleteImage } from "./image-structure";

export const softwareVisualLimit = 5 * 1024 * 1024;

export const softwareVisualTypes = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
} as const;

/** Whether the bytes are a complete image of the declared type: its structure is walked to the end, with nothing after. */
export function softwareVisualMatches(bytes: ArrayBuffer, type: string) {
	return isCompleteImage(new Uint8Array(bytes), type);
}

export function softwareVisualKey(
	key: string,
	requestId: string,
	updateId: string,
) {
	return (
		key.startsWith(`software/${requestId}/${updateId}/`) &&
		/^software\/[a-z0-9-]{1,100}\/[a-z0-9-]{1,100}\/[a-z0-9-]+\.(png|jpg|webp)$/.test(
			key,
		)
	);
}

export const softwareVisualHeaders = {
	"cache-control": "private, no-store",
	"x-robots-tag": "noindex, nofollow",
	"x-content-type-options": "nosniff",
};
