import { expect, it } from "vitest";
import { meterLine, meterShare } from "~/lib/loudness-meter";

it("places loudness on one scale from -20 to -6 LUFS, clamped at both ends", () => {
	expect(meterShare(-20)).toBe(0);
	expect(meterShare(-6)).toBe(1);
	expect(meterShare(-13)).toBe(0.5);
	expect(meterShare(-30)).toBe(0);
	expect(meterShare(-2)).toBe(1);
});

it("writes loudness to one decimal with a true minus sign, and says how far Match loudness turned it down", () => {
	expect(meterLine(-12.23)).toBe("−12.2 LUFS");
	expect(meterLine(-12.23, 2.5)).toBe("−12.2 LUFS, turned down 2.5 dB");
	// A cut too small to show at one decimal is left out.
	expect(meterLine(-9.73, 0.01)).toBe("−9.7 LUFS");
});
