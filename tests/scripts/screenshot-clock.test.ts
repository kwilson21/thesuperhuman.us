import { readFileSync } from "node:fs";
import { type Context, createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	browserClockScript,
	CLOCK_BASE,
	installClock,
} from "../../scripts/screenshots/clock.mjs";

const BASE = Date.parse(CLOCK_BASE);
const REAL_NOW = Date.parse("2026-11-13T15:00:00.000Z");

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

type Scope = { Date: DateConstructor };

// A fake global: the real Date, and nothing else the shim touches.
const scopeWithDate = (): Scope => ({ Date });

// Runs installClock inside a new context against that context's own globalThis, as the browser does.
const installInside = (sandbox: Context, baseMs: number) =>
	runInContext(`(${installClock.toString()})(globalThis, ${baseMs})`, sandbox);

const freshContext = (baseMs: number) => {
	const sandbox = createContext({});
	installInside(sandbox, baseMs);

	return sandbox;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("CLOCK_BASE", () => {
	it("is 22 September 2026 at noon UTC, so no run crosses a date line in New York", () => {
		expect(CLOCK_BASE).toBe("2026-09-22T12:00:00.000Z");
	});
});

describe("installClock", () => {
	it("starts the clock at the base and moves it forward at the real rate", () => {
		let real = REAL_NOW;
		vi.spyOn(Date, "now").mockImplementation(() => real);
		const scope = scopeWithDate();

		installClock(scope, BASE);

		expect(scope.Date.now()).toBe(BASE);
		expect(new scope.Date().getTime()).toBe(BASE);

		real += 5_000;
		expect(scope.Date.now()).toBe(BASE + 5_000);
		expect(new scope.Date().toISOString()).toBe("2026-09-22T12:00:05.000Z");
		expect(scope.Date).not.toBe(Date);
	});

	it("moves the clock back to exactly the base on reset", () => {
		let real = REAL_NOW;
		vi.spyOn(Date, "now").mockImplementation(() => real);
		const scope = scopeWithDate();
		const clock = installClock(scope, BASE);

		real += 90_000;
		expect(scope.Date.now()).toBe(BASE + 90_000);

		clock.reset();
		expect(scope.Date.now()).toBe(BASE);

		real += 2_000;
		expect(scope.Date.now()).toBe(BASE + 2_000);
	});

	it("keeps the argument forms of the real Date", () => {
		vi.spyOn(Date, "now").mockReturnValue(REAL_NOW);
		const scope = scopeWithDate();
		installClock(scope, BASE);

		expect(new scope.Date(0).getTime()).toBe(0);
		expect(new scope.Date("2020-01-02T03:04:05.000Z").toISOString()).toBe(
			"2020-01-02T03:04:05.000Z",
		);
		expect(new scope.Date(2020, 0, 2, 3, 4, 5).getTime()).toBe(
			new Date(2020, 0, 2, 3, 4, 5).getTime(),
		);
		expect(scope.Date.UTC(2020, 0, 1)).toBe(Date.UTC(2020, 0, 1));
		expect(scope.Date.parse("2020-01-01T00:00:00Z")).toBe(
			Date.parse("2020-01-01T00:00:00Z"),
		);
		expect(new scope.Date(BASE).getTime()).toBe(BASE);
	});

	it("returns the pinned time as a string when called without new", () => {
		vi.spyOn(Date, "now").mockReturnValue(REAL_NOW);
		const scope = scopeWithDate();
		installClock(scope, BASE);

		expect(scope.Date()).toBe(new Date(BASE).toString());
	});

	it("keeps instanceof working for dates made before and after the shim", () => {
		vi.spyOn(Date, "now").mockReturnValue(REAL_NOW);
		const before = new Date(0);
		const scope = scopeWithDate();
		installClock(scope, BASE);

		expect(before instanceof scope.Date).toBe(true);
		expect(new scope.Date() instanceof scope.Date).toBe(true);
		expect(new scope.Date() instanceof Date).toBe(true);
	});

	it("keeps the name and length of Date", () => {
		const scope = scopeWithDate();
		installClock(scope, BASE);

		expect(scope.Date.name).toBe("Date");
		expect(scope.Date.length).toBe(Date.length);
	});

	it("does not stack when installed twice, and one restore puts the real Date back", () => {
		let real = REAL_NOW;
		vi.spyOn(Date, "now").mockImplementation(() => real);
		const scope = scopeWithDate();

		const first = installClock(scope, BASE);
		const second = installClock(scope, BASE + 1_000);

		expect(scope.Date.now()).toBe(BASE + 1_000);
		real += 500;
		expect(new scope.Date().getTime()).toBe(BASE + 1_500);

		second.restore();
		expect(scope.Date).toBe(Date);

		// A handle from before the second install is stale and changes nothing.
		first.restore();
		expect(scope.Date).toBe(Date);
	});

	it("does not stack a stale handle's reset over the live clock", () => {
		let real = REAL_NOW;
		vi.spyOn(Date, "now").mockImplementation(() => real);
		const scope = scopeWithDate();

		const first = installClock(scope, BASE);
		installClock(scope, BASE);
		real += 10_000;
		first.reset();

		expect(scope.Date.now()).toBe(BASE + 10_000);
	});

	it("restores the real Date", () => {
		const scope = scopeWithDate();
		const clock = installClock(scope, BASE);

		expect(scope.Date).not.toBe(Date);
		clock.restore();
		expect(scope.Date).toBe(Date);
	});

	it("pins the no-argument Intl formatting, which otherwise reads the real clock", () => {
		const sandbox = freshContext(Date.parse("2020-06-15T12:00:00.000Z"));

		const format = (code: string) => runInContext(code, sandbox);
		const options = `{ timeZone: "UTC", year: "numeric" }`;

		expect(
			format(`new Intl.DateTimeFormat("en-US", ${options}).format()`),
		).toBe("2020");
		expect(
			format(`new Intl.DateTimeFormat("en-US", ${options}).format(undefined)`),
		).toBe("2020");
		expect(
			format(
				`new Intl.DateTimeFormat("en-US", ${options}).formatToParts()[0].value`,
			),
		).toBe("2020");
		expect(
			format(
				`new Intl.DateTimeFormat("en-US", ${options}).format(new Date(0))`,
			),
		).toBe("1970");
	});

	it("gives back the real Intl formatting on restore", () => {
		const sandbox = createContext({});

		const handle = installInside(
			sandbox,
			Date.parse("2020-06-15T12:00:00.000Z"),
		);

		handle.restore();

		const year = runInContext(
			`new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric" }).format(new Date(2031, 0, 1))`,
			sandbox,
		);

		expect(year).toBe("2031");

		expect(
			runInContext(
				`new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric" }).format()`,
				sandbox,
			),
		).toMatch(/^20\d\d$/);
	});

	it("is self-contained, so it still works when its source runs in a fresh context", () => {
		const sandbox = freshContext(BASE);

		const now = Number(runInContext("new Date().getTime()", sandbox));
		expect(now - BASE).toBeGreaterThanOrEqual(0);
		expect(now - BASE).toBeLessThan(60_000);
	});
});

describe("browserClockScript", () => {
	const ORIGIN = "http://127.0.0.1:4321";
	// The capture process's pinned time at some moment: a real day, away from CLOCK_BASE.
	const CAPTURE_NOW = Date.parse("2026-09-24T09:15:00.000Z");

	// Runs the init script in a fresh page context on the given origin, the way Playwright does.
	const runOn = (origin: string, script: string) => {
		const sandbox = createContext({ location: { origin } });
		runInContext(script, sandbox);

		return sandbox;
	};

	it("pins the page's clock to the base it is given, on the preview's own origin", () => {
		const sandbox = runOn(ORIGIN, browserClockScript(ORIGIN, CAPTURE_NOW));

		const now = Number(runInContext("Date.now()", sandbox));
		expect(now - CAPTURE_NOW).toBeGreaterThanOrEqual(0);
		expect(now - CAPTURE_NOW).toBeLessThan(60_000);
	});

	it("leaves a third-party frame on the real clock", () => {
		const sandbox = runOn(
			"https://challenges.cloudflare.com",
			browserClockScript(ORIGIN, CAPTURE_NOW),
		);

		expect(
			Math.abs(Number(runInContext("Date.now()", sandbox)) - Date.now()),
		).toBeLessThan(60_000);
	});

	it("names the base in the script, so each capture passes its own", () => {
		expect(browserClockScript(ORIGIN, CAPTURE_NOW)).toContain(
			`, ${CAPTURE_NOW})`,
		);
	});

	it("is what capture installs, with the capture process's pinned Date.now() as the base", () => {
		const capture = read("scripts/screenshots/capture.mjs");

		expect(capture).toContain("browserClockScript(");
		expect(capture).toMatch(
			/browserClockScript\(new URL\(BASE\)\.origin, Date\.now\(\)\)/,
		);
		expect(capture).not.toContain("Date.parse(CLOCK_BASE)");
	});
});

describe("the clock is wired into every process", () => {
	it("makes the capture process the first importer of the clock install module", () => {
		const capture = read("scripts/screenshots/capture.mjs");
		const firstImport = capture.match(/^import [^;]+;/m)?.[0] ?? "";

		expect(firstImport).toContain("./clock-install.mjs");
	});

	it("installs the clock in the dev server, which runs the site's server code", () => {
		const dev = read("scripts/screenshots/dev.config.mjs");
		const firstImport = dev.match(/^import [^;]+;/m)?.[0] ?? "";

		expect(firstImport).toContain("./clock-install.mjs");
		expect(dev).toContain("/__screenshots/clock/reset");
		expect(dev).toMatch(/method !== "POST"/);
	});

	it("has no day rule left in the capture, cache or README", () => {
		for (const file of [
			"scripts/screenshots/capture.mjs",
			"scripts/screenshots/cache.mjs",
			"scripts/screenshots/README.md",
		])
			expect(read(file), file).not.toMatch(/\bday\b/);
	});
});
