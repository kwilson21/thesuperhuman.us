// The scheduled handler (src/worker.ts) and its work (src/server/market-refresh-job.ts): the handler runs the refresh at
// the cron's time, and the job never rejects, logging a store failure with its fixed line. The Worker's fetch is Astro's
// own handler, which every page the screenshot and end-to-end runs load goes through.
import { afterEach, describe, expect, it, vi } from "vitest";
import { onScheduled, runScheduledRefresh } from "~/server/market-refresh-job";
import { fakeKv, partial } from "../helpers/doubles";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("the scheduled job", () => {
	it("resolves when the store fails, and logs only its fixed line", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const kv = fakeKv({
			get: async () => {
				throw new Error("KV is down");
			},
		});

		await expect(
			runScheduledRefresh(
				partial<Env>({ RESUME_STORE: kv, AI: partial<Ai>({}) }),
				"2026-11-23T07:23:00.000Z",
			),
		).resolves.toBeUndefined();
		expect(error.mock.calls).toEqual([
			[
				"scheduled market refresh: the store failed; the next daily check tries again.",
			],
		]);
	});

	it("does nothing but log when the store or the AI binding is missing", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runScheduledRefresh(partial<Env>({}), "2026-11-23T07:23:00.000Z");

		expect(error).toHaveBeenCalledTimes(1);
	});
});

describe("the Worker's scheduled handler", () => {
	it("runs the refresh at the cron's time and keeps it running past the handler's return", () => {
		const running = Promise.resolve();
		const refresh = vi.fn(() => running);
		const waitUntil = vi.fn();
		const env = partial<Env>({});

		onScheduled(refresh)(
			partial<ScheduledController>({
				scheduledTime: Date.parse("2026-11-23T07:23:00.000Z"),
			}),
			env,
			partial<ExecutionContext>({ waitUntil }),
		);

		expect(refresh).toHaveBeenCalledWith(env, "2026-11-23T07:23:00.000Z");
		expect(waitUntil).toHaveBeenCalledWith(running);
	});
});
