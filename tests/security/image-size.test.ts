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

type Entry = { tag: number; type: number; count: number; value: number };

/** A TIFF block built entry by entry, so a test can make the entries wrong or point the IFD somewhere else. */
function tiffRaw(
	entries: Entry[],
	{ order = "MM", ifd = 8 }: { order?: "II" | "MM"; ifd?: number } = {},
) {
	const le = order === "II",
		short = (n: number) => (le ? u16be(n).reverse() : u16be(n)),
		long = (n: number) => (le ? u32le(n) : u32be(n));

	return [
		...text(order),
		...short(42),
		...long(ifd),
		...short(entries.length),
		...entries.flatMap((e) => [
			...short(e.tag),
			...short(e.type),
			...long(e.count),
			...(e.type === 3 ? [...short(e.value), 0, 0] : long(e.value)),
		]),
		...long(0),
	];
}

const orientationEntry = (value: number, type = 3, count = 1): Entry => ({
	tag: 0x0112,
	type,
	count,
	value,
});

function pngWith(
	width: number,
	height: number,
	exif?: number[],
	idat: number[] = [1, 2, 3],
) {
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
		...chunk("IDAT", idat),
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

const jpegSegment = (marker: number, body: number[]) => [
	0xff,
	marker,
	...u16be(body.length + 2),
	...body,
];

const exifSegment = (tiffBytes: number[]) =>
	jpegSegment(0xe1, [...text("Exif"), 0, 0, ...tiffBytes]);

const xmpSegment = () =>
	jpegSegment(0xe1, [...text("http://ns.adobe.com/xap/1.0/"), 0, 1, 2, 3]);

/** A JPEG of 800 by 600 with `before` (raw bytes) between the start marker and the tables. */
function jpegRaw(before: number[], after: number[] = []) {
	return Uint8Array.from([
		0xff,
		0xd8,
		...before,
		...jpegSegment(0xdb, [0, ...new Array(64).fill(8)]),
		...jpegSegment(0xc0, [8, ...u16be(600), ...u16be(800), 1, 1, 0x11, 0]),
		...after,
		...jpegSegment(0xda, [1, 1, 0, 0, 63, 0]),
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

describe("jpeg segment walking", () => {
	const size = { width: 800, height: 600 };

	it("gives null when an XMP segment comes before the Exif segment", () => {
		expect(
			imageSize(
				jpegRaw([
					...xmpSegment(),
					...exifSegment(tiffRaw([orientationEntry(6)])),
				]),
				"image/jpeg",
			),
		).toBeNull();
	});

	it("keeps the swapped size when the XMP segment comes after the Exif segment", () => {
		expect(
			imageSize(
				jpegRaw([
					...exifSegment(tiffRaw([orientationEntry(6)])),
					...xmpSegment(),
				]),
				"image/jpeg",
			),
		).toEqual({ width: 600, height: 800 });
	});

	it("keeps the unswapped size when there is an XMP segment and no Exif", () => {
		expect(imageSize(jpegRaw(xmpSegment()), "image/jpeg")).toEqual(size);
	});

	it("gives null for an Exif segment whose sixth byte is not zero", () => {
		const odd = (sixth: number) =>
			jpegSegment(0xe1, [
				...text("Exif"),
				0,
				sixth,
				...tiffRaw([orientationEntry(6)]),
			]);

		expect(imageSize(jpegRaw(odd(0xff)), "image/jpeg")).toBeNull();
		expect(imageSize(jpegRaw(odd(1)), "image/jpeg")).toBeNull();
	});

	it("gives null when an odd Exif segment is followed by a normal one", () => {
		expect(
			imageSize(
				jpegRaw([
					...jpegSegment(0xe1, [
						...text("Exif"),
						0,
						1,
						...tiffRaw([{ tag: 0x010f, type: 3, count: 1, value: 1 }]),
					]),
					...exifSegment(tiffRaw([orientationEntry(6)])),
				]),
				"image/jpeg",
			),
		).toBeNull();
	});

	it.each(["II", "MM"] as const)(
		"keeps the size of an ordinary camera file after JFIF (%s)",
		(order) => {
			const exif = (orientation: number) =>
				tiffRaw(
					[
						{ tag: 0x010f, type: 3, count: 1, value: 1 },
						orientationEntry(orientation),
						{ tag: 0x8769, type: 4, count: 1, value: 0x40 },
					],
					{ order },
				);

			const jfif = jpegSegment(0xe0, [
				...text("JFIF"),
				0,
				1,
				1,
				0,
				0,
				1,
				0,
				1,
				0,
				0,
			]);

			expect(
				imageSize(jpegRaw([...jfif, ...exifSegment(exif(1))]), "image/jpeg"),
			).toEqual(size);
			expect(
				imageSize(jpegRaw([...jfif, ...exifSegment(exif(6))]), "image/jpeg"),
			).toEqual({ width: 600, height: 800 });
		},
	);

	it("swaps a 4032 by 3024 frame with Orientation 6", () => {
		const bytes = Uint8Array.from([
			0xff,
			0xd8,
			...exifSegment(tiffRaw([orientationEntry(6)])),
			...jpegSegment(0xc0, [8, ...u16be(3024), ...u16be(4032), 1, 1, 0x11, 0]),
			...jpegSegment(0xda, [1, 1, 0, 0, 63, 0]),
			0x12,
			0xff,
			0xd9,
		]);

		expect(imageSize(bytes, "image/jpeg")).toEqual({
			width: 3024,
			height: 4032,
		});
	});

	it("skips fill bytes between segments", () => {
		expect(
			imageSize(
				jpegRaw([0xff, 0xff, 0xff, ...xmpSegment(), 0xff, 0xff]),
				"image/jpeg",
			),
		).toEqual(size);
	});

	it("skips standalone TEM and restart markers", () => {
		expect(
			imageSize(jpegRaw([0xff, 0x01, 0xff, 0xd0, 0xff, 0xd7]), "image/jpeg"),
		).toEqual(size);
	});

	it("gives null when two Exif segments are present", () => {
		const exif = exifSegment(tiffRaw([orientationEntry(1)]));

		expect(imageSize(jpegRaw([...exif, ...exif]), "image/jpeg")).toBeNull();
		expect(
			imageSize(
				jpegRaw(exif, exifSegment(tiffRaw([orientationEntry(6)]))),
				"image/jpeg",
			),
		).toBeNull();
	});

	it("keeps the size for readable Exif with no Orientation tag", () => {
		expect(
			imageSize(
				jpegRaw(
					exifSegment(tiffRaw([{ tag: 0x010f, type: 3, count: 1, value: 1 }])),
				),
				"image/jpeg",
			),
		).toEqual(size);
		expect(imageSize(jpegRaw(exifSegment(tiffRaw([]))), "image/jpeg")).toEqual(
			size,
		);
	});
});

describe("exif is read only inside its own block", () => {
	// An IFD offset that points past the end of the block, where a later segment holds a plausible IFD.
	const fakeIfd = (value: number) => [
		0,
		1,
		...u16be(0x0112),
		...u16be(3),
		...u32be(1),
		...u16be(value),
		0,
		0,
	];

	it("gives null for a JPEG whose IFD offset is past its segment", () => {
		expect(
			imageSize(
				jpegRaw([
					0xff,
					0xe1,
					...u16be(16),
					...text("Exif"),
					0,
					0,
					...text("MM"),
					0,
					0x2a,
					...u32be(0x0c),
					...jpegSegment(0xfe, fakeIfd(6)),
				]),
				"image/jpeg",
			),
		).toBeNull();
	});

	it("gives null for a PNG whose IFD offset is past its eXIf chunk", () => {
		// The eXIf body is 8 bytes; the next chunk's data starts 12 bytes after it (CRC, length, type).
		expect(
			imageSize(
				pngWith(640, 480, tiffRaw([], { ifd: 20 }).slice(0, 8), fakeIfd(1)),
				"image/png",
			),
		).toBeNull();
	});

	it("gives null for a WebP whose IFD offset is past its EXIF chunk", () => {
		// The EXIF body is 8 bytes; the next chunk's data starts 8 bytes after it (type, length).
		expect(
			imageSize(
				riff([
					extended(1920, 1080, 0x08),
					lossy(1920, 1080),
					chunkOf("EXIF", tiffRaw([], { ifd: 16 }).slice(0, 8)),
					chunkOf("JUNK", fakeIfd(1)),
				]),
				"image/webp",
			),
		).toBeNull();
	});

	it("gives null when the IFD is cut short", () => {
		const whole = tiffRaw([orientationEntry(6)]);

		for (const cut of [9, 10, 14, 20])
			expect(
				imageSize(jpegRaw(exifSegment(whole.slice(0, cut))), "image/jpeg"),
			).toBeNull();
	});

	it("gives null for Orientation with a count other than 1", () => {
		expect(
			imageSize(
				jpegRaw(exifSegment(tiffRaw([orientationEntry(6, 3, 2)]))),
				"image/jpeg",
			),
		).toBeNull();
	});

	it("gives null for Orientation of a type other than SHORT", () => {
		expect(
			imageSize(
				jpegRaw(exifSegment(tiffRaw([orientationEntry(6, 4)]))),
				"image/jpeg",
			),
		).toBeNull();
	});

	it("gives null for Orientation values outside 1 to 8", () => {
		for (const value of [0, 9])
			expect(
				imageSize(
					jpegRaw(exifSegment(tiffRaw([orientationEntry(value)]))),
					"image/jpeg",
				),
			).toBeNull();
	});

	it("gives null for Exif that cannot be read", () => {
		expect(
			imageSize(jpegRaw(exifSegment(text("XX*\0"))), "image/jpeg"),
		).toBeNull();
	});
});

describe("webp", () => {
	it("reads the largest extended canvas", () => {
		expect(
			imageSize(
				riff([extended(16777216, 16777216, 0x02), lossy(10, 10)]),
				"image/webp",
			),
		).toEqual({ width: 16777216, height: 16777216 });
	});

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
			imageSize(riff([extended(1920, 1080), lossy(1920, 1080)]), "image/webp"),
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
					lossy(1920, 1080),
					chunkOf("EXIF", tiff(6, "II")),
				]),
				"image/webp",
			),
		).toBeNull();
		expect(
			imageSize(
				riff([
					extended(1920, 1080, 0x08),
					lossy(1920, 1080),
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
					lossy(1920, 1080),
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

/** A PNG chunk (the checksum is not read by the size reader). */
const pngChunk = (type: string, body: number[]) => [
	...u32be(body.length),
	...text(type),
	...body,
	0,
	0,
	0,
	0,
];

const pngBytes = (width: number, height: number, middle: number[][]) =>
	Uint8Array.from([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10,
		...pngChunk("IHDR", [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]),
		...middle.flat(),
		...pngChunk("IDAT", [1, 2, 3]),
		...pngChunk("IEND", []),
	]);

/** The Exif block a macOS screenshot carries: IFD0 holds only the ExifIFD pointer, the Exif directory holds sizes and a comment. */
function screenshotExif(width: number, height: number) {
	const comment = [...text("ASCII"), 0, 0, 0, ...text("Screenshot")],
		subIfd = 26,
		commentAt = subIfd + 2 + 3 * 12 + 4;

	return [
		...text("MM"),
		...u16be(42),
		...u32be(8),
		...u16be(1),
		...u16be(0x8769),
		...u16be(4),
		...u32be(1),
		...u32be(subIfd),
		...u32be(0),
		...u16be(3),
		...u16be(0x9286),
		...u16be(7),
		...u32be(comment.length),
		...u32be(commentAt),
		...u16be(0xa002),
		...u16be(4),
		...u32be(1),
		...u32be(width),
		...u16be(0xa003),
		...u16be(4),
		...u32be(1),
		...u32be(height),
		...u32be(0),
		...comment,
	];
}

const screenshotXmp = (width: number, height: number) =>
	pngChunk("iTXt", [
		...text("XML:com.adobe.xmp"),
		0,
		0,
		0,
		0,
		0,
		...text(
			`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:PixelXDimension="${width}" exif:PixelYDimension="${height}"/></rdf:RDF></x:xmpmeta>`,
		),
	]);

describe("files that ordinary tools write", () => {
	it("reads a macOS screenshot PNG with pHYs, eXIf and XMP", () => {
		const bytes = pngBytes(2880, 1800, [
			pngChunk("pHYs", [...u32be(5669), ...u32be(5669), 1]),
			pngChunk("eXIf", screenshotExif(2880, 1800)),
			screenshotXmp(2880, 1800),
		]);

		expect(imageSize(bytes, "image/png")).toEqual({
			width: 2880,
			height: 1800,
		});
	});

	it("reads a plain export PNG, with and without sRGB and pHYs", () => {
		expect(imageSize(pngBytes(640, 480, []), "image/png")).toEqual({
			width: 640,
			height: 480,
		});
		expect(
			imageSize(
				pngBytes(640, 480, [
					pngChunk("sRGB", [0]),
					pngChunk("pHYs", [...u32be(2835), ...u32be(2835), 1]),
				]),
				"image/png",
			),
		).toEqual({ width: 640, height: 480 });
	});

	it("reads a plain lossless WebP and a baseline JPEG with only JFIF", () => {
		expect(imageSize(riff([lossless(800, 600)]), "image/webp")).toEqual({
			width: 800,
			height: 600,
		});
		expect(
			imageSize(
				jpegRaw(
					jpegSegment(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
				),
				"image/jpeg",
			),
		).toEqual({ width: 800, height: 600 });
	});
});

describe("webp canvas and frame", () => {
	it("gives null for a still extended image whose canvas differs from its frame", () => {
		expect(
			imageSize(riff([extended(80, 40), lossy(40, 20)]), "image/webp"),
		).toBeNull();
		expect(
			imageSize(riff([extended(80, 40), lossless(40, 20)]), "image/webp"),
		).toBeNull();
	});

	it("keeps the canvas when it equals the frame", () => {
		expect(
			imageSize(riff([extended(40, 20), lossy(40, 20)]), "image/webp"),
		).toEqual({ width: 40, height: 20 });
		expect(
			imageSize(riff([extended(40, 20), lossless(40, 20)]), "image/webp"),
		).toEqual({ width: 40, height: 20 });
	});

	it("keeps the canvas of an animated file whose frames are smaller", () => {
		const frame = chunkOf("ANMF", [
			0,
			0,
			0,
			0,
			0,
			0,
			39,
			0,
			0,
			19,
			0,
			0,
			10,
			0,
			0,
			0,
			...lossy(40, 20),
		]);

		expect(
			imageSize(
				riff([
					extended(80, 40, 0x02),
					chunkOf("ANIM", [0, 0, 0, 0, 0, 0]),
					frame,
				]),
				"image/webp",
			),
		).toEqual({ width: 80, height: 40 });
		// An ANIM chunk alone marks it animated, whatever the flag says.
		expect(
			imageSize(
				riff([extended(80, 40), chunkOf("ANIM", [0, 0, 0, 0, 0, 0]), frame]),
				"image/webp",
			),
		).toEqual({ width: 80, height: 40 });
	});
});
