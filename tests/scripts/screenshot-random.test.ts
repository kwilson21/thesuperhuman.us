import { readFileSync } from "node:fs";
import { type Context, createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	installRandom,
	RANDOM_SEED,
	seededRandomScript,
	WAVE_SCENE_SEED,
} from "../../scripts/screenshots/random.mjs";

const ORIGIN = "http://127.0.0.1:4321";

const read = (path: string): string =>
	readFileSync(`${process.cwd()}/${path}`, "utf8");

// Runs the init script in a fresh page context on the given origin, the way Playwright does.
function runOn(origin: string, script: string): Context {
	const sandbox = createContext({ location: { origin } });

	runInContext(script, sandbox);

	return sandbox;
}

// The first `count` values Math.random gives in the page.
function drawsIn(sandbox: Context, count = 8): number[] {
	return Array.from({ length: count }, () =>
		Number(runInContext("Math.random()", sandbox)),
	);
}

// A scope whose Math inherits the real Math (for imul) but has its own random, so the tests do not touch the
// test process's Math.random.
function freshScope() {
	// SAFETY: Object.create(Math) gives an object with the same methods as Math, and installRandom only replaces random.
	return { Math: Object.create(Math) as Math };
}

describe("installRandom", () => {
	it("gives the same sequence every time it is installed, so each capture sees the same values", () => {
		const first = freshScope();
		const second = freshScope();

		installRandom(first);
		installRandom(second);

		const a = Array.from({ length: 8 }, () => first.Math.random());
		const b = Array.from({ length: 8 }, () => second.Math.random());

		expect(a).toEqual(b);
	});

	it("returns values in [0, 1) that vary", () => {
		const scope = freshScope();

		installRandom(scope);

		const values = Array.from({ length: 50 }, () => scope.Math.random());

		for (const value of values) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}

		expect(new Set(values).size).toBeGreaterThan(40);
	});

	it("starts from the fixed seed the module names", () => {
		expect(Number.isInteger(RANDOM_SEED)).toBe(true);
		expect(RANDOM_SEED).not.toBe(0);
	});

	it("defaults to RANDOM_SEED, since its source is copied into the page and cannot refer to the constant", () => {
		const byDefault = freshScope();
		const bySeed = freshScope();

		installRandom(byDefault);
		installRandom(bySeed, RANDOM_SEED);

		const a = Array.from({ length: 8 }, () => byDefault.Math.random());
		const b = Array.from({ length: 8 }, () => bySeed.Math.random());

		expect(a).toEqual(b);
	});
});

describe("seededRandomScript", () => {
	it("gives the same sequence on each fresh page on the preview's own origin", () => {
		const first = drawsIn(runOn(ORIGIN, seededRandomScript(ORIGIN)));
		const second = drawsIn(runOn(ORIGIN, seededRandomScript(ORIGIN)));

		expect(second).toEqual(first);
	});

	it("leaves a third-party frame on real randomness", () => {
		const seeded = drawsIn(runOn(ORIGIN, seededRandomScript(ORIGIN)));

		const other = runOn(
			"https://challenges.cloudflare.com",
			seededRandomScript(ORIGIN),
		);

		expect(drawsIn(other)).not.toEqual(seeded);
	});

	it("is self-contained, so its source works in a fresh context", () => {
		const sandbox = createContext({});

		runInContext(`(${installRandom.toString()})(globalThis);`, sandbox);

		const values = drawsIn(sandbox);

		expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
	});

	it("is what capture installs before any page script runs", () => {
		const capture = read("scripts/screenshots/capture.mjs");

		expect(capture).toMatch(
			/addInitScript\(\{\s*content: seededRandomScript\(new URL\(BASE\)\.origin, seed\)/,
		);
	});
});

describe("the 404 page's scene", () => {
	// The 404 page draws its scene with `Math.random() < .5`, so the first draw decides it.
	const sceneFor = (seed: number) => {
		const sandbox = runOn(ORIGIN, seededRandomScript(ORIGIN, seed));

		// SAFETY: the expression is a conditional over two string literals, so it always yields one of them.
		return runInContext(
			"Math.random() < .5 ? 'horizon' : 'wave'",
			sandbox,
		) as string;
	};

	it("is the test the 404 page runs, so the scenes below are the page's own", () => {
		expect(read("src/pages/404.astro")).toContain(
			"Math.random() < .5 ? 'horizon' : 'wave'",
		);
	});

	it("shows the horizon with the default seed", () => {
		expect(sceneFor(RANDOM_SEED)).toBe("horizon");
	});

	it("shows the wave with WAVE_SCENE_SEED, so both scenes can be photographed deterministically", () => {
		expect(sceneFor(WAVE_SCENE_SEED)).toBe("wave");
		expect(WAVE_SCENE_SEED).not.toBe(RANDOM_SEED);
	});
});
