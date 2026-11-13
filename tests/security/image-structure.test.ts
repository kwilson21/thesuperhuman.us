import { describe, expect, it } from "vitest";
import { tinyImages } from "../fixtures/tiny-images";
import { softwareVisualMatches } from "~/lib/software-visuals";

// A visual is stored and served as the type it declares, so it must be a complete image of that type: nothing missing,
// nothing after the end, every checksum and length consistent.

const bytes = (name: keyof typeof tinyImages) =>
	Uint8Array.from(atob(tinyImages[name]), (c) => c.charCodeAt(0));

const accepts = (data: Uint8Array, type: string) =>
	softwareVisualMatches(data.buffer.slice(0) as ArrayBuffer, type);

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

	it("refuses bytes after the end of the image", () => {
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
