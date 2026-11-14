import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { double, partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { byteRange, bytesStream } from "../helpers/r2";
import { clearSuppliedEntries, supplyEntries } from "../helpers/astro-content";
import { GET } from "~/pages/audio/file/[slug]";

// The audio-tracks collection has no files in this repository, so the test gives it its entries through the
// astro:content helper's seam. The route still reads them with getCollection.
beforeEach(() => {
	supplyEntries("audio-tracks", [
		{
			id: "private-software",
			collection: "audio-tracks",
			data: { file: "software/request/update/visual.png" },
		},
		{
			id: "slow-burn",
			collection: "audio-tracks",
			data: { file: "tracks/slow-burn.mp3" },
		},
	]);
});

afterEach(() => clearSuppliedEntries());

function makeR2(body = new Uint8Array([1, 2, 3, 4, 5]), size = 5) {
	return double<R2Bucket>({
		head: vi.fn(async (_key: string) => partial<R2Object>({ size })),
		get: vi.fn(async (_key: string, opts?: R2GetOptions) => {
			const range = byteRange(opts?.range);

			if (range) {
				const slice = body.slice(range.offset, range.offset + range.length);

				return partial<R2ObjectBody>({
					body: bytesStream(slice),
					size,
					range,
				});
			}

			return partial<R2ObjectBody>({
				body: bytesStream(body),
				size,
			});
		}),
	});
}

function makeContext(slug: string, rangeHeader?: string) {
	const headers = new Headers();

	if (rangeHeader) headers.set("range", rangeHeader);
	const audio = makeR2();

	return partial<APIContext>({
		params: { slug },
		request: new Request(`https://audio.thesuperhuman.us/file/${slug}`, {
			headers,
		}),
		locals: partial<APIContext["locals"]>({
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({ AUDIO: audio }),
			}),
		}),
	});
}

describe("GET /audio/file/[slug]", () => {
	it("streams the full file when no Range header is sent", async () => {
		const res = await GET(makeContext("slow-burn"));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("audio/mpeg");
		expect(res.headers.get("accept-ranges")).toBe("bytes");
		expect(res.headers.get("cache-control")).toContain("immutable");
	});

	it("returns 404 for an unknown slug", async () => {
		const res = await GET(makeContext("unknown"));
		expect(res.status).toBe(404);
	});

	it("honours a Range header with 206 and Content-Range", async () => {
		const res = await GET(makeContext("slow-burn", "bytes=1-3"));
		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 1-3/5");
		expect(res.headers.get("content-length")).toBe("3");
	});

	it("returns 416 with Content-Range:*/<size> for an out-of-range request", async () => {
		const res = await GET(makeContext("slow-burn", "bytes=99-100"));
		expect(res.status).toBe(416);
		expect(res.headers.get("content-range")).toBe("bytes */5");
	});

	it("returns 416 for an inverted range (start > end)", async () => {
		const res = await GET(makeContext("slow-burn", "bytes=4-2"));
		expect(res.status).toBe(416);
	});

	it("ignores a malformed Range header and serves 200", async () => {
		const res = await GET(makeContext("slow-burn", "malformed=foo"));
		expect(res.status).toBe(200);
	});
});

it("refuses software visuals through the public audio route without reading R2", async () => {
	const context = makeContext("private-software");
	const response = await GET(context);
	expect(response.status).toBe(404);
	expect(context.locals.runtime.env.AUDIO.get).not.toHaveBeenCalled();
});
