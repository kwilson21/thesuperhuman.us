import { expect, it } from "vitest";
import {
	expectedPartLength,
	maxPartEtagLength,
	maxProjectFileSize,
	readBodyWithin,
	uploadPartSize,
} from "~/lib/audio-project-uploads";

it("fits the maximum part tags and waveform peaks into the completion request limit", () => {
	const count = Math.ceil(maxProjectFileSize / uploadPartSize);

	const parts = Array.from({ length: count }, (_, index) => ({
		partNumber: index + 1,
		etag: "x".repeat(maxPartEtagLength),
	}));

	const peaks = Array.from({ length: 400 }, () => 100);
	expect(
		new TextEncoder().encode(
			JSON.stringify({
				action: "complete",
				uploadId: crypto.randomUUID(),
				parts,
				peaks,
			}),
		).byteLength,
	).toBeLessThan(34_000);
});

it("stops reading an upload body as soon as it passes the expected size", async () => {
	let pulled = 0;

	const endless = new ReadableStream<Uint8Array>({
		pull(controller) {
			pulled++;
			controller.enqueue(new Uint8Array(4));
		},
	});

	expect(await readBodyWithin(endless, 10)).toBeNull();
	expect(pulled).toBeLessThanOrEqual(4);

	const exact = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([1, 2]));
			controller.enqueue(new Uint8Array([3]));
			controller.close();
		},
	});

	expect([...new Uint8Array((await readBodyWithin(exact, 3))!)]).toEqual([
		1, 2, 3,
	]);
});

it("splits a file into parts of 10 MiB with a shorter last one, and has no part outside them", () => {
	const size = uploadPartSize + 3;

	expect(expectedPartLength(size, 1)).toBe(uploadPartSize);
	expect(expectedPartLength(size, 2)).toBe(3);
	expect(expectedPartLength(size, 0)).toBeNull();
	expect(expectedPartLength(size, 3)).toBeNull();
	expect(expectedPartLength(size, 1.5)).toBeNull();
	expect(expectedPartLength(12, 1)).toBe(12);
});
