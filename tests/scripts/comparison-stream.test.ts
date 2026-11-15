import { afterEach, expect, it, vi } from "vitest";
import { setupComparisonPlayers } from "~/scripts/comparison-player";

// The A/B comparison's stream phase: until both versions are decoded, the chosen one plays from its own audio element,
// then synced playback takes over. These stand-ins run the real player against fake elements, a fake audio context and
// a decode the test releases.

afterEach(() => {
	vi.unstubAllGlobals();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Whether the page may set an element's volume; false plays as iOS Safari does, where it always reads 1. */
let volumeSettable = true;

/** A play() the element has not settled yet. */
type PendingPlay = { resolve: () => void; reject: (error: Error) => void };

/**
 * An audio element as the player uses it. Its events arrive as tasks, as a browser's do; play() settles a few
 * milliseconds later, once playing, and pausing before then rejects every play() still pending with an AbortError.
 */
class StandInAudio extends EventTarget {
	paused = true;
	ended = false;
	currentTime = 0;
	controls = true;
	hidden = false;
	currentSrc: string;
	src: string;
	private level = 1;
	private pending: PendingPlay[] = [];

	constructor(readonly dataset: Record<string, string>) {
		super();
		this.src = this.currentSrc = `/music/file/${dataset.version}`;
	}

	get volume() {
		return volumeSettable ? this.level : 1;
	}

	set volume(level: number) {
		if (volumeSettable) this.level = level;
	}

	play() {
		this.paused = false;
		this.ended = false;
		setTimeout(() => this.dispatchEvent(new Event("play")));

		return new Promise<void>((resolve, reject) => {
			const play = { resolve, reject };

			this.pending.push(play);
			setTimeout(() => {
				this.pending = this.pending.filter((other) => other !== play);
				resolve();
			}, 5);
		});
	}

	pause() {
		if (this.paused) return;
		this.paused = true;

		const refused = this.pending.splice(0);

		setTimeout(() => {
			this.dispatchEvent(new Event("pause"));
			refused.forEach((play) => play.reject(new Error("AbortError")));
		});
	}

	/** Plays to the end of the file, as a stream that outruns decoding does. */
	end() {
		this.currentTime = 160 + Number(this.dataset.offset);
		this.paused = true;
		this.ended = true;
		setTimeout(() => {
			this.dispatchEvent(new Event("pause"));
			this.dispatchEvent(new Event("ended"));
		});
	}
}

/** A control the player reads and writes: attributes, data, a value and its listeners. */
class StandInControl extends EventTarget {
	dataset: Record<string, string> = {};
	value = "0";
	max = "0";
	checked = false;
	textContent = "";
	private attributes = new Map<string, string>();
	style = { setProperty: () => {} };

	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}

	click() {
		this.dispatchEvent(new Event("click"));
	}
}

/** The comparison root's data attributes the player reads and writes. */
type RootData = { duration: string; title: string; audioFallback?: string };

/** One played source of the synced transport, so a test can tell whether it is sounding. */
type Source = { started: boolean; stopped: boolean };

/** Mounts one comparison: the mix ("before", quieter) and the master ("after", 2.5 dB louder). */
function mount({ decodes = true, fixedVolume = false } = {}) {
	volumeSettable = !fixedVolume;

	const mix = new StandInAudio({
		version: "before",
		label: "Mix",
		offset: "0",
		loudness: "-14",
	});

	const master = new StandInAudio({
		version: "after",
		label: "Master",
		offset: "0",
		loudness: "-11.5",
	});

	const controls = {
		play: new StandInControl(),
		seek: new StandInControl(),
		volume: new StandInControl(),
		status: new StandInControl(),
		match: new StandInControl(),
		time: new StandInControl(),
	};

	controls.volume.value = "1";

	const switches = ["before", "after"].map((version) => {
		const button = new StandInControl();
		button.dataset.selectVersion = version;

		return button;
	});

	const one = new Map<string, StandInControl>([
		["[data-comparison-play]", controls.play],
		["[data-comparison-seek]", controls.seek],
		["[data-comparison-volume]", controls.volume],
		["[data-comparison-status]", controls.status],
		["[data-match-level]", controls.match],
		["[data-comparison-time]", controls.time],
	]);

	const dataset: RootData = { duration: "160", title: "Old News" };

	const root = Object.assign(new EventTarget(), {
		dataset,
		style: { setProperty: () => {} },
		querySelector: (selector: string) => one.get(selector) ?? null,
		querySelectorAll: (selector: string) =>
			selector === "audio"
				? [mix, master]
				: selector === "[data-select-version]"
					? switches
					: [],
		contains: () => false,
	});

	let releaseDecode = () => {};

	const decoded = new Promise<void>((resolve) => {
		releaseDecode = resolve;
	});

	const sources: Source[] = [];

	class StandInContext {
		currentTime = 0;
		destination = {};

		resume() {
			return Promise.resolve();
		}

		createGain() {
			return {
				gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime() {} },
				connect() {},
			};
		}

		createBufferSource() {
			const source: Source = { started: false, stopped: false };

			sources.push(source);

			return {
				buffer: undefined,
				onended: null,
				connect() {},
				disconnect() {},
				start: () => {
					source.started = true;
				},
				stop: () => {
					source.stopped = true;
				},
			};
		}

		decodeAudioData() {
			return Promise.resolve({ duration: 160 });
		}
	}

	vi.stubGlobal(
		"Audio",
		class {
			private level = 1;

			get volume() {
				return volumeSettable ? this.level : 1;
			}

			set volume(level: number) {
				if (volumeSettable) this.level = level;
			}
		},
	);
	vi.stubGlobal("window", {
		AudioContext: StandInContext,
		addEventListener() {},
	});
	vi.stubGlobal("navigator", {});
	// The full player's loop Length menu is read with instanceof; this comparison has no loop desk.
	vi.stubGlobal("HTMLSelectElement", class {});
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
	vi.stubGlobal("fetch", () =>
		decoded.then(() => ({
			ok: decodes,
			arrayBuffer: async () => new ArrayBuffer(0),
		})),
	);
	vi.stubGlobal("document", {
		querySelectorAll: (selector: string) =>
			selector === "[data-comparison]" ? [root] : [],
	});
	setupComparisonPlayers();

	return {
		root,
		mix,
		master,
		...controls,
		choose: (version: string) =>
			switches
				.find((button) => button.dataset.selectVersion === version)!
				.click(),
		/** Lets both versions finish decoding, and the player hand over. */
		decode: async () => {
			releaseDecode();
			await settle();
		},
		/** Whether the synced transport is sounding. */
		synced: () => sources.some((source) => source.started && !source.stopped),
		label: () => controls.play.getAttribute("aria-label") ?? "",
	};
}

it("streams the chosen version at once, then hands over to synced playback", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	expect(ab.mix.paused).toBe(false);
	expect(ab.label()).toMatch(/^Pause /);
	await ab.decode();
	expect(ab.synced()).toBe(true);
	expect(ab.mix.paused).toBe(true);
	expect(ab.label()).toMatch(/^Pause /);
});

it("stays at the end when the stream finishes before both versions are decoded", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	ab.mix.end();
	await tick();
	expect(ab.label()).toMatch(/^Play /);
	await ab.decode();
	expect(ab.synced()).toBe(false);
	expect(ab.seek.value).toBe("160");
});

it("stays paused when something outside the page pauses the stream, and plays again on one click", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	ab.mix.pause();
	await tick();
	expect(ab.label()).toMatch(/^Play /);
	await ab.decode();
	expect(ab.synced()).toBe(false);
	ab.play.click();
	await settle();
	expect(ab.synced()).toBe(true);
});

it("leaves the stream alone when the version already chosen is chosen again", async () => {
	const ab = mount();

	ab.play.click();
	ab.choose("before");
	await settle();
	expect(ab.mix.paused).toBe(false);
	expect(ab.label()).toMatch(/^Pause /);
	ab.play.click();
	await tick();
	expect(ab.mix.paused).toBe(true);
	await ab.decode();
	expect(ab.synced()).toBe(false);
});

it("switches the stream to the other version at the same point before the handover", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	ab.mix.currentTime = 12;
	ab.choose("after");
	await tick();
	expect(ab.mix.paused).toBe(true);
	expect(ab.master.paused).toBe(false);
	expect(ab.master.currentTime).toBe(12);
	expect(ab.label()).toMatch(/^Pause .*Master$/);
});

it("keeps the controls on the stream when decoding fails, and keeps the fallback's note when paused", async () => {
	const ab = mount({ decodes: false });

	ab.play.click();
	await tick();
	await ab.decode();
	expect(ab.root.dataset.audioFallback).toBe("true");
	expect(ab.mix.paused).toBe(false);
	expect(ab.label()).toMatch(/^Pause /);
	ab.play.click();
	await tick();
	expect(ab.mix.paused).toBe(true);
	expect(ab.label()).toMatch(/^Play /);
	expect(ab.status.textContent).toContain("couldn’t load");
});

it("pauses when a hidden version is started from outside the page after the handover", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	await ab.decode();
	expect(ab.synced()).toBe(true);
	// A media key or the lock screen plays the element whose controls it kept from the stream.
	void ab.mix.play();
	await settle();
	expect(ab.mix.paused).toBe(true);
	expect(ab.synced()).toBe(false);
	expect(ab.label()).toMatch(/^Play /);
});

it("waits for synced playback where a version that should play quieter cannot be turned down", async () => {
	const ab = mount({ fixedVolume: true });

	ab.match.checked = true;
	ab.match.dispatchEvent(new Event("change"));
	ab.choose("after");
	ab.play.click();
	await tick();
	expect(ab.master.paused).toBe(true);
	expect(ab.play.getAttribute("aria-busy")).toBe("true");
	expect(ab.status.textContent).toBe("Preparing synchronized audio…");
	await ab.decode();
	expect(ab.synced()).toBe(true);
});

it("streams the quieter version at full level where volume is fixed, and stops it when it must play quieter", async () => {
	const ab = mount({ fixedVolume: true });

	ab.match.checked = true;
	ab.play.click();
	await tick();
	expect(ab.mix.paused).toBe(false);
	ab.volume.value = "0.5";
	ab.volume.dispatchEvent(new Event("input"));
	await tick();
	expect(ab.mix.paused).toBe(true);
	expect(ab.play.getAttribute("aria-busy")).toBe("true");
	await ab.decode();
	expect(ab.synced()).toBe(true);
});
