import { describe, expect, it } from "vitest";
import { characters, mcpText } from "../../src/lib/mcp-readers";
import { readWith } from "../../src/lib/readers";

// The public probe accepts a request body of several megabytes and counts the characters of the challenge in it, so the
// count must be right for a large text, and must not build a list of its characters to get there.

const MEGABYTES = 4 * 1024 * 1024;

describe("counting characters", () => {
	it("counts a pair of UTF-16 units as one and a lone unit as one", () => {
		expect(characters("")).toBe(0);
		expect(characters("abc")).toBe(3);
		expect(characters("🚀")).toBe(1);
		expect(characters("a🚀b")).toBe(3);
		expect(characters("\ud83d")).toBe(1);
		expect(characters("\ude80")).toBe(1);
		expect(characters("\ud83d\ud83d")).toBe(2);
		expect(characters("\ud83d🚀")).toBe(2);
		expect(characters("\ude80\ud83d")).toBe(2);
		expect(characters("🚀🚀")).toBe(2);
	});

	it("counts a text of several megabytes", () => {
		expect(characters("a".repeat(MEGABYTES))).toBe(MEGABYTES);
		expect(characters("🚀".repeat(MEGABYTES / 2))).toBe(MEGABYTES / 2);
		expect(characters("a🚀".repeat(MEGABYTES / 4))).toBe(MEGABYTES / 2);
		expect(characters("\ud83d".repeat(MEGABYTES))).toBe(MEGABYTES);
		expect(characters(`${"🚀".repeat(1000)}\ud83d`)).toBe(1001);
	});

	it("refuses a text of several megabytes by its limit, not by its size", () => {
		const reader = mcpText([{ least: 1 }, { most: 80 }]);
		const answer = readWith(reader, "🚀".repeat(MEGABYTES / 2));

		expect(answer).toEqual({
			ok: false,
			issues: [
				{
					path: [],
					message: "Too big: expected string to have <=80 characters",
				},
			],
		});
		expect(readWith(reader, "🚀".repeat(80)).ok).toBe(true);
	});
});
