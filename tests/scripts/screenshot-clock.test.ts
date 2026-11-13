import { readdirSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { type Context, createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	browserClockScript,
	CLOCK_BASE,
	installClock,
	STEP_MS,
	stepTime,
} from "../../scripts/screenshots/clock.mjs";
import {
	CLOCK_BODY_LIMIT,
	clockMiddleware,
	handleClockPost,
	readLimitedBody,
} from "../../scripts/screenshots/clock-endpoint.mjs";
import { createStepper } from "../../scripts/screenshots/clock-steps.mjs";

const BASE = Date.parse(CLOCK_BASE);
const REAL_NOW = Date.parse("2026-11-13T15:00:00.000Z");

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

type Scope = { Date: DateConstructor };

// A scope whose Date is only known to have now(), for a test that puts another Date in place.
type NowOnlyScope = { Date: { now(): number } };

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
	it("is 12 November 2026 at noon UTC, so no run crosses a date line in New York", () => {
		expect(CLOCK_BASE).toBe("2026-11-12T12:00:00.000Z");
	});

	// A scenario that treats a date as past must not sit after the pinned clock, or the server refuses it
	// (the outside signed date cannot be in the future). Dates the website brief treats as still ahead must
	// stay ahead of the clock.
	it("is after the latest date a scenario treats as past, and before the date the brief treats as ahead", () => {
		const day = CLOCK_BASE.slice(0, 10);

		expect(day > "2026-10-20").toBe(true);
		expect(day < "2026-12-01").toBe(true);
	});

	it("keeps a scenario date that should be past from ending up after the pinned clock: no hard-coded date lies between the base day and 1 December 2026", () => {
		const directory = `${process.cwd()}/scripts/screenshots/scenarios`;

		const files = [
			...readdirSync(directory).map(
				(file) => `scripts/screenshots/scenarios/${file}`,
			),
			"scripts/screenshots/agreed-terms.mjs",
		];

		const day = CLOCK_BASE.slice(0, 10);

		for (const file of files)
			for (const [date] of read(file).matchAll(/\b\d{4}-\d{2}-\d{2}\b/g))
				expect(
					date > day && date < "2026-12-01",
					`${file} has ${date}, between the pinned day and 2026-12-01`,
				).toBe(false);
	});
});

describe("installClock", () => {
	it("freezes the clock at the given instant: real time moving on does not move it", () => {
		let real = REAL_NOW;
		vi.spyOn(Date, "now").mockImplementation(() => real);
		const scope = scopeWithDate();

		installClock(scope, BASE);

		expect(scope.Date.now()).toBe(BASE);
		expect(new scope.Date().getTime()).toBe(BASE);

		real += 5_000;
		expect(scope.Date.now()).toBe(BASE);
		expect(new scope.Date().toISOString()).toBe("2026-11-12T12:00:00.000Z");
		expect(scope.Date).not.toBe(Date);
	});

	it("does not move when the real clock runs for minutes", () => {
		let real = REAL_NOW;
		vi.spyOn(Date, "now").mockImplementation(() => real);
		const scope = scopeWithDate();
		installClock(scope, BASE);

		real += 200_000;

		expect(scope.Date.now()).toBe(BASE);
		expect(new scope.Date().getTime()).toBe(BASE);
		expect(runInContext("new Date().getTime()", freshContext(BASE))).toBe(BASE);
	});

	it("moves the clock to exactly the given instant with set, and only that", () => {
		let real = REAL_NOW;
		vi.spyOn(Date, "now").mockImplementation(() => real);
		const scope = scopeWithDate();
		const clock = installClock(scope, BASE);

		clock.set(BASE + 90_000);
		expect(scope.Date.now()).toBe(BASE + 90_000);
		expect(new scope.Date().toISOString()).toBe("2026-11-12T12:01:30.000Z");

		real += 2_000;
		expect(scope.Date.now()).toBe(BASE + 90_000);

		clock.set(BASE);
		expect(scope.Date.now()).toBe(BASE);
	});

	it("does not let a set from a replaced install change the live clock", () => {
		const scope = scopeWithDate();
		const first = installClock(scope, BASE);
		installClock(scope, BASE + 60_000);

		first.set(BASE + 5_000);

		expect(scope.Date.now()).toBe(BASE + 60_000);
	});

	it("gives stepTime one second per step from the base, exactly", () => {
		expect(STEP_MS).toBe(1000);
		expect(stepTime(0)).toBe(BASE);
		expect(stepTime(5)).toBe(Date.parse("2026-11-12T12:00:05.000Z"));
		expect(stepTime(5) - stepTime(4)).toBe(STEP_MS);
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
		expect(new scope.Date().getTime()).toBe(BASE + 1_000);

		second.restore();
		expect(scope.Date).toBe(Date);

		// A handle from before the second install is stale and changes nothing.
		first.restore();
		expect(scope.Date).toBe(Date);
	});

	it("does not let a stale handle's set move the live clock", () => {
		const scope = scopeWithDate();

		const first = installClock(scope, BASE);
		const second = installClock(scope, BASE);
		first.set(BASE + 10_000);

		expect(scope.Date.now()).toBe(BASE);
		second.set(BASE + 20_000);
		expect(scope.Date.now()).toBe(BASE + 20_000);
	});

	it("reports the instant it holds, so the server can answer with the time it really shows", () => {
		const scope = scopeWithDate();
		const clock = installClock(scope, BASE);

		expect(clock.now()).toBe(BASE);
		clock.set(BASE + 3_000);
		expect(clock.now()).toBe(BASE + 3_000);
	});

	it("reports the time code in its scope sees, so a Date something else put in place shows its own time", () => {
		const scope: NowOnlyScope = { Date };
		const clock = installClock(scope, BASE);

		scope.Date = { now: () => BASE + 9_000 };

		expect(clock.now()).toBe(BASE + 9_000);
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

		expect(runInContext("new Date().getTime()", sandbox)).toBe(BASE);
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

	it("freezes the page's clock at the instant it is given, on the preview's own origin", () => {
		const sandbox = runOn(ORIGIN, browserClockScript(ORIGIN, CAPTURE_NOW));

		expect(runInContext("Date.now()", sandbox)).toBe(CAPTURE_NOW);
		expect(runInContext("new Date().getTime()", sandbox)).toBe(CAPTURE_NOW);
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

	it("names the instant in the script, so each capture passes its own", () => {
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
		expect(dev).toContain('"/__screenshots/clock"');
		expect(dev).not.toContain("/reset");
		expect(dev).toContain("clockMiddleware(clock)");
	});

	it("does not compute a date string for the cache, so the date a run happens on cannot reach an image", () => {
		expect(read("scripts/screenshots/capture.mjs")).not.toMatch(
			/toLocaleDateString\(\s*"en-CA"/,
		);
	});
});

describe("the clock endpoint", () => {
	// Stands in for installClock's handle: `set` moves the clock and `now` reports where it is.
	function clockAt(start: number) {
		let current = start;

		return {
			set: (ms: number) => {
				current = ms;
			},
			now: () => current,
		};
	}

	// A handle whose set does nothing, as a server whose clock did not move would be.
	const stuckClock = (start: number) => ({ set: () => {}, now: () => start });

	const JSON_TYPE = "application/json";

	const post = (
		body: string | undefined,
		contentType: string | undefined = JSON_TYPE,
	) => handleClockPost({ method: "POST", contentType, body }, clockAt(BASE));

	it("answers 405 to anything but POST, and says POST is allowed", () => {
		const reply = handleClockPost(
			{ method: "GET", contentType: JSON_TYPE, body: "" },
			clockAt(BASE),
		);

		expect(reply.status).toBe(405);
		expect(reply.headers).toEqual({ allow: "POST" });
	});

	it("answers 415 unless the body is declared as JSON, so a page cannot send a simple form POST", () => {
		const body = JSON.stringify({ now: BASE + STEP_MS });

		expect(
			handleClockPost(
				{ method: "POST", contentType: undefined, body },
				clockAt(BASE),
			).status,
		).toBe(415);
		expect(post(body, "text/plain").status).toBe(415);
		expect(post(body, "application/x-www-form-urlencoded").status).toBe(415);
	});

	it("accepts JSON with a charset parameter", () => {
		expect(
			post(
				JSON.stringify({ now: BASE + STEP_MS }),
				"application/json; charset=utf-8",
			).status,
		).toBe(200);
	});

	it.each([
		["text that is not JSON", "{ now"],
		["an object with no now", "{}"],
		["a fraction", JSON.stringify({ now: BASE + 0.5 })],
		["a string", JSON.stringify({ now: String(BASE) })],
		["null", "null"],
	])("answers 400 for %s", (_, body) => {
		expect(post(body).status).toBe(400);
	});

	it.each([
		["above Date's range", 8.64e15 + 1],
		["below Date's range", -(8.64e15 + 1)],
	])("answers 400 for a time %s", (_, now) => {
		expect(post(JSON.stringify({ now })).status).toBe(400);
	});

	it("accepts the two ends of Date's range", () => {
		expect(post(JSON.stringify({ now: 8.64e15 })).status).toBe(200);
		expect(post(JSON.stringify({ now: -8.64e15 })).status).toBe(200);
	});

	it("answers 200 with the time the clock shows once it is set", () => {
		const reply = post(JSON.stringify({ now: BASE + 5_000 }));

		expect(reply.status).toBe(200);
		expect(JSON.parse(reply.body)).toEqual({ ok: true, now: BASE + 5_000 });
	});

	it("answers with a different time when the clock did not move, so the capture can fail", () => {
		const reply = handleClockPost(
			{
				method: "POST",
				contentType: JSON_TYPE,
				body: JSON.stringify({ now: BASE + 5_000 }),
			},
			stuckClock(BASE),
		);

		expect(JSON.parse(reply.body).now).toBe(BASE);
	});

	it("answers 413 when the body was longer than the limit", () => {
		expect(post(undefined).status).toBe(413);
	});

	it("reads a body that fits the limit whole", async () => {
		const text = JSON.stringify({ now: BASE });

		await expect(
			readLimitedBody(Readable.from([Buffer.from(text)]), CLOCK_BODY_LIMIT),
		).resolves.toBe(text);
	});

	it("reads no body that is longer than the limit", async () => {
		const long = Buffer.alloc(CLOCK_BODY_LIMIT + 1, " ");

		await expect(
			readLimitedBody(Readable.from([long]), CLOCK_BODY_LIMIT),
		).resolves.toBeUndefined();
	});

	it("reads a body sent in two chunks whose total fits the limit", async () => {
		const text = JSON.stringify({ now: BASE });
		const cut = Math.floor(text.length / 2);

		await expect(
			readLimitedBody(
				Readable.from([
					Buffer.from(text.slice(0, cut)),
					Buffer.from(text.slice(cut)),
				]),
				CLOCK_BODY_LIMIT,
			),
		).resolves.toBe(text);
	});

	it("answers 413 to a body sent in two chunks, each under the limit, that is over it together", async () => {
		const clock = clockAt(BASE);
		const response = fakeResponse();
		const chunks = [Buffer.alloc(300, " "), Buffer.alloc(300, " ")];

		await clockMiddleware(clock)(
			fakeRequest({ method: "POST", contentType: JSON_TYPE, chunks }),
			response,
		);

		expect(response.statusCode).toBe(413);
		expect(clock.now()).toBe(BASE);
	});

	// A request stream with the method, URL and headers the middleware reads.
	function fakeRequest({
		method,
		url = "/",
		contentType,
		chunks,
	}: {
		method: string;
		url?: string;
		contentType?: string;
		chunks: Buffer[];
	}) {
		return Object.assign(Readable.from(chunks), {
			method,
			url,
			headers: contentType === undefined ? {} : { "content-type": contentType },
		});
	}

	// Records the status, headers and body the middleware writes.
	function fakeResponse() {
		const headers: Record<string, string> = {};

		const response = {
			statusCode: 200,
			body: "",
			headers,
			setHeader(name: string, value: string) {
				headers[name] = value;
			},
			end(body = "") {
				response.body = body;
			},
		};

		return response;
	}

	it("sets the installed clock from a JSON POST and writes the 200 reply with the time it shows", async () => {
		const clock = clockAt(BASE);
		const response = fakeResponse();

		await clockMiddleware(clock)(
			fakeRequest({
				method: "POST",
				contentType: JSON_TYPE,
				chunks: [Buffer.from(JSON.stringify({ now: BASE + 4_000 }))],
			}),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toBe(JSON_TYPE);
		expect(JSON.parse(response.body)).toEqual({ ok: true, now: BASE + 4_000 });
		expect(clock.now()).toBe(BASE + 4_000);
	});

	it("writes 405 with an allow header for a GET, and leaves the clock alone", async () => {
		const clock = clockAt(BASE);
		const response = fakeResponse();

		await clockMiddleware(clock)(
			fakeRequest({ method: "GET", chunks: [] }),
			response,
		);

		expect(response.statusCode).toBe(405);
		expect(response.headers.allow).toBe("POST");
		expect(clock.now()).toBe(BASE);
	});

	it("answers 404 for any path other than the endpoint's own", async () => {
		const response = fakeResponse();

		await clockMiddleware(clockAt(BASE))(
			fakeRequest({
				method: "POST",
				url: "/other",
				contentType: JSON_TYPE,
				chunks: [],
			}),
			response,
		);

		expect(response.statusCode).toBe(404);
	});
});

describe("createStepper", () => {
	type Call = [string, number];

	// Fake setters that record each call in order. The server answers with `answer(now)`, which a test can change.
	function recorder(
		answer: (now: number) => { ok: boolean; now: number } | null = (now) => ({
			ok: true,
			now,
		}),
	) {
		const calls: Call[] = [];

		return {
			calls,
			setLocal: (now: number) => {
				calls.push(["local", now]);
			},
			setServer: async (now: number) => {
				calls.push(["server", now]);

				return answer(now);
			},
		};
	}

	const stepperFor = (fake: ReturnType<typeof recorder>, maxMs = 50 * 60_000) =>
		createStepper({ ...fake, stepTime, maxMs });

	it("sets both clocks on reset and next, and only the local clock on nextLocal", async () => {
		const fake = recorder();
		const stepper = stepperFor(fake);

		await stepper.reset();
		await stepper.next();
		stepper.nextLocal();
		await stepper.next();

		expect(fake.calls).toEqual([
			["local", stepTime(0)],
			["server", stepTime(0)],
			["local", stepTime(1)],
			["server", stepTime(1)],
			["local", stepTime(2)],
			["local", stepTime(3)],
			["server", stepTime(3)],
		]);
		expect(stepper.step()).toBe(3);
	});

	it("moves both clocks back to step 0 on reset, whatever step it was at", async () => {
		const fake = recorder();
		const stepper = stepperFor(fake);

		await stepper.next();
		await stepper.next();
		fake.calls.length = 0;
		await stepper.reset();

		expect(fake.calls).toEqual([
			["local", stepTime(0)],
			["server", stepTime(0)],
		]);
		expect(stepper.step()).toBe(0);
	});

	it("refuses a next or reset that starts while a next is in flight, and keeps the first call's flag", async () => {
		const pending: Array<() => void> = [];

		const stepper = createStepper({
			setLocal: () => {},
			setServer: (now: number) =>
				new Promise((done) => pending.push(() => done({ ok: true, now }))),
			stepTime,
			maxMs: 50 * 60_000,
		});

		const first = stepper.next();

		await expect(stepper.next()).rejects.toThrow("awaited one at a time");
		await expect(stepper.reset()).rejects.toThrow("awaited one at a time");

		pending[0]();
		await first;

		const second = stepper.next();
		pending[1]();
		await second;

		expect(stepper.step()).toBe(2);
	});

	it("clears the in-flight flag when a clock update rejects, so a later next works", async () => {
		let attempts = 0;

		const stepper = createStepper({
			setLocal: () => {},
			setServer: async (now: number) => {
				attempts += 1;

				if (attempts === 1) throw new Error("server down");

				return { ok: true, now };
			},
			stepTime,
			maxMs: 50 * 60_000,
		});

		await expect(stepper.next()).rejects.toThrow("server down");
		await expect(stepper.next()).resolves.toBeUndefined();

		expect(stepper.step()).toBe(2);
	});

	it.each([
		["a different time", (now: number) => ({ ok: true, now: now + 1 })],
		["an answer that is not ok", (now: number) => ({ ok: false, now })],
		["no answer", () => null],
	])(
		"refuses a server reply with %s, so a clock that did not move fails the capture",
		async (_, answer) => {
			const stepper = stepperFor(recorder(answer));

			await expect(stepper.next()).rejects.toThrow(
				"No clock update at /__screenshots/clock",
			);
		},
	);

	it("refuses a step past the limit before it moves either clock", async () => {
		const fake = recorder();
		const stepper = stepperFor(fake, 2_000);

		await stepper.next();
		await stepper.next();
		const before = fake.calls.length;

		await expect(stepper.next()).rejects.toThrow(
			"too many steps for the owner token",
		);
		expect(fake.calls.length).toBe(before);
		expect(() => stepper.nextLocal()).toThrow(
			"too many steps for the owner token",
		);
	});
});

describe("capture steps the clock", () => {
	const capture = read("scripts/screenshots/capture.mjs");

	// Scenario steps are the only thing that moves the clock. Page captures run before any scenario, at step 0.
	it("sets step 0 before the page captures and before each scenario runs", () => {
		const resets = capture.match(/await stepper\.reset\(\);/g) ?? [];

		expect(resets.length).toBeGreaterThanOrEqual(2);
	});

	it("moves the clock one step on at the start of each capture and each ownerFetch", () => {
		expect(capture).toMatch(
			/async function capture\(\{[^}]*\}\)\s*\{\s*await nextStep\(\);/,
		);
		expect(capture).toMatch(
			/async function ownerFetch\([^)]*\)\s*\{\s*await nextStep\(\);/,
		);
	});

	it("moves the capture process's clock one step on at each sql call, without waiting", () => {
		expect(capture).toMatch(/const sql = \(command\) => \{\s*sqlStep\(\);/);
	});

	it("builds its stepper from the clock and the dev server, and leaves page captures off the clock", () => {
		expect(capture).toMatch(
			/import \{ createStepper \} from "\.\/clock-steps\.mjs";/,
		);
		expect(capture).toMatch(/setLocal: \(now\) => clock\.set\(now\)/);
		expect(capture).toMatch(/maxMs: MAX_STEP_MS/);
		expect(capture).toMatch(
			/async function nextStep\(\) \{\s*if \(currentScenario === undefined\) return;\s*await stepper\.next\(\);\s*\}/,
		);
		expect(capture).toMatch(
			/function sqlStep\(\) \{\s*if \(currentScenario === undefined\) return;\s*stepper\.nextLocal\(\);\s*\}/,
		);
	});

	it("refuses a scenario that would outrun the owner token's expiry", () => {
		expect(read("scripts/screenshots/clock-steps.mjs")).toMatch(
			/too many steps/,
		);
		expect(capture).toMatch(/setExpirationTime\("1h"\)/);
	});
});
