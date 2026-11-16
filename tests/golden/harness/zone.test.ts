// The golden fixtures are recorded in UTC, as production Workers run. A zoneless date string is read in the machine's
// zone, so the test run pins TZ=UTC in vitest.config.ts; this proves the pin took effect.
import { describe, expect, it } from "vitest";

describe("the test time zone", () => {
	it("is UTC whatever zone the machine is in", () => {
		expect(process.env.TZ).toBe("UTC");
		expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
		expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(0);
	});

	it("reads a date string with no zone as UTC", () => {
		expect(Date.parse("2026-11-13 11:00:00")).toBe(
			Date.parse("2026-11-13T11:00:00.000Z"),
		);
	});
});
