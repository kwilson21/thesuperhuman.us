// The edge of the media routes: what a path parameter must be to name a file. Effect Schema readers; a value that is not
// one reads as `null`, and the route or rule answers it as the unknown file it is (a 404 that names nothing).
import * as Schema from "effect/Schema";
import { MUSIC_VERSIONS, type MusicVersion } from "./rules/music-file";

const version = Schema.Literals(MUSIC_VERSIONS);

/** A portfolio track's slug: lower-case letters, digits and dashes, as the audio route has always read it. */
const slug = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/));

/** The version of a recording a path names, or `null` when it is not one of the four. */
export const readVersion = (raw: string | undefined): MusicVersion | null =>
	Schema.is(version)(raw) ? raw : null;

/** The slug a path names, or `null` when it is missing or not made of lower-case letters, digits and dashes. */
export const readSlug = (raw: string | undefined): string | null =>
	Schema.is(slug)(raw) ? raw : null;
