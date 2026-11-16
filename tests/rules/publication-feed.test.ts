import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import { canonicalPublication } from "../../src/lib/publication/canonical";
import {
	chooseFeed,
	daysToRead,
	moreToRead,
	revisionsToRead,
	showFeed,
	type FeedEvent,
	type FeedDays,
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

/** An index and the days the day read would give for it: its publish events carry these days (by entry). */
type Journal = FeedIndex & { readonly days: FeedDays };

const index = (
	events: FeedEvent[],
	days: { [entryId: string]: string } = {},
): Journal => ({
	latestRevision: events.length === 0 ? null : events.length,
	events,
	days: new Map(
		events.flatMap((e): [number, string][] =>
			e.operation === "publish"
				? [[e.revision, days[e.entryId] ?? "2026-11-01"]]
				: [],
		),
	),
});

const choice = (i: Journal) =>
	Effect.runSync(chooseFeed.decide({ index: i, days: i.days }, {}));

/** The text store as it would answer for each picked event: the canonical text of a publication on its day. */
const textsFor = (i: Journal, erased: readonly number[] = []): FeedTexts =>
	new Map(
		revisionsToRead(choice(i)).map((revision): [number, string | null] => {
			const picked = i.events.find((e) => e.revision === revision);

			const published = i.events.find(
				(e) => e.entryId === picked?.entryId && e.operation === "publish",
			);

			const day = i.days.get(published?.revision ?? 0) ?? "2026-11-01";

			return [
				revision,
				erased.includes(revision)
					? null
					: canonicalPublication(envelope(picked?.entryId ?? "?", day)),
			];
		}),
	);

const shown = (i: Journal, texts: FeedTexts = textsFor(i)) =>
	Effect.runSync(
		Effect.result(
			showFeed.decide({ projectId: "p", choice: choice(i) }, { texts }),
		),
	);

const feed = (i: Journal, texts?: FeedTexts) => {
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

	/** 150 published entries, one a day or so apart, so the history has more than it shows. */
	const long = () => {
		const events = Array.from({ length: 150 }, (_, i) => event(i + 1, `e${i}`));

		const days = Object.fromEntries(
			events.map((e, i) => [
				e.entryId,
				`2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
			]),
		);

		return { events, days };
	};

	it("reads the text of the shown entries and a few spare only: never all 150, and the current entry once", () => {
		const { events, days } = long();
		const i = index(events, days);

		expect(feed(i)?.history).toHaveLength(100);
		// 100 shown, 10 spare; the current entry (the newest publish) is one of them or one more.
		expect(revisionsToRead(choice(i)).length).toBeLessThanOrEqual(111);
		expect(revisionsToRead(choice(i)).length).toBeGreaterThan(100);
	});

	it("shows 100 entries when a withdrawal erased one of them between the reads, as a request just after it would", () => {
		const { events, days } = long();
		const i = index(events, days);
		const picked = choice(i).history[40];

		// The same journal after the withdrawal: that entry's event is erased in the index itself.
		const after = index(
			events.map((e) =>
				e.revision === picked.revision ? { ...e, erased: true } : e,
			),
			days,
		);

		const raced = feed(i, textsFor(i, [picked.revision]));

		expect(raced?.history).toHaveLength(100);
		expect(raced?.history.map((e) => e.entryId)).not.toContain(picked.entryId);
		expect(raced?.history).toEqual(feed(after)?.history);
	});

	it("does not read a spare entry as a publication unless it is shown", () => {
		const { events, days } = long();
		const i = index(events, days);
		const spare = choice(i).history[100];
		const texts = new Map(textsFor(i)).set(spare.revision, "not json");

		expect(feed(i, texts)?.history).toHaveLength(100);
		// With one of the first 100 erased, that spare is shown, and it does not read.
		const erased = new Map(texts).set(choice(i).history[3].revision, null);
		const answer = shown(i, erased);

		expect(Result.isFailure(answer) && answer.failure._tag).toBe(
			"StoredPublicationInvalid",
		);
	});

	describe("reading more when withdrawals erased some of what was read", () => {
		const journal = (total: number) => {
			const events = Array.from({ length: total }, (_, i) =>
				event(i + 1, `e${i}`),
			);

			return index(events, {});
		};

		/** Asks round after round, as the flow does, until nothing more is asked for; returns the entries shown. */
		const refilled = (total: number, erasedCount: number) => {
			const i = journal(total);
			const picked = choice(i);

			// The newest entries (the first picks, all on one day) are the erased ones.
			const erased = new Set(
				picked.history.slice(0, erasedCount).map((pick) => pick.revision),
			);

			const textOf = (revision: number): string | null => {
				const e = i.events.find((x) => x.revision === revision);

				return erased.has(revision)
					? null
					: canonicalPublication(envelope(e?.entryId ?? "?", "2026-11-01"));
			};

			const asked = new Set(revisionsToRead(picked));
			const texts = new Map<number, string | null>();

			for (const revision of asked) texts.set(revision, textOf(revision));

			for (let round = 0; round < 10; round += 1) {
				const more = Effect.runSync(
					moreToRead.decide({ choice: picked, asked, texts }, {}),
				);

				if (more.length === 0) break;

				for (const revision of more) {
					asked.add(revision);
					texts.set(revision, textOf(revision));
				}
			}

			const answer = Effect.runSync(
				Effect.result(
					showFeed.decide({ projectId: "p", choice: picked }, { texts }),
				),
			);

			return { answer, asked, picked, erased };
		};

		it("asks for nothing more when 100 of what was read still have their text", () => {
			const i = journal(150);
			const picked = choice(i);
			const asked = new Set(revisionsToRead(picked));
			const texts = textsFor(i, [picked.history[3].revision]);

			expect(
				Effect.runSync(moreToRead.decide({ choice: picked, asked, texts }, {})),
			).toEqual([]);
		});

		it("asks for the next entry when 11 of 111 read were erased, and the feed is full", () => {
			const { answer, picked, erased } = refilled(111, 11);

			expect(Result.isSuccess(answer) && answer.success.history).toHaveLength(
				100,
			);
			expect(erased.size).toBe(11);
			expect(picked.history).toHaveLength(111);
		});

		it("keeps asking in rounds when 150 of 250 were erased, and reads only as many as it must", () => {
			const { answer, asked } = refilled(250, 150);

			expect(Result.isSuccess(answer) && answer.success.history).toHaveLength(
				100,
			);
			// The 150 newest are erased and the 100 live ones are the oldest, so every entry has to be read to find them.
			expect(asked.size).toBeLessThanOrEqual(251);
			expect(asked.size).toBeGreaterThanOrEqual(250);
		});

		it("does not count the current entry as one of the history read when it sorts below the first 110", () => {
			const events = Array.from({ length: 120 }, (_, k) =>
				event(k + 1, `e${k}`),
			);

			const i = index(events, { e119: "2026-01-01" });
			const picked = choice(i);
			const first = revisionsToRead(picked);

			// The current entry (the newest publish) is asked for with the first read, and is the history's last entry.
			expect(picked.current?.entryId).toBe("e119");
			expect(picked.history.at(-1)?.entryId).toBe("e119");
			expect(first).toContain(picked.current?.revision);
			const asked = new Set(first);

			const texts: Map<number, string | null> = new Map(
				first.map((revision) => [revision, "x"]),
			);

			for (const pick of picked.history.slice(0, 11))
				texts.set(pick.revision, null);

			const more = Effect.runSync(
				moreToRead.decide({ choice: picked, asked, texts }, {}),
			);

			expect(more.length).toBeGreaterThan(0);
			expect(more).not.toContain(picked.current?.revision);
		});

		it("shows what is left when fewer than 100 live entries remain, and stops asking", () => {
			const { answer, asked } = refilled(120, 60);

			expect(Result.isSuccess(answer) && answer.success.history).toHaveLength(
				60,
			);
			expect(asked.size).toBe(120);
		});
	});

	it("asks for the day of the entries that are not withdrawn only", () => {
		const i = index([
			event(1, "a"),
			event(2, "gone"),
			event(3, "gone", { operation: "withdraw", erased: true }),
			event(4, "erased", { erased: true }),
			event(5, "a", { operation: "correct" }),
		]);

		// a: its publish event (1); gone: withdrawn; erased: nothing left of it.
		expect(daysToRead(i)).toEqual([1]);
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
