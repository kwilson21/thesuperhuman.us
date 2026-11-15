import { describe, expect, it, vi, type Mock } from "vitest";
import { partial } from "../helpers/doubles";
import { ComparisonTransport } from "../../src/scripts/comparison-transport";

/** An audio buffer source with the members the transport calls; the transport sets and clears onended. */
type FakeSource = {
	buffer: null;
	loop?: boolean;
	loopStart?: number;
	loopEnd?: number;
	connect: Mock;
	disconnect: Mock;
	start: Mock;
	stop: Mock;
	onended: (() => void) | null;
};

/** A gain node with the members the transport calls. */
type FakeGain = {
	gain: {
		value: number;
		cancelScheduledValues: Mock;
		setTargetAtTime: Mock;
	};
	connect: Mock;
};

/** The ended callback the transport set on a source; a source without one fails the test. */
function endedCallback(source: FakeSource): () => void {
	if (!source.onended) throw new Error("The transport set no ended callback.");

	return source.onended;
}

function fixture() {
	const sources: FakeSource[] = [],
		gains: FakeGain[] = [];

	const context = {
		currentTime: 10,
		destination: {},
		createGain() {
			const node: FakeGain = {
				gain: {
					value: 0,
					cancelScheduledValues: vi.fn(),
					setTargetAtTime: vi.fn(),
				},
				connect: vi.fn(),
			};

			gains.push(node);

			return node;
		},
		createBufferSource() {
			const source: FakeSource = {
				buffer: null,
				connect: vi.fn(),
				disconnect: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				onended: null,
			};

			sources.push(source);

			return source;
		},
	};

	const transport = new ComparisonTransport(
		// SAFETY: ComparisonTransport reads only currentTime, destination, createGain and createBufferSource from the context, and the fake supplies each of them; its nodes are plain objects with the members the transport uses.
		context as never,
		[
			partial<AudioBuffer>({ duration: 160.3 }),
			partial<AudioBuffer>({ duration: 160 }),
		],
		[0.05, 0],
		160,
		vi.fn(),
	);

	return { context, sources, gains, transport };
}

describe("shared comparison clock", () => {
	it("starts both exports at exactly the same clock time with their source offsets", () => {
		const { transport, sources } = fixture();
		transport.play();
		expect(sources[0].start.mock.calls[0][0]).toBe(
			sources[1].start.mock.calls[0][0],
		);
		expect(sources[0].start.mock.calls[0][1]).toBe(0.05);
		expect(sources[1].start.mock.calls[0][1]).toBe(0);
	});
	it("rapid A/B and loudness changes never seek, restart or stop either source", () => {
		const { transport, sources, context } = fixture();
		transport.play();
		context.currentTime += 1;
		const position = transport.position;

		for (let i = 0; i < 100; i++)
			transport.setLevels(i % 2 ? [1, 0] : [0, 0.75]);
		expect(transport.position).toBe(position);
		expect(sources).toHaveLength(2);
		sources.forEach((s) => {
			expect(s.start).toHaveBeenCalledTimes(1);
			expect(s.stop).not.toHaveBeenCalled();
		});
	});
	it("seeks both exports together and resumes from one position after pausing", () => {
		const { transport, sources, context } = fixture();
		transport.play();
		transport.seek(70);
		expect(sources[2].start.mock.calls[0][1]).toBe(70.05);
		expect(sources[3].start.mock.calls[0][1]).toBe(70);
		context.currentTime += 2;
		transport.pause();
		const stopped = transport.position;
		context.currentTime += 20;
		expect(transport.position).toBe(stopped);
		transport.play();
		expect(sources[4].start.mock.calls[0][1]).toBeCloseTo(stopped + 0.05);
		expect(sources[5].start.mock.calls[0][1]).toBeCloseTo(stopped);
	});
	it("uses the common playable duration and ignores stale ended callbacks after a seek", () => {
		const { transport, sources } = fixture();
		transport.play();
		const ended = endedCallback(sources[0]);
		transport.seek(30);
		ended();
		expect(transport.playing).toBe(true);
		endedCallback(sources[2])();
		expect(transport.playing).toBe(false);
		expect(transport.position).toBe(160);
		transport.play();
		expect(sources[4].start.mock.calls[0][1]).toBe(0.05);
	});
});

describe("looping a passage", () => {
	it("loops both exports over the same passage at their own offsets, without an end", () => {
		const { transport, sources } = fixture();
		transport.seek(40);
		transport.setLoop({ start: 40, end: 48 });
		transport.play();
		expect(sources.map((s) => [s.loop, s.loopStart, s.loopEnd])).toEqual([
			[true, 40.05, 48.05],
			[true, 40, 48],
		]);
		expect(sources[0].start.mock.calls[0]).toEqual([10.03, 40.05]);
		expect(sources[1].start.mock.calls[0]).toEqual([10.03, 40]);
	});

	it("wraps the position and counts passes on the shared clock", () => {
		const { transport, context } = fixture();
		transport.setLoop({ start: 40, end: 48 });
		transport.play();
		context.currentTime = 10.03 + 7.5;
		expect(transport.position).toBeCloseTo(47.5);
		expect(transport.pass).toBe(0);
		context.currentTime = 10.03 + 9;
		expect(transport.position).toBeCloseTo(41);
		expect(transport.pass).toBe(1);
		context.currentTime = 10.03 + 8 * 3 + 0.5;
		expect(transport.pass).toBe(3);
		expect(transport.position).toBeCloseTo(40.5);
	});

	it("names the clock time of the next wrap, for a switch that lands on it", () => {
		const { transport, context } = fixture();
		transport.seek(44);
		transport.setLoop({ start: 40, end: 48 });
		transport.play();
		// From 44 the first wrap is 4 s in; later ones every 8 s.
		expect(transport.nextWrap).toBeCloseTo(10.03 + 4);
		context.currentTime = 10.03 + 5;
		expect(transport.nextWrap).toBeCloseTo(10.03 + 12);
		transport.pause();
		expect(transport.nextWrap).toBeUndefined();
	});

	it("moves playback into the passage, keeps playing, and stops looping when cleared", () => {
		const { transport, sources, context } = fixture();
		transport.seek(100);
		transport.play();
		transport.setLoop({ start: 40, end: 48 });
		expect(transport.playing).toBe(true);
		expect(sources[2].start.mock.calls[0][1]).toBe(40.05);
		context.currentTime += 2;
		transport.setLoop(undefined);
		expect(sources[4].loop).toBeUndefined();
		expect(sources[4].start.mock.calls[0]).toHaveLength(3);
		expect(transport.playing).toBe(true);
	});

	it("keeps the passage inside the song", () => {
		const { transport } = fixture();
		transport.setLoop({ start: 155, end: 163 });
		transport.play();
		expect(transport.nextWrap).toBeCloseTo(10.03 + 5);
	});

	it("schedules a level change at a clock time, replacing any change scheduled from then on", () => {
		const { transport, gains } = fixture();
		transport.setLevelsAt([0, 0.8], 25);
		expect(gains[0].gain.cancelScheduledValues).toHaveBeenCalledWith(25);
		expect(gains[1].gain.setTargetAtTime).toHaveBeenCalledWith(0.8, 25, 0.003);
	});
});
