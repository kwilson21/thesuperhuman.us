// The owner's pricing reference reader. Every figure here is made up for the test; the owner's real numbers live only in
// the private store, never in the repository.
import { describe, expect, it } from "vitest";
import {
	marketRange,
	readMarketReference,
	readPricingReference,
} from "~/lib/pricing-reference";

const research = {
	researchedOn: "2026-11-15",
	ranges: [
		{
			kind: "website",
			size: "small",
			definition: "A few pages",
			lowUsd: 1000,
			highUsd: 2000,
			sourceIds: [1, 2],
		},
		{
			kind: "workflow",
			size: "large",
			definition: "No confirmed source",
			lowUsd: 0,
			highUsd: 0,
			sourceIds: [],
		},
	],
	dayRate: { lowUsd: 100, highUsd: 200, sourceIds: [1] },
	contingencyPercent: { low: 0, high: 0, sourceIds: [] },
	caveats: ["Made up for a test."],
	sources: [
		{
			id: 1,
			title: "A source",
			url: "https://example.org/a",
			published: "2026-01-01",
			kind: "survey",
		},
		{ id: 2, title: "Another", url: "https://example.org/b" },
	],
};

describe("the market research", () => {
	it("reads the research file as the workflow writes it, ignoring fields it does not use", () => {
		const read = readMarketReference(research);

		expect(read.ok).toBe(true);

		if (!read.ok) return;
		expect(read.value.ranges).toHaveLength(2);
		expect(read.value.dayRate).toEqual({ lowUsd: 100, highUsd: 200 });
		expect(read.value.sources[1]).toEqual({
			id: 2,
			title: "Another",
			url: "https://example.org/b",
			published: "",
			kind: "",
		});
		expect(marketRange(read.value, "website", "small")?.highUsd).toBe(2000);
		// A range of zeros is research that found no figure: the board has no range for it.
		expect(marketRange(read.value, "workflow", "large")).toBeNull();
		expect(marketRange(read.value, "webapp", "medium")).toBeNull();
	});

	it.each([
		["no date", { ...research, researchedOn: "last week" }],
		[
			"a low end above the high end",
			{
				...research,
				ranges: [{ ...research.ranges[0], lowUsd: 3000 }],
			},
		],
		[
			"a kind and size twice",
			{ ...research, ranges: [research.ranges[0], research.ranges[0]] },
		],
		[
			"a kind the board does not price",
			{ ...research, ranges: [{ ...research.ranges[0], kind: "idea" }] },
		],
		[
			"a link that is not https",
			{
				...research,
				sources: [{ ...research.sources[0], url: "http://example.org" }],
			},
		],
		[
			"cents",
			{ ...research, ranges: [{ ...research.ranges[0], lowUsd: 1.5 }] },
		],
		["no ranges", { researchedOn: "2026-11-15" }],
	])("refuses research with %s, saying why", (_, raw) => {
		const read = readMarketReference(raw);

		expect(read.ok).toBe(false);

		if (!read.ok) expect(read.error.length).toBeGreaterThan(10);
	});
});

describe("the stored reference", () => {
	it("reads back what was saved, and treats anything unreadable as never saved", () => {
		expect(
			readPricingReference({
				version: 3,
				dayValueCents: 50000,
				contingencyPercent: 15,
				market: research,
				updatedAt: "2026-11-15T12:00:00.000Z",
			}),
		).toMatchObject({
			version: 3,
			dayValueCents: 50000,
			contingencyPercent: 15,
			updatedAt: "2026-11-15T12:00:00.000Z",
		});
		expect(
			readPricingReference({
				version: -1,
				dayValueCents: 50050,
				contingencyPercent: 101,
				market: "nope",
			}),
		).toEqual({
			version: 0,
			dayValueCents: null,
			contingencyPercent: 0,
			market: null,
			updatedAt: "",
		});
		expect(readPricingReference(null).version).toBe(0);
	});
});

describe("found in the offer board's first review", () => {
	it("reads research without a day rate back after it is stored, where the day rate is null", () => {
		const { dayRate: _, ...withoutDayRate } = research;
		const read = readMarketReference(withoutDayRate);

		expect(read.ok).toBe(true);

		if (!read.ok) return;
		expect(read.value.dayRate).toBeNull();

		const stored = readPricingReference(
			JSON.parse(
				JSON.stringify({
					version: 1,
					dayValueCents: null,
					contingencyPercent: 0,
					market: read.value,
					updatedAt: "",
				}),
			),
		);

		expect(stored.market).toEqual(read.value);
	});

	it("still refuses a day rate it cannot read", () => {
		expect(readMarketReference({ ...research, dayRate: "high" }).ok).toBe(
			false,
		);
	});
});
