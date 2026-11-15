// Which file of the music catalog a listener asked for. The recording is found by its id in the catalog the route read
// (production holds the public entries only), and the version must be one the recording has. The file's key must be a
// public one: the catalog's own schema holds every key under music/, so this guard is a second wall against a private
// object (a studio file or a software visual) ever being served from the public route. A recording that does not exist, a
// version it lacks and a name that is not a version all read as one 404, before the bucket is asked.
import * as Data from "effect/Data";
import type { Recording } from "../../lib/music-catalog";
import { alwaysWrites, term, unless } from "../terms";

/** The versions a recording can have, in the order the catalog schema lists them. */
export const MUSIC_VERSIONS = ["master", "mix", "unmixed", "video"] as const;

export type MusicVersion = (typeof MUSIC_VERSIONS)[number];

/** No such recording, no such version, or the recording lacks it. */
export class MusicFileNotFound extends Data.TaggedError("MusicFileNotFound") {
	readonly say = "Not found";
}

/** The file's key is a private object's, which the public route never serves. */
export class MusicFileWithheld extends Data.TaggedError("MusicFileWithheld") {
	readonly say = "Media unavailable";
}

/** The file to read: its key in the bucket and the media type the catalog gives it. */
export type MusicAsset = { readonly key: string; readonly type: string };

type Given = MusicAsset & { readonly found: boolean };

/** Keys under these folders belong to a client's project, never to the public catalog. */
const isPrivateKey = (key: string) =>
	key.startsWith("studio/") || key.startsWith("software/");

export const decideMusicFile = alwaysWrites({
	name: "choose the catalog file a listener asked for",
	given: (
		request: {
			readonly id: string | undefined;
			readonly version: MusicVersion | null;
		},
		recordings: readonly Recording[],
	): Given => {
		const track = recordings.find((recording) => recording.id === request.id);

		const asset = request.version
			? track?.versions[request.version]
			: undefined;

		// `found` is false for every missing piece; the key and type are then never read.
		return {
			found: asset !== undefined,
			key: asset?.key ?? "",
			type: asset?.type ?? "",
		};
	},
	refusals: [
		unless(
			term(
				"the recording has the version asked for",
				(given: Given) => given.found,
			),
			() => new MusicFileNotFound(),
		),
		unless(
			term(
				"the file is not a private object",
				(given: Given) => !isPrivateKey(given.key),
			),
			() => new MusicFileWithheld(),
		),
	],
	writes: (given): MusicAsset => ({ key: given.key, type: given.type }),
	writesText: "the key and media type of the file to stream",
});
