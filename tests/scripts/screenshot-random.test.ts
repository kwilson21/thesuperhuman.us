import { readFileSync } from "node:fs";
import { type Context, createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	installRandom,
	RANDOM_SEED,
	seededRandomScript,
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
			/addInitScript\(\{\s*content: seededRandomScript\(new URL\(BASE\)\.origin\)/,
		);
	});
});
