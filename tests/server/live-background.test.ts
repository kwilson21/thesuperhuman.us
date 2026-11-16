import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";
import { Background, liveBackground } from "../../src/server/services";
import { double } from "../helpers/doubles";

// The live Background hands effects to the background at once, in order, in one waitUntil. The deferred effects need no
// service: they are run here with an empty context, so one that did would fail.

const defer = (work: readonly Effect.Effect<void>[], ctx?: ExecutionContext) =>
	Background.use((background) => background.defer(work)).pipe(
		Effect.provideContext(liveBackground(ctx)),
		Effect.runPromise,
	);

describe("Background.defer", () => {
	it("starts every effect before it returns, in order, and registers one waitUntil with all of them", async () => {
		const started: number[] = [];
		const registered: Promise<unknown>[] = [];

		const ctx = double<ExecutionContext>({
			waitUntil: vi.fn((work: Promise<unknown>) => {
				registered.push(work);
			}),
		});

		await defer(
			[1, 2].map((n) =>
				Effect.sync(() => {
					started.push(n);
				}),
			),
			ctx,
		);

		expect(started).toEqual([1, 2]);
		expect(registered).toHaveLength(1);
		await registered[0];
	});

	it("with no context waits for the effects", async () => {
		let finished = false;

		await defer([
			Effect.promise(async () => {
				await Promise.resolve();
				finished = true;
			}),
		]);

		expect(finished).toBe(true);
	});
});
