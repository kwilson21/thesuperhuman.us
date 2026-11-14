// The feed rules: what a project's journal shows the public, in pure steps over plain reads, so a request reads the
// journal's small columns for the project, the day of each entry that may be shown, and the text of the entries it
// shows, never the text of all of them.
//   daysToRead  from the small columns of every event (no text), the publish events whose day the choice needs: those of
//               the entries that are not withdrawn.
//   chooseFeed  from the small columns and those days, picks the CURRENT entry (the newest published entry of live work, if
//               its newest live event is not a withdrawal) and the HISTORY (every entry that was not withdrawn, once, at
//               its newest event, newest day first), the first 100 and a few spare. Backfilled entries are history only.
//   showFeed    from the text of the picked events, reads each as a publication and builds the feed. A picked event whose
//               text is gone by now (a withdrawal landed between the reads and erased it) is treated as withdrawn and
//               left out, and the next spare entry takes its place, so the history has the 100 a request just after the
//               withdrawal would show. A story that is shown and does not read as a publication makes the whole feed
//               refuse, because the journal holds something this site did not write.
// Neither reads a store or writes anything, so no write-time guard applies. Nothing is decided in SQL: the store returns
// columns and text, and the choices above are made here.
import * as Data from "effect/Data";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { parsePublication } from "../../lib/publication/contract";
import type { ProjectFeed, PublicEntry } from "../../lib/publication/read";
import { alwaysWrites, term, unless } from "../terms";

/** The small columns of one stored event: no text. `erased` says its text was erased by a withdrawal. */
export type FeedEvent = {
	readonly revision: number;
	readonly entryId: string;
	readonly operation: string;
	readonly origin: string;
	readonly erased: boolean;
	readonly publishedAt: string;
};

/** What the first read gives: the latest revision (null when the project has no event) and every event's small columns. */
export type FeedIndex = {
	readonly latestRevision: number | null;
	/** Every event of the project, oldest revision first. */
	readonly events: readonly FeedEvent[];
};

/** The day each publish event says the work happened, by revision, read from its stored text; null when it names none or the text is gone. */
export type FeedDays = ReadonlyMap<number, string | null>;

/** An event picked to be shown, with what the entry needs besides its text. */
export type FeedPick = {
	readonly revision: number;
	readonly entryId: string;
	/** The origin the entry shows: the publish event's for history, the event's own for the current entry. */
	readonly origin: string;
	/** The day to show instead of the story's own (history only). */
	readonly day: string | null;
	readonly publishedAt: string;
};

export type FeedChoice = {
	readonly revision: number;
	readonly current: FeedPick | null;
	readonly history: readonly FeedPick[];
};

/** A stored event that is shown does not read as a publication with a story: the journal holds something this site did not write. */
export class StoredPublicationInvalid extends Data.TaggedError(
	"StoredPublicationInvalid",
) {
	readonly say = "stored publication invalid";
}

const MOST_IN_HISTORY = 100;

/**
 * Entries read beyond the 100 shown. A withdrawal that lands between the reads erases a picked entry, and the entry just
 * after the hundredth takes its place, as it would for a request made just after the withdrawal. The read stays bounded.
 */
const SPARE_IN_HISTORY = 10;

/** The newest event of each entry. */
function newestOfEach(events: readonly FeedEvent[]): FeedEvent[] {
	const newest = new Map<string, FeedEvent>();

	for (const event of events) {
		const held = newest.get(event.entryId);

		if (!held || event.revision > held.revision)
			newest.set(event.entryId, event);
	}

	return [...newest.values()];
}

type ChooseGiven = { readonly choice: FeedChoice };

/** The newest publish event of each entry: the one whose day and origin the entry shows. */
function publishOfEach(events: readonly FeedEvent[]) {
	return new Map(
		events.flatMap((event): [string, FeedEvent][] =>
			event.operation === "publish" ? [[event.entryId, event]] : [],
		),
	);
}

/** The entries that may be in the history: not erased, not withdrawn, and published. */
function historyEvents(events: readonly FeedEvent[]) {
	const publishOf = publishOfEach(events);

	return newestOfEach(events).flatMap((event) => {
		const published = publishOf.get(event.entryId);

		return !event.erased && event.operation !== "withdraw" && published
			? [{ event, published }]
			: [];
	});
}

/** The revisions of the publish events whose day the choice needs: those of the entries that may be in the history. */
export const daysToRead = (index: FeedIndex): number[] =>
	historyEvents(index.events).map(({ published }) => published.revision);

function choose(index: FeedIndex, days: FeedDays): ChooseGiven {
	const live = index.events.filter((event) => event.origin !== "backfill");

	const newestPublish = live
		.filter((event) => event.operation === "publish")
		.reduce<FeedEvent | null>(
			(best, event) => (!best || event.revision > best.revision ? event : best),
			null,
		);

	const currentEvent = newestPublish
		? newestOfEach(
				live.filter((event) => event.entryId === newestPublish.entryId),
			)[0]
		: undefined;

	const history = historyEvents(index.events)
		.map(({ event, published }) => ({
			event,
			published,
			day: days.get(published.revision) ?? null,
		}))
		.sort((a, b) => {
			// Newest day first; a story with no day last; the later publish first on the same day.
			if (a.day !== b.day) {
				if (a.day === null) return 1;

				if (b.day === null) return -1;

				return a.day < b.day ? 1 : -1;
			}

			return b.published.revision - a.published.revision;
		})
		.slice(0, MOST_IN_HISTORY + SPARE_IN_HISTORY)
		.map(
			({ event, published, day }): FeedPick => ({
				revision: event.revision,
				entryId: event.entryId,
				origin: published.origin,
				day,
				publishedAt: event.publishedAt,
			}),
		);

	return {
		choice: {
			revision: index.latestRevision ?? 0,
			current:
				currentEvent && !currentEvent.erased
					? {
							revision: currentEvent.revision,
							entryId: currentEvent.entryId,
							origin: currentEvent.origin,
							day: null,
							publishedAt: currentEvent.publishedAt,
						}
					: null,
			history,
		},
	};
}

export const chooseFeed = alwaysWrites({
	name: "Choose the current entry and the history of a project's journal",
	given: (
		request: { readonly index: FeedIndex; readonly days: FeedDays },
		_facts: Record<string, never>,
	) => choose(request.index, request.days),
	refusals: [],
	writes: (g) => g.choice,
	writesText: "the events whose text the feed shows",
});

/** The revisions whose text is to be read: the current entry's and the history's, each once. */
export const revisionsToRead = (choice: FeedChoice): number[] => [
	...new Set([
		...(choice.current ? [choice.current.revision] : []),
		...choice.history.map((pick) => pick.revision),
	]),
];

/** The stored text of the picked events by revision; null where it was erased. */
export type FeedTexts = ReadonlyMap<number, string | null>;

const text = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

type Shown =
	| { readonly ok: true; readonly entry: PublicEntry | null }
	| { readonly ok: false };

const nothing: Shown = { ok: true, entry: null };

/** The entry a picked event shows: none when its text is gone, a refusal when its text is not a publication with a story. */
function entryOf(pick: FeedPick, payload: string | null | undefined): Shown {
	if (payload === null || payload === undefined) return nothing;
	const json = text(payload);

	if (!Result.isSuccess(json)) return { ok: false };
	const publication = parsePublication(json.success);

	if (!publication || !publication.story) return { ok: false };

	return {
		ok: true,
		entry: {
			entryId: publication.entryId,
			occurredOn: pick.day ?? publication.occurredOn,
			publishedAt: pick.publishedAt,
			backfilled: pick.origin === "backfill",
			story: publication.story,
		},
	};
}

type ShowGiven = { readonly valid: boolean; readonly feed: ProjectFeed };

const refused = (projectId: string, revision: number): ShowGiven => ({
	valid: false,
	feed: { projectId, revision, current: null, history: [] },
});

function assemble(
	request: { readonly projectId: string; readonly choice: FeedChoice },
	texts: FeedTexts,
): ShowGiven {
	const { projectId, choice } = request;

	const current = choice.current
		? entryOf(choice.current, texts.get(choice.current.revision))
		: nothing;

	if (!current.ok) return refused(projectId, choice.revision);

	// The first 100 entries that still have text; one that does not read as a publication refuses the feed. A spare that
	// is not reached is never read as one.
	const history: PublicEntry[] = [];

	for (const pick of choice.history) {
		if (history.length >= MOST_IN_HISTORY) break;
		const item = entryOf(pick, texts.get(pick.revision));

		if (!item.ok) return refused(projectId, choice.revision);

		if (item.entry) history.push(item.entry);
	}

	return {
		valid: true,
		feed: {
			projectId,
			revision: choice.revision,
			current: current.entry,
			history,
		},
	};
}

export const showFeed = alwaysWrites({
	name: "Show a project's chosen entries to the public",
	given: (
		request: { readonly projectId: string; readonly choice: FeedChoice },
		facts: { readonly texts: FeedTexts },
	) => assemble(request, facts.texts),
	refusals: [
		unless(
			term<ShowGiven>(
				"every story that is shown reads as a publication",
				(g) => g.valid,
			),
			() => new StoredPublicationInvalid(),
		),
	],
	writes: (g) => g.feed,
	writesText: "nothing: the answer is the feed",
});
