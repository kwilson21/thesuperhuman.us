import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import { canonicalPublication } from "../../src/lib/publication/canonical";
import {
	projectFeed,
	type FeedEvent,
} from "../../src/server/rules/publication-feed";

// The feed rule: which entry is current, which are history, in what order, and when the whole feed refuses.

const envelope = (entryId: string, day: string, headline = entryId) => ({
	version: 1,
	projectId: "p",
	eventId: `e-${entryId}`,
	entryId,
	expectedRevision: 0,
	operation: "publish",
	origin: "work",
	occurredOn: day,
	threadId: null,
	milestoneId: null,
	story: {
		headline,
		summary: "s",
		technicalDetail: null,
		delivery: "available",
		basis: "repository-verified",
	},
});

const event = (
	revision: number,
	entryId: string,
	over: Partial<FeedEvent> = {},
	day = "2026-11-01",
): FeedEvent => ({
	revision,
	entryId,
	operation: "publish",
	origin: "work",
	payload: canonicalPublication(envelope(entryId, day)),
	publishedAt: `2026-11-13T11:00:0${revision}.000Z`,
	...over,
});

const answer = (events: FeedEvent[]) =>
	Effect.runSync(
		Effect.result(
			projectFeed.decide(
				{ projectId: "p" },
				{ revision: events.length, events },
			),
		),
	);

/** The feed the rule shows, or null when it refuses. */
const feed = (events: FeedEvent[]) => {
	const shown = answer(events);

	return Result.isSuccess(shown) ? shown.success : null;
};

/** The name of the refusal, or null when the feed is shown. */
const refusal = (events: FeedEvent[]) => {
	const shown = answer(events);

	return Result.isFailure(shown) ? shown.failure._tag : null;
};

describe("what the public sees of a journal", () => {
	it("shows the newest published entry as current and every entry once, newest day first", () => {
		const shown = feed([
			event(1, "a", {}, "2026-11-01"),
			event(2, "b", {}, "2026-10-01"),
			event(3, "c", {}, "2026-11-05"),
		]);

		expect(shown?.current?.entryId).toBe("c");
		expect(shown?.history.map((e) => e.entryId)).toEqual(["c", "a", "b"]);
		expect(shown?.revision).toBe(3);
	});

	it("keeps backfilled entries to the history", () => {
		const shown = feed([
			event(1, "a", {}, "2026-11-01"),
			event(2, "past", { origin: "backfill" }, "2026-08-01"),
		]);

		expect(shown?.current?.entryId).toBe("a");
		expect(shown?.history.map((e) => e.backfilled)).toEqual([false, true]);
	});

	it("shows nothing of a withdrawn entry, and hides an older current one behind a withdrawn newer entry", () => {
		const shown = feed([
			event(1, "a"),
			event(2, "b"),
			event(3, "b", { operation: "withdraw", payload: null }),
		]);

		expect(shown?.current).toBeNull();
		expect(shown?.history.map((e) => e.entryId)).toEqual(["a"]);
	});

	it("stops the history at the 100 newest days", () => {
		const events = Array.from({ length: 101 }, (_, i) =>
			event(
				i + 1,
				`e${i}`,
				{},
				`2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
			),
		);

		expect(feed(events)?.history).toHaveLength(100);
	});

	it("refuses the whole feed when a story that is shown is not a publication", () => {
		for (const payload of [
			"not json",
			"{}",
			canonicalPublication({
				...envelope("a", "2026-11-01"),
				operation: "withdraw",
				story: null,
			}),
		])
			expect(refusal([event(1, "a", { payload })])).toBe(
				"StoredPublicationInvalid",
			);
	});
});
