import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
	ChangedSinceRead,
	decideAndSave,
	guardedSave,
	isGuardRaised,
	isUniqueViolation,
	rowOrChanged,
} from "../../src/server/guarded-save";
import { DatabaseSync } from "../helpers/sqlite-d1";

describe("isGuardRaised", () => {
	it("recognizes the batch guard's own failure", () => {
		const database = new DatabaseSync(":memory:");

		try {
			database
				.prepare(
					"SELECT CASE WHEN NOT EXISTS(SELECT 1) THEN 1 ELSE json_extract('Template changed','$') END",
				)
				.all();
			expect.unreachable("the guard should raise");
		} catch (error) {
			expect(error instanceof Error && isGuardRaised(error)).toBe(true);
		}
	});

	it("recognizes D1's wording and a wrapped cause", () => {
		expect(
			isGuardRaised(new Error("D1_ERROR: malformed JSON: SQLITE_ERROR")),
		).toBe(true);
		expect(
			isGuardRaised(
				new Error("batch failed", { cause: new Error("malformed JSON") }),
			),
		).toBe(true);
	});

	it("does not take another failure for the guard", () => {
		expect(isGuardRaised(new Error("UNIQUE constraint failed: a.b"))).toBe(
			false,
		);
		expect(isGuardRaised(new Error("D1_ERROR: no such table: x"))).toBe(false);
	});
});

describe("isUniqueViolation", () => {
	it("finds the message down the cause chain, and nothing in a non-Error", () => {
		expect(
			isUniqueViolation(new Error("UNIQUE constraint failed: t.name")),
		).toBe(true);
		expect(
			isUniqueViolation(
				new Error("failed", { cause: new Error("UNIQUE constraint failed") }),
			),
		).toBe(true);
		expect(isUniqueViolation(new Error("other"))).toBe(false);
		expect(isUniqueViolation("UNIQUE")).toBe(false);
	});

	it("stops on a cause chain that loops", () => {
		const loop = new Error("loop");

		loop.cause = loop;
		expect(isUniqueViolation(loop)).toBe(false);
	});
});

describe("rowOrChanged", () => {
	it("gives the returned row", () => {
		expect(Effect.runSync(rowOrChanged([{ id: 1 }]))).toEqual({ id: 1 });
	});

	it("fails with ChangedSinceRead when the UPDATE returned nothing", () => {
		const failure = Effect.runSync(Effect.flip(rowOrChanged([])));

		expect(failure).toBeInstanceOf(ChangedSinceRead);
		expect(failure._tag).toBe("ChangedSinceRead");
	});
});

describe("guardedSave", () => {
	it("gives what the save answered", async () => {
		await expect(Effect.runPromise(guardedSave(async () => 7))).resolves.toBe(
			7,
		);
	});

	it("turns the guard's error into ChangedSinceRead", async () => {
		const failure = await Effect.runPromise(
			Effect.flip(
				guardedSave(async () => Promise.reject(new Error("malformed JSON"))),
			),
		);

		expect(failure._tag).toBe("ChangedSinceRead");
	});

	it("turns a taken name into the refusal given", async () => {
		const failure = await Effect.runPromise(
			Effect.flip(
				guardedSave(
					async () =>
						Promise.reject(new Error("UNIQUE constraint failed: t.name")),
					() => "taken" as const,
				),
			),
		);

		expect(failure).toBe("taken");
	});

	it("is a defect for any other failure", async () => {
		await expect(
			Effect.runPromise(
				guardedSave(async () => Promise.reject(new Error("disk"))),
			),
		).rejects.toThrow("disk");
		await expect(
			Effect.runPromise(
				guardedSave(async () =>
					Promise.reject(new Error("UNIQUE constraint failed")),
				),
			),
		).rejects.toThrow("UNIQUE");
	});
});

describe("decideAndSave", () => {
	const steps = (overrides: {
		decide?: (facts: number) => Effect.Effect<Option.Option<string>, never>;
		save?: (write: string) => Effect.Effect<string, ChangedSinceRead>;
	}) => ({
		facts: Effect.succeed(1),
		decide:
			overrides.decide ??
			((facts: number) => Effect.succeed(Option.some(`w${facts}`))),
		save:
			overrides.save ?? ((write: string) => Effect.succeed(`saved ${write}`)),
		gaveUp: "gave up",
	});

	it("reads, decides and saves", async () => {
		const answer = await Effect.runPromise(decideAndSave(steps({})));

		expect(answer.facts).toBe(1);
		expect(answer.saved).toBe("saved w1");
		expect(Option.isSome(answer.decided)).toBe(true);
	});

	it("does not save when the rule has nothing to do", async () => {
		let saves = 0;

		const answer = await Effect.runPromise(
			decideAndSave(
				steps({
					decide: () => Effect.succeed(Option.none()),
					save: () =>
						Effect.sync(() => {
							saves += 1;

							return "x";
						}),
				}),
			),
		);

		expect(saves).toBe(0);
		expect(answer.saved).toBeUndefined();
	});

	it("asks again on fresh facts when the guard raised, then saves", async () => {
		let reads = 0;
		let saves = 0;

		const answer = await Effect.runPromise(
			decideAndSave({
				facts: Effect.sync(() => ++reads),
				decide: (facts) => Effect.succeed(Option.some(facts)),
				save: (write) =>
					++saves < 3
						? Effect.fail(new ChangedSinceRead())
						: Effect.succeed(write),
				gaveUp: "gave up",
			}),
		);

		expect(reads).toBe(3);
		expect(answer.saved).toBe(3);
	});

	it("gives up as a defect after three tries in all", async () => {
		let reads = 0;

		await expect(
			Effect.runPromise(
				decideAndSave({
					facts: Effect.sync(() => ++reads),
					decide: (facts) => Effect.succeed(Option.some(facts)),
					save: () => Effect.fail(new ChangedSinceRead()),
					gaveUp: "Could not save after three tries.",
				}),
			),
		).rejects.toThrow("Could not save after three tries.");
		expect(reads).toBe(3);
	});

	it("passes a rule's refusal through without retrying", async () => {
		let reads = 0;

		const failure = await Effect.runPromise(
			Effect.flip(
				decideAndSave({
					facts: Effect.sync(() => ++reads),
					decide: () => Effect.fail({ _tag: "Refused" as const }),
					save: () => Effect.succeed("x"),
					gaveUp: "gave up",
				}),
			),
		);

		expect(failure._tag).toBe("Refused");
		expect(reads).toBe(1);
	});
});
