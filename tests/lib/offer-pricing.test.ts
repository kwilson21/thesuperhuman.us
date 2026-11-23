import { describe, expect, it } from "vitest";
import {
	dayValueEstimate,
	estimateHigh,
	estimateLow,
	offerTotal,
	spread,
	upToRounding,
	withinRange,
} from "~/lib/offer-pricing";

describe("the offer board's money rules", () => {
	it("rounds up to whole $50, leaving a whole amount as it is", () => {
		expect(upToRounding(0)).toBe(0);
		expect(upToRounding(1)).toBe(5000);
		expect(upToRounding(5000)).toBe(5000);
		expect(upToRounding(5001)).toBe(10000);
	});

	it("turns days into an estimate with the owner's day value and contingency", () => {
		// 3 to 5 days at $800 a day, with 20% on the high end: $2,400 to $4,800.
		expect(dayValueEstimate([{ daysLow: 3, daysHigh: 5 }], 80000, 20)).toEqual({
			lowCents: 240000,
			highCents: 480000,
		});
		// Two milestones add up; half days count: 2.5 + 1 = 3.5 days at $750 is $2,625, so $2,650.
		expect(
			dayValueEstimate(
				[
					{ daysLow: 2.5, daysHigh: 4 },
					{ daysLow: 1, daysHigh: 2 },
				],
				75000,
				0,
			),
		).toEqual({ lowCents: 265000, highCents: 450000 });
	});

	it("rounds a half cent up before rounding to $50", () => {
		// Half a day at $1 with 1% contingency is 50.5 cents.
		expect(estimateHigh(1, 100, 1)).toBe(5000);
		expect(estimateLow(1, 100)).toBe(5000);
	});

	it.each([
		["no day value", [{ daysLow: 1, daysHigh: 2 }], null, 10],
		["no milestone", [], 80000, 10],
		["four milestones", Array(4).fill({ daysLow: 1, daysHigh: 2 }), 80000, 10],
		["low above high", [{ daysLow: 3, daysHigh: 2 }], 80000, 10],
		["more than 60 days", [{ daysLow: 1, daysHigh: 61 }], 80000, 10],
		["less than half a day", [{ daysLow: 0.2, daysHigh: 1 }], 80000, 10],
		["cents in the day value", [{ daysLow: 1, daysHigh: 2 }], 80050, 10],
		["a contingency over 100%", [{ daysLow: 1, daysHigh: 2 }], 80000, 101],
	] as const)("gives no estimate for %s", (_, milestones, day, contingency) => {
		expect(dayValueEstimate(milestones, day, contingency)).toBeNull();
	});

	it("holds a market figure inside the researched range", () => {
		expect(withinRange(4000, 2000, 10000)).toBe(4000);
		expect(withinRange(1000, 2000, 10000)).toBe(2000);
		expect(withinRange(12000, 2000, 10000)).toBe(10000);
	});

	it("adds an offer's milestone fees, and spreads past totals", () => {
		expect(offerTotal([120000, 240000, 60000])).toBe(420000);
		expect(offerTotal([])).toBe(0);
		expect(spread([])).toBeNull();
		expect(spread([500, 100, 300])).toEqual({
			low: 100,
			middle: 300,
			high: 500,
		});
		expect(spread([400, 100, 300, 200])).toEqual({
			low: 100,
			middle: 200,
			high: 400,
		});
	});
});
