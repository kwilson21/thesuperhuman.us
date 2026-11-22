import { describe, expect, it } from "vitest";
import { tinyImages } from "../fixtures/tiny-images";
import { imageSize } from "~/lib/image-structure";

// The pixel size a browser will show for an uploaded image, read from its headers. Anything it cannot say for certain is
// null, so the page falls back to markup with no size.

const real = (name: keyof typeof tinyImages) =>
	Uint8Array.from(atob(tinyImages[name]), (c) => c.charCodeAt(0));

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];

const u32be = (n: number) => [
	(n >>> 24) & 0xff,
	(n >>> 16) & 0xff,
	(n >>> 8) & 0xff,
	n & 0xff,
];

const u32le = (n: number) => u32be(n).reverse();

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A TIFF block holding one Orientation entry, in either byte order. */
function tiff(orientation: number, order: "II" | "MM") {
	const le = order === "II",
		short = (n: number) => (le ? u16be(n).reverse() : u16be(n)),
		long = (n: number) => (le ? u32le(n) : u32be(n));

	return [
		...text(order),
		...short(42),
		...long(8),
		...short(1),
		...short(0x0112),
		...short(3),
		...long(1),
		...short(orientation),
		0,
		0,
		...long(0),
	];
}

function pngWith(width: number, height: number, exif?: number[]) {
	const chunk = (type: string, body: number[]) => [
		...u32be(body.length),
		...text(type),
		...body,
		0,
		0,
		0,
		0,
	];

	return Uint8Array.from([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10,
		...chunk("IHDR", [...u32be(width), ...u32be(height), 8, 2, 0, 0, 0]),
		...(exif ? chunk("eXIf", exif) : []),
		...chunk("IDAT", [1, 2, 3]),
		...chunk("IEND", []),
	]);
}

function jpegWith(
	frame: number,
	width: number,
	height: number,
	exif?: number[],
) {
	const segment = (marker: number, body: number[]) => [
		0xff,
		marker,
		...u16be(body.length + 2),
		...body,
	];

	return Uint8Array.from([
		0xff,
		0xd8,
		...segment(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
		...(exif ? segment(0xe1, [...text("Exif"), 0, 0, ...exif]) : []),
		...segment(0xe1, [...text("http://ns.adobe.com/xap/1.0/"), 0, 1, 2, 3]),
		...segment(0xdb, [0, ...new Array(64).fill(8)]),
		...segment(frame, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]),
		...segment(0xda, [1, 1, 0, 0, 63, 0]),
		0x12,
		0x34,
		0xff,
		0xd9,
	]);
}

function riff(chunks: number[][]) {
	const body = [...text("WEBP"), ...chunks.flat()];

	return Uint8Array.from([...text("RIFF"), ...u32le(body.length), ...body]);
}

const chunkOf = (type: string, body: number[]) => [
	...text(type),
	...u32le(body.length),
	...body,
	...(body.length & 1 ? [0] : []),
];

const lossy = (width: number, height: number) =>
	chunkOf("VP8 ", [
		0x10,
		0x02,
		0x00,
		0x9d,
		0x01,
		0x2a,
		width & 0xff,
		(width >> 8) & 0x3f,
		height & 0xff,
		(height >> 8) & 0x3f,
		1,
		2,
	]);

const lossless = (width: number, height: number) => {
	const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;

	return chunkOf("VP8L", [0x2f, ...u32le(bits), 1, 2]);
};

const extended = (width: number, height: number, flags = 0) => {
	const three = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

	return chunkOf("VP8X", [
		flags,
		0,
		0,
		0,
		...three(width - 1),
		...three(height - 1),
	]);
};

describe("png", () => {
	it("reads the header size", () => {
		expect(imageSize(pngWith(640, 480), "image/png")).toEqual({
			width: 640,
			height: 480,
		});
		expect(imageSize(real("png"), "image/png")).toEqual({
			width: 4,
			height: 4,
		});
	});

	it("gives null for an orientation other than 1", () => {
		expect(imageSize(pngWith(640, 480, tiff(6, "MM")), "image/png")).toBeNull();
		expect(imageSize(pngWith(640, 480, tiff(3, "II")), "image/png")).toBeNull();
	});

	it("keeps the size when the orientation is 1", () => {
		expect(imageSize(pngWith(640, 480, tiff(1, "II")), "image/png")).toEqual({
			width: 640,
			height: 480,
		});
	});

	it("gives null for a zero dimension", () => {
		expect(imageSize(pngWith(0, 480), "image/png")).toBeNull();
		expect(imageSize(pngWith(640, 0), "image/png")).toBeNull();
	});
});

describe("jpeg", () => {
	it("reads the first frame past other segments", () => {
		expect(imageSize(jpegWith(0xc0, 800, 600), "image/jpeg")).toEqual({
			width: 800,
			height: 600,
		});
	});

	it("reads a progressive frame", () => {
		expect(imageSize(jpegWith(0xc2, 1024, 768), "image/jpeg")).toEqual({
			width: 1024,
			height: 768,
		});
		expect(imageSize(real("jpegProgressive"), "image/jpeg")).toEqual({
			width: 4,
			height: 4,
		});
	});

	it.each(["II", "MM"] as const)(
		"swaps width and height for orientations 5 to 8 (%s)",
		(order) => {
			for (const orientation of [5, 6, 7, 8])
				expect(
					imageSize(
						jpegWith(0xc0, 800, 600, tiff(orientation, order)),
						"image/jpeg",
					),
				).toEqual({ width: 600, height: 800 });
		},
	);

	it.each(["II", "MM"] as const)(
		"does not swap for orientations 1 to 4 (%s)",
		(order) => {
			for (const orientation of [1, 2, 3, 4])
				expect(
					imageSize(
						jpegWith(0xc0, 800, 600, tiff(orientation, order)),
						"image/jpeg",
					),
				).toEqual({ width: 800, height: 600 });
		},
	);

	it("does not take a DHT, JPG or DAC marker for a frame", () => {
		for (const marker of [0xc4, 0xc8, 0xcc])
			expect(imageSize(jpegWith(marker, 800, 600), "image/jpeg")).toBeNull();
	});

	it("gives null for a zero dimension", () => {
		expect(imageSize(jpegWith(0xc0, 0, 600), "image/jpeg")).toBeNull();
		expect(imageSize(jpegWith(0xc0, 800, 0), "image/jpeg")).toBeNull();
	});
});

describe("webp", () => {
	it("reads a lossy image", () => {
		expect(imageSize(riff([lossy(320, 200)]), "image/webp")).toEqual({
			width: 320,
			height: 200,
		});
		expect(imageSize(real("webpLossy"), "image/webp")).toEqual({
			width: 4,
			height: 4,
		});
	});

	it("reads a lossless image", () => {
		expect(imageSize(riff([lossless(321, 201)]), "image/webp")).toEqual({
			width: 321,
			height: 201,
		});
		expect(imageSize(real("webpLossless"), "image/webp")).toEqual({
			width: 4,
			height: 4,
		});
	});

	it("reads the canvas of an extended image", () => {
		expect(
			imageSize(riff([extended(1920, 1080), lossy(10, 10)]), "image/webp"),
		).toEqual({ width: 1920, height: 1080 });
		expect(imageSize(real("webpExtended"), "image/webp")).toEqual({
			width: 4,
			height: 4,
		});
	});

	it("gives null for an orientation other than 1", () => {
		expect(
			imageSize(
				riff([
					extended(1920, 1080, 0x08),
					lossy(10, 10),
					chunkOf("EXIF", tiff(6, "II")),
				]),
				"image/webp",
			),
		).toBeNull();
		expect(
			imageSize(
				riff([
					extended(1920, 1080, 0x08),
					lossy(10, 10),
					chunkOf("EXIF", [...text("Exif"), 0, 0, ...tiff(8, "MM")]),
				]),
				"image/webp",
			),
		).toBeNull();
	});

	it("keeps the size when the orientation is 1", () => {
		expect(
			imageSize(
				riff([
					extended(1920, 1080, 0x08),
					lossy(10, 10),
					chunkOf("EXIF", tiff(1, "II")),
				]),
				"image/webp",
			),
		).toEqual({ width: 1920, height: 1080 });
	});
});

describe("anything unreadable", () => {
	it("gives null for truncated input and never throws", () => {
		for (const [name, type] of [
			["png", "image/png"],
			["jpeg", "image/jpeg"],
			["webpLossy", "image/webp"],
			["webpLossless", "image/webp"],
			["webpExtended", "image/webp"],
		] as const) {
			const full = real(name);

			for (let length = 0; length < 20 && length < full.length; length++)
				expect(imageSize(full.slice(0, length), type)).toBeNull();
		}
	});

	it("gives null for an unknown type or the wrong type", () => {
		expect(imageSize(real("png"), "image/gif")).toBeNull();
		expect(imageSize(real("png"), "image/jpeg")).toBeNull();
		expect(imageSize(new Uint8Array(), "image/png")).toBeNull();
	});
});
