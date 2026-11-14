// The feed rule: what a project's journal shows the public. From every stored event (read in one batch with the latest
// revision) it picks the CURRENT entry (the newest published entry of live work, if its newest live event is not a
// withdrawal) and the HISTORY (every entry that was not withdrawn, once, at its newest event, newest day first, at most
// 100). Backfilled entries are history only. A story that is shown is read again as a publication; one that does not read
// as one makes the whole feed refuse, because the journal holds something this site did not write.
//
// It reads no store and writes nothing, so no write-time guard applies. Nothing is decided in SQL: the store returns
// rows, and the choices above are made here.
import * as Data from "effect/Data";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { parsePublication } from "../../lib/publication/contract";
import type { ProjectFeed, PublicEntry } from "../../lib/publication/read";
import { alwaysWrites, term, unless } from "../terms";

/** One stored event of a project, with its content (null once a withdrawal erased it). */
export type FeedEvent = {
	readonly revision: number;
	readonly entryId: string;
	readonly operation: string;
	readonly origin: string;
	readonly payload: string | null;
	readonly publishedAt: string;
};

/** What the feed reads, in one batch. */
export type FeedFacts = {
	readonly revision: number;
	/** Every event of the project, oldest revision first. */
	readonly events: readonly FeedEvent[];
};

/** A stored event that is shown does not read as a publication with a story: the journal holds something this site did not write. */
export class StoredPublicationInvalid extends Data.TaggedError(
	"StoredPublicationInvalid",
) {
	readonly say = "stored publication invalid";
}

const MOST_IN_HISTORY = 100;

const text = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

type Parsed =
	| { readonly ok: true; readonly entry: PublicEntry | null }
	| { readonly ok: false };

const noEntry: Parsed = { ok: true, entry: null };

/** The entry a stored event shows: none when its content was erased, a refusal when its content is not a publication with a story. */
function entryOf(
	event: FeedEvent,
	origin: string,
	occurredOn: string | null,
): Parsed {
	if (event.payload === null) return noEntry;
	const json = text(event.payload);

	if (!Result.isSuccess(json)) return { ok: false };
	const publication = parsePublication(json.success);

	if (!publication || !publication.story) return { ok: false };

	return {
		ok: true,
		entry: {
			entryId: publication.entryId,
			occurredOn: occurredOn ?? publication.occurredOn,
			publishedAt: event.publishedAt,
			backfilled: origin === "backfill",
			story: publication.story,
		},
	};
}

const publishedDay = Schema.decodeUnknownResult(
	Schema.Struct({ occurredOn: Schema.optional(Schema.String) }),
);

/** The day a publish event says the work happened, from its stored content: null when erased, or when it names no day. */
function dayOf(
	event: FeedEvent,
): { ok: true; day: string | null } | { ok: false } {
	if (event.payload === null) return { ok: true, day: null };
	const json = text(event.payload);

	if (!Result.isSuccess(json)) return { ok: false };
	const read = publishedDay(json.success);

	return {
		ok: true,
		day: Result.isSuccess(read) ? (read.success.occurredOn ?? null) : null,
	};
}

type Given = { readonly valid: boolean; readonly feed: ProjectFeed };

const empty = (facts: FeedFacts): ProjectFeed => ({
	projectId: "",
	revision: facts.revision,
	current: null,
	history: [],
});

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

function assemble(projectId: string, facts: FeedFacts): Given {
	const live = facts.events.filter((event) => event.origin !== "backfill");

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

	const current = currentEvent
		? entryOf(currentEvent, currentEvent.origin, null)
		: noEntry;

	const publishOf = new Map(
		facts.events
			.filter((event) => event.operation === "publish")
			.map((event) => [event.entryId, event]),
	);

	const candidates = newestOfEach(facts.events).flatMap((event) => {
		const published = publishOf.get(event.entryId);

		return event.payload !== null && event.operation !== "withdraw" && published
			? [{ event, published }]
			: [];
	});

	const days = candidates.map((candidate) => ({
		...candidate,
		read: dayOf(candidate.published),
	}));

	if (!current.ok || days.some((candidate) => !candidate.read.ok))
		return { valid: false, feed: empty(facts) };

	const ordered = days
		.flatMap((candidate) =>
			candidate.read.ok ? [{ ...candidate, day: candidate.read.day }] : [],
		)
		.sort((a, b) => {
			// Newest day first; a story with no day last; the later publish first on the same day.
			if (a.day !== b.day) {
				if (a.day === null) return 1;

				if (b.day === null) return -1;

				return a.day < b.day ? 1 : -1;
			}

			return b.published.revision - a.published.revision;
		})
		.slice(0, MOST_IN_HISTORY);

	const history = ordered.map((candidate) =>
		entryOf(candidate.event, candidate.published.origin, candidate.day),
	);

	if (history.some((item) => !item.ok))
		return { valid: false, feed: empty(facts) };

	return {
		valid: true,
		feed: {
			projectId,
			revision: facts.revision,
			current: current.entry,
			history: history.flatMap((item) =>
				item.ok && item.entry ? [item.entry] : [],
			),
		},
	};
}

export const projectFeed = alwaysWrites({
	name: "Show a project's journal to the public",
	given: (request: { readonly projectId: string }, facts: FeedFacts) =>
		assemble(request.projectId, facts),
	refusals: [
		unless(
			term(
				"every story that is shown reads as a publication",
				(g: Given) => g.valid,
			),
			() => new StoredPublicationInvalid(),
		),
	],
	writes: (g) => g.feed,
	writesText: "nothing: the answer is the feed",
});
