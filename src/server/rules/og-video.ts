// Which link preview video a request names, and whether the static assets' answer for it can be served. A name is served
// only when a rendered scene's video is exactly `/og/<name>.mp4`; every other name (an image, a stale name from an earlier
// render, a path) is one 404, before the assets are asked. The assets answer is then judged: a 404 means the file is not
// there, any other answer that is not a success is a fault of the site (the route logs it and answers its fixed 500).
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** No rendered scene's video has this name. */
export class OgVideoNotFound extends Data.TaggedError("OgVideoNotFound") {
	readonly say = "Not found";
}

/** The static assets have no file for a name that is rendered. */
export class OgVideoMissing extends Data.TaggedError("OgVideoMissing") {
	readonly say = "Not found";
}

/** The static assets answered with a status that is neither a success nor a 404. */
export class AssetsNotOk extends Data.TaggedError("AssetsNotOk") {
	readonly say = "The static assets did not answer with a success.";
}

type Named = { readonly named: boolean; readonly name: string };

export const decideOgVideo = alwaysWrites({
	name: "choose the link preview video a request names",
	given: (
		request: { readonly name: string | undefined },
		videos: readonly string[],
	): Named => {
		const name = request.name ?? "";

		return {
			named: name !== "" && videos.includes(`/og/${name}.mp4`),
			name,
		};
	},
	refusals: [
		unless(
			term(
				"a rendered scene's video has this name",
				(given: Named) => given.named,
			),
			() => new OgVideoNotFound(),
		),
	],
	writes: (given) => given.name,
	writesText: "the name of the video to read",
});

type Answer = { readonly status: number; readonly ok: boolean };

/** The assets' answer is a success. A 404 is a missing file; any other failure is the site's fault. */
export const judgeOgSource = alwaysWrites({
	name: "serve the bytes the static assets answered",
	given: (_request: null, answer: Answer) => answer,
	refusals: [
		unless(
			term("the assets have the file", (given: Answer) => given.status !== 404),
			() => new OgVideoMissing(),
		),
		unless(
			term("the assets answered a success", (given: Answer) => given.ok),
			() => new AssetsNotOk(),
		),
	],
	writes: (given) => given,
	writesText: "the answer whose bytes are read",
});
