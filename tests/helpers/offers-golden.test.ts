import { describe, expect, it } from "vitest";
import { hookPatterns, hookPatternsIn } from "./offers-golden";

// The hook patterns the offers store's tests hold its SQL to are read from the golden test files' syntax: a pattern the
// reader passes over would let a changed statement slip past the count those tests keep, so every form it cannot read
// fails.

describe("hookPatternsIn", () => {
	it("reads a literal, and a name bound by a const to one", () => {
		expect(
			hookPatternsIn(
				"x.test.ts",
				"const onBatch = /INSERT INTO a/;\nconst cases = [{ failures: [{ on: /UPDATE b/ }] }, { interleave: [{ on: onBatch }] }];",
			),
		).toEqual(["/UPDATE b/", "/INSERT INTO a/"]);
	});

	it.each([
		["a quoted key", `const cases = [{ failures: [{ "on": /UPDATE b/ }] }];`],
		[
			"a single-quoted key",
			`const cases = [{ failures: [{ 'on': /UPDATE b/ }] }];`,
		],
		[
			"a computed key",
			`const cases = [{ failures: [{ ["on"]: /UPDATE b/ }] }];`,
		],
		[
			"a computed template key",
			"const cases = [{ failures: [{ [`on`]: /UPDATE b/ }] }];",
		],
	])("fails on %s", (_name, text) => {
		expect(() => hookPatternsIn("x.test.ts", text)).toThrow(
			/quoted or computed/,
		);
	});

	it("fails on a value it cannot read", () => {
		expect(() =>
			hookPatternsIn(
				"x.test.ts",
				"const cases = [{ failures: [{ on: pick() }] }];",
			),
		).toThrow(/neither a regular expression literal/);
	});

	it("reads every hook of the seven corpora", () => {
		expect(hookPatterns().length).toBe(27);
	});
});
