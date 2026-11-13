import { double } from "./doubles";

/** R2Bucket's methods are overloaded, so a test's put, get, list and delete are typed with this loose signature. */
type R2Member = (...args: never[]) => void;

/**
 * An R2 bucket with the four members the tests use, and no others.
 */
export function fakeR2Bucket(members: {
	put: R2Member;
	get: R2Member;
	list: R2Member;
	delete: R2Member;
}): R2Bucket {
	// SAFETY: the code under test calls only put, get, list and delete, with the arguments these fakes accept; any other member of R2Bucket is absent and throws if called.
	return members as R2Bucket;
}

/**
 * An R2 bucket whose get() resolves to an object whose arrayBuffer() returns a copy of `bytes`, and no other members.
 * arrayBuffer() resolves to an ArrayBuffer, as R2ObjectBody.arrayBuffer() does; callers that read the body as a stream
 * use bytesStream instead.
 */
export function fakeR2Bytes(bytes: Uint8Array): R2Bucket {
	return double<R2Bucket>({
		get: async () =>
			double<R2ObjectBody>({ arrayBuffer: async () => bytes.slice().buffer }),
	});
}

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
