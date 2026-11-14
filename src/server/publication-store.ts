// What the publication routes read from and write to PUBLICATION_DB (the PublicationDb service), one function each. A read
// asks for stored facts and decides nothing; the one write stores the row the commit rule decided. Classes of statement
// (docs/prelaunch-qa-2026-11-14-publication.md lists each): every statement here is a plain read, or a write guarded by
// the table's own constraints. A unique violation (the project's revision, or its event id) is ChangedSinceRead, so the
// flow reads the facts again and the rule decides again. Any other database failure is a PublicationStoreFailed, which a
// route answers with its fixed sentence and never with the failure's own text (the error carries none).
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { ChangedSinceRead, isUniqueViolation } from "./guarded-save";
import type {
	CommitFacts,
	CommitWrite,
	StoredEvent,
} from "./rules/publication-commit";
import type { FeedEvent, FeedFacts } from "./rules/publication-feed";
import { PublicationDb } from "./services";

/** The publication database failed, and nothing says it is only unavailable: an outage, a bad statement, a failed batch. */
export class PublicationStoreFailed extends Data.TaggedError(
	"PublicationStoreFailed",
) {}

/** The receipt of a stored event: where it sits and when the database stamped it. */
export type StoredReceipt = Pick<StoredEvent, "revision" | "publishedAt">;

type EventRow = {
	revision?: number;
	published_at?: string;
	payload_hash?: string;
	operation?: string;
	entry_id?: string;
	origin?: string;
	payload?: string | null;
};

/** Runs one database call; a rejection is a PublicationStoreFailed. */
const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* PublicationDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: () => new PublicationStoreFailed(),
		});
	});

/** The project's latest revision statement. 0 when the project has no event. */
const latestRevision = (db: D1Database, projectId: string) =>
	db
		.prepare(
			"SELECT COALESCE(MAX(revision),0) AS revision FROM publication_events WHERE project_id=?1",
		)
		.bind(projectId);

/**
 * Reads, in ONE batch (one transaction, one snapshot), the three facts a commit decides on: the project's latest revision,
 * the event stored under this event id, and the operations stored for this entry. Read apart, a writer could store between
 * two of them and the rule would judge a state that never existed.
 */
export const readCommitFacts = (
	projectId: string,
	eventId: string,
	entryId: string,
) =>
	asked(async (db): Promise<CommitFacts> => {
		const [latest, same, entry] = await db.batch<EventRow>([
			latestRevision(db, projectId),
			db
				.prepare(
					"SELECT revision,published_at,payload_hash FROM publication_events WHERE project_id=?1 AND event_id=?2",
				)
				.bind(projectId, eventId),
			db
				.prepare(
					"SELECT operation FROM publication_events WHERE project_id=?1 AND entry_id=?2",
				)
				.bind(projectId, entryId),
		]);

		const stored = same.results[0];

		return {
			latestRevision: latest.results[0]?.revision ?? 0,
			sameEvent:
				stored?.revision === undefined ||
				stored.published_at === undefined ||
				stored.payload_hash === undefined
					? null
					: {
							revision: stored.revision,
							publishedAt: stored.published_at,
							payloadHash: stored.payload_hash,
						},
			entryOperations: entry.results.flatMap((row) =>
				row.operation === undefined ? [] : [row.operation],
			),
		};
	});

/**
 * Stores the event the rule decided, and for a withdrawal erases the content of every event of the entry, in one batch
 * (all or none); the receipt is read back last, because the database stamps `published_at`. The primary key (project and
 * event id) and `UNIQUE (project_id, revision)` refuse the insert when another writer stored this event or took this
 * revision first, which is ChangedSinceRead.
 */
export const insertEvent = (write: CommitWrite) =>
	Effect.gen(function* () {
		const db = yield* PublicationDb;

		const results = yield* Effect.tryPromise({
			try: () =>
				db.batch<EventRow>([
					...(write.inserts
						? [
								db
									.prepare(`INSERT INTO publication_events
        (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`)
									.bind(
										write.projectId,
										write.eventId,
										write.entryId,
										write.revision,
										write.operation,
										write.origin,
										write.payloadHash,
										write.payload,
									),
							]
						: []),
					...(write.erasesEntry
						? [
								db
									.prepare(
										"UPDATE publication_events SET payload=NULL WHERE project_id=?1 AND entry_id=?2",
									)
									.bind(write.projectId, write.entryId),
							]
						: []),
					db
						.prepare(
							"SELECT revision,published_at FROM publication_events WHERE project_id=?1 AND event_id=?2",
						)
						.bind(write.projectId, write.eventId),
				]),
			catch: (cause) =>
				isUniqueViolation(cause)
					? new ChangedSinceRead()
					: new PublicationStoreFailed(),
		});

		const row = results.at(-1)?.results[0];

		if (row?.revision === undefined || row.published_at === undefined)
			return yield* Effect.fail(new PublicationStoreFailed());

		return { revision: row.revision, publishedAt: row.published_at };
	});

/**
 * Reads a project's whole journal for the feed, in ONE batch: the latest revision and every event with its stored
 * content. Which entry is current and which are history is the feed rule's decision (src/server/rules/publication-feed.ts).
 */
export const readFeedFacts = (projectId: string) =>
	asked(async (db): Promise<FeedFacts> => {
		const [latest, events] = await db.batch<EventRow>([
			latestRevision(db, projectId),
			db
				.prepare(
					"SELECT revision,entry_id,operation,origin,payload,published_at FROM publication_events WHERE project_id=?1 ORDER BY revision",
				)
				.bind(projectId),
		]);

		return {
			revision: latest.results[0]?.revision ?? 0,
			events: events.results.flatMap((row): FeedEvent[] =>
				row.revision === undefined ||
				row.entry_id === undefined ||
				row.operation === undefined ||
				row.origin === undefined ||
				row.payload === undefined ||
				row.published_at === undefined
					? []
					: [
							{
								revision: row.revision,
								entryId: row.entry_id,
								operation: row.operation,
								origin: row.origin,
								payload: row.payload,
								publishedAt: row.published_at,
							},
						],
			),
		};
	});
