import { describe, expect, it } from "vitest";
import { double, fakeD1, fakeKv } from "./doubles";

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
});
