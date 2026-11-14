import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import { canonicalPublication } from "../../src/lib/publication/canonical";
import {
	chooseFeed,
	revisionsToRead,
	showFeed,
	type FeedEvent,
	type FeedIndex,
	type FeedTexts,
} from "../../src/server/rules/publication-feed";

// The feed rules: which entry is current, which are history, in what order, which text is read, and when the whole feed
// refuses. The events here carry only the small columns; the text of the picked events comes from a second read.

const envelope = (entryId: string, day: string) => ({
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
		headline: entryId,
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
): FeedEvent => ({
	revision,
	entryId,
	operation: "publish",
	origin: "work",
	erased: false,
	publishedAt: `2026-11-13T11:00:0${revision % 10}.000Z`,
	...over,
});

/** An index whose publish events carry these days (by entry). */
const index = (
	events: FeedEvent[],
	days: { [entryId: string]: string } = {},
): FeedIndex => ({
	latestRevision: events.length === 0 ? null : events.length,
	events,
	days: events.flatMap((e) =>
		e.operation === "publish"
			? [{ entryId: e.entryId, day: days[e.entryId] ?? "2026-11-01" }]
			: [],
	),
});

const choice = (i: FeedIndex) => Effect.runSync(chooseFeed.decide(i, {}));

/** The text store as it would answer for each picked event: the canonical text of a publication on its day. */
const textsFor = (i: FeedIndex, erased: readonly number[] = []): FeedTexts =>
	new Map(
		revisionsToRead(choice(i)).map((revision): [number, string | null] => {
			const picked = i.events.find((e) => e.revision === revision);

			const day =
				i.days.find((d) => d.entryId === picked?.entryId)?.day ?? "2026-11-01";

			return [
				revision,
				erased.includes(revision)
					? null
					: canonicalPublication(envelope(picked?.entryId ?? "?", day)),
			];
		}),
	);

const shown = (i: FeedIndex, texts: FeedTexts = textsFor(i)) =>
	Effect.runSync(
		Effect.result(
			showFeed.decide({ projectId: "p", choice: choice(i) }, { texts }),
		),
	);

const feed = (i: FeedIndex, texts?: FeedTexts) => {
	const answer = shown(i, texts);

	return Result.isSuccess(answer) ? answer.success : null;
};

describe("what the public sees of a journal", () => {
	it("shows the newest published entry as current and every entry once, newest day first", () => {
		const i = index([event(1, "a"), event(2, "b"), event(3, "c")], {
			a: "2026-11-01",
			b: "2026-10-01",
			c: "2026-11-05",
		});

		expect(feed(i)?.current?.entryId).toBe("c");
		expect(feed(i)?.history.map((e) => e.entryId)).toEqual(["c", "a", "b"]);
		expect(feed(i)?.revision).toBe(3);
	});

	it("reads an empty journal as revision 0 with nothing shown", () => {
		expect(feed(index([]))).toEqual({
			projectId: "p",
			revision: 0,
			current: null,
			history: [],
		});
	});

	it("keeps backfilled entries to the history", () => {
		const i = index([event(1, "a"), event(2, "past", { origin: "backfill" })], {
			a: "2026-11-01",
			past: "2026-08-01",
		});

		expect(feed(i)?.current?.entryId).toBe("a");
		expect(feed(i)?.history.map((e) => e.backfilled)).toEqual([false, true]);
	});

	it("shows nothing of a withdrawn entry, and hides an older current one behind a withdrawn newer entry", () => {
		const i = index([
			event(1, "a"),
			event(2, "b"),
			event(3, "b", { operation: "withdraw", erased: true }),
		]);

		expect(feed(i)?.current).toBeNull();
		expect(feed(i)?.history.map((e) => e.entryId)).toEqual(["a"]);
	});

	it("reads the text of the shown entries only: at most 100 in history, and the current entry once", () => {
		const events = Array.from({ length: 150 }, (_, i) => event(i + 1, `e${i}`));

		const days = Object.fromEntries(
			events.map((e, i) => [
				e.entryId,
				`2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
			]),
		);

		const i = index(events, days);

		expect(feed(i)?.history).toHaveLength(100);
		// 100 history picks; the current entry (the newest publish) is one of them or one more, never a read of all 150.
		expect(revisionsToRead(choice(i)).length).toBeLessThanOrEqual(101);
	});

	it("leaves out an entry whose text a withdrawal erased between the two reads, as a withdrawn one", () => {
		const i = index([event(1, "a"), event(2, "b")], {
			a: "2026-11-01",
			b: "2026-11-02",
		});

		const answer = feed(i, textsFor(i, [2]));

		// b was current and in history; its text is gone, so it is neither.
		expect(answer?.current).toBeNull();
		expect(answer?.history.map((e) => e.entryId)).toEqual(["a"]);
	});

	it("refuses the whole feed when a story that is shown is not a publication", () => {
		const i = index([event(1, "a")]);

		for (const payload of [
			"not json",
			"{}",
			canonicalPublication({
				...envelope("a", "2026-11-01"),
				operation: "withdraw",
				story: null,
			}),
		]) {
			const answer = shown(i, new Map([[1, payload]]));

			expect(Result.isFailure(answer) && answer.failure._tag).toBe(
				"StoredPublicationInvalid",
			);
		}
	});
});
