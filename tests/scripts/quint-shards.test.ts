import { describe, expect, it } from "vitest";
import { models } from "../../scripts/lib/quint-mutants.mjs";
import {
	parseShard,
	partitionChecks,
	selectChecks,
} from "../../scripts/lib/quint-shards.mjs";

const checks = models.flatMap((model) => [
	...model.current.map((main) => ({ model, main, kind: "pass" })),
	...model.equivalents.map((main) => ({ model, main, kind: "pass" })),
	...Object.keys(model.mutants).map((main) => ({
		model,
		main,
		kind: "violation",
	})),
]);

describe("Quint scheduling changes placement, never verification", () => {
	it("partitions every current property, mutant and equivalent exactly once", () => {
		const buckets = partitionChecks(checks, 8);
		expect(buckets).toHaveLength(8);
		expect(buckets.every((bucket) => bucket.length > 0)).toBe(true);
		expect(buckets.flat()).toHaveLength(checks.length);
		expect(new Set(buckets.flat())).toEqual(new Set(checks));
		expect(partitionChecks(checks, 8)).toEqual(buckets);

		for (let index = 1; index <= 8; index++)
			expect(selectChecks(checks, parseShard(`${index}/8`))).toEqual(
				buckets[index - 1],
			);
	});
	it("keeps the original complete run when sharding is absent", () => {
		expect(selectChecks(checks, parseShard(undefined))).toBe(checks);
	});
	it("includes future checks even without a timing hint", () => {
		const added = { main: "future", kind: "pass" };
		expect(partitionChecks([...checks, added], 8).flat()).toContain(added);
	});
	it.each([
		"",
		"0/8",
		"9/8",
		"1/0",
		"-1/8",
		"1.5/8",
		"1/65",
		" 1/8",
		"1/8x",
		"1/9007199254740993",
	])("fails closed for invalid shard %s", (value) => {
		expect(() => parseShard(value)).toThrow();
	});
	it("does not let an empty shard pass", () => {
		expect(() => partitionChecks(checks.slice(0, 2), 3)).toThrow();
		expect(() => partitionChecks(checks, 0)).toThrow();
	});
});
