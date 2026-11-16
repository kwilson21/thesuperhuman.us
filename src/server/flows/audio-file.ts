// A visitor's read of a portfolio track's file. A request with no usable range reads the whole object in one call, whose own
// size is the content length; a range asks the bucket for the size first, judges the range against it, and then reads those
// bytes. Only reads, so there is nothing to guard: an object that goes missing between the size and the bytes is the same
// 404 as one that was never there. It builds no response text; each refusal carries the sentence the route answers.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { readAudioTracks } from "../media-store";
import {
	decideAudioFile,
	decideAudioRange,
	readAudioRange,
} from "../rules/audio-file";
import { type MediaRange, MediaObjects } from "../services";

/** The bucket has no object for a file the collection names. */
export class AudioObjectMissing extends Data.TaggedError("AudioObjectMissing") {
	readonly say = "not found";
}

/** The range starts past the end of a file of `size` bytes. The route answers 416 and names the size. */
export class AudioRangeOutsideFile extends Data.TaggedError(
	"AudioRangeOutsideFile",
)<{ readonly size: number }> {}

export type AudioFileRead = {
	/** The whole file's size. */
	readonly size: number;
	/** The bytes read, or the whole file when `null`. */
	readonly slice: MediaRange | null;
	readonly body: ReadableStream;
};

export const readAudioFile = (input: {
	/** The slug as `readSlug` read it: `null` when it is not well formed. */
	readonly slug: string | null;
	readonly range: string | null;
}) =>
	Effect.gen(function* () {
		// A slug that is not well formed names no track, so the collection is not read for it.
		const tracks = input.slug === null ? [] : yield* readAudioTracks();
		const key = yield* decideAudioFile.decide({ slug: input.slug }, tracks);
		const objects = yield* MediaObjects;
		const plan = readAudioRange(input.range);

		if (plan.kind === "whole") {
			const full = yield* objects.get(key);

			if (full === null) return yield* Effect.fail(new AudioObjectMissing());

			return {
				size: full.size,
				slice: null,
				body: full.body,
			} satisfies AudioFileRead;
		}

		const head = yield* objects.head(key);

		if (head === null) return yield* Effect.fail(new AudioObjectMissing());

		const slice = yield* decideAudioRange
			.decide({ start: plan.start, end: plan.end }, { size: head.size })
			.pipe(
				Effect.catchTag("AudioRangeUnsatisfiable", () =>
					Effect.fail(new AudioRangeOutsideFile({ size: head.size })),
				),
			);

		const partial = yield* objects.get(key, slice);

		if (partial === null) return yield* Effect.fail(new AudioObjectMissing());

		return {
			size: head.size,
			slice,
			body: partial.body,
		} satisfies AudioFileRead;
	});
