import { describe, expect, it } from "vitest";
import {
	advancePlug,
	frameSteps,
	type PlugMotion,
	REACH,
	SEAT,
} from "../../src/scripts/switchboard";

const goal = { point: { x: 300, y: 0 }, scale: 1.14 };

// Runs the plug's frame update, the one the switchboard's animation loop calls, toward a jack 300px
// away at a steady frame rate, and records how far the plug moved each frame.
function run(fps: number, spring: typeof REACH) {
	const plug: PlugMotion = {
		position: { x: 0, y: 0 },
		velocity: { x: 0, y: 0 },
		scale: 1,
		scaleVelocity: 0,
	};

	const moves: number[] = [];
	const gaps: number[] = [];
	let furthest = 0;

	for (let elapsed = 0; elapsed < 2; elapsed += 1 / fps) {
		const before = plug.position.x;
		advancePlug(plug, goal, 1 / fps, spring, false);
		moves.push(plug.position.x - before);
		gaps.push(Math.abs(300 - before));
		furthest = Math.max(furthest, plug.position.x);
	}

	return { plug, moves, gaps, overshoot: furthest - 300 };
}

describe("the switchboard plug's frame update", () => {
	// Battery savers hold animation to 30 frames a second, where one long step made the quick reach
	// spring diverge; displays at 90, 144 or 165 Hz once got an uneven number of steps per frame, so the
	// plug stalled on one frame and jumped on the next.
	for (const fps of [30, 60, 90, 120, 144, 165, 240]) {
		it(`reaches a jack at ${fps} frames a second without overshooting, stalling or jumping, and stops`, () => {
			const { plug, moves, gaps, overshoot } = run(fps, REACH);

			expect(Math.abs(plug.position.x - 300)).toBeLessThan(0.3);
			expect(Math.abs(plug.velocity.x)).toBeLessThan(2);
			expect(Math.abs(plug.scale - 1.14)).toBeLessThan(0.002);
			expect(overshoot).toBeLessThan(0.5);

			// Every frame moves while the plug is still on its way, and once the plug is past its
			// fastest frame each frame moves no further than the one before.
			const fastest = moves.indexOf(Math.max(...moves));

			moves.forEach((move, index) => {
				if (gaps[index] > 1) expect(move).toBeGreaterThan(0);

				if (index > fastest)
					expect(move).toBeLessThanOrEqual(moves[index - 1] + 1e-9);
			});
		});

		it(`seats in a jack at ${fps} frames a second with only a slight overshoot, and stops`, () => {
			const { plug, overshoot } = run(fps, SEAT);

			expect(Math.abs(plug.position.x - 300)).toBeLessThan(0.3);
			expect(Math.abs(plug.velocity.x)).toBeLessThan(2);
			expect(overshoot).toBeGreaterThan(0);
			expect(overshoot).toBeLessThan(30);
		});
	}

	it("keeps a carried plug under the pointer, with its speed capped, while its lift follows the spring", () => {
		const plug: PlugMotion = {
			position: { x: 0, y: 0 },
			velocity: { x: 0, y: 0 },
			scale: 1,
			scaleVelocity: 0,
		};

		advancePlug(plug, goal, 1 / 60, SEAT, true);

		expect(plug.position).toEqual({ x: 300, y: 0 });
		expect(plug.velocity.x).toBe(2400);
		expect(plug.scale).toBeGreaterThan(1);
		expect(plug.scale).toBeLessThan(1.14);
	});

	it("splits a frame into equal steps near 1/120 s, steady under timing jitter, and never runs time backwards", () => {
		expect(frameSteps(-1)).toEqual({ count: 0, size: 0 });
		expect(frameSteps(0)).toEqual({ count: 0, size: 0 });
		expect(frameSteps(0.0005).count).toBe(1);
		expect(frameSteps(1 / 144).count).toBe(1);
		// Real 60 Hz frames last 16.6 or 16.7 ms; both take two steps.
		expect(frameSteps(0.0166).count).toBe(2);
		expect(frameSteps(0.0167).count).toBe(2);
		expect(frameSteps(1 / 120).count).toBe(1);
		expect(frameSteps(1 / 90)).toEqual({ count: 2, size: 1 / 180 });
		expect(frameSteps(1 / 30).count).toBe(4);
		expect(frameSteps(1).count).toBe(4);
	});
});
