import { describe, expect, it } from "vitest";
import {
	DAMPING,
	plugSteps,
	REACH_DAMPING,
	REACH_STIFFNESS,
	STIFFNESS,
	springSteps,
	type Spring,
} from "../../src/scripts/switchboard";

// Drives the plug's spring frame by frame, as the switchboard's animation loop does, toward a jack
// 300px away, and reports where it ends and how far past the jack it ever went.
function run(frameSeconds: number, stiffness: number, damping: number) {
	const spring: Spring = { value: 0, speed: 0 };
	let clock = 0;
	let furthest = 0;

	for (let elapsed = 0; elapsed < 2; elapsed += frameSeconds) {
		const tick = plugSteps(clock, frameSeconds);
		clock = tick.clock;
		springSteps(spring, 300, tick.steps, stiffness, damping);
		furthest = Math.max(furthest, spring.value);
	}

	return { spring, overshoot: furthest - 300 };
}

describe("the switchboard plug's spring", () => {
	// Battery savers hold animation to 30 frames a second; a single long step at that rate made the
	// quick reach spring diverge, flinging the plug off the page.
	for (const fps of [30, 60, 144]) {
		it(`reaches a jack at ${fps} frames a second without overshooting, and stops`, () => {
			const { spring, overshoot } = run(
				1 / fps,
				REACH_STIFFNESS,
				REACH_DAMPING,
			);

			expect(Math.abs(spring.value - 300)).toBeLessThan(0.3);
			expect(Math.abs(spring.speed)).toBeLessThan(2);
			expect(overshoot).toBeLessThan(0.5);
		});

		it(`seats in a jack at ${fps} frames a second with only a slight overshoot, and stops`, () => {
			const { spring, overshoot } = run(1 / fps, STIFFNESS, DAMPING);
			expect(Math.abs(spring.value - 300)).toBeLessThan(0.3);
			expect(Math.abs(spring.speed)).toBeLessThan(2);
			expect(overshoot).toBeGreaterThan(0);
			expect(overshoot).toBeLessThan(30);
		});
	}

	it("carries at most eight steps out of a long frame and never runs time backwards", () => {
		expect(plugSteps(0, 1).steps).toBe(4);
		expect(plugSteps(0, -1)).toEqual({ steps: 0, clock: 0 });
		expect(plugSteps(0.05, 1 / 30).steps).toBe(8);
	});
});
