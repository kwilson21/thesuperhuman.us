/** The body of an R2 object: a stream that yields the given bytes once, as R2 returns it. */
export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

/** The byte range an R2 read names when it gives both an offset and a length; a Headers range names none. */
export function byteRange(
	range: R2Range | Headers | undefined,
): { offset: number; length: number } | undefined {
	if (!range || range instanceof Headers) return undefined;

	const offset = "offset" in range ? range.offset : undefined;
	const length = "length" in range ? range.length : undefined;

	return offset !== undefined && length !== undefined
		? { offset, length }
		: undefined;
}
