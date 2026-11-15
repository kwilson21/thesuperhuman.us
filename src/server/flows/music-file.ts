// A listener's read of a recording's file: the catalog names the file, the bucket says how big it is, the Range header is
// judged against that size, and then the bytes (or, for HEAD, nothing) are read. Only reads, so there is nothing to guard
// and no state: an object that goes missing between the size and the bytes is the same 404 as one that was never there.
// It builds no response text; each refusal carries the sentence the route answers.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { readRecordings } from "../media-store";
import { decideMusicFile, type MusicVersion } from "../rules/music-file";
import { type MediaRange, MediaObjects } from "../services";
import { sliceOf } from "./media-range";

/** The bucket has no object for a file the catalog names. */
export class MusicObjectMissing extends Data.TaggedError("MusicObjectMissing") {
	readonly say = "Media unavailable";
}

export type MusicFileRead = {
	/** The media type the catalog gives the file. */
	readonly type: string;
	/** The whole file's size, from the bucket. */
	readonly size: number;
	/** The bytes read, or the whole file when `null`. */
	readonly slice: MediaRange | null;
	/** The bytes; `null` for HEAD, which reads none. */
	readonly body: ReadableStream | null;
};

export const readMusicFile = (input: {
	readonly id: string | undefined;
	readonly version: MusicVersion | null;
	readonly method: string;
	readonly range: string | null;
}) =>
	Effect.gen(function* () {
		const recordings = yield* readRecordings();

		const asset = yield* decideMusicFile.decide(
			{ id: input.id, version: input.version },
			recordings,
		);

		const objects = yield* MediaObjects;
		const head = yield* objects.head(asset.key);

		if (head === null) return yield* Effect.fail(new MusicObjectMissing());

		const slice = yield* sliceOf(
			{ method: input.method, range: input.range },
			head.size,
		);

		if (input.method === "HEAD")
			return {
				type: asset.type,
				size: head.size,
				slice,
				body: null,
			} satisfies MusicFileRead;

		const object = yield* objects.get(asset.key, slice ?? undefined);

		if (object === null) return yield* Effect.fail(new MusicObjectMissing());

		return {
			type: asset.type,
			size: head.size,
			slice,
			body: object.body,
		} satisfies MusicFileRead;
	});
