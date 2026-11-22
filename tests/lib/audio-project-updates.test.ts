import { describe, expect, it } from "vitest";
import { defaultFirstUpdate } from "~/lib/audio-project-updates";

describe("default first update", () => {
	it("starts each service with a first update the owner can edit", () => {
		expect(defaultFirstUpdate("vocal-mix")).toContain("solid static mix");
		expect(defaultFirstUpdate("bundle")).toBe(defaultFirstUpdate("vocal-mix"));
		expect(defaultFirstUpdate("mastering")).toContain("shaping the master");
		expect(defaultFirstUpdate("custom")).toContain("plan we agreed");
		expect(defaultFirstUpdate(null)).toBe(defaultFirstUpdate("custom"));

		for (const service of ["vocal-mix", "mastering", "custom"]) {
			const text = defaultFirstUpdate(service);
			expect(text.length).toBeLessThanOrEqual(1000);
			expect(text).not.toContain(" — ");
		}
	});
});
