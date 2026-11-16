import { describe, expect, it } from "vitest";
import {
	advanceChain,
	type Chain,
	drawnChain,
	LINKS,
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
	// its middle about as far as the frames either side of it. On 90, 144, 165 and 240 Hz displays some
	// frames fall between the cable's steps and others hold two of them; drawn naively, those frames
	// stand still or jump.
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
});
