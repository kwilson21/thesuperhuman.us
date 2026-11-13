import { describe, expect, it } from "vitest";
import { tinyImages } from "../fixtures/tiny-images";
import { softwareVisualMatches } from "~/lib/software-visuals";

// A visual is stored and served as the type it declares, so it must be a complete image of that type: nothing missing,
// nothing after the end, every checksum and length consistent.

const bytes = (name: keyof typeof tinyImages) =>
	Uint8Array.from(atob(tinyImages[name]), (c) => c.charCodeAt(0));

const accepts = (data: Uint8Array, type: string) =>
	softwareVisualMatches(data.slice().buffer, type);

const withExtra = (data: Uint8Array, extra: number[]) =>
	Uint8Array.from([...data, ...extra]);

const cases = [
	["png", "image/png"],
	["jpeg", "image/jpeg"],
	["jpegProgressive", "image/jpeg"],
	["webpLossy", "image/webp"],
	["webpLossless", "image/webp"],
	["webpExtended", "image/webp"],
] as const;

describe.each(cases)("%s as %s", (name, type) => {
	it("accepts the real image", () => {
		expect(accepts(bytes(name), type)).toBe(true);
	});

	it("refuses it under any other declared type", () => {
		for (const [, other] of cases)
			if (other !== type) expect(accepts(bytes(name), other)).toBe(false);
	});

	it("refuses every shorter prefix of it", () => {
		const full = bytes(name);

		for (let length = 0; length < full.length; length++)
			expect(accepts(full.slice(0, length), type), `prefix ${length}`).toBe(
				false,
			);
	});

	it("refuses bytes after the end of the image, except that a JPEG may carry more data", () => {
		if (type === "image/jpeg") return;
		expect(accepts(withExtra(bytes(name), [0]), type)).toBe(false);
		expect(accepts(withExtra(bytes(name), [0, 0, 0, 0]), type)).toBe(false);
		expect(
			accepts(
				withExtra(
					bytes(name),
					[..."<script>"].map((c) => c.charCodeAt(0)),
				),
				type,
			),
		).toBe(false);
	});
});

describe("png", () => {
	it("refuses a changed byte in any chunk, which breaks its checksum", () => {
		const full = bytes("png");

		// Every byte from the first chunk's length to the end sits in a length, a type, data or a checksum.
		for (let index = 8; index < full.length; index++) {
			const changed = Uint8Array.from(full);
			changed[index] ^= 0x01;
			expect(accepts(changed, "image/png"), `byte ${index}`).toBe(false);
		}
	});

	it("refuses the signature alone and the signature with filler", () => {
		const signature = [137, 80, 78, 71, 13, 10, 26, 10];

		expect(accepts(Uint8Array.from(signature), "image/png")).toBe(false);
		expect(
			accepts(
				Uint8Array.from([...signature, ...Array(64).fill(0)]),
				"image/png",
			),
		).toBe(false);
	});
});

describe("jpeg", () => {
	it("accepts data appended after the first end marker, as real photos carry (gain maps, MPF, motion photos)", () => {
		const full = bytes("jpeg");
		const second = [...bytes("jpegProgressive")];

		expect(accepts(withExtra(full, second), "image/jpeg")).toBe(true);
		expect(accepts(withExtra(full, [0, 0, 0, 0]), "image/jpeg")).toBe(true);
		expect(
			accepts(
				withExtra(
					full,
					[..."<script>"].map((c) => c.charCodeAt(0)),
				),
				"image/jpeg",
			),
		).toBe(true);
	});

	it("refuses the start marker with filler", () => {
		expect(
			accepts(
				Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(0)]),
				"image/jpeg",
			),
		).toBe(false);
	});

	it("refuses an image whose end marker is missing", () => {
		const full = bytes("jpeg");

		expect(accepts(full.slice(0, full.length - 2), "image/jpeg")).toBe(false);
	});
});

describe("webp", () => {
	it("refuses a riff size that does not match the length", () => {
		const full = bytes("webpLossy");

		for (const delta of [-2, 2]) {
			const changed = Uint8Array.from(full);
			new DataView(changed.buffer).setUint32(4, full.length - 8 + delta, true);
			expect(accepts(changed, "image/webp")).toBe(false);
		}
	});

	it("refuses the header with filler", () => {
		const header = [..."RIFF"].map((c) => c.charCodeAt(0));
		const webp = [..."WEBP"].map((c) => c.charCodeAt(0));

		expect(
			accepts(
				Uint8Array.from([...header, 0, 0, 0, 0, ...webp, ...Array(32).fill(0)]),
				"image/webp",
			),
		).toBe(false);
	});
});

it("refuses an unknown type", () => {
	expect(accepts(bytes("png"), "image/gif")).toBe(false);
	expect(accepts(bytes("png"), "constructor")).toBe(false);
});

const text = (value: string) => [...value].map((c) => c.charCodeAt(0));

const le32 = (value: number) => [
	value & 255,
	(value >> 8) & 255,
	(value >> 16) & 255,
	(value >> 24) & 255,
];

const riff = (...chunks: number[][]) => {
	const body = [...text("WEBP"), ...chunks.flat()];

	return Uint8Array.from([...text("RIFF"), ...le32(body.length), ...body]);
};

const chunk = (type: string, data: number[]) => [
	...text(type),
	...le32(data.length),
	...data,
	...(data.length % 2 ? [0] : []),
];

describe("headers with no image data", () => {
	it("refuses a WebP with a VP8X header and an empty ANMF chunk", () => {
		const file = riff(chunk("VP8X", Array(10).fill(0)), chunk("ANMF", []));

		expect(file.length).toBe(38);
		expect(accepts(file, "image/webp")).toBe(false);
	});

	it("refuses a VP8X with no frame at all", () => {
		expect(accepts(riff(chunk("VP8X", Array(10).fill(0))), "image/webp")).toBe(
			false,
		);
	});

	it("refuses a VP8L chunk of five bytes, which is only its header", () => {
		expect(accepts(riff(chunk("VP8L", [0x2f, 0, 0, 0, 0])), "image/webp")).toBe(
			false,
		);
	});

	it("refuses a VP8 chunk that is only its header or has no size", () => {
		const header = [0, 0, 0, 0x9d, 0x01, 0x2a, 4, 0, 4, 0];

		expect(accepts(riff(chunk("VP8 ", header)), "image/webp")).toBe(false);
		expect(
			accepts(
				riff(chunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0, 1, 2])),
				"image/webp",
			),
		).toBe(false);
	});

	it("refuses the JPEG with empty frame and scan headers", () => {
		const file = Uint8Array.from([
			0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9,
		]);

		expect(accepts(file, "image/jpeg")).toBe(false);
	});

	it("refuses a JPEG with a frame of no size, no components, a scan that disagrees, or no scan data", () => {
		const frame = (width: number, height: number, components: number) => [
			0xff,
			0xc0,
			0x00,
			8 + 3 * components,
			8,
			height >> 8,
			height & 255,
			width >> 8,
			width & 255,
			components,
			...Array(3 * components).fill(1),
		];
		const scan = (components: number, data: number[]) => [
			0xff,
			0xda,
			0x00,
			6 + 2 * components,
			components,
			...Array(2 * components + 3).fill(0),
			...data,
		];
		const file = (...parts: number[][]) =>
			Uint8Array.from([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);

		expect(
			accepts(file(frame(4, 4, 1), scan(1, [1, 2, 3])), "image/jpeg"),
		).toBe(true);
		expect(
			accepts(file(frame(0, 4, 1), scan(1, [1, 2, 3])), "image/jpeg"),
		).toBe(false);
		expect(
			accepts(file(frame(4, 0, 1), scan(1, [1, 2, 3])), "image/jpeg"),
		).toBe(false);
		expect(
			accepts(file(frame(4, 4, 0), scan(1, [1, 2, 3])), "image/jpeg"),
		).toBe(false);
		// A scan header whose length does not match its component count, and a scan with no data.
		const mismatched = [0xff, 0xda, 0x00, 8, 2, 1, 0, 2, 0, 0, 63, 0, 1, 2, 3];

		expect(accepts(file(frame(4, 4, 1), mismatched), "image/jpeg")).toBe(false);
		expect(accepts(file(frame(4, 4, 1), scan(1, [])), "image/jpeg")).toBe(
			false,
		);
	});

	it("refuses a PNG whose image data chunk is empty", () => {
		const full = bytes("png");
		const noData = Uint8Array.from([
			...full.slice(0, 33),
			...[0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54, 0x35, 0xaf, 0x06, 0x1e],
			...full.slice(full.length - 12),
		]);

		expect(accepts(noData, "image/png")).toBe(false);
	});
});
