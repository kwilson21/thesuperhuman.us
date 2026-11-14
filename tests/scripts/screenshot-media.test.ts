import { type Context, createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	metadataLoaded,
	playersSettled,
	renderPlayers,
	waitForPlayers,
} from "../../scripts/screenshots/media.mjs";

// A fake project player: its audio element and time label, as the page exposes them.
type FakePlayer = {
	querySelector: (
		selector: string,
	) => FakeAudio | { textContent: string } | null;
};

type FakeAudio = {
	src: string;
	error: { code: number } | null;
	readyState: number;
	dispatchEvent: (event: { type: string }) => void;
};

function player(
	options: {
		src?: string;
		error?: { code: number } | null;
		readyState?: number;
		label?: string;
		events?: string[];
	} = {},
): FakePlayer {
	const audio: FakeAudio = {
		src: options.src ?? "/a.mp3",
		error: options.error ?? null,
		readyState: options.readyState ?? 0,
		dispatchEvent: (event) => {
			options.events?.push(event.type);
		},
	};

	const time = { textContent: options.label ?? "0:00" };

	return {
		querySelector: (selector: string) =>
			selector === "audio"
				? audio
				: selector === "[data-player-time]"
					? time
					: null,
	};
}

// Runs a page-side function in a fresh context whose document lists the given players.
function inPage(
	fn: () => boolean | void,
	players: FakePlayer[],
): boolean | undefined {
	const sandbox: Context = createContext({
		document: {
			querySelectorAll: (selector: string) =>
				selector === "[data-project-player]" ? players : [],
		},
		Event: class {
			type: string;

			constructor(type: string) {
				this.type = type;
			}
		},
	});

	// SAFETY: the page functions return a boolean (playersSettled) or nothing (renderPlayers), as typed above.
	return runInContext(`(${fn.toString()})()`, sandbox) as boolean | undefined;
}

describe("metadataLoaded", () => {
	it("holds when there are no players", () => {
		expect(inPage(metadataLoaded, [])).toBe(true);
	});

	it("holds for a player with no source or one that failed to load", () => {
		expect(inPage(metadataLoaded, [player({ src: "" })])).toBe(true);
		expect(
			inPage(metadataLoaded, [player({ error: { code: 4 }, readyState: 0 })]),
		).toBe(true);
	});

	it("waits while a player with a source has no metadata yet", () => {
		expect(inPage(metadataLoaded, [player({ readyState: 0 })])).toBe(false);
	});

	it("holds once the metadata is loaded, even before the label is rendered", () => {
		expect(
			inPage(metadataLoaded, [player({ readyState: 1, label: "0:00" })]),
		).toBe(true);
	});

	it("requires every player, not just the first", () => {
		expect(
			inPage(metadataLoaded, [
				player({ readyState: 1 }),
				player({ readyState: 0 }),
			]),
		).toBe(false);
	});
});

describe("playersSettled", () => {
	it("is settled when there are no players", () => {
		expect(inPage(playersSettled, [])).toBe(true);
	});

	it("waits while the metadata has not loaded, so the label still shows no duration", () => {
		expect(
			inPage(playersSettled, [player({ readyState: 0, label: "0:00" })]),
		).toBe(false);
	});

	it("waits when the metadata is loaded but the label has not been rendered yet", () => {
		expect(
			inPage(playersSettled, [player({ readyState: 1, label: "0:00" })]),
		).toBe(false);
	});

	it("is settled once the metadata is loaded and the label shows the duration", () => {
		expect(
			inPage(playersSettled, [player({ readyState: 1, label: "0:00 / 0:01" })]),
		).toBe(true);
	});

	it("does not wait for a player without a source or one that failed to load", () => {
		expect(inPage(playersSettled, [player({ src: "" })])).toBe(true);
		expect(inPage(playersSettled, [player({ error: { code: 4 } })])).toBe(true);
	});

	it("requires every player, not just the first", () => {
		expect(
			inPage(playersSettled, [
				player({ readyState: 1, label: "0:00 / 0:01" }),
				player({ readyState: 0 }),
			]),
		).toBe(false);
	});
});

describe("renderPlayers", () => {
	it("dispatches loadedmetadata to a loaded player whose label has not rendered the duration", () => {
		const events: string[] = [];

		inPage(renderPlayers, [player({ readyState: 1, label: "0:00", events })]);

		expect(events).toEqual(["loadedmetadata"]);
	});

	it("leaves a player alone when its label already shows the duration, or its metadata is not loaded", () => {
		const shown: string[] = [];
		const waiting: string[] = [];

		inPage(renderPlayers, [
			player({ readyState: 1, label: "0:00 / 0:01", events: shown }),
		]);
		inPage(renderPlayers, [player({ readyState: 0, events: waiting })]);

		expect(shown).toEqual([]);
		expect(waiting).toEqual([]);
	});
});

type FakePage = {
	evaluate: (fn: () => void) => Promise<void>;
	waitForFunction: unknown;
};

// SAFETY: the fake pages implement only the two methods waitForPlayers calls, which is all it reads.
const asPage = (page: FakePage) => page as never;

// A fake page that records the order of its waits and evaluations, by the function passed to each. `timesOut`
// makes every wait time out; `timesOutOn` names the one wait that does.
function recordingPage(options: { timesOut?: boolean; timesOutOn?: string }) {
	const calls: { name: string; timeout?: number }[] = [];

	return {
		calls,
		page: {
			waitForFunction: async (
				fn: () => boolean,
				_argument: null,
				wait: { timeout: number },
			) => {
				calls.push({
					name: fn.name,
					timeout: wait.timeout,
				});

				if (options.timesOut || options.timesOutOn === fn.name) {
					throw Object.assign(new Error("Timeout exceeded."), {
						name: "TimeoutError",
					});
				}

				return true;
			},
			evaluate: async (fn: () => void) => {
				calls.push({ name: fn.name });
			},
		},
	};
}

describe("waitForPlayers", () => {
	it("waits for the metadata, renders the label from it, then waits for the labels", async () => {
		const recorded = recordingPage({ timesOut: false });

		await waitForPlayers(asPage(recorded.page), { timeout: 4321 });

		expect(recorded.calls.map((call) => call.name)).toEqual([
			"metadataLoaded",
			"renderPlayers",
			"playersSettled",
		]);
		expect(recorded.calls[0]?.timeout).toBe(4321);
	});

	it("fails loudly with the reason when the metadata never loads", async () => {
		const recorded = recordingPage({ timesOut: true });

		await expect(
			waitForPlayers(asPage(recorded.page), { timeout: 5 }),
		).rejects.toThrow(/audio player metadata did not load/);
	});

	it("does not blame the metadata when the duration label is what fails to render", async () => {
		const recorded = recordingPage({ timesOutOn: "playersSettled" });

		const failure = waitForPlayers(asPage(recorded.page), { timeout: 5 });

		await expect(failure).rejects.toThrow(/duration label did not render/);
		await expect(failure).rejects.not.toThrow(/metadata did not load/);
	});
});
