export const uploadPartSize = 10 * 1024 * 1024;
export const maxProjectFileSize = 1024 * 1024 * 1024;
export const maxPartEtagLength = 256;

export function expectedPartLength(
	byteSize: number,
	partNumber: number,
): number | null {
	const count = Math.ceil(byteSize / uploadPartSize);

	if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > count)
		return null;

	return Math.min(uploadPartSize, byteSize - (partNumber - 1) * uploadPartSize);
}

/** Reads a request body only up to `limit` bytes; returns null as soon as it would exceed it. */
export async function readBodyWithin(
	body: ReadableStream<Uint8Array>,
	limit: number,
): Promise<ArrayBuffer | null> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		for (;;) {
			const { done, value } = await reader.read();

			if (done) break;
			total += value.byteLength;

			if (total > limit) {
				await reader.cancel().catch(() => {});

				return null;
			}

			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const joined = new Uint8Array(total);
	let at = 0;

	for (const chunk of chunks) {
		joined.set(chunk, at);
		at += chunk.byteLength;
	}

	return joined.buffer;
}
