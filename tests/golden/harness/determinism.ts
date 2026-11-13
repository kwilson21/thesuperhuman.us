// One frozen clock and seeded randomness for a case, so two runs write identical fixtures.
//
// Frozen: Date.now(), new Date() and performance.now(). Seeded, per case: crypto.randomUUID (a hex counter, so a value
// that a route checks against a hex pattern still passes), crypto.getRandomValues and Math.random. A case moves time
// only with `advance(ms)`, and the move is recorded.
import { vi } from "vitest";
import type { EffectLog } from "./log";

export const START = "2026-11-13T12:00:00.000Z";

/** The n-th id, as a UUID version 4 shape with a hex counter. */
export const uuidFor = (
	n: number,
): `${string}-${string}-${string}-${string}-${string}` =>
	`00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** A small seeded generator (mulberry32). */
function seeded(seed: number) {
	let state = seed >>> 0;

	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export class Determinism {
	private ids = 0;
	private uploads = 0;
	private restores: (() => void)[] = [];

	constructor(private readonly log: EffectLog) {}

	/** An id for a fake's own use (an R2 upload id), counted apart from the UUIDs routes draw. */
	nextFakeId = () => String(++this.uploads);

	now = () => new Date();

	install() {
		vi.useFakeTimers({ toFake: ["Date", "performance"] });
		vi.setSystemTime(new Date(START));

		const bytes = seeded(0x2545f491);
		const floats = seeded(0x9e3779b9);

		const uuid = vi
			.spyOn(crypto, "randomUUID")
			.mockImplementation(() => uuidFor(++this.ids));

		const random = vi
			.spyOn(crypto, "getRandomValues")
			.mockImplementation((array) => {
				if (array === null) return array;

				const view = new Uint8Array(
					array.buffer,
					array.byteOffset,
					array.byteLength,
				);

				for (let index = 0; index < view.length; index += 1)
					view[index] = Math.floor(bytes() * 256);

				return array;
			});

		const math = vi.spyOn(Math, "random").mockImplementation(floats);

		this.restores = [
			() => uuid.mockRestore(),
			() => random.mockRestore(),
			() => math.mockRestore(),
			() => vi.useRealTimers(),
		];
	}

	/** Restarts the id sequence, for setup (sign-in) that must not move the ids the case draws. */
	resetIds() {
		this.ids = 0;
	}

	advance(ms: number) {
		this.log.push({ kind: "advance", ms });
		vi.setSystemTime(Date.now() + ms);
	}

	restore() {
		for (const restore of this.restores) restore();
		this.restores = [];
	}
}
