import { describe, expect, it } from "vitest";
import { double, fakeD1, fakeKv, partial } from "./doubles";

describe("double", () => {
	it("returns the members it is given, as the same object", () => {
		const members = { ok: true, status: 200 };

		expect(double<Response>(members)).toBe(members);
	});

	it("rejects a member of the wrong type at compile time", () => {
		// @ts-expect-error prepare must be a function, not a number
		const bad = double<D1Database>({ prepare: 1 });

		expect(bad).toBeDefined();
	});
});

describe("partial", () => {
	it("returns the fields it is given, as the same object, and every other field reads undefined", () => {
		const fields = { ok: true, status: 200 };
		const response = partial<Response>(fields);

		expect(response).toBe(fields);
		expect(response.statusText).toBeUndefined();
	});

	it("rejects a field of the wrong type at compile time", () => {
		// @ts-expect-error status must be a number, not a string
		const bad = partial<Response>({ status: "200" });

		expect(bad).toBeDefined();
	});
});

describe("fakeD1", () => {
	it("returns the statement function it is given, as the same object", () => {
		const prepare = () => {
			throw new Error("not used");
		};

		expect(fakeD1({ prepare }).prepare).toBe(prepare);
	});

	it("throws when the code under test calls a member the test did not supply", () => {
		const db = fakeD1({});

		expect(() => db.prepare("SELECT 1")).toThrow(TypeError);
	});
});

describe("fakeKv", () => {
	it("returns the members it is given, as the same object", () => {
		const get = async () => null;
		const kv = fakeKv({ get });

		expect(kv.get).toBe(get);
	});

	it("accepts put, delete and list, and throws for a member the test did not supply", async () => {
		const list = async () => ({ keys: [], list_complete: true });
		const kv = fakeKv({ get: async () => null, list });

		expect(kv.list).toBe(list);
		expect(() => kv.put("key", "value")).toThrow(TypeError);
	});
});
