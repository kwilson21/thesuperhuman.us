import { expect, it } from "vitest";
import { ComparisonSignal } from "~/scripts/comparison-signal";
import { followComparison } from "~/scripts/home-signal";

/** Follows a stand-in comparison whose frames come `frame` milliseconds apart, and records what Home would draw. */
function follow(frame = 1000 / 60) {
	const target = new EventTarget();
	const heard: (number | "stopped")[] = [];
	const stop = new AbortController();
	let clock = 0;

	followComparison(
		target,
		{
			playing: (level) => heard.push(level),
			stopped: () => heard.push("stopped"),
		},
		stop.signal,
		() => clock,
	);

	return {
		heard,
		stop,
		send: (level: number, playing = true) => {
			target.dispatchEvent(new ComparisonSignal(level, playing));
			clock += frame;
		},
	};
}

it("rises quickly toward the music's level and falls slowly, as a meter's needle does", () => {
	const home = follow();

	home.send(1);
	home.send(1);
	expect(home.heard).toEqual([0.5, 0.75]);
	home.send(0);
	expect(home.heard.at(-1)).toBeCloseTo(0.75 * 0.88, 10);
});

it("comes to rest when the music stops, and starts from silence the next time", () => {
	const home = follow();

	home.send(1);
	home.send(0, false);
	expect(home.heard).toEqual([0.5, "stopped"]);
	home.send(1);
	expect(home.heard.at(-1)).toBe(0.5);
});

it("stops listening once the motion layer stops", () => {
	const home = follow();

	home.stop.abort();
	home.send(1);
	expect(home.heard).toEqual([]);
});

it("ignores an event that only shares the name", () => {
	const target = new EventTarget();
	const heard: number[] = [];

	followComparison(
		target,
		{ playing: (level) => heard.push(level), stopped: () => heard.push(-1) },
		new AbortController().signal,
	);
	target.dispatchEvent(new Event("comparison-signal"));
	expect(heard).toEqual([]);
});

it("moves alike at any refresh rate: two frames at 120 Hz reach where one at 60 Hz does", () => {
	const at60 = follow();
	const at120 = follow(1000 / 120);

	at60.send(1);
	at60.send(1);
	at120.send(1);
	at120.send(1);
	at120.send(1);
	expect(at120.heard.at(-1)).toBeCloseTo(Number(at60.heard.at(-1)), 10);
});
