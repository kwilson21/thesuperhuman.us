import { describe, expect, it } from "vitest";
import { createTimings } from "../../scripts/screenshots/timings.mjs";

// A clock the test moves by hand, so every number in a summary is exact.
function fakeClock() {
	let now = 0;

	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("createTimings", () => {
	it("returns no lines when nothing was recorded", () => {
		expect(createTimings(() => 0).summary()).toEqual([]);
	});

	it("accumulates phase time across calls", () => {
		const timings = createTimings(() => 0);
		timings.add("login", "goto", 1000);
		timings.add("login", "goto", 2500);

		expect(timings.summary()[0]).toBe("Timing login: 3.5s. goto 3.5s");
	});

	it("adds elapsed time and returns the result of time()", async () => {
		const clock = fakeClock();
		const timings = createTimings(clock.now);

		const result = await timings.time("login", "goto", async () => {
			clock.advance(2000);

			return "page";
		});

		expect(result).toBe("page");
		expect(timings.summary()[0]).toBe("Timing login: 2.0s. goto 2.0s");
	});

	it("records time even when the timed function throws, and rethrows", async () => {
		const clock = fakeClock();
		const timings = createTimings(clock.now);

		await expect(
			timings.time("login", "goto", async () => {
				clock.advance(1500);
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(timings.summary()[0]).toBe("Timing login: 1.5s. goto 1.5s");
	});

	it("counts each name and prints the counts before the phases", () => {
		const timings = createTimings(() => 0);
		timings.count("login", "captures");
		timings.count("login", "captures");
		timings.count("login", "captures");
		timings.count("login", "sql");
		timings.add("login", "goto", 1000);

		expect(timings.summary()[0]).toBe(
			"Timing login: 1.0s, 3 captures, 1 sql. goto 1.0s",
		);
	});

	it("orders phases largest first, keeping first-seen order on ties", () => {
		const timings = createTimings(() => 0);
		timings.add("login", "close", 100);
		timings.add("login", "goto", 5000);
		timings.add("login", "idle", 100);
		timings.add("login", "fonts", 2000);

		expect(timings.summary()[0]).toBe(
			"Timing login: 7.2s. goto 5.0s, fonts 2.0s, close 0.1s, idle 0.1s",
		);
	});

	it("prints scopes in first-seen order, then one total line", () => {
		const timings = createTimings(() => 0);
		timings.add("second", "goto", 1000);
		timings.add("first", "goto", 1000);

		const lines = timings.summary();
		expect(lines.map((line) => line.split(":")[0])).toEqual([
			"Timing second",
			"Timing first",
			"Timing total",
		]);
	});

	it("sums each phase over all scopes in the total line", () => {
		const timings = createTimings(() => 0);
		timings.add("first", "goto", 1000);
		timings.add("first", "sql", 500);
		timings.add("second", "goto", 2000);

		expect(timings.summary().at(-1)).toBe(
			"Timing total: 3.5s. goto 3.0s, sql 0.5s",
		);
	});

	it("prints seconds with one decimal place", () => {
		const timings = createTimings(() => 0);
		timings.add("login", "goto", 1234);

		expect(timings.summary()[0]).toBe("Timing login: 1.2s. goto 1.2s");
	});

	it("prints a scope that only has counts as zero seconds", () => {
		const timings = createTimings(() => 0);
		timings.count("login", "reused");

		expect(timings.summary()[0]).toBe("Timing login: 0.0s, 1 reused");
	});

	it("reports the wall time of a scope and the unaccounted rest as other", async () => {
		const clock = fakeClock();
		const timings = createTimings(clock.now);

		await timings.wall("login", async () => {
			await timings.time("login", "goto", async () => clock.advance(2000));
			clock.advance(3000);
		});

		expect(timings.summary()[0]).toBe(
			"Timing login: 5.0s. other 3.0s, goto 2.0s",
		);
	});

	it("floors other at zero when phases are longer than the wall time", async () => {
		const timings = createTimings(() => 0);
		await timings.wall("login", async () => {
			timings.add("login", "goto", 6000);
		});

		expect(timings.summary()[0]).toBe(
			"Timing login: 0.0s. goto 6.0s, other 0.0s",
		);
	});

	it("does not compute other for a parallel scope and says how many ran at once", async () => {
		const clock = fakeClock();
		const timings = createTimings(clock.now);

		await timings.wall(
			"pages",
			async () => {
				timings.add("pages", "goto", 9000);
				clock.advance(5000);
			},
			4,
		);

		expect(timings.summary()[0]).toBe(
			"Timing pages: 5.0s (4 at once). goto 9.0s",
		);
	});

	it("returns the result of wall() and records the wall time when it throws", async () => {
		const clock = fakeClock();
		const timings = createTimings(clock.now);

		await expect(
			timings.wall("login", async () => {
				clock.advance(4000);
				throw new Error("failed");
			}),
		).rejects.toThrow("failed");

		expect(timings.summary()[0]).toBe("Timing login: 4.0s. other 4.0s");
	});
});
