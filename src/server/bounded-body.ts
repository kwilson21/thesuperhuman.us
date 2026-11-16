// Reads a request body up to a limit, whatever its Content-Length says. The reading is an outside effect (a stream from the
// network), so a failure is named, and a body over the limit is a named refusal, not a truncated read.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

/** The body is longer than the limit. */
export class BodyTooLarge extends Data.TaggedError("BodyTooLarge") {}

/** The body stream failed while it was read. */
export class BodyUnreadable extends Data.TaggedError("BodyUnreadable") {}

/** The bytes of the body, or null when it is over `limit`. Stops reading at the first byte past the limit. */
const gather = async (
	body: ReadableStream<Uint8Array>,
	limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> => {
	const reader = body.getReader();
	const parts: Uint8Array[] = [];
	let size = 0;

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;
		size += value.byteLength;

		if (size > limit) {
			await reader.cancel();

			return null;
		}

		parts.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;

	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}

	return bytes;
};

export const readBounded = (body: ReadableStream<Uint8Array>, limit: number) =>
	Effect.tryPromise({
		try: () => gather(body, limit),
		catch: () => new BodyUnreadable(),
	}).pipe(
		Effect.flatMap((bytes) =>
			bytes === null ? Effect.fail(new BodyTooLarge()) : Effect.succeed(bytes),
		),
	);
