// A link preview video: the rendered name is checked, the static assets are asked for the raw file, their answer is judged,
// and the Range header is judged against the size of the bytes that came back. The whole file is read into memory, because
// the static assets answer every request with the whole file and this route slices it. Only reads. It builds no response
// text; each refusal carries the sentence the route answers.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { decideOgVideo, judgeOgSource } from "../rules/og-video";
import { type MediaRange, OgAssets } from "../services";
import { sliceOf } from "./media-range";

/** The static assets answered `status`, which is neither a success nor a 404. The route logs it once and answers its fixed 500. */
export class AssetsAnswered extends Data.TaggedError("AssetsAnswered")<{
	readonly status: number;
}> {}

export type OgVideoRead = {
	readonly bytes: ArrayBuffer;
	readonly size: number;
	/** The bytes to answer with, or the whole file when `null` (and always for HEAD). */
	readonly slice: MediaRange | null;
};

export const readOgVideo = (input: {
	readonly name: string | undefined;
	/** The rendered scenes' video paths. */
	readonly videos: readonly string[];
	/** The address the request came to, which the raw file's address is built from. */
	readonly requestUrl: string;
	readonly method: string;
	readonly range: string | null;
}) =>
	Effect.gen(function* () {
		const name = yield* decideOgVideo.decide(
			{ name: input.name },
			input.videos,
		);

		const assets = yield* OgAssets;

		const answer = yield* assets.fetch(
			new URL(`/og/raw/${name}.mp4`, input.requestUrl),
		);

		yield* judgeOgSource
			.decide(null, { status: answer.status, ok: answer.ok })
			.pipe(
				Effect.catchTag("AssetsNotOk", () =>
					Effect.fail(new AssetsAnswered({ status: answer.status })),
				),
			);

		const bytes = yield* answer.bytes();
		const size = bytes.byteLength;

		const slice = yield* sliceOf(
			{ method: input.method, range: input.range },
			size,
		);

		return { bytes, size, slice } satisfies OgVideoRead;
	});
