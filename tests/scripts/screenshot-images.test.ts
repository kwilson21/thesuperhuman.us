import { type Context, createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	decodeImages,
	eagerLazyImages,
	IMAGE_CAP_MS,
	imagesLoaded,
	imagesReason,
	pendingImages,
} from "../../scripts/screenshots/images.mjs";
import { REASON_URL_LENGTH } from "../../scripts/screenshots/settle.mjs";

// The fake document a page function reads: its images, or its lazy-image query.
type FakeDocument = {
	images?: { complete: boolean; naturalWidth: number }[];
	querySelectorAll?: (selector: string) => { loading: string | undefined }[];
};

// Runs a page-side function in a fresh context that has the given document, as Playwright would run it.
function inPage(
	fn: () => boolean | void,
	document: FakeDocument,
): boolean | undefined {
	const sandbox: Context = createContext({ document });

	// SAFETY: the tested page functions return a boolean (imagesLoaded) or nothing (eagerLazyImages), as typed.
	return runInContext(`(${fn.toString()})()`, sandbox) as boolean | undefined;
}

describe("eagerLazyImages", () => {
	it("makes only the lazy images eager, without changing the others", () => {
		const lazy = { loading: "lazy" };
		const eager = { loading: "eager" };
		const none = { loading: undefined };

		const document = {
			querySelectorAll: (selector: string) =>
				selector === 'img[loading="lazy"]' ? [lazy] : [eager, none],
		};

		inPage(eagerLazyImages, document);

		expect(lazy.loading).toBe("eager");
		expect(eager.loading).toBe("eager");
		expect(none.loading).toBeUndefined();
	});
});

describe("imagesLoaded", () => {
	it("holds once every image is complete, including a broken one", () => {
		const document = {
			images: [
				{ complete: true, naturalWidth: 300 },
				{ complete: true, naturalWidth: 0 },
			],
		};

		expect(inPage(imagesLoaded, document)).toBe(true);
	});

	it("does not hold while an image is still loading", () => {
		const document = {
			images: [
				{ complete: true, naturalWidth: 300 },
				{ complete: false, naturalWidth: 0 },
			],
		};

		expect(inPage(imagesLoaded, document)).toBe(false);
	});
});

describe("pendingImages", () => {
	it("returns only the images that have not finished, and not a broken one that has", () => {
		const loading = {
			src: "https://a.test/x.webp",
			complete: false,
			naturalWidth: 0,
		};

		const broken = {
			src: "https://a.test/y.webp",
			complete: true,
			naturalWidth: 0,
		};

		const loaded = {
			src: "https://a.test/z.webp",
			complete: true,
			naturalWidth: 9,
		};

		expect(pendingImages([loading, broken, loaded])).toEqual([loading]);
	});
});

describe("imagesReason", () => {
	it("names how many images were still loading and the first one's URL without its query", () => {
		const reason = imagesReason([
			{ src: "https://a.test/one.webp?v=secret#f", complete: false },
			{ src: "https://a.test/two.webp", complete: false },
		]);

		expect(reason).toBe(
			"images: 2 still loading, first https://a.test/one.webp",
		);
		expect(reason).not.toContain("secret");
	});

	it("truncates the first URL to the reason length", () => {
		const long = `https://a.test/${"a".repeat(300)}`;
		const reason = imagesReason([{ src: long, complete: false }]);

		expect(reason).toBe(
			`images: 1 still loading, first ${long.slice(0, REASON_URL_LENGTH)}`,
		);
	});
});

describe("decodeImages", () => {
	it("decodes the loaded images and ignores a decode that fails", async () => {
		const decoded: string[] = [];

		const document = {
			images: [
				{
					complete: true,
					naturalWidth: 5,
					decode: async () => {
						decoded.push("ok");
					},
				},
				{
					complete: true,
					naturalWidth: 5,
					decode: async () => {
						throw new Error("EncodingError");
					},
				},
				{
					complete: true,
					naturalWidth: 0,
					decode: async () => {
						decoded.push("broken");
					},
				},
			],
		};

		const sandbox: Context = createContext({ document });

		await runInContext(`(${decodeImages.toString()})()`, sandbox);

		expect(decoded).toEqual(["ok"]);
	});
});

describe("the image cap", () => {
	it("is a few seconds, not a wait a full run would notice", () => {
		expect(IMAGE_CAP_MS).toBeGreaterThanOrEqual(1_000);
		expect(IMAGE_CAP_MS).toBeLessThanOrEqual(5_000);
	});
});
