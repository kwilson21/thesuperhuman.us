import { afterEach, expect, it, vi } from "vitest";
import { setupComparisonPlayers } from "~/scripts/comparison-player";

// The full A/B player's listening desk: Loop repeats a passage from where the visitor is, its length is chosen, and
// Flip A/B switches versions on each pass. These stand-ins run the real player against fake elements, a fake audio
// context and a decode the test releases.

afterEach(() => {
	vi.unstubAllGlobals();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** An audio element as the player uses it before synced playback: its data, its file and whether it shows. */
class StandInAudio {
	controls = true;
	hidden = false;
	currentSrc: string;
	src: string;

	constructor(readonly dataset: Record<string, string>) {
		this.src = this.currentSrc = `/music/file/${dataset.version}`;
	}

	pause() {}

	/** Whether the player moved keyboard focus here. */
	focused = false;

	focus() {
		this.focused = true;
	}
}

/** A control the player reads and writes: attributes, data, a value and its listeners. */
class StandInControl extends EventTarget {
	dataset: Record<string, string> = {};
	value = "0";
	max = "0";
	checked = false;
	disabled = false;
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

/** A loudness meter: its bar's share of the scale and the line beside it. */
class StandInMeter {
	share = "";
	readonly value = new StandInControl();
	readonly style = {
		setProperty: (_name: string, share: string) => (this.share = share),
	};

	querySelector(selector: string) {
		return selector === "[data-lane-meter-value]" ? this.value : null;
	}
}

/** The desk's Loop length menu; the player checks it with instanceof HTMLSelectElement, which this stands in for. */
class StandInSelect extends StandInControl {}

/** The document as the player uses it: its comparisons, whether it is hidden, and its listeners. */
class StandInDocument extends EventTarget {
	hidden = false;
	/** The control keyboard focus is on, if a test put it on one. */
	activeElement: StandInControl | null = null;

	constructor(readonly querySelectorAll: (selector: string) => EventTarget[]) {
		super();
	}
}

/** The comparison root's data attributes the player reads and writes. */
type RootData = { duration: string; title: string; audioFallback?: string };

/** One played source of the synced transport, so a test can tell whether it is sounding and where it started. */
type Source = { started: boolean; stopped: boolean; offset?: number };

/**
 * Mounts one full comparison with its desk (Loop off, Loop length 8 s, Flip off): the mix ("before", quieter) and the
 * master ("after", 2.5 dB louder). `decodedLength` is how long the decoded versions turn out to be.
 */
function mount({ decodes = true, decodedLength = 160 } = {}) {
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

	const loop = {
		toggle: new StandInControl(),
		length: new StandInSelect(),
		flip: new StandInControl(),
	};

	loop.toggle.setAttribute("aria-pressed", "false");
	loop.length.value = "8";

	const one = new Map<string, StandInControl>([
		["[data-comparison-play]", controls.play],
		["[data-comparison-seek]", controls.seek],
		["[data-comparison-volume]", controls.volume],
		["[data-comparison-status]", controls.status],
		["[data-match-level]", controls.match],
		["[data-comparison-time]", controls.time],
		["[data-loop]", loop.toggle],
		["[data-loop-length]", loop.length],
		["[data-loop-flip]", loop.flip],
	]);

	// One loudness meter per version, as the full player renders them.
	const meters = [new StandInMeter(), new StandInMeter()];

	// The shaded loop on each waveform.
	const regions = [{ hidden: true }, { hidden: true }];

	const dataset: RootData = { duration: "160", title: "Old News" };
	const styles = new Map<string, string>();

	const root = Object.assign(new EventTarget(), {
		dataset,
		style: {
			setProperty: (name: string, value: string) => styles.set(name, value),
		},
		querySelector: (selector: string) => one.get(selector) ?? null,
		querySelectorAll: (selector: string) =>
			selector === "audio"
				? [mix, master]
				: selector === "[data-select-version]"
					? switches
					: selector === "[data-lane-meter]"
						? meters
						: selector === "[data-loop-region]"
							? regions
							: [],
		contains: () => false,
	});

	// Whether the versions' files load: a test can let a later try succeed.
	let loads = decodes;
	let releaseDecode = () => {};

	const decoded = new Promise<void>((resolve) => {
		releaseDecode = resolve;
	});

	const sources: Source[] = [];
	const contexts: StandInContext[] = [];
	const gains: [number, number][][] = [];

	class StandInContext {
		currentTime = 0;
		destination = {};

		constructor() {
			contexts.push(this);
		}

		resume() {
			return Promise.resolve();
		}

		createGain() {
			// Each level a gain is set to, with the clock time it is set for.
			const levels: [number, number][] = [];

			gains.push(levels);

			return {
				gain: {
					value: 0,
					cancelScheduledValues() {},
					setTargetAtTime: (level: number, time: number) =>
						levels.push([level, time]),
				},
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
				start: (_when: number, offset: number) => {
					source.started = true;
					source.offset = offset;
				},
				stop: () => {
					source.stopped = true;
				},
			};
		}

		decodeAudioData() {
			return Promise.resolve({ duration: decodedLength });
		}
	}

	vi.stubGlobal("window", {
		AudioContext: StandInContext,
		addEventListener() {},
		setInterval: () => 0,
	});
	vi.stubGlobal("navigator", {});
	vi.stubGlobal("HTMLSelectElement", StandInSelect);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
	vi.stubGlobal("fetch", () =>
		decoded.then(() => ({
			ok: loads,
			arrayBuffer: async () => new ArrayBuffer(0),
		})),
	);

	const page = new StandInDocument((selector: string) =>
		selector === "[data-comparison]" ? [root] : [],
	);

	vi.stubGlobal("document", page);
	setupComparisonPlayers();

	return {
		root,
		mix,
		master,
		/** Puts keyboard focus on a control, as Tab does. */
		focusOn: (control: StandInControl) => {
			page.activeElement = control;
		},
		...controls,
		choose: (version: string) =>
			switches
				.find((button) => button.dataset.selectVersion === version)!
				.click(),
		/** Lets both versions finish decoding, and synced playback start. */
		decode: async () => {
			releaseDecode();
			await settle();
		},
		/** Lets the next try load the versions' files. */
		loadNextTime: () => {
			loads = true;
		},
		/** Whether each waveform shows the shaded loop. */
		shaded: () => regions.map((region) => !region.hidden),
		loop,
		styles,
		/** Each meter's bar share and its line. */
		meters: () => meters.map((meter) => [meter.share, meter.value.textContent]),
		/** Turns Flip A/B on, as a visitor ticking it does. */
		flipOn: () => {
			loop.flip.checked = true;
			loop.flip.dispatchEvent(new Event("change"));
		},
		/** Moves the seek slider to `seconds`, as a visitor dragging it does. */
		seekTo: (seconds: number) => {
			controls.seek.value = String(seconds);
			controls.seek.dispatchEvent(new Event("input"));
		},
		/** Whether the synced transport is sounding. */
		synced: () => sources.some((source) => source.started && !source.stopped),
		/** How many synced sources have started, so a test can tell whether playback restarted. */
		starts: () => sources.filter((source) => source.started).length,
		/** The level each version is set to now, on the audio clock (the last level set for the current time). */
		levelsNow: () =>
			gains.map(
				(levels) =>
					levels
						.filter(([, time]) => time === contexts[0].currentTime)
						.at(-1)?.[0],
			),
		/** Moves the audio clock on, as playback does. */
		advance: (seconds: number) => {
			contexts.forEach((context) => (context.currentTime += seconds));
		},
		/** Where the synced sources last started, in the song. */
		startedAt: () => sources.at(-1)?.offset,
		label: () => controls.play.getAttribute("aria-label") ?? "",
	};
}

it("loops the chosen length from where the visitor is, and says so", async () => {
	const ab = mount();

	ab.seekTo(30);
	ab.loop.toggle.click();
	expect(ab.loop.toggle.getAttribute("aria-pressed")).toBe("true");
	expect(ab.status.textContent).toBe("Looping 0:30 to 0:38.");
	expect(ab.styles.get("--loop-start")).toBe(`${(30 / 160) * 100}%`);
	expect(ab.styles.get("--loop-width")).toBe(`${(8 / 160) * 100}%`);
	// Flip is offered only while looping.
	expect(ab.loop.flip.disabled).toBe(false);
	ab.loop.length.value = "16";
	ab.loop.length.dispatchEvent(new Event("change"));
	expect(ab.status.textContent).toBe("Looping 0:30 to 0:46.");
	ab.loop.toggle.click();
	expect(ab.status.textContent).toBe("Loop off.");
	expect(ab.loop.flip.disabled).toBe(true);
});

it("keeps a loop near the song's end inside the song", () => {
	const ab = mount();

	ab.seekTo(157);
	ab.loop.toggle.click();
	expect(ab.status.textContent).toBe("Looping 2:32 to 2:40.");
});

it("leaves synced playback alone when the length changes with Loop off", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	await ab.decode();

	const starts = ab.starts();

	ab.loop.length.value = "4";
	ab.loop.length.dispatchEvent(new Event("change"));
	expect(ab.starts()).toBe(starts);
	expect(ab.status.textContent).toBe("");
});

it("moves synced playback to a seek inside the loop, even one that lands inside the old loop", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	await ab.decode();
	ab.loop.toggle.click();
	expect(ab.status.textContent).toBe("Looping 0:00 to 0:08.");
	ab.seekTo(46);
	expect(ab.styles.get("--loop-start")).toBe(`${(46 / 160) * 100}%`);
	// Back by less than the loop's length: 43 is inside the old loop, and playback still moves there.
	ab.seekTo(43);
	expect(ab.startedAt()).toBe(43);
	expect(ab.styles.get("--loop-start")).toBe(`${(43 / 160) * 100}%`);
	// The slider says where it is; the loop's status line waits until the seeking settles, so a drag is not read out
	// at every step.
	expect(ab.status.textContent).toBe("Looping 0:00 to 0:08.");
	await new Promise((resolve) => setTimeout(resolve, 750));
	expect(ab.status.textContent).toBe("Looping 0:43 to 0:51.");
});

it("fits the loop to the decoded versions when they end before the catalog's duration", async () => {
	const ab = mount({ decodedLength: 150 });

	ab.seekTo(156);
	ab.loop.toggle.click();
	expect(ab.styles.get("--loop-start")).toBe(`${(152 / 160) * 100}%`);
	ab.play.click();
	await tick();
	await ab.decode();
	expect(ab.styles.get("--loop-start")).toBe(`${(142 / 150) * 100}%`);
	expect(ab.synced()).toBe(true);
});

it("flips to the other version at each wrap on the audio clock", async () => {
	const ab = mount();

	ab.loop.toggle.click();
	ab.flipOn();
	ab.play.click();
	await tick();
	await ab.decode();
	expect(ab.levelsNow()).toEqual([1, 0]);
	ab.advance(9);
	ab.volume.value = "1";
	ab.volume.dispatchEvent(new Event("input"));
	expect(ab.levelsNow()).toEqual([0, 1]);
});

it("keeps the version a flip has just switched to when the volume changes before the next frame", async () => {
	const ab = mount();

	ab.loop.toggle.click();
	ab.flipOn();
	ab.play.click();
	await tick();
	await ab.decode();
	expect(ab.synced()).toBe(true);
	// Past the first wrap of the 0:00 to 0:08 loop: the master sounds now, and no frame has drawn it yet.
	ab.advance(9);
	ab.volume.value = "0.8";
	ab.volume.dispatchEvent(new Event("input"));
	expect(ab.levelsNow()).toEqual([0, 0.8]);
});

it("switches to the version chosen while flipping, playing or paused, and flips on from it", async () => {
	const ab = mount();

	ab.loop.toggle.click();
	ab.flipOn();
	ab.play.click();
	await tick();
	await ab.decode();
	ab.choose("after");
	expect(ab.levelsNow()).toEqual([0, 1]);
	expect(ab.label()).toMatch(/Master$/);
	ab.play.click();
	ab.choose("before");
	expect(ab.label()).toMatch(/Mix$/);
	ab.play.click();
	await settle();
	expect(ab.levelsNow()).toEqual([1, 0]);
});

it("plays the selected version alone again once Flip is turned off", async () => {
	const ab = mount();

	ab.loop.toggle.click();
	ab.flipOn();
	ab.play.click();
	await tick();
	await ab.decode();
	ab.advance(9);
	ab.loop.flip.checked = false;
	ab.loop.flip.dispatchEvent(new Event("change"));
	// The flip had switched to the master; it stays the one playing, through the next wrap too.
	expect(ab.levelsNow()).toEqual([0, 1]);
	ab.advance(8);
	ab.volume.dispatchEvent(new Event("input"));
	expect(ab.levelsNow()).toEqual([0, 1]);
});

it("keeps the load failure's note when a seek that moved the loop settles", async () => {
	const ab = mount({ decodes: false });

	ab.play.click();
	await tick();
	ab.loop.toggle.click();
	ab.seekTo(60);
	await ab.decode();
	expect(ab.root.dataset.audioFallback).toBe("true");
	await new Promise((resolve) => setTimeout(resolve, 750));
	expect(ab.status.textContent).toContain("couldn’t load");
});

it("brings the louder version's meter down to the quieter one's when Match loudness is on, and back when it is off", () => {
	const ab = mount();

	expect(ab.meters()).toEqual([
		[String(6 / 14), "\u221214.0 LUFS"],
		[String(8.5 / 14), "\u221211.5 LUFS"],
	]);
	ab.match.checked = true;
	ab.match.dispatchEvent(new Event("change"));
	expect(ab.meters()).toEqual([
		[String(6 / 14), "\u221214.0 LUFS"],
		[String(6 / 14), "\u221214.0 LUFS, turned down 2.5 dB"],
	]);
	ab.match.checked = false;
	ab.match.dispatchEvent(new Event("change"));
	expect(ab.meters()[1]).toEqual([String(8.5 / 14), "\u221211.5 LUFS"]);
});

it("shades the loop on both waveforms while Loop is on", () => {
	const ab = mount();

	expect(ab.shaded()).toEqual([false, false]);
	ab.loop.toggle.click();
	expect(ab.shaded()).toEqual([true, true]);
	ab.loop.toggle.click();
	expect(ab.shaded()).toEqual([false, false]);
});

it("keeps the wait for synced playback on the status line when Loop is pressed while the audio loads", async () => {
	const ab = mount();

	ab.play.click();
	await tick();
	ab.loop.toggle.click();
	expect(ab.loop.toggle.getAttribute("aria-pressed")).toBe("true");
	expect(ab.status.textContent).toBe("Preparing synchronized audio…");
	await ab.decode();
	expect(ab.synced()).toBe(true);
	expect(ab.shaded()).toEqual([true, true]);
});

it("turns the desk off where the comparison could not load, keeps that note, and offers the desk again on another try", async () => {
	const ab = mount({ decodes: false });

	ab.loop.toggle.click();
	ab.flipOn();
	ab.play.click();
	await tick();
	await ab.decode();
	expect(ab.root.dataset.audioFallback).toBe("true");
	expect(ab.loop.toggle.getAttribute("aria-pressed")).toBe("false");
	expect(ab.loop.toggle.disabled).toBe(true);
	expect(ab.loop.length.disabled).toBe(true);
	expect(ab.loop.flip.disabled).toBe(true);
	expect(ab.shaded()).toEqual([false, false]);
	expect(ab.status.textContent).toContain("couldn’t load");
	// Another try that works leaves the fallback behind, and the desk works again.
	ab.loadNextTime();
	ab.play.click();
	expect(ab.loop.toggle.disabled).toBe(false);
	expect(ab.loop.length.disabled).toBe(false);
	await settle();
	expect(ab.synced()).toBe(true);
	expect(ab.root.dataset.audioFallback).toBeUndefined();
	ab.loop.toggle.click();
	ab.seekTo(40);
	await new Promise((resolve) => setTimeout(resolve, 750));
	expect(ab.status.textContent).toBe("Looping 0:40 to 0:48.");
});

it("leaves the fallback behind when another try starts, even one paused before it loads", async () => {
	const ab = mount({ decodes: false });

	ab.play.click();
	await tick();
	await ab.decode();
	expect(ab.root.dataset.audioFallback).toBe("true");
	// Another try, paused while it loads: the native players are hidden again, and the fallback goes with them.
	ab.play.click();
	ab.play.click();
	await settle();
	expect(ab.root.dataset.audioFallback).toBeUndefined();
	ab.loop.toggle.click();
	ab.seekTo(40);
	await new Promise((resolve) => setTimeout(resolve, 750));
	expect(ab.status.textContent).toBe("Looping 0:40 to 0:48.");
});

it("describes the loop as it is when the line is shown, after the decoded length refits it", async () => {
	const ab = mount({ decodedLength: 158 });

	ab.loop.toggle.click();
	ab.play.click();
	await tick();
	ab.seekTo(155);
	await ab.decode();
	await new Promise((resolve) => setTimeout(resolve, 750));
	expect(ab.status.textContent).toBe("Looping 2:30 to 2:38.");
});

it("drops a loop line still waiting, and moves focus to the first native player, when a load failure turns the desk off", async () => {
	const ab = mount({ decodes: false });

	ab.play.click();
	await tick();
	ab.loop.toggle.click();
	ab.seekTo(40);
	ab.focusOn(ab.loop.toggle);
	await ab.decode();
	expect(ab.mix.focused).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 750));
	expect(ab.status.textContent).toContain("couldn’t load");
});

it("shows no loop line after a quick retry that works, once the failure turned Loop off", async () => {
	const ab = mount({ decodes: false });

	ab.play.click();
	await tick();
	ab.loop.toggle.click();
	ab.seekTo(40);
	await ab.decode();
	ab.loadNextTime();
	ab.play.click();
	await settle();
	expect(ab.synced()).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 750));
	expect(ab.status.textContent).toBe("");
});

it("moves focus off Flip too, to the chosen version's native player, when a load failure turns the desk off", async () => {
	const ab = mount({ decodes: false });

	ab.choose("after");
	ab.play.click();
	await tick();
	ab.loop.toggle.click();
	ab.flipOn();
	ab.focusOn(ab.loop.flip);
	await ab.decode();
	expect(ab.loop.flip.disabled).toBe(true);
	expect(ab.master.focused).toBe(true);
	expect(ab.mix.focused).toBe(false);
});
