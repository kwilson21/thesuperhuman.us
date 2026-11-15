import { describe, expect, it } from "vitest";
import type { Recording } from "../../src/lib/music-catalog";
import { readSlug, readVersion } from "../../src/server/media-input";
import {
	AudioRangeUnsatisfiable,
	decideAudioFile,
	decideAudioRange,
	readAudioRange,
} from "../../src/server/rules/audio-file";
import { decideMediaRange } from "../../src/server/rules/media-range";
import { decideMusicFile } from "../../src/server/rules/music-file";
import { decideOgVideo, judgeOgSource } from "../../src/server/rules/og-video";
import { answerOfRun, done, refuse } from "../helpers/rule-answers";

// The rules of the three media routes as stories: what a request names, and which bytes a Range header asks for.

const recording = (versions: Recording["versions"]): Recording => ({
	id: "a-song",
	title: "A song",
	artist: "Kazon",
	duration: 100,
	visibility: "public",
	credits: [],
	services: [],
	versions,
});

const song = recording({
	master: { key: "music/a-song/master-aa.mp3", type: "audio/mpeg" },
	video: { key: "music/a-song/video-bb.mp4", type: "video/mp4" },
});

describe("which catalog file a listener asked for", () => {
	it("names the key and type of a version the recording has", async () => {
		expect(
			await answerOfRun(
				decideMusicFile.decide({ id: "a-song", version: "video" }, [song]),
			),
		).toEqual(done({ key: "music/a-song/video-bb.mp4", type: "video/mp4" }));
	});

	it.each([
		["an unknown recording", { id: "other", version: "master" as const }],
		[
			"a version the recording lacks",
			{ id: "a-song", version: "mix" as const },
		],
		["a name that is not a version", { id: "a-song", version: null }],
		["no id", { id: undefined, version: "master" as const }],
	])("refuses %s as one 404", async (_name, request) => {
		expect(await answerOfRun(decideMusicFile.decide(request, [song]))).toEqual(
			refuse("MusicFileNotFound", "Not found"),
		);
	});

	it.each(["studio/projects/r1/f1.mp3", "software/r1/u1/visual.png"])(
		"never serves a private object: %s",
		async (key) => {
			const private_ = recording({ master: { key, type: "audio/mpeg" } });

			expect(
				await answerOfRun(
					decideMusicFile.decide({ id: "a-song", version: "master" }, [
						private_,
					]),
				),
			).toEqual(refuse("MusicFileWithheld", "Media unavailable"));
		},
	);
});

describe("which bytes a media read answers with", () => {
	const ask = (method: string, range: string | null, size = 100) =>
		answerOfRun(decideMediaRange.decide({ method, range }, { size }));

	it("reads the whole file without a header", async () => {
		expect(await ask("GET", null)).toEqual(done(null));
	});

	it("reads the bytes a valid header names", async () => {
		expect(await ask("GET", "bytes=10-19")).toEqual(
			done({ offset: 10, length: 10 }),
		);

		expect(await ask("GET", "bytes=-20")).toEqual(
			done({ offset: 80, length: 20 }),
		);
	});

	it("never reads the header of a HEAD request", async () => {
		expect(await ask("HEAD", "bytes=500-")).toEqual(done(null));
	});

	it.each([
		"bytes=100-",
		"bytes=0-1,4-5",
		"items=0-5",
		"bytes=-0",
		"bytes=9-3",
	])("refuses %s", async (range) => {
		expect(await ask("GET", range)).toEqual(
			refuse("RangeUnsatisfiable", "Requested range not satisfiable"),
		);
	});

	it("refuses any range of an empty file", async () => {
		expect((await ask("GET", "bytes=0-", 0)).kind).toBe("refuse");
	});
});

describe("which portfolio track file a visitor asked for", () => {
	const tracks = [
		{ id: "slow-burn", file: "tracks/slow-burn.mp3" },
		{ id: "inside", file: "studio/projects/r1/f1.mp3" },
		{ id: "visual", file: "software/r1/u1/visual.png" },
	];

	it("names the key of a public track", async () => {
		expect(
			await answerOfRun(decideAudioFile.decide({ slug: "slow-burn" }, tracks)),
		).toEqual(done("tracks/slow-burn.mp3"));
	});

	it.each(["unknown", "inside", "visual"])(
		"answers one 404 for %s",
		async (slug) => {
			expect(
				await answerOfRun(decideAudioFile.decide({ slug }, tracks)),
			).toEqual(refuse("AudioFileNotFound", "not found"));
		},
	);
});

describe("the portfolio audio Range header", () => {
	it.each([
		[null, { kind: "whole" }],
		["", { kind: "whole" }],
		["bytes=-8", { kind: "whole" }],
		["bytes=0-5,10-15", { kind: "whole" }],
		["items=0-5", { kind: "whole" }],
		["BYTES=0-5", { kind: "whole" }],
		["bytes=a-b", { kind: "whole" }],
		["bytes=5-", { kind: "bytes", start: 5, end: null }],
		["bytes=5-9", { kind: "bytes", start: 5, end: 9 }],
		["bytes=00-05", { kind: "bytes", start: 0, end: 5 }],
	])("reads %s", (header, plan) => {
		expect(readAudioRange(header)).toEqual(plan);
	});
});

describe("which bytes a portfolio range names", () => {
	const ask = (start: number, end: number | null, size = 64) =>
		answerOfRun(decideAudioRange.decide({ start, end }, { size }));

	it("reads the bytes named", async () => {
		expect(await ask(16, 31)).toEqual(done({ offset: 16, length: 16 }));
		expect(await ask(48, null)).toEqual(done({ offset: 48, length: 16 }));
	});

	it("takes an end past the size as the end", async () => {
		expect(await ask(0, 1000)).toEqual(done({ offset: 0, length: 64 }));
		expect(await ask(60, 99)).toEqual(done({ offset: 60, length: 4 }));
	});

	it.each([
		[64, null],
		[100, 120],
		[10, 5],
	])("refuses a start of %s and an end of %s", async (start, end) => {
		expect(await ask(start, end)).toEqual(
			refuse(
				new AudioRangeUnsatisfiable()._tag,
				"Requested range not satisfiable",
			),
		);
	});

	it("refuses any range of an empty file", async () => {
		expect((await ask(0, null, 0)).kind).toBe("refuse");
	});
});

describe("which link preview video a request names", () => {
	const videos = ["/og/home-aaaaaaaaaa.mp4", "/og/about-bbbbbbbbbb.mp4"];

	it("names a rendered scene's video", async () => {
		expect(
			await answerOfRun(
				decideOgVideo.decide({ name: "about-bbbbbbbbbb" }, videos),
			),
		).toEqual(done("about-bbbbbbbbbb"));
	});

	it.each([
		undefined,
		"",
		"home",
		"home-aaaaaaaaaa.mp4",
		"../raw/x",
		"HOME-AAAAAAAAAA",
	])("answers one 404 for %s", async (name) => {
		expect(await answerOfRun(decideOgVideo.decide({ name }, videos))).toEqual(
			refuse("OgVideoNotFound", "Not found"),
		);
	});

	it("serves a success, calls a 404 missing, and calls any other failure the assets' fault", async () => {
		const judge = (status: number) =>
			answerOfRun(
				judgeOgSource.decide(null, {
					status,
					ok: status >= 200 && status < 300,
				}),
			);

		expect((await judge(200)).kind).toBe("done");
		expect(await judge(404)).toEqual(refuse("OgVideoMissing", "Not found"));
		expect((await judge(500)).kind).toBe("refuse");
		expect((await judge(403)).kind).toBe("refuse");
	});
});

describe("the path parameters", () => {
	it("reads the four versions and nothing else", () => {
		for (const version of ["master", "mix", "unmixed", "video"])
			expect(readVersion(version)).toBe(version);

		for (const other of [
			undefined,
			"",
			"MASTER",
			"stems",
			"__proto__",
			"constructor",
		])
			expect(readVersion(other)).toBeNull();
	});

	it("reads a slug of lower-case letters, digits and dashes", () => {
		expect(readSlug("slow-burn-2")).toBe("slow-burn-2");

		for (const other of [
			undefined,
			"",
			"Slow",
			"a_b",
			"a.b",
			"a b",
			"a/b",
			"a\n",
		])
			expect(readSlug(other)).toBeNull();
	});
});
