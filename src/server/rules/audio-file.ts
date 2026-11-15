// Which portfolio track an audio file request names, and which bytes it asks for. The track is found by its slug among the
// audio-tracks entries the route read; its file's key must start with tracks/ (the bucket also holds studio files, software visuals, signed agreements and attachments). Every
// refusal is one 404. A Range header is read the way this route always has: only `bytes=<start>-` and `bytes=<start>-<end>`
// are ranges; anything else (a suffix range, two ranges, another unit, no header) asks for the whole file. A range is
// checked against the file's size after the bucket says it, with an end past the size taken as the end (RFC 9110, 14.1.2).
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** No track has this slug, or its file is not under tracks/. */
export class AudioFileNotFound extends Data.TaggedError("AudioFileNotFound") {
	readonly say = "not found";
}

/** The range starts at or past the end of the file, or ends before it starts. */
export class AudioRangeUnsatisfiable extends Data.TaggedError(
	"AudioRangeUnsatisfiable",
) {
	readonly say = "Requested range not satisfiable";
}

/** An audio-tracks entry as the route needs it. */
export type AudioTrack = { readonly id: string; readonly file: string };

type Given = { readonly found: boolean; readonly key: string };

/** The one folder the portfolio serves from: a key must start with exactly this, case and all, with nothing normalised. */
const PUBLIC_FOLDER = "tracks/";

export const decideAudioFile = alwaysWrites({
	name: "choose the portfolio track file a visitor asked for",
	given: (
		request: { readonly slug: string },
		tracks: readonly AudioTrack[],
	): Given => {
		const track = tracks.find((entry) => entry.id === request.slug);

		return { found: track !== undefined, key: track?.file ?? "" };
	},
	refusals: [
		unless(
			term("a track has this slug", (given: Given) => given.found),
			() => new AudioFileNotFound(),
		),
		unless(
			term(
				"the file's key starts with tracks/",
				(given: Given) => given.key.startsWith(PUBLIC_FOLDER),
			),
			() => new AudioFileNotFound(),
		),
	],
	writes: (given) => given.key,
	writesText: "the key of the file to stream",
});

/** What the Range header asks for: the whole file, or the bytes from a start to an end (absent: to the end). */
export type AudioReadPlan =
	| { readonly kind: "whole" }
	| {
			readonly kind: "bytes";
			readonly start: number;
			readonly end: number | null;
	  };

/** Reads the Range header: a plain `bytes=<start>-<end?>` is a range, and everything else is a whole read. */
export const readAudioRange = (header: string | null): AudioReadPlan => {
	if (!header) return { kind: "whole" };
	const match = /^bytes=(\d+)-(\d*)$/.exec(header);

	if (!match) return { kind: "whole" };
	const start = Number.parseInt(match[1], 10);
	const end = match[2] ? Number.parseInt(match[2], 10) : null;

	if (Number.isNaN(start) || (end !== null && Number.isNaN(end)))
		return { kind: "whole" };

	return { kind: "bytes", start, end };
};

type RangeGiven = {
	readonly satisfiable: boolean;
	readonly offset: number;
	readonly length: number;
};

export const decideAudioRange = alwaysWrites({
	name: "choose the bytes of a portfolio track a range asks for",
	given: (
		request: { readonly start: number; readonly end: number | null },
		facts: { readonly size: number },
	): RangeGiven => {
		const end = Math.min(request.end ?? facts.size - 1, facts.size - 1);

		return {
			satisfiable: request.start <= end && request.start < facts.size,
			offset: request.start,
			length: end - request.start + 1,
		};
	},
	refusals: [
		unless(
			term(
				"the range starts inside the file and does not end before it starts",
				(given: RangeGiven) => given.satisfiable,
			),
			() => new AudioRangeUnsatisfiable(),
		),
	],
	writes: (given) => ({ offset: given.offset, length: given.length }),
	writesText: "the offset and length to read",
});
