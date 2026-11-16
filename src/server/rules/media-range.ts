// Which bytes a media read answers with, for the music file route and the link preview video route (the two that read a
// Range header with `mediaRange` in src/lib/music-media.ts, which the studio file route shares). A HEAD request never reads
// the header and always answers the whole file's headers. A header that is not a range this file can serve (another unit,
// two ranges, a start at or past the end, a zero suffix) is refused: the route answers 416 with the file's size, which the
// flow adds, because a rule's refusal carries no facts. Pure: the size is read before the decision.
import * as Data from "effect/Data";
import { mediaRange } from "../../lib/music-media";
import type { MediaRange } from "../services";
import { alwaysWrites, term, unless } from "../terms";

/** The Range header names bytes the file does not have, or is not a range this route serves. */
export class RangeUnsatisfiable extends Data.TaggedError("RangeUnsatisfiable") {
	readonly say = "Requested range not satisfiable";
}

type Given = {
	readonly range: MediaRange | null | "invalid";
};

export const decideMediaRange = alwaysWrites({
	name: "choose the bytes a media read answers with",
	given: (
		request: { readonly method: string; readonly range: string | null },
		facts: { readonly size: number },
	): Given => ({
		range:
			request.method === "HEAD" ? null : mediaRange(request.range, facts.size),
	}),
	refusals: [
		unless(
			term(
				"the Range header, if any, names bytes the file has",
				(given: Given) => given.range !== "invalid",
			),
			() => new RangeUnsatisfiable(),
		),
	],
	// `null` is the whole file.
	writes: (given): MediaRange | null =>
		given.range === "invalid" ? null : given.range,
	writesText: "the offset and length to read, or the whole file",
});
