import { describe, expect, it } from "vitest";
import { byteRange, bytesStream, fakeR2Bucket, fakeR2Bytes } from "./r2";

describe("fakeR2Bucket", () => {
	it("returns the members it is given, and no others", () => {
		const get = () => undefined;

		const bucket = fakeR2Bucket({
			get,
			put: get,
			list: get,
			delete: get,
		});

		expect(bucket.get).toBe(get);
		expect(() => bucket.head("key")).toThrow(TypeError);
	});
});

describe("fakeR2Bytes", () => {
	it("resolves get() to an object whose arrayBuffer() is a copy of the bytes", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const object = await fakeR2Bytes(bytes).get("key");
		const buffer = await object?.arrayBuffer();

		expect(buffer).toBeInstanceOf(ArrayBuffer);
		expect(new Uint8Array(buffer ?? new ArrayBuffer(0))).toEqual(bytes);
		expect(buffer).not.toBe(bytes.buffer);
	});
});

describe("bytesStream", () => {
	it("yields the bytes once and then ends", async () => {
		const response = new Response(bytesStream(new Uint8Array([4, 5])));

		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([4, 5]),
		);
	});
});

describe("byteRange", () => {
	it("gives the offset and length of a range that names both", () => {
		expect(byteRange({ offset: 2, length: 5 })).toEqual({
			offset: 2,
			length: 5,
		});
	});

	it("gives nothing for a missing range, a Headers range or a range missing a bound", () => {
		expect(byteRange(undefined)).toBeUndefined();
		expect(byteRange(new Headers({ range: "bytes=0-1" }))).toBeUndefined();
		expect(byteRange({ offset: 2 })).toBeUndefined();
		expect(byteRange({ suffix: 4 })).toBeUndefined();
	});
});
