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
import type { FeedIndex, FeedTexts } from "./rules/publication-feed";
import { PublicationDb } from "./services";

/** The publication database failed, and nothing says it is only unavailable: an outage, a bad statement, a failed batch. */
export class PublicationStoreFailed extends Data.TaggedError(
	"PublicationStoreFailed",
) {}

/** The receipt of a stored event: where it sits and when the database stamped it. */
export type StoredReceipt = Pick<StoredEvent, "revision" | "publishedAt">;

type EventRow = {
	revision?: number | null;
	published_at?: string;
	payload_hash?: string;
	operation?: string;
	entry_id?: string;
	origin?: string;
	payload?: string | null;
	erased?: number;
	occurred_on?: string | null;
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

/** The project's latest revision statement. The value is null when the project has no event; the rules treat that as 0. */
const latestRevision = (db: D1Database, projectId: string) =>
	db
		.prepare(
			"SELECT MAX(revision) AS revision FROM publication_events WHERE project_id=?1",
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
			latestRevision: latest.results[0]?.revision ?? null,
			sameEvent:
				stored?.revision == null ||
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

		if (row?.revision == null || row.published_at === undefined)
			return yield* Effect.fail(new PublicationStoreFailed());

		return { revision: row.revision, publishedAt: row.published_at };
	});

/**
 * Reads, in ONE batch, what choosing a project's feed needs and no text: the latest revision, the small columns of every
 * event (`erased` says its text was erased by a withdrawal), and each publish event's day, taken from its stored text by
 * `json_extract` (a projection of one field, not a decision). Which entry is current and which are history is the feed
 * rule's decision (src/server/rules/publication-feed.ts).
 */
export const readFeedIndex = (projectId: string) =>
	asked(async (db): Promise<FeedIndex> => {
		const [latest, events, days] = await db.batch<EventRow>([
			latestRevision(db, projectId),
			db
				.prepare(
					"SELECT revision,entry_id,operation,origin,payload IS NULL AS erased,published_at FROM publication_events WHERE project_id=?1 ORDER BY revision",
				)
				.bind(projectId),
			db
				.prepare(
					"SELECT entry_id,json_extract(payload,'$.occurredOn') AS occurred_on FROM publication_events WHERE project_id=?1 AND operation='publish'",
				)
				.bind(projectId),
		]);

		return {
			latestRevision: latest.results[0]?.revision ?? null,
			events: events.results.flatMap((row) =>
				row.revision == null ||
				row.entry_id === undefined ||
				row.operation === undefined ||
				row.origin === undefined ||
				row.erased === undefined ||
				row.published_at === undefined
					? []
					: [
							{
								revision: row.revision,
								entryId: row.entry_id,
								operation: row.operation,
								origin: row.origin,
								erased: row.erased === 1,
								publishedAt: row.published_at,
							},
						],
			),
			days: days.results.flatMap((row) =>
				row.entry_id === undefined
					? []
					: [{ entryId: row.entry_id, day: row.occurred_on ?? null }],
			),
		};
	});

/** Most revisions in one statement: D1 allows 100 bound values in a statement, and one is the project. */
const REVISIONS_PER_STATEMENT = 50;

/**
 * Reads the stored text of the picked events, by project and revision (a key), in ONE batch of plain reads. A text that a
 * withdrawal erased since the index was read is null; one that is not there is absent.
 */
export const readFeedTexts = (
	projectId: string,
	revisions: readonly number[],
) =>
	asked(async (db): Promise<FeedTexts> => {
		if (revisions.length === 0) return new Map();
		const chunks: number[][] = [];

		for (let at = 0; at < revisions.length; at += REVISIONS_PER_STATEMENT)
			chunks.push(revisions.slice(at, at + REVISIONS_PER_STATEMENT));

		const results = await db.batch<EventRow>(
			chunks.map((chunk) =>
				db
					.prepare(
						`SELECT revision,payload FROM publication_events WHERE project_id=?1 AND revision IN (${chunk.map((_, i) => `?${i + 2}`).join(",")})`,
					)
					.bind(projectId, ...chunk),
			),
		);

		return new Map(
			results.flatMap((result) =>
				result.results.flatMap((row): [number, string | null][] =>
					row.revision == null || row.payload === undefined
						? []
						: [[row.revision, row.payload]],
				),
			),
		);
	});
