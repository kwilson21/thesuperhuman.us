import { describe, expect, it } from "vitest";
import {
	advanceChain,
	type Chain,
	drawnChain,
	LINKS,
	STEP,
} from "../../src/scripts/switchboard";

const from = { x: 0, y: 0 };
const to = { x: 300, y: 0 };
const link = 360 / LINKS;
const pull = { x: 0, y: 1900 };

// A cable laid straight between the two plugs, with slack to fall into.
function laidStraight(): Chain {
	const points = Array.from({ length: LINKS + 1 }, (_, index) => ({
		x: (300 * index) / LINKS,
		y: 0,
	}));

	return {
		points,
		before: points.map((point) => ({ ...point })),
		clock: 0,
	};
}

// A small seeded generator, so each timing pattern is the same on every run.
function seeded(seed: number) {
	let state = seed;

	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;

		return state / 4294967296;
	};
}

const patterns = {
	"a steady 60 Hz": () => () => 1 / 60,
	"a steady 144 Hz": () => () => 1 / 144,
	"53.3 Hz with 0.15 ms of jitter": () => {
		const random = seeded(1);

		return () => 0.01876 + (random() - 0.5) * 0.0003;
	},
	"random frames of 5 to 40 ms": () => {
		const random = seeded(2);

		return () => 0.005 + random() * 0.035;
	},
	"90 Hz with three frames in ten dropped": () => {
		const random = seeded(3);

		return () => (random() < 0.3 ? 2 : 1) / 90;
	},
	"frames of 7 and 25 ms in turn": () => {
		let odd = false;

		return () => ((odd = !odd) ? 0.007 : 0.025);
	},
	"60 Hz with a second callback 0.02 ms after some frames": () => {
		let frame = 0;

		return () => (++frame % 10 === 0 ? 0.00002 : 1 / 60);
	},
} satisfies Record<string, () => () => number>;

// Runs frames the way the switchboard's loop does, which stops on the first frame whose measured
// movement falls below 0.03 px, and reports when that happened and where the cable's middle lies.
function settle(nextFrame: () => number) {
	const chain = laidStraight();
	let stirring = 1;
	let elapsed = 0;

	while (stirring >= 0.03 && elapsed < 10) {
		const dt = nextFrame();
		elapsed += dt;
		const moved = advanceChain(chain, from, to, link, pull, dt);

		if (moved !== null) stirring = moved;
	}

	return elapsed;
}

// Runs eight seconds of frames, long past any swing, and reports where the cable's middle hangs.
function hang(nextFrame: () => number) {
	const chain = laidStraight();

	for (let elapsed = 0; elapsed < 8; ) {
		const dt = nextFrame();
		elapsed += dt;
		advanceChain(chain, from, to, link, pull, dt);
	}

	return chain.points[LINKS / 2];
}

describe("the switchboard cable's frame update", () => {
	const rested = Object.entries(patterns).map(([name, pattern]) => ({
		name,
		elapsed: settle(pattern()),
		middle: hang(pattern()),
	}));

	for (const { name, elapsed } of rested)
		it(`comes to rest within three seconds at ${name}`, () => {
			expect(elapsed).toBeLessThan(3);
		});

	it("rests in the same shape whatever the frame timing", () => {
		const [first, ...others] = rested;

		for (const other of others) {
			expect(
				Math.abs(other.middle.x - first.middle.x),
				other.name,
			).toBeLessThan(0.05);
			expect(
				Math.abs(other.middle.y - first.middle.y),
				other.name,
			).toBeLessThan(0.05);
		}

		// It has fallen into a hang, not stayed straight.
		expect(first.middle.y).toBeGreaterThan(80);
	});

	it("is not kicked by a frame a few hundredths of a millisecond long", () => {
		const chain = laidStraight();

		for (let frame = 0; frame < 600; frame++)
			advanceChain(chain, from, to, link, pull, 1 / 60);

		const still = chain.points.map((point) => ({ ...point }));

		for (const dt of [0.00002, 1 / 120, 1 / 60])
			advanceChain(chain, from, to, link, pull, dt);

		const furthest = Math.max(
			...chain.points.map((point, index) =>
				Math.hypot(point.x - still[index].x, point.y - still[index].y),
			),
		);

		expect(furthest).toBeLessThan(0.5);
	});

	// The plug moves away at a steady 60 px/s with plenty of slack, and the cable is drawn every frame.
	// Once the first swing has died away the cable is dragged along smoothly, so each frame should move
	// its middle about as far as the frames either side of it. Drawn naively, it moves unevenly at 90 Hz,
	// where a frame holds one of the cable's steps or two, and at 144, 165 and 240 Hz the frames that
	// fall between its steps stand still while others jump.
	for (const fps of [60, 90, 120, 144, 165, 240])
		it(`draws the cable moving evenly at ${fps} Hz while the plug moves steadily`, () => {
			const chain = laidStraight();
			const long = 600 / LINKS;
			const moves: number[] = [];
			let previous = drawnChain(chain, from, to)[LINKS / 2];

			for (let frame = 1; frame <= 3 * fps; frame++) {
				const end = { x: 300 + (60 * frame) / fps, y: 0 };
				advanceChain(chain, from, end, long, pull, 1 / fps);
				const middle = drawnChain(chain, from, end)[LINKS / 2];
				moves.push(Math.hypot(middle.x - previous.x, middle.y - previous.y));
				previous = middle;
			}

			const last = moves.slice(-fps / 2);

			last.forEach((move, index) => {
				expect(move).toBeGreaterThan(0);

				if (index === 0 || index === last.length - 1) return;
				const neighbours = (last[index - 1] + last[index + 1]) / 2;

				expect(Math.abs(move - neighbours) / neighbours).toBeLessThan(0.05);
			});
		});

	// The cable's end is pinned where the plug was at its last step, up to one step behind the plug, and
	// a cable at rest has no speed to carry it on. Drawn naively, the plug setting off from rest
	// stretched the last link to seven times its length for a few frames at 120 Hz, depending on where
	// the frames fell against the cable's steps. Here the plug sets off at 900 px/s from rest on a
	// cable with plenty of slack, at every rate and at five such phases.
	for (const fps of [60, 90, 120, 144, 165, 240])
		it(`never draws a link stretched when the plug sets off from rest at ${fps} Hz`, () => {
			for (const phase of [0, 0.25, 0.5, 0.75, 0.99]) {
				const chain = laidStraight();
				const long = 600 / LINKS;

				for (let frame = 0; frame < 600; frame++)
					advanceChain(chain, from, to, long, pull, 1 / 60);
				chain.clock = phase * STEP;

				for (let frame = 1; frame <= Math.round(fps * 0.15); frame++) {
					const end = { x: 300 + (900 * frame) / fps, y: 0 };
					advanceChain(chain, from, end, long, pull, 1 / fps);
					const drawn = drawnChain(chain, from, end);

					for (let index = 1; index < LINKS; index++) {
						const gap = Math.hypot(
							drawn[index + 1].x - drawn[index].x,
							drawn[index + 1].y - drawn[index].y,
						);

						const own = Math.hypot(
							chain.points[index + 1].x - chain.points[index].x,
							chain.points[index + 1].y - chain.points[index].y,
						);

						// No longer than the cable's own link, which the jerk itself barely stretches.
						expect(gap, `phase ${phase}, frame ${frame}`).toBeLessThanOrEqual(
							own + 1e-9,
						);
						expect(own / long).toBeLessThan(1.05);
					}
				}
			}
		});

	// A change of layout moves both ends at once (the plug is put in place and the cable swings to it),
	// so the first step moves links hundreds of pixels. Carried on along that leap, the drawing flung
	// the cable out to ten times its length for a frame or two. Each drawn link now stays within two
	// steps of a thrown plug's travel (one carried ahead, one pulled in toward the plug) of the cable.
	it("draws the cable near where it is when the layout moves its ends", () => {
		for (const phase of [0, 0.5, 0.99]) {
			const chain = laidStraight();

			for (let frame = 0; frame < 600; frame++)
				advanceChain(chain, from, to, link, pull, 1 / 60);
			const movedFrom = { x: 0, y: 300 };
			const movedTo = { x: 120, y: 340 };
			// What settle does when it puts the plug in place.
			chain.end = { ...movedTo };
			chain.clock = phase * STEP;

			for (let frame = 0; frame < 60; frame++) {
				advanceChain(chain, movedFrom, movedTo, link, pull, 1 / 120);
				const drawn = drawnChain(chain, movedFrom, movedTo);

				for (let index = 1; index < LINKS; index++)
					expect(
						Math.hypot(
							drawn[index].x - chain.points[index].x,
							drawn[index].y - chain.points[index].y,
						),
						`phase ${phase}, frame ${frame}, link ${index}`,
					).toBeLessThanOrEqual(2 * STEP * 2400);
			}
		}
	});
});
