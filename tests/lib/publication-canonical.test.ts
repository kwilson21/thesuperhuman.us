import { describe, expect, it } from "vitest";
import { canonicalPublication } from "~/lib/publication/canonical";

describe("canonicalPublication", () => {
	it("sorts object keys at every depth", () => {
		expect(canonicalPublication({ b: { d: 1, c: "x" }, a: null })).toBe(
			'{"a":null,"b":{"c":"x","d":1}}',
		);
	});

	it.each([null, "text", 42, true])(
		"serializes a value that is not an object (%j) as JSON",
		(value) => {
			expect(canonicalPublication(value)).toBe(JSON.stringify(value));
		},
	);
});
