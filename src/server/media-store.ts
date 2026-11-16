// What the media routes read from the content collections: the music catalog (public entries in production, every entry in a
// development server) and the audio-tracks collection. There is no database and no statement here. A read that throws
// (a catalog entry that does not validate, a collection that cannot be loaded) is a named failure; the route logs its cause
// once through `logUnexpected` and answers its fixed 500.
import { getCollection } from "astro:content";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Recording } from "../lib/music-catalog";
import { loadMusicCatalog } from "../lib/music-content";
import type { AudioTrack } from "./rules/audio-file";

/** A collection read failed. The route logs the failure once and answers its fixed 500. */
export class MediaCatalogFailed extends Data.TaggedError("MediaCatalogFailed")<{
	readonly failure: unknown;
}> {}

/** The recordings the music catalog shows (`import.meta.env.DEV` decides about drafts, as it does for every page). */
export const readRecordings = (): Effect.Effect<
	readonly Recording[],
	MediaCatalogFailed
> =>
	Effect.tryPromise({
		try: async () => (await loadMusicCatalog()).recordings,
		catch: (failure) => new MediaCatalogFailed({ failure }),
	});

/** The audio-tracks entries, each with the slug it is served under and its file's key. */
export const readAudioTracks = (): Effect.Effect<
	readonly AudioTrack[],
	MediaCatalogFailed
> =>
	Effect.tryPromise({
		try: async () =>
			(await getCollection("audio-tracks")).map((entry) => ({
				id: entry.id,
				file: entry.data.file,
			})),
		catch: (failure) => new MediaCatalogFailed({ failure }),
	});
