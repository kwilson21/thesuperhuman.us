import { describe, expect, it } from "vitest";
import { readJson } from "./json";

describe("readJson", () => {
	it("resolves to the parsed body of a response", async () => {
		const body = await readJson<{ a: number[] }>(Response.json({ a: [1, 2] }));

		expect(body.a).toEqual([1, 2]);
	});

	it("rejects a body that is not JSON", async () => {
		await expect(readJson(new Response("not json"))).rejects.toThrow(
			SyntaxError,
		);
	});
});
