import { afterEach, vi } from "vitest";
import type { JsonObject } from "../helpers/json";
import { clearSuppliedEntries, supplyEntries } from "../helpers/astro-content";
import { GET, HEAD } from "~/pages/music/file/[id]/[version]";
import {
	asOwner,
	asVisitor,
	defineCorpus,
	type Case,
	type Handler,
	type R2Seed,
	type Step,
} from "./harness";
import { BODY, CONDITIONALS, RANGES } from "./areas/media";

// The golden corpus for GET and HEAD /music/file/[id]/[version]: the public player and the lyric video stream a
// recording's audio or video from R2. The route finds the recording in the music catalog (src/content, through
// loadMusicCatalog), takes the version's key and media type from it and hands both to streamMusic
// (src/lib/music-media.ts), which heads the object, reads the Range header with mediaRange and answers.
//
// The route reads no cookie, session or database. It makes no write and no log line, so every case's effects are the
// R2 head and get calls and nothing else. Production hides draft entries (loadMusicCatalog hides them unless
// import.meta.env.DEV), so every case runs as production unless its name says "in development".
//
// Every response branch and the cases that reach it:
//
//   404 "Not found"          an unknown recording id, the id in capitals, a release id, a prototype name (__proto__,
//                            constructor), an empty id, no id param; no version param, an empty version, an unknown
//                            version name, a valid name the recording lacks (unmixed), a version in capitals, a
//                            prototype name; a draft recording in production
//   404 "Media unavailable"  the object is missing from R2 (head finds nothing), the object vanishes between head and get
//   200 full body            master, mix and video, from the real catalog; the media type is the catalog's, never R2's;
//                            cookies, authorization and conditional request headers are ignored (there is no etag, so no 304)
//   206 partial body        a first, middle, open-ended, suffix, one byte, last byte, an end past the size
//   416 content-range */n   a start at or past the size, a start after the end, a zero suffix, "bytes=-", another unit,
//                            two ranges, capitals, a space, letters, an empty object asked for any range
//   HEAD                     headers only, content-length of the whole file, Range ignored, missing object 404
//   draft in development     a draft recording is served by a development build
//   R2 outage                head throws, get throws (with and without a range), head throws on HEAD, no AUDIO binding
//   catalog                  a catalog that does not validate; a catalog that holds only drafts
//   sequences                two reads, a range read after a whole read, another actor's cookie

const KEYS = {
	master: "music/old-news-recording/master-cda232160a069f03.mp3",
	mix: "music/old-news-recording/mix-e0df4fabd704edc5.mp3",
	video: "music/old-news-recording/video-44555c710ec8f444.mp4",
} as const;

const SEED: R2Seed = {
	[KEYS.master]: { body: BODY },
	[KEYS.mix]: { body: BODY },
	[KEYS.video]: { body: BODY },
};

/** Runs the route as production does: draft catalog entries are hidden. */
const production =
	(route: Handler): Handler =>
	async (context) => {
		vi.stubEnv("DEV", false);

		try {
			return await route(context);
		} finally {
			vi.unstubAllEnvs();
		}
	};

afterEach(() => clearSuppliedEntries());

const read = (
	id: string | undefined,
	version: string | undefined,
	extra: Partial<Step> = {},
): Step => ({
	as: asVisitor(),
	method: "GET",
	path: `/music/file/${id ?? ""}/${version ?? ""}`,
	params: { id, version },
	...extra,
});

const master = (extra: Partial<Step> = {}) =>
	read("old-news-recording", "master", extra);

const ranged = (range: string, extra: Partial<Step> = {}) =>
	master({ headers: { range }, ...extra });

const open = (
	name: string,
	steps: readonly Step[] = [master()],
	extra: Partial<Case> = {},
): Case => ({ name, steps, r2: { seed: SEED }, ...extra });

const recording = (id: string, over: JsonObject = {}): JsonObject => ({
	id,
	title: "A song",
	artist: "Kazon",
	duration: 100,
	visibility: "public",
	credits: [],
	services: [],
	versions: {
		master: { key: `music/${id}/master-aa.mp3`, type: "audio/mpeg" },
		unmixed: { key: `music/${id}/unmixed-bb.mp3`, type: "audio/mpeg" },
	},
	...over,
});

const catalog = (...recordings: JsonObject[]) => {
	supplyEntries(
		"recordings",
		recordings.map((data) => ({
			id: String(data.id),
			collection: "recordings",
			data,
		})),
	);
	supplyEntries("releases", []);
	supplyEntries("audio-examples", []);
};

const cases: Case[] = [
	// the real catalog
	open("master"),
	open("mix", [read("old-news-recording", "mix")]),
	open("video", [read("old-news-recording", "video")]),
	open("a query string is ignored", [
		master({ path: "/music/file/old-news-recording/master?download=1&x=1" }),
	]),
	open("an owner's session is ignored", [master({ as: asOwner() })]),
	// ids and versions
	open("an unknown recording", [read("nothing-here", "master")]),
	open("the recording id in capitals", [read("OLD-NEWS-RECORDING", "master")]),
	open("a release id", [read("old-news-single", "master")]),
	open("a release slug", [read("old-news", "master")]),
	open("a prototype name as the id", [read("__proto__", "master")]),
	open("constructor as the id", [read("constructor", "master")]),
	open("an empty id", [read("", "master")]),
	open("no id param", [
		master({ params: { version: "master" }, path: "/music/file//master" }),
	]),
	open("no version param", [master({ params: { id: "old-news-recording" } })]),
	open("an empty version", [read("old-news-recording", "")]),
	open("an unknown version", [read("old-news-recording", "stems")]),
	open("a version the recording lacks", [
		read("old-news-recording", "unmixed"),
	]),
	open("the version in capitals", [read("old-news-recording", "MASTER")]),
	open("a prototype name as the version", [
		read("old-news-recording", "__proto__"),
	]),
	open("constructor as the version", [
		read("old-news-recording", "constructor"),
	]),
	open("toString as the version", [read("old-news-recording", "toString")]),
	open("a version with a path in it", [
		read("old-news-recording", "master/../mix"),
	]),
	// R2 content
	open("the object is missing from R2", [master()], { r2: { seed: {} } }),
	open("only another version is in R2", [master()], {
		r2: { seed: { [KEYS.mix]: { body: BODY } } },
	}),
	open("the object vanishes between head and get", [master()], {
		r2: { seed: SEED, vanishAfterHead: [KEYS.master] },
	}),
	open("R2's own content type is ignored", [master()], {
		r2: {
			seed: {
				[KEYS.master]: {
					body: BODY,
					httpMetadata: { contentType: "text/html", cacheControl: "no-store" },
				},
			},
		},
	}),
	open("an empty object", [master()], {
		r2: { seed: { [KEYS.master]: { body: "" } } },
	}),
	open("an empty object asked for a range", [ranged("bytes=0-")], {
		r2: { seed: { [KEYS.master]: { body: "" } } },
	}),
	open("an empty object, HEAD", [master({ method: "HEAD" })], {
		r2: { seed: { [KEYS.master]: { body: "" } } },
	}),
	// ranges
	...RANGES.map(([name, header]) => open(`range: ${name}`, [ranged(header)])),
	open("a range on the video", [
		read("old-news-recording", "video", { headers: { range: "bytes=8-23" } }),
	]),
	// conditional requests and other headers
	...CONDITIONALS.map(([name, headers]) =>
		open(`header: ${name}`, [master({ headers })]),
	),
	// HEAD
	open("HEAD", [master({ method: "HEAD" })]),
	open("HEAD of the video", [
		read("old-news-recording", "video", { method: "HEAD" }),
	]),
	open("HEAD with a Range header ignores it", [
		ranged("bytes=0-9", { method: "HEAD" }),
	]),
	open("HEAD with a range that GET would refuse", [
		ranged("bytes=64-", { method: "HEAD" }),
	]),
	open("HEAD with a malformed range", [
		ranged("items=0-5", { method: "HEAD" }),
	]),
	open("the HEAD export is served by its own handler", [
		master({ method: "HEAD", handler: production(HEAD) }),
	]),
	open("HEAD with the object missing", [master({ method: "HEAD" })], {
		r2: { seed: {} },
	}),
	open("HEAD of an unknown recording", [
		read("nothing-here", "master", { method: "HEAD" }),
	]),
	open("HEAD of an unknown version", [
		read("old-news-recording", "stems", { method: "HEAD" }),
	]),
	// the catalog
	open(
		"a draft recording is hidden in production",
		[read("draft-song", "master")],
		{
			setup: () => catalog(recording("draft-song", { visibility: "draft" })),
			r2: { seed: { "music/draft-song/master-aa.mp3": { body: BODY } } },
		},
	),
	open(
		"a draft recording is served in development",
		[read("draft-song", "master", { handler: GET })],
		{
			setup: () => catalog(recording("draft-song", { visibility: "draft" })),
			r2: { seed: { "music/draft-song/master-aa.mp3": { body: BODY } } },
		},
	),
	open("the real recording is not in a catalog of drafts", [master()], {
		setup: () => catalog(recording("draft-song", { visibility: "draft" })),
	}),
	open(
		"a public recording with an unmixed version",
		[read("a-song", "unmixed")],
		{
			setup: () => catalog(recording("a-song")),
			r2: { seed: { "music/a-song/unmixed-bb.mp3": { body: BODY } } },
		},
	),
	open("a public recording without a video", [read("a-song", "video")], {
		setup: () => catalog(recording("a-song")),
	}),
	open("a catalog entry that does not validate", [master()], {
		setup: () => catalog(recording("a-song", { duration: -1 })),
	}),
	open(
		"a catalog entry with a private object key",
		[read("a-song", "master")],
		{
			setup: () =>
				catalog(
					recording("a-song", {
						versions: {
							master: { key: "studio/projects/r1/f1.mp3", type: "audio/mpeg" },
						},
					}),
				),
			r2: { seed: { "studio/projects/r1/f1.mp3": { body: BODY } } },
		},
	),
	// outages
	open("R2 head fails", [master()], { r2: { seed: SEED, fails: ["head"] } }),
	open("R2 get fails", [master()], { r2: { seed: SEED, fails: ["get"] } }),
	open("R2 get fails on a range", [ranged("bytes=0-9")], {
		r2: { seed: SEED, fails: ["get"] },
	}),
	open("R2 head fails on HEAD", [master({ method: "HEAD" })], {
		r2: { seed: SEED, fails: ["head"] },
	}),
	open(
		"R2 get fails on HEAD, which never reads the body",
		[master({ method: "HEAD" })],
		{
			r2: { seed: SEED, fails: ["get"] },
			mustNotFire: [
				{ trigger: "r2 AUDIO fails get", reason: "HEAD never reads the body" },
			],
		},
	),
	open(
		"R2 fails for an unknown recording, which never reaches it",
		[read("nothing-here", "master")],
		{
			r2: { seed: SEED, fails: ["head", "get"] },
			mustNotFire: [
				{
					trigger: "r2 AUDIO fails head",
					reason: "an unknown recording is refused before R2",
				},
				{
					trigger: "r2 AUDIO fails get",
					reason: "an unknown recording is refused before R2",
				},
			],
		},
	),
	open("no audio bucket", [master()], { r2: { missing: true } }),
	open(
		"no audio bucket for an unknown recording",
		[read("nothing-here", "master")],
		{
			r2: { missing: true },
		},
	),
	open("no audio bucket for HEAD", [master({ method: "HEAD" })], {
		r2: { missing: true },
	}),
	// sequences
	open("two whole reads", [master(), master({ advanceMs: 1000 })]),
	open("a whole read, then a range, then HEAD", [
		master(),
		ranged("bytes=10-19", { advanceMs: 1000 }),
		master({ method: "HEAD", advanceMs: 1000 }),
	]),
];

defineCorpus("music-file", production(GET), cases);
