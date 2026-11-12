import { describe, expect, it } from "vitest";
import { fakeLocals, testRuntime } from "./runtime";

describe("testRuntime", () => {
	it("has the env bindings it is given and reads others as undefined", () => {
		const runtime = testRuntime({ SITE_ORIGIN: "https://example.test" });

		expect(runtime.env.SITE_ORIGIN).toBe("https://example.test");
		expect(runtime.env.MUSIC_DB).toBeUndefined();
	});
});

describe("fakeLocals", () => {
	it("carries the runtime env and the owner when one is signed in", () => {
		const locals = fakeLocals(
			{ SITE_ORIGIN: "https://example.test" },
			{
				email: "owner@example.com",
			},
		);

		expect(locals.runtime.env.SITE_ORIGIN).toBe("https://example.test");
		expect(locals.owner).toEqual({ email: "owner@example.com" });
	});

	it("has no owner when none signs in", () => {
		expect(fakeLocals({}).owner).toBeUndefined();
	});
});
