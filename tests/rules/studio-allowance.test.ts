import { describe, expect, it } from "vitest";
import {
	ALLOWANCE_WINDOW_MS,
	allowanceTimes,
	takeAllowance,
} from "../../src/server/rules/studio-allowance";
import { outcome, run } from "../helpers/offer-rules";

// The allowance rule (docs/plans/2026-11-studio-signin-conversion.md, section 2): a use is taken while the uses counted in
// its window, this one included, are within the limit, as `uses <= limit` in src/lib/audio-client-access.ts decides today;
// a count that came back with no row is refused, as today's `Infinity` was.

const taken = (uses: number | null, limit: number) =>
	outcome(run(takeAllowance.decide({ limit }, { uses })));

describe("taking a use of a studio allowance", () => {
	it("takes every use up to the limit, the limit included", () => {
		for (const limit of [3, 10, 20])
			for (let uses = 1; uses <= limit; uses++)
				expect(taken(uses, limit)).toBe("writes");
	});

	it("refuses the use after the limit, and any later one", () => {
		for (const limit of [3, 10, 20]) {
			expect(taken(limit + 1, limit)).toBe("AllowanceSpent");
			expect(taken(limit + 50, limit)).toBe("AllowanceSpent");
		}
	});

	it("refuses a count that came back with no row", () => {
		expect(taken(null, 10)).toBe("AllowanceSpent");
	});

	it("binds the use at the time read, and prunes the windows that started five minutes before it or earlier", () => {
		expect(ALLOWANCE_WINDOW_MS).toBe(300_000);
		expect(allowanceTimes(new Date("2026-11-13T12:00:00.000Z"))).toEqual({
			at: "2026-11-13T12:00:00.000Z",
			staleAt: "2026-11-13T11:55:00.000Z",
		});
	});
});
