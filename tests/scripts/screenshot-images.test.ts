import { type Context, createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
	decodeImages,
	eagerLazyImages,
	IMAGE_CAP_MS,
	imageStates,
	imagesLoaded,
	imagesReason,
	pendingImages,
	waitForImages,
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
	it("is three seconds", () => {
		expect(IMAGE_CAP_MS).toBe(3_000);
	});
});

// A page with a fake clock. `images` gives the images as they are at the clock's time; a wait that errors first
// throws each of `waitErrors` in turn.
type FakeState = { src: string; complete: boolean; naturalWidth: number };

type FakeScript =
	| typeof imageStates
	| typeof decodeImages
	| typeof eagerLazyImages;

type ImagePage = Parameters<typeof waitForImages>[0];

function fakeClock() {
	let now = 0;

	return {
		now: () => now,
		pause: async (ms: number) => {
			now += ms;
		},
	};
}

function fakePage({
	clock,
	images,
	decode = () => Promise.resolve(),
	waitErrors = [],
}: {
	clock: ReturnType<typeof fakeClock>;
	images: () => FakeState[];
	decode?: () => Promise<void>;
	waitErrors?: Error[];
}) {
	const errors = [...waitErrors];

	return {
		evaluate: vi.fn(async (script: FakeScript): Promise<FakeState[] | void> => {
			if (script === imageStates)
				return images().map(({ src, complete, naturalWidth }) => ({
					src,
					complete,
					naturalWidth,
				}));

			if (script === decodeImages) return decode();

			return undefined;
		}),
		waitForFunction: vi.fn(
			async (
				_script: typeof imagesLoaded,
				_arg: null,
				{ timeout }: { timeout: number },
			) => {
				const failure = errors.shift();

				if (failure) throw failure;

				const start = clock.now();

				for (;;) {
					if (images().every((image) => image.complete)) return true;

					if (clock.now() - start >= timeout) {
						const error = new Error("Timeout exceeded.");
						error.name = "TimeoutError";

						throw error;
					}

					await clock.pause(50);
				}
			},
		),
		waitForLoadState: vi.fn(async () => {}),
	};
}

const never = () => new Promise<void>(() => {});
const SHOT = "shot.png";

const navigation = () =>
	new Error(
		"Execution context was destroyed, most likely because of a navigation",
	);

describe("waitForImages", () => {
	it("records nothing and decodes when every image is complete at once", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{ src: "https://a.test/x.webp", complete: true, naturalWidth: 9 },
			],
		});

		const record = vi.fn();

		await waitForImages(page, {
			file: SHOT,
			record,
			now: clock.now,
			pause: never,
		});

		expect(page.waitForFunction).toHaveBeenCalledWith(imagesLoaded, null, {
			timeout: IMAGE_CAP_MS,
		});
		expect(page.evaluate).toHaveBeenCalledWith(decodeImages);
		expect(record).not.toHaveBeenCalled();
	});

	it("waits for an image that finishes later, within the cap, without recording a reason", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{
					src: "https://a.test/x.webp",
					complete: clock.now() >= 1_200,
					naturalWidth: 9,
				},
			],
		});

		const record = vi.fn();

		await waitForImages(page, {
			file: SHOT,
			record,
			now: clock.now,
			pause: never,
		});

		expect(clock.now()).toBe(1_200);
		expect(record).not.toHaveBeenCalled();
	});

	it("does not hang on a broken image, which is complete with no width", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{ src: "https://a.test/x.webp", complete: true, naturalWidth: 0 },
			],
		});

		const record = vi.fn();

		await waitForImages(page, {
			file: SHOT,
			record,
			now: clock.now,
			pause: never,
		});

		expect(clock.now()).toBe(0);
		expect(record).not.toHaveBeenCalled();
	});

	it("stops at the cap and names how many images are still loading and the first URL without its query", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{
					src: "https://a.test/one.webp?v=secret#f",
					complete: false,
					naturalWidth: 0,
				},
				{ src: "https://a.test/two.webp", complete: false, naturalWidth: 0 },
			],
		});

		const record = vi.fn();

		await waitForImages(page, {
			file: SHOT,
			record,
			now: clock.now,
			pause: never,
		});

		expect(clock.now()).toBe(IMAGE_CAP_MS);
		expect(record).toHaveBeenCalledWith(
			"images: 2 still loading, first https://a.test/one.webp",
		);
		expect(record.mock.calls[0]?.[0]).not.toContain("secret");
	});

	it("keeps the decode inside the cap: it is raced against the time left, and a decode that never ends is recorded", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{ src: "https://a.test/x.webp", complete: true, naturalWidth: 9 },
			],
			decode: never,
		});

		const record = vi.fn();
		const pause = vi.fn(async () => {});

		await waitForImages(page, {
			file: SHOT,
			record,
			now: clock.now,
			pause,
		});

		expect(pause).toHaveBeenCalledWith(IMAGE_CAP_MS);
		expect(record).toHaveBeenCalledWith("images: decode still running at cap");
	});

	it("retries once after a navigation when there is no prepare step, and records the reason", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{ src: "https://a.test/x.webp", complete: true, naturalWidth: 9 },
			],
			waitErrors: [navigation()],
		});

		const record = vi.fn();

		await waitForImages(page, {
			file: SHOT,
			record,
			now: clock.now,
			pause: never,
		});

		expect(page.waitForLoadState).toHaveBeenCalledWith("load");
		expect(page.waitForFunction).toHaveBeenCalledTimes(2);
		expect(record).toHaveBeenCalledWith(
			"images: page navigated during the wait",
		);
	});

	it("throws, naming the capture, on a navigation when the capture has a prepare step, without retrying", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{ src: "https://a.test/x.webp", complete: true, naturalWidth: 9 },
			],
			waitErrors: [navigation()],
		});

		await expect(
			waitForImages(page, {
				file: SHOT,
				prepared: true,
				record: vi.fn(),
				now: clock.now,
				pause: never,
			}),
		).rejects.toThrow(/shot\.png.*prepare step/);

		expect(page.waitForLoadState).not.toHaveBeenCalled();
		expect(page.waitForFunction).toHaveBeenCalledTimes(1);
	});

	it("throws, naming the capture, when the retry also navigates", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{ src: "https://a.test/x.webp", complete: true, naturalWidth: 9 },
			],
			waitErrors: [navigation(), navigation()],
		});

		await expect(
			waitForImages(page, {
				file: SHOT,
				record: vi.fn(),
				now: clock.now,
				pause: never,
			}),
		).rejects.toThrow(/shot\.png/);

		expect(page.waitForFunction).toHaveBeenCalledTimes(2);
	});

	it("does not retry when the page is closed, and names the capture", async () => {
		const clock = fakeClock();

		const page = fakePage({
			clock,
			images: () => [
				{ src: "https://a.test/x.webp", complete: true, naturalWidth: 9 },
			],
			waitErrors: [
				new Error("Target page, context or browser has been closed"),
			],
		});

		await expect(
			waitForImages(page, {
				file: SHOT,
				record: vi.fn(),
				now: clock.now,
				pause: never,
			}),
		).rejects.toThrow(/shot\.png: the image wait failed/);

		expect(page.waitForLoadState).not.toHaveBeenCalled();
	});
});
