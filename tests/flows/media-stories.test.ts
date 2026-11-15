import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";
import { readAudioFile } from "../../src/server/flows/audio-file";
import { readMusicFile } from "../../src/server/flows/music-file";
import { readOgVideo } from "../../src/server/flows/og-video";
import {
	liveMediaObjects,
	liveOgAssets,
	OgAssets,
} from "../../src/server/services";
import { clearSuppliedEntries, supplyEntries } from "../helpers/astro-content";
import { double, partial } from "../helpers/doubles";
import { bytesStream } from "../helpers/r2";

// The three media flows as stories, run against the real catalog (the old-news recording) and a bucket or assets double
// that says what it was asked. A story names what the visitor asked for and what was read, or the named failure.

const KEY = "music/old-news-recording/master-cda232160a069f03.mp3";
const SIZE = 64;

type Calls = string[];

/** A bucket holding `held` keys of SIZE bytes; each call is noted as `head KEY` or `get KEY offset-length`. */
const bucket = (
	held: readonly string[],
	calls: Calls,
	options: { vanishes?: boolean; throws?: "head" | "get" } = {},
) =>
	double<R2Bucket>({
		head: async (key: string) => {
			calls.push(`head ${key}`);

			if (options.throws === "head") throw new Error("head failed");

			return held.includes(key) ? partial<R2Object>({ size: SIZE }) : null;
		},
		get: async (key: string, range?: R2GetOptions) => {
			calls.push(
				`get ${key}${
					range?.range && "offset" in range.range
						? ` ${range.range.offset}-${range.range.length}`
						: ""
				}`,
			);

			if (options.throws === "get") throw new Error("get failed");

			return held.includes(key) && !options.vanishes
				? partial<R2ObjectBody>({
						body: bytesStream(new Uint8Array(SIZE)),
						size: SIZE,
					})
				: null;
		},
	});

/** A failure's tag and the one fact it may carry. */
type Named = {
	readonly _tag: string;
	readonly size?: number;
	readonly status?: number;
};

const facts = (failure: Named) => ({
	size: failure.size,
	status: failure.status,
});

/** What the flow answered: its value (with the body reduced to whether there is one) or the failure it ended with. */
const outcome = <V extends { body?: ReadableStream | null }, E extends Named>(
	program: Effect.Effect<V, E>,
) =>
	Effect.runPromise(
		Effect.match(program, {
			onFailure: (failure) => ({ failed: failure._tag, ...facts(failure) }),
			onSuccess: (value) => ({
				read: { ...value, body: value.body ? "bytes" : null },
			}),
		}),
	);

afterEach(() => clearSuppliedEntries());

const music = (
	over: {
		id?: string;
		version?: "master" | "mix" | "unmixed" | "video" | null;
		method?: string;
		range?: string | null;
	},
	services: ReturnType<typeof liveMediaObjects>,
) =>
	outcome(
		readMusicFile({
			id: over.id ?? "old-news-recording",
			version: over.version === undefined ? "master" : over.version,
			method: over.method ?? "GET",
			range: over.range ?? null,
		}).pipe(Effect.provideContext(services)),
	);

describe("a listener reads a recording's file", () => {
	it("reads the object whole: its size first, then its bytes", async () => {
		const calls: Calls = [];

		expect(await music({}, liveMediaObjects(bucket([KEY], calls)))).toEqual({
			read: { type: "audio/mpeg", size: SIZE, slice: null, body: "bytes" },
		});

		expect(calls).toEqual([`head ${KEY}`, `get ${KEY}`]);
	});

	it("reads only the bytes a range names", async () => {
		const calls: Calls = [];

		const answer = await music(
			{ range: "bytes=16-31" },
			liveMediaObjects(bucket([KEY], calls)),
		);

		expect(answer).toMatchObject({
			read: { slice: { offset: 16, length: 16 } },
		});
		expect(calls).toEqual([`head ${KEY}`, `get ${KEY} 16-16`]);
	});

	it("reads no bytes for HEAD, whatever the header says", async () => {
		const calls: Calls = [];

		expect(
			await music(
				{ method: "HEAD", range: "bytes=500-" },
				liveMediaObjects(bucket([KEY], calls)),
			),
		).toEqual({
			read: { type: "audio/mpeg", size: SIZE, slice: null, body: null },
		});

		expect(calls).toEqual([`head ${KEY}`]);
	});

	it("names the size when the range cannot be served, and reads no bytes", async () => {
		const calls: Calls = [];

		const answer = await music(
			{ range: "bytes=64-" },
			liveMediaObjects(bucket([KEY], calls)),
		);

		expect(answer).toEqual({ failed: "RangeOutsideFile", size: SIZE });

		expect(calls).toEqual([`head ${KEY}`]);
	});

	it.each([
		["an object that is not there", bucket([], [])],
		[
			"an object that vanishes between the size and the bytes",
			bucket([KEY], [], { vanishes: true }),
		],
	])("answers a missing file for %s", async (_name, held) => {
		expect(await music({}, liveMediaObjects(held))).toEqual({
			failed: "MusicObjectMissing",
		});
	});

	it("refuses what the catalog does not name before the bucket is asked, bound or not", async () => {
		const calls: Calls = [];

		const unbound = await music({ id: "nothing" }, liveMediaObjects(undefined));

		const bound = await music(
			{ version: "unmixed" },
			liveMediaObjects(bucket([KEY], calls)),
		);

		expect(unbound).toEqual({ failed: "MusicFileNotFound" });
		expect(bound).toEqual({ failed: "MusicFileNotFound" });
		expect(calls).toEqual([]);
	});

	it("names a missing bucket, and a failing one with its cause", async () => {
		expect(await music({}, liveMediaObjects(undefined))).toEqual({
			failed: "MediaBucketNotBound",
		});

		const head = await music(
			{},
			liveMediaObjects(bucket([KEY], [], { throws: "head" })),
		);

		const get = await music(
			{},
			liveMediaObjects(bucket([KEY], [], { throws: "get" })),
		);

		expect(head).toEqual({ failed: "MediaObjectFailed" });
		expect(get).toEqual({ failed: "MediaObjectFailed" });
	});
});

const track = (slug: string, file: string) => ({
	id: slug,
	collection: "audio-tracks",
	data: { file },
});

const audio = (
	range: string | null,
	services: ReturnType<typeof liveMediaObjects>,
	slug = "slow-burn",
) =>
	outcome(readAudioFile({ slug, range }).pipe(Effect.provideContext(services)));

describe("a visitor reads a portfolio track's file", () => {
	const TRACK = "tracks/slow-burn.mp3";

	const withTracks = () =>
		supplyEntries("audio-tracks", [
			track("slow-burn", TRACK),
			track("inside", "studio/projects/r1/f1.mp3"),
		]);

	it("reads a whole file in one call, without asking its size", async () => {
		withTracks();
		const calls: Calls = [];

		expect(await audio(null, liveMediaObjects(bucket([TRACK], calls)))).toEqual(
			{
				read: { size: SIZE, slice: null, body: "bytes" },
			},
		);

		expect(calls).toEqual([`get ${TRACK}`]);
	});

	it("reads a whole file for a range it does not understand", async () => {
		withTracks();
		const calls: Calls = [];

		await audio("bytes=-8", liveMediaObjects(bucket([TRACK], calls)));
		expect(calls).toEqual([`get ${TRACK}`]);
	});

	it("asks the size, then reads the bytes a range names, taking an end past the size as the end", async () => {
		withTracks();
		const calls: Calls = [];

		const answer = await audio(
			"bytes=60-99",
			liveMediaObjects(bucket([TRACK], calls)),
		);

		expect(answer).toMatchObject({
			read: { slice: { offset: 60, length: 4 } },
		});
		expect(calls).toEqual([`head ${TRACK}`, `get ${TRACK} 60-4`]);
	});

	it("names the size when the range starts past the end", async () => {
		withTracks();

		expect(
			await audio("bytes=64-", liveMediaObjects(bucket([TRACK], []))),
		).toEqual({ failed: "AudioRangeOutsideFile", size: SIZE });
	});

	it("answers one 404 for an unknown slug and a private file, and never asks the bucket", async () => {
		withTracks();
		const calls: Calls = [];

		for (const slug of ["unknown", "inside"])
			expect(
				await audio(null, liveMediaObjects(bucket([TRACK], calls)), slug),
			).toEqual({ failed: "AudioFileNotFound" });

		expect(calls).toEqual([]);
	});

	it("answers a missing file whether the size or the bytes come back empty", async () => {
		withTracks();

		expect(await audio(null, liveMediaObjects(bucket([], [])))).toEqual({
			failed: "AudioObjectMissing",
		});

		expect(await audio("bytes=0-9", liveMediaObjects(bucket([], [])))).toEqual({
			failed: "AudioObjectMissing",
		});

		expect(
			await audio(
				"bytes=0-9",
				liveMediaObjects(bucket([TRACK], [], { vanishes: true })),
			),
		).toEqual({ failed: "AudioObjectMissing" });
	});

	it("names a missing bucket after the request is judged, and a failing one", async () => {
		withTracks();

		expect(await audio(null, liveMediaObjects(undefined))).toEqual({
			failed: "MediaBucketNotBound",
		});

		expect(await audio(null, liveMediaObjects(undefined), "unknown")).toEqual({
			failed: "AudioFileNotFound",
		});

		expect(
			await audio(
				null,
				liveMediaObjects(bucket([TRACK], [], { throws: "get" })),
			),
		).toEqual({ failed: "MediaObjectFailed" });
	});
});

const VIDEOS = ["/og/home-aaaaaaaaaa.mp4"];
const BYTES = new Uint8Array(Array.from({ length: SIZE }, (_, index) => index));

const assetsAnswering = (
	status: number,
	asked: string[],
	options: { rejects?: boolean } = {},
) =>
	liveOgAssets(
		double<Fetcher>({
			fetch: async (input: RequestInfo | URL) => {
				asked.push(String(input));

				if (options.rejects) throw new Error("assets down");

				return new Response(status === 404 ? "no" : BYTES, { status });
			},
		}),
	);

const og = (
	over: { name?: string; method?: string; range?: string | null },
	services: Context.Context<OgAssets>,
) =>
	Effect.runPromise(
		Effect.match(
			readOgVideo({
				name: "name" in over ? over.name : "home-aaaaaaaaaa",
				videos: VIDEOS,
				requestUrl: "https://thesuperhuman.us/og/home-aaaaaaaaaa.mp4",
				method: over.method ?? "GET",
				range: over.range ?? null,
			}).pipe(Effect.provideContext(services)),
			{
				onFailure: (failure) => ({ failed: failure._tag, ...facts(failure) }),
				onSuccess: ({ size, slice, bytes }) => ({
					read: { size, slice, length: bytes.byteLength },
				}),
			},
		),
	);

describe("a crawler or browser reads a link preview video", () => {
	it("asks the assets for the raw file at the address the request came to", async () => {
		const asked: string[] = [];

		expect(await og({}, assetsAnswering(200, asked))).toEqual({
			read: { size: SIZE, slice: null, length: SIZE },
		});

		expect(asked).toEqual([
			"https://thesuperhuman.us/og/raw/home-aaaaaaaaaa.mp4",
		]);
	});

	it("slices a range, and ignores one for HEAD", async () => {
		expect(
			await og({ range: "bytes=0-9" }, assetsAnswering(200, [])),
		).toMatchObject({ read: { slice: { offset: 0, length: 10 } } });

		expect(
			await og(
				{ method: "HEAD", range: "bytes=500-" },
				assetsAnswering(200, []),
			),
		).toMatchObject({ read: { slice: null } });
	});

	it("names the size when the range cannot be served", async () => {
		expect(await og({ range: "bytes=64-" }, assetsAnswering(200, []))).toEqual({
			failed: "RangeOutsideFile",
			size: SIZE,
		});
	});

	it("answers a missing file for a 404 and names any other failure with its status", async () => {
		expect(await og({}, assetsAnswering(404, []))).toEqual({
			failed: "OgVideoMissing",
		});

		for (const status of [403, 500, 502])
			expect(await og({}, assetsAnswering(status, []))).toEqual({
				failed: "AssetsAnswered",
				status,
			});
	});

	it("names a failing fetch", async () => {
		const answer = await og({}, assetsAnswering(200, [], { rejects: true }));

		expect(answer).toEqual({ failed: "AssetsFailed" });
	});

	it("refuses a name that is not rendered before the assets are asked, bound or not", async () => {
		const asked: string[] = [];

		expect(await og({ name: "nothing" }, assetsAnswering(200, asked))).toEqual({
			failed: "OgVideoNotFound",
		});

		expect(await og({ name: "nothing" }, liveOgAssets(undefined))).toEqual({
			failed: "OgVideoNotFound",
		});

		expect(asked).toEqual([]);
	});

	it("names missing assets for a name that is rendered", async () => {
		expect(await og({}, liveOgAssets(undefined))).toEqual({
			failed: "AssetsNotBound",
		});
	});
});
