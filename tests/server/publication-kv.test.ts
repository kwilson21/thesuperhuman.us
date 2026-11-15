import { describe, expect, it } from "vitest";
import { keyBoundedKv } from "~/server/publication-kv";
import { double, fakeKv } from "../helpers/doubles";

// The OAuth library's KV namespace, held to Cloudflare's limit of 512 bytes on a key. The namespace underneath records the
// key of every call that reaches it.

const atLimit = "k".repeat(512);
const over = "k".repeat(513);

// Two bytes in UTF-8 each: 257 of them make a key of 514 bytes in 257 characters.
const overInBytes = "é".repeat(257);

function underneath() {
	const calls: string[] = [];

	const kv = fakeKv({
		get: async (key: string) => {
			calls.push(`get ${key}`);

			return "held";
		},
		put: async (key: string) => {
			calls.push(`put ${key}`);
		},
		delete: async (key: string) => {
			calls.push(`delete ${key}`);
		},
		list: async (options: { prefix?: string }) => {
			calls.push(`list ${options.prefix}`);

			return { keys: [{ name: "listed" }], list_complete: true };
		},
	});

	return { calls, kv: keyBoundedKv(kv) };
}

describe("the key-bounded KV namespace", () => {
	it("passes a read of a key of 512 bytes through", async () => {
		const { calls, kv } = underneath();

		expect(await kv.get(atLimit)).toBe("held");
		expect(calls).toEqual([`get ${atLimit}`]);
	});

	it("answers a read of a longer key as not found without calling KV, measuring in bytes", async () => {
		const { calls, kv } = underneath();

		expect(await kv.get(over)).toBeNull();
		expect(await kv.get(over, { type: "json" })).toBeNull();
		expect(await kv.get(overInBytes)).toBeNull();
		expect(calls).toEqual([]);
	});

	it("answers a metadata read of a longer key as not found without calling KV", async () => {
		const calls: string[] = [];

		const kv = keyBoundedKv(
			double<KVNamespace>({
				getWithMetadata: async (key: string | string[]) => {
					calls.push(String(key));

					throw new Error("reached KV");
				},
			}),
		);

		expect(await kv.getWithMetadata(over)).toEqual({
			value: null,
			metadata: null,
			cacheStatus: null,
		});
		expect(calls).toEqual([]);

		await expect(kv.getWithMetadata(atLimit)).rejects.toThrow("reached KV");
		expect(calls).toEqual([atLimit]);
	});

	it("does nothing for a delete of a longer key and passes any other through", async () => {
		const { calls, kv } = underneath();

		await kv.delete(over);
		await kv.delete("short");
		expect(calls).toEqual(["delete short"]);
	});

	it("answers a list by a longer prefix with nothing, and passes any other through", async () => {
		const { calls, kv } = underneath();

		expect(await kv.list({ prefix: over })).toEqual({
			keys: [],
			list_complete: true,
			cacheStatus: null,
		});
		expect((await kv.list({ prefix: "grant:" })).keys).toEqual([
			{ name: "listed" },
		]);
		expect(calls).toEqual(["list grant:"]);
	});

	it("passes a write through, so a key too long to store fails as KV fails", async () => {
		const kv = keyBoundedKv(
			fakeKv({
				get: async () => null,
				put: async (key: string) => {
					throw new Error(`refused ${key.length}`);
				},
			}),
		);

		await expect(kv.put(over, "v")).rejects.toThrow("refused 513");
	});
});
