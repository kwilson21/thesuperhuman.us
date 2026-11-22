import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setupProjectPlayers } from "../../src/scripts/project-player";

beforeEach(() => {
	// The test environment has no media element class; only its HAVE_METADATA constant is read.
	vi.stubGlobal("HTMLMediaElement", { HAVE_METADATA: 1 });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/**
 * A fake DOM element with the members the project player script touches, plus the extra members
 * given. fire runs the listeners registered for an event type with no event argument.
 */
function element<E extends object>(extra: E) {
	const handlers: Partial<Record<string, Array<() => void>>> = {};
	const attributes: Partial<Record<string, string>> = {};

	return {
		handlers,
		disabled: false,
		hidden: true,
		textContent: "",
		value: "0",
		style: { setProperty: vi.fn() },
		classList: {
			classes: new Set<string>(),
			add(name: string) {
				this.classes.add(name);
			},
			remove(name: string) {
				this.classes.delete(name);
			},
		},
		addEventListener(type: string, handler: () => void) {
			(handlers[type] ??= []).push(handler);
		},
		getAttribute: (name: string) => attributes[name] ?? null,
		setAttribute: (name: string, value: string) => {
			attributes[name] = value;
		},
		fire(type: string) {
			for (const handler of handlers[type] ?? []) handler();
		},
		...extra,
	};
}

it("shows an accessible problem and disables the controls when the audio cannot load or play, then retries", async () => {
	const load = vi.fn();

	const audio = element({
		paused: true,
		duration: NaN,
		currentTime: 0,
		load,
		pause: vi.fn(),
		play: vi.fn(async () => {
			throw Object.assign(new Error("Not found"), {
				name: "NotSupportedError",
			});
		}),
	});

	const toggle = element({});
	toggle.setAttribute("aria-label", "Play Review");

	const seek = element({}),
		time = element({}),
		wave = element({}),
		problem = element({}),
		status = element({}),
		retry = element({});

	const parts = new Map([
		["audio", audio],
		["[data-player-toggle]", toggle],
		["[data-player-seek]", seek],
		["[data-player-time]", time],
		[".player-wave", wave],
		["[data-player-problem]", problem],
		["[data-player-status]", status],
		["[data-player-retry]", retry],
	]);

	const player = element({
		querySelector: (selector: string) => parts.get(selector) ?? null,
	});

	vi.stubGlobal("document", { querySelectorAll: () => [player] });
	setupProjectPlayers();

	toggle.fire("click");
	await Promise.resolve();
	await Promise.resolve();
	expect(toggle.disabled).toBe(true);
	expect(seek.disabled).toBe(true);
	expect(problem.hidden).toBe(false);
	expect(status.textContent).toContain("could not load");
	expect(player.classList.classes.has("unavailable")).toBe(true);

	retry.fire("click");
	expect(load).toHaveBeenCalledOnce();
	expect(toggle.disabled).toBe(false);
	expect(problem.hidden).toBe(true);

	audio.fire("error");
	expect(toggle.disabled).toBe(true);
	expect(status.textContent).toContain("could not load");
});

/**
 * A player whose audio readiness is read from `media`, so a test can change it before an event fires. The
 * real element exposes these as read-only getters, so they are defined that way here.
 */
function mountPlayer(media: {
	readyState: number;
	duration: number;
	error: MediaError | null;
}) {
	const audio = element({
		paused: true,
		currentTime: 0,
		load: vi.fn(),
		pause: vi.fn(),
		play: vi.fn(),
	});

	Object.defineProperties(audio, {
		readyState: { get: () => media.readyState },
		duration: { get: () => media.duration },
		error: { get: () => media.error },
	});

	const toggle = element({});
	toggle.setAttribute("aria-label", "Play Review");

	const seek = element({}),
		time = element({}),
		wave = element({}),
		problem = element({}),
		status = element({});

	const parts = new Map([
		["audio", audio],
		["[data-player-toggle]", toggle],
		["[data-player-seek]", seek],
		["[data-player-time]", time],
		[".player-wave", wave],
		["[data-player-problem]", problem],
		["[data-player-status]", status],
	]);

	const player = element({
		querySelector: (selector: string) => parts.get(selector) ?? null,
	});

	vi.stubGlobal("document", { querySelectorAll: () => [player] });

	return { audio, toggle, seek, time, problem, status, player };
}

it("renders the duration from metadata that loaded before the script ran, without any event", () => {
	const { time } = mountPlayer({
		readyState: 1,
		duration: 125,
		error: null,
	});

	setupProjectPlayers();

	expect(time.textContent).toBe("0:00 / 2:05");
});

it("shows the unavailable state from an error that happened before the script ran", () => {
	// SAFETY: the script reads only the error's truthiness, so a plain object with a code stands in for MediaError.
	const failed = { code: 4 } as MediaError;

	const { toggle, seek, problem, status, player } = mountPlayer({
		readyState: 0,
		duration: NaN,
		error: failed,
	});

	setupProjectPlayers();

	expect(player.classList.classes.has("unavailable")).toBe(true);
	expect(toggle.disabled).toBe(true);
	expect(seek.disabled).toBe(true);
	expect(problem.hidden).toBe(false);
	expect(status.textContent).toContain("could not load");
});

it("treats an error as unavailable even when metadata has also loaded, and does not render the duration", () => {
	// SAFETY: the script reads only the error's truthiness, so a plain object with a code stands in for MediaError.
	const failed = { code: 4 } as MediaError;

	const { toggle, seek, time, player } = mountPlayer({
		readyState: 1,
		duration: 125,
		error: failed,
	});

	setupProjectPlayers();

	expect(player.classList.classes.has("unavailable")).toBe(true);
	expect(toggle.disabled).toBe(true);
	expect(seek.disabled).toBe(true);
	expect(time.textContent).toBe("");
});

it("leaves the label alone until metadata loads, then renders on loadedmetadata", () => {
	const media = { readyState: 0, duration: NaN, error: null };
	const { audio, time } = mountPlayer(media);

	setupProjectPlayers();
	expect(time.textContent).toBe("");

	media.readyState = 1;
	media.duration = 125;
	audio.fire("loadedmetadata");

	expect(time.textContent).toBe("0:00 / 2:05");
});
