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

	// What the analyser reads out: every sample at this value, so its level is known.
	const sound = { sample: 0 };

	const analyser = {
		fftSize: 2048,
		connect: vi.fn(),
		getFloatTimeDomainData: (into: Float32Array) => into.fill(sound.sample),
	};

	const context = {
		currentTime: 10,
		destination: {},
		createAnalyser: () => analyser,
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
		// SAFETY: ComparisonTransport reads only currentTime, destination, createAnalyser, createGain and createBufferSource from the context, and the fake supplies each of them; its nodes are plain objects with the members the transport uses.
		context as never,
		[
			partial<AudioBuffer>({ duration: 160.3 }),
			partial<AudioBuffer>({ duration: 160 }),
		],
		[0.05, 0],
		160,
		vi.fn(),
	);

	return { context, sources, gains, transport, analyser, sound };
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

	it("starts a loop from the position given, or from the passage's start when that is outside it", () => {
		const { transport, sources } = fixture();
		transport.play();
		transport.setLoop({ start: 40, end: 48 }, 45);
		expect(sources[2].start.mock.calls[0][1]).toBe(45.05);
		transport.setLoop({ start: 40, end: 48 }, 30);
		expect(sources[4].start.mock.calls[0][1]).toBe(40.05);
	});

	it("keeps a seek inside the passage while looping", () => {
		const { transport } = fixture();
		transport.setLoop({ start: 40, end: 48 });
		transport.seek(52);
		expect(transport.position).toBe(40);
		transport.seek(46);
		expect(transport.position).toBe(46);
	});

	it("moves playback into the passage, keeps playing, and stops looping when cleared", () => {
		const { transport, sources, context } = fixture();
		transport.seek(100);
		transport.play();
		transport.setLoop({ start: 40, end: 48 });
		expect(transport.playing).toBe(true);
		expect(sources[2].start.mock.calls[0][1]).toBe(40.05);
		context.currentTime += 2;
		// Already looping and staying put, the playing sources simply stop looping: no restart, no gap. Started without
		// an end, each now stops where the song ends: 160 - 41.97 s from now.
		transport.setLoop(undefined);
		expect(sources).toHaveLength(4);
		expect(sources[2].loop).toBe(false);
		expect(sources[2].stop).toHaveBeenCalledTimes(1);
		expect(sources[2].stop.mock.calls[0][0]).toBeCloseTo(12 + 160 - 41.97);
		expect(transport.playing).toBe(true);
		expect(transport.position).toBeCloseTo(41.97);
	});

	it("changes a playing loop in place when playback stays inside it", () => {
		const { transport, sources, context } = fixture();
		transport.setLoop({ start: 40, end: 56 });
		transport.play();
		context.currentTime = 10.03 + 3;
		transport.setLoop({ start: 40, end: 44 });
		expect(sources).toHaveLength(2);
		expect(sources.map((s) => [s.loopStart, s.loopEnd])).toEqual([
			[40.05, 44.05],
			[40, 44],
		]);
		// Passes count on from the change: 43 now, so the next wrap is 1 s away.
		context.currentTime += 1.5;
		expect(transport.pass).toBe(1);
		expect(transport.position).toBeCloseTo(40.5);
	});

	it("restarts the sources when a new loop leaves playback outside it", () => {
		const { transport, sources, context } = fixture();
		transport.setLoop({ start: 40, end: 56 });
		transport.play();
		context.currentTime = 10.03 + 10;
		transport.setLoop({ start: 40, end: 44 });
		expect(sources).toHaveLength(4);
		expect(sources[2].start.mock.calls[0][1]).toBe(40.05);
	});

	it("keeps the passage inside the song", () => {
		const { transport, context } = fixture();
		transport.setLoop({ start: 155, end: 163 });
		transport.play();
		// The passage ends with the song, at 160, so it wraps 5 s in.
		context.currentTime = 10.03 + 5.5;
		expect(transport.pass).toBe(1);
		expect(transport.position).toBeCloseTo(155.5);
	});
});

describe("flipping A/B at each wrap", () => {
	const levels = [
		[1, 0],
		[0, 0.8],
	];

	/** The level changes a gain has scheduled after `after`, as [level, clock time], from its `from`th call on. */
	const scheduled = (gain: FakeGain, after: number, from = 0) =>
		gain.gain.setTargetAtTime.mock.calls
			.slice(from)
			.filter(([, time]) => time > after)
			.map(([level, time]) => [level, Number(time.toFixed(2))]);

	it("schedules each wrap's version on the audio clock, many wraps ahead", () => {
		const { transport, gains } = fixture();
		transport.seek(44);
		transport.setLoop({ start: 40, end: 48 });
		transport.play();
		transport.setFlip({ levels, selected: 0 });
		// From 44 the first wrap is 4 s in, then every 8 s: the master, the mix, the master...
		const master = scheduled(gains[1], 10.03);
		expect(master.slice(0, 3)).toEqual([
			[0.8, 14.03],
			[0, 22.03],
			[0.8, 30.03],
		]);
		expect(master).toHaveLength(64);
		expect(scheduled(gains[0], 10.03).slice(0, 2)).toEqual([
			[0, 14.03],
			[1, 22.03],
		]);
	});

	it("names the version sounding as the passes go by", () => {
		const { transport, context } = fixture();
		transport.setLoop({ start: 40, end: 48 });
		transport.play();
		transport.setFlip({ levels, selected: 1 });
		expect(transport.flipped).toBe(1);
		context.currentTime = 10.03 + 9;
		expect(transport.flipped).toBe(0);
		context.currentTime = 10.03 + 17;
		expect(transport.flipped).toBe(1);
		transport.setFlip(undefined);
		expect(transport.flipped).toBeUndefined();
	});

	it("resumes with the version that was sounding when paused", () => {
		const { transport, context, gains } = fixture();
		transport.setLoop({ start: 40, end: 48 });
		transport.play();
		transport.setFlip({ levels, selected: 0 });
		context.currentTime = 10.03 + 9;
		transport.pause();
		expect(transport.flipped).toBe(1);

		const resumed = gains[0].gain.setTargetAtTime.mock.calls.length;

		transport.play();
		expect(transport.flipped).toBe(1);
		// From 41 the next wrap is 7 s after the new start, and it goes back to the mix.
		expect(scheduled(gains[0], 19.06, resumed)[0]).toEqual([1, 26.06]);
	});

	it("starts from the version chosen mid-pass, and schedules more once half have passed", () => {
		const { transport, context, gains } = fixture();
		transport.setLoop({ start: 40, end: 48 });
		transport.play();
		context.currentTime = 10.03 + 9;
		transport.setFlip({ levels, selected: 0 });
		expect(transport.flipped).toBe(0);

		const before = gains[0].gain.setTargetAtTime.mock.calls.length;

		context.currentTime = 10.03 + 8 * 20;
		transport.keepFlipping();
		expect(gains[0].gain.setTargetAtTime.mock.calls.length).toBe(before);
		context.currentTime = 10.03 + 8 * 40;
		transport.keepFlipping();
		expect(gains[0].gain.setTargetAtTime.mock.calls.length).toBeGreaterThan(
			before,
		);
	});
});

describe("how loud the comparison sounds", () => {
	it("sends both versions out through one analyser", () => {
		const { gains, analyser, context } = fixture();

		gains.forEach((gain) =>
			expect(gain.connect).toHaveBeenCalledWith(analyser),
		);
		expect(analyser.connect).toHaveBeenCalledWith(context.destination);
	});

	it("reads 0 while paused or silent, 1 at full scale, and halfway 24 dB down", () => {
		const { transport, sound } = fixture();

		sound.sample = 0.5;
		expect(transport.level()).toBe(0);
		transport.play();
		sound.sample = 0;
		expect(transport.level()).toBe(0);
		sound.sample = 1;
		expect(transport.level()).toBe(1);
		sound.sample = 10 ** (-24 / 20);
		expect(transport.level()).toBeCloseTo(0.5, 5);
		sound.sample = 10 ** (-60 / 20);
		expect(transport.level()).toBe(0);
	});
});
