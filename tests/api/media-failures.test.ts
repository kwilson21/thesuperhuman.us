import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSuppliedEntries, supplyEntries } from "../helpers/astro-content";
import { double, partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { bytesStream } from "../helpers/r2";
import { GET as audio } from "~/pages/audio/file/[slug]";
import { GET as music } from "~/pages/music/file/[id]/[version]";
import { GET as og } from "~/pages/og/[name].mp4";
import { ogMedia, serveOgVideo } from "~/lib/og-media";

// How the three media routes answer when R2 or the assets fetch fails, when a binding is missing and when a byte range
// runs past the end of a file. An unexpected failure answers 500 with the route's fixed sentence and never the error's
// own text; a missing binding is a deliberate 503; the failure is logged once without its text.

const LEAK = "secret-internal-detail";
const OG = ogMedia("home").video;
const OG_NAME = OG.slice("/og/".length, -".mp4".length);

const context = (
	params: { [name: string]: string },
	env: Partial<TestRuntime["env"]>,
	range?: string,
) =>
	partial<APIContext>({
		params,
		request: new Request("https://thesuperhuman.us/media", {
			headers: range ? { range } : {},
		}),
		locals: partial<APIContext["locals"]>({
			runtime: partial<TestRuntime>({ env: partial<TestRuntime["env"]>(env) }),
		}),
	});

const masterParams = { id: "old-news-recording", version: "master" };

const broken = (operation: "head" | "get") =>
	double<R2Bucket>({
		head: async () => {
			if (operation === "head") throw new Error(LEAK);

			return partial<R2Object>({ size: 8 });
		},
		get: async () => {
			throw new Error(LEAK);
		},
	});

const good = double<R2Bucket>({
	head: async () => partial<R2Object>({ size: 8 }),
	get: async () =>
		partial<R2ObjectBody>({
			body: bytesStream(new Uint8Array(8)),
			size: 8,
		}),
});

let logged: unknown[][];

beforeEach(() => {
	logged = [];
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		logged.push(args);
	});

	supplyEntries("audio-tracks", [
		{
			id: "slow-burn",
			collection: "audio-tracks",
			data: { file: "tracks/slow-burn.mp3" },
		},
	]);
});

afterEach(() => {
	clearSuppliedEntries();
	vi.restoreAllMocks();
});

const answered = async (response: Response) => ({
	status: response.status,
	text: await response.text(),
});

const noLeak = () => expect(JSON.stringify(logged)).not.toContain(LEAK);

describe("the music file route", () => {
	it.each(["head", "get"] as const)(
		"answers 500 with a fixed sentence when R2 %s fails",
		async (operation) => {
			const response = await music(
				context(masterParams, { AUDIO: broken(operation) }),
			);

			expect(await answered(response)).toEqual({
				status: 500,
				text: "Media unavailable",
			});
			expect(logged).toHaveLength(1);
			noLeak();
		},
	);

	it("answers 503 when the audio bucket is not bound", async () => {
		expect(await answered(await music(context(masterParams, {})))).toEqual({
			status: 503,
			text: "Media unavailable",
		});
	});

	it("still answers 404 for an unknown recording without the bucket", async () => {
		expect(
			(await music(context({ id: "nothing", version: "master" }, {}))).status,
		).toBe(404);
	});
});

describe("the audio file route", () => {
	it.each(["head", "get"] as const)(
		"answers 500 with a fixed sentence when R2 %s fails",
		async (operation) => {
			const response = await audio(
				context(
					{ slug: "slow-burn" },
					{ AUDIO: broken(operation) },
					operation === "head" ? "bytes=0-3" : undefined,
				),
			);

			expect(await answered(response)).toEqual({
				status: 500,
				text: "Media unavailable",
			});
			expect(logged).toHaveLength(1);
			noLeak();
		},
	);

	it("answers 503 when the audio bucket is not bound", async () => {
		expect(
			await answered(await audio(context({ slug: "slow-burn" }, {}))),
		).toEqual({ status: 503, text: "Media unavailable" });
	});

	it("still answers 404 for an unknown slug without the bucket", async () => {
		expect((await audio(context({ slug: "nothing" }, {}))).status).toBe(404);
	});

	it.each([
		["bytes=0-1000", "bytes 0-7/8", "8"],
		["bytes=4-99", "bytes 4-7/8", "4"],
	])(
		"clamps an end past the size: %s answers 206 %s",
		async (range, contentRange, length) => {
			const response = await audio(
				context({ slug: "slow-burn" }, { AUDIO: good }, range),
			);

			expect(response.status).toBe(206);
			expect(response.headers.get("content-range")).toBe(contentRange);
			expect(response.headers.get("content-length")).toBe(length);
		},
	);

	it("still refuses a start at the size with 416", async () => {
		const response = await audio(
			context({ slug: "slow-burn" }, { AUDIO: good }, "bytes=8-"),
		);

		expect(response.status).toBe(416);
		expect(response.headers.get("content-range")).toBe("bytes */8");
	});
});

describe("the link preview video route", () => {
	const request = new Request(`https://thesuperhuman.us${OG}`);

	it("answers 500 with a fixed sentence when the assets fetch rejects", async () => {
		const assets = double<Fetcher>({
			fetch: async () => {
				throw new Error(LEAK);
			},
		});

		const response = await serveOgVideo(request, OG_NAME, assets);

		expect(await answered(response)).toEqual({
			status: 500,
			text: "Media unavailable",
		});
		expect(logged).toHaveLength(1);
		noLeak();
	});

	it.each([403, 500, 502])(
		"answers 500 when the assets answer %s",
		async (status) => {
			const assets = double<Fetcher>({
				fetch: async () => new Response("no", { status }),
			});

			expect((await serveOgVideo(request, OG_NAME, assets)).status).toBe(500);
		},
	);

	it("answers 404 when the assets have no such file", async () => {
		const assets = double<Fetcher>({
			fetch: async () => new Response("no", { status: 404 }),
		});

		expect(
			await answered(await serveOgVideo(request, OG_NAME, assets)),
		).toEqual({ status: 404, text: "Not found" });
	});

	it("answers 503 when production has no assets binding", async () => {
		expect(
			await answered(await serveOgVideo(request, OG_NAME, undefined)),
		).toEqual({ status: 503, text: "Media unavailable" });
	});

	it("still answers 404 for an unknown name without the binding", async () => {
		expect((await serveOgVideo(request, "nothing", undefined)).status).toBe(
			404,
		);
	});

	it("reads the binding in production and the global fetch in development", async () => {
		// Vitest runs with import.meta.env.DEV set, so the route uses the global fetch, which rejects here.
		vi.stubGlobal("fetch", async () => new Response(new Uint8Array(4)));

		try {
			const response = await og(
				partial<APIContext>({
					params: { name: OG_NAME },
					request,
					locals: partial<APIContext["locals"]>({}),
				}),
			);

			expect(response.status).toBe(200);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
