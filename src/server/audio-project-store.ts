// The store of the audio project routes (docs/plans/2026-11-audio-projects-conversion.md, section 4). One function per
// statement. A read is a plain read of stored columns; a write is guarded by a key, or is a compare-and-set that keeps
// today's conditions (the project is open, the stage, the request's status, the session, the count under the cap), because
// the rule has already judged from a read and a request that lost a race is refused by the write: an empty RETURNING is the
// named refusal the flow raises, never a retry. None decides an outcome. Rows are read through Effect Schema readers. A
// failed statement, or a row that is not the shape its table has, is an `AudioProjectStoreFailed`, which carries its cause so the route can log it
// through logUnexpected and answer its fixed 500.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { REVISION_ROUNDS, roundsUsed } from "../lib/audio-project-messages";
import type {
	StoredDecision,
	StoredFile,
	StoredMessage,
	StoredUpdate,
} from "./rules/audio-project-messages";
import { MusicDb } from "./services";

/** A D1 call failed, or a row was not the shape its table has. The cause is for the route's log. */
export class AudioProjectStoreFailed extends Data.TaggedError(
	"AudioProjectStoreFailed",
)<{ readonly failure: unknown }> {}

/** Runs a D1 call with the request's database; a rejection is an `AudioProjectStoreFailed`. */
const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: (cause) => new AudioProjectStoreFailed({ failure: cause }),
		});
	});

const text = Schema.String;
const maybeText = Schema.NullOr(Schema.String);

/** Reads rows of one shape; a row that is not that shape is a failure, never a half-read value. */
const rowsOf = <S extends Schema.ConstraintDecoder<unknown>>(
	row: S,
	results: readonly unknown[],
): Effect.Effect<readonly S["Type"][], AudioProjectStoreFailed> => {
	const read = Schema.decodeUnknownResult(Schema.Array(row))(results);

	return Result.isSuccess(read)
		? Effect.succeed(read.success)
		: Effect.fail(new AudioProjectStoreFailed({ failure: read.failure }));
};

/** One prepared statement's rows, run alone. */
const readAll = <S extends Schema.ConstraintDecoder<unknown>>(
	row: S,
	statement: (db: D1Database) => D1PreparedStatement,
) =>
	asked(async (db) => (await statement(db).all()).results).pipe(
		Effect.flatMap((results) => rowsOf(row, results)),
	);

/** The row a write answers with (INSERT ... RETURNING), or null when its conditions no longer held. */
const returned = <S extends Schema.ConstraintDecoder<unknown>>(
	row: S,
	statement: (db: D1Database) => D1PreparedStatement,
) =>
	asked(async (db) => await statement(db).first()).pipe(
		Effect.flatMap((found) =>
			found === null
				? Effect.succeed(null)
				: rowsOf(row, [found]).pipe(Effect.map((rows) => rows[0] ?? null)),
		),
	);

/** The columns of a stored message, in the order the answer's JSON writes them. */
const MESSAGE_COLUMNS = "id,actor,body,created_at,read_at,review_decision";

/** A stored message as the route answers it. */
const MessageRow = Schema.Struct({
	id: Schema.Number,
	actor: Schema.Literals(["owner", "client"]),
	body: text,
	created_at: text,
	read_at: maybeText,
	review_decision: Schema.NullOr(
		Schema.Literals(["approved", "changes", "stopped"]),
	),
});

export type SavedMessage = typeof MessageRow.Type;

const ProjectRow = Schema.Struct({
	request_id: text,
	stage: text,
	revoked_at: maybeText,
});

const RequestRow = Schema.Struct({ status: text, email: text });

const FileRow = Schema.Struct({
	id: text,
	version: text,
	status: text,
	published_at: maybeText,
});

const DecisionRow = Schema.Struct({ created_at: text });

const UpdateRow = Schema.Struct({ milestone: maybeText });

const CountRow = Schema.Struct({ total: Schema.Number });

const ReadMessageRow = Schema.Struct({ actor: text, read_at: maybeText });

/** Plain read: a batch's statements run in one snapshot, and each result's rows are read as one shape. */
const batched = (statements: (db: D1Database) => D1PreparedStatement[]) =>
	asked(async (db) =>
		(await db.batch(statements(db))).map((result) => result.results),
	);

/**
 * Plain reads in ONE batch (one snapshot): the project, and the request it belongs to. Neither is filtered, so a project the
 * client may not see reads like one it may.
 */
export const readProjectFacts = (requestId: string) =>
	batched((db) => [
		db
			.prepare(
				"SELECT request_id,stage,revoked_at FROM audio_projects WHERE request_id=?",
			)
			.bind(requestId),
		db
			.prepare("SELECT status,email FROM owner_requests WHERE id=?")
			.bind(requestId),
	]).pipe(
		Effect.flatMap(([projects, requests]) =>
			Effect.all({
				project: rowsOf(ProjectRow, projects ?? []),
				request: rowsOf(RequestRow, requests ?? []),
			}),
		),
		Effect.map((rows) => ({
			project: rows.project[0] ?? null,
			request: rows.request[0] ?? null,
		})),
	);

const countStatement = (
	db: D1Database,
	requestId: string,
	windowStart: string,
) =>
	db
		.prepare(`SELECT count(*) AS total FROM audio_project_messages
    WHERE request_id=? AND actor='client' AND created_at>?`)
		.bind(requestId, windowStart);

/** Plain read: how many messages the client sent after `windowStart`. */
export const readClientMessageCount = (
	requestId: string,
	windowStart: string,
) =>
	readAll(CountRow, (db) => countStatement(db, requestId, windowStart)).pipe(
		Effect.map((rows) => rows[0]?.total ?? 0),
	);

/** What the rule needs to judge an answer to a review, read in ONE batch (one snapshot). */
export type ReviewFacts = {
	readonly files: readonly StoredFile[];
	readonly decisions: readonly StoredDecision[];
	readonly updates: readonly StoredUpdate[];
	readonly count: number;
};

/**
 * Plain reads in ONE batch: the project's files, the client messages that answered a review, the project's updates (the
 * rule counts the revision rounds among them) and the client's message count.
 */
export const readReviewFacts = (requestId: string, windowStart: string) =>
	batched((db) => [
		db
			.prepare(
				"SELECT id,version,status,published_at FROM audio_project_files WHERE request_id=?",
			)
			.bind(requestId),
		db
			.prepare(
				"SELECT created_at FROM audio_project_messages WHERE request_id=? AND review_decision IS NOT NULL",
			)
			.bind(requestId),
		db
			.prepare("SELECT milestone FROM audio_project_updates WHERE request_id=?")
			.bind(requestId),
		countStatement(db, requestId, windowStart),
	]).pipe(
		Effect.flatMap(([files, decisions, updates, counts]) =>
			Effect.all({
				files: rowsOf(FileRow, files ?? []),
				decisions: rowsOf(DecisionRow, decisions ?? []),
				updates: rowsOf(UpdateRow, updates ?? []),
				counts: rowsOf(CountRow, counts ?? []),
			}),
		),
		Effect.map(
			(rows): ReviewFacts => ({
				files: rows.files,
				decisions: rows.decisions,
				updates: rows.updates,
				count: rows.counts[0]?.total ?? 0,
			}),
		),
	);

/** Plain read: who wrote a message of this project and whether it was read, or null. */
export const readMessage = (requestId: string, messageId: number) =>
	readAll(ReadMessageRow, (db) =>
		db
			.prepare(
				"SELECT actor,read_at FROM audio_project_messages WHERE id=? AND request_id=?",
			)
			.bind(messageId, requestId),
	).pipe(Effect.map((rows): StoredMessage | null => rows[0] ?? null));

/** What an owner's message writes. */
export type OwnerMessageWrite = {
	readonly ownerEmail: string;
	readonly body: string;
};

/**
 * M1, compare-and-set: the owner's message, written while the project is not complete and is open and the request is
 * not withdrawn. Null when a condition no longer held.
 */
export const insertOwnerMessage = (
	requestId: string,
	write: OwnerMessageWrite,
	at: string,
) =>
	returned(MessageRow, (db) =>
		db
			.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'owner',?,?,? FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    WHERE p.request_id=? AND p.stage<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
    RETURNING ${MESSAGE_COLUMNS}`)
			.bind(write.ownerEmail, write.body, at, requestId),
	);

/** What a client's message writes. */
export type ClientMessageWrite = {
	readonly body: string;
	readonly at: string;
	readonly windowStart: string;
	readonly limit: number;
};

/**
 * M2, compare-and-set: the client's message, written while the session is open, the project is open and not complete, the
 * request is not withdrawn and the client's messages in the window are under the cap. Null when a condition no longer held.
 */
export const insertClientMessage = (
	requestId: string,
	tokenHash: string,
	write: ClientMessageWrite,
) =>
	returned(MessageRow, (db) =>
		db
			.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'client',?,?,? FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    JOIN audio_client_sessions s ON s.email=r.email
    WHERE p.request_id=? AND p.stage<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND (SELECT count(*) FROM audio_project_messages m
        WHERE m.request_id=? AND m.actor='client' AND m.created_at>?)<?
    RETURNING ${MESSAGE_COLUMNS}`)
			.bind(
				tokenHash,
				write.body,
				write.at,
				requestId,
				tokenHash,
				write.at,
				requestId,
				write.windowStart,
				write.limit,
			),
	);

/** What a client's answer to a review writes. */
export type DecisionWrite = ClientMessageWrite & {
	readonly decision: "approved" | "changes" | "stopped";
	readonly reviewId: string;
};

/** SQL: the project has a published review and no client decision since the latest one. */
const reviewAwaitingAnswer = `(SELECT MAX(f.published_at) FROM audio_project_files f
    WHERE f.request_id=p.request_id AND f.version='review' AND f.status='published') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM audio_project_messages d
    WHERE d.request_id=p.request_id AND d.review_decision IS NOT NULL AND d.created_at>=(SELECT MAX(f.published_at) FROM audio_project_files f
    WHERE f.request_id=p.request_id AND f.version='review' AND f.status='published'))`;

const decisionInsert = (
	db: D1Database,
	requestId: string,
	tokenHash: string,
	write: DecisionWrite,
) =>
	db
		.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at,review_decision)
    SELECT p.request_id,'client',?,?,?,? FROM audio_projects p
    JOIN owner_requests r ON r.id=p.request_id
    JOIN audio_client_sessions s ON s.email=r.email
    WHERE p.request_id=? AND p.stage='review_ready' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND (SELECT count(*) FROM audio_project_messages m
        WHERE m.request_id=? AND m.actor='client' AND m.created_at>?)<?
      AND ${reviewAwaitingAnswer}
      AND (? = 'approved' OR (${roundsUsed("p.request_id")} < ${REVISION_ROUNDS}) = (? = 'changes'))
      AND ?=(SELECT f.id FROM audio_project_files f WHERE f.request_id=p.request_id AND f.version='review'
        AND f.status='published' ORDER BY f.published_at DESC LIMIT 1)
    RETURNING ${MESSAGE_COLUMNS}`)
		.bind(
			tokenHash,
			write.body,
			write.at,
			write.decision,
			requestId,
			tokenHash,
			write.at,
			requestId,
			write.windowStart,
			write.limit,
			write.decision,
			write.decision,
			write.reviewId,
		);

/**
 * M3, compare-and-set: the client's approval or request for changes, written while the session and the project are open,
 * the stage is review_ready, the count is under the cap, the review still awaits an answer, the decision fits the rounds
 * used and the named review is still the latest. Null when a condition no longer held.
 */
export const insertDecision = (
	requestId: string,
	tokenHash: string,
	write: DecisionWrite,
) =>
	returned(MessageRow, (db) => decisionInsert(db, requestId, tokenHash, write));

/**
 * M3, M4 and M5 in ONE batch: the client's stop. The decision is written as M3 is; the project's access closes and the
 * audit row is written only while the stopped decision this request just wrote is there (`EXISTS` on the request, the
 * decision and this request's `created_at`, as today). Null when M3's conditions no longer held.
 */
export const insertStoppingDecision = (
	requestId: string,
	tokenHash: string,
	write: DecisionWrite,
) =>
	asked(async (db) => {
		const stopped = `EXISTS(SELECT 1 FROM audio_project_messages WHERE request_id=? AND review_decision='stopped' AND created_at=?)`;

		const [saved] = await db.batch([
			decisionInsert(db, requestId, tokenHash, write),
			db
				.prepare(
					`UPDATE audio_projects SET revoked_at=?,updated_at=? WHERE request_id=? AND revoked_at IS NULL AND ${stopped}`,
				)
				.bind(write.at, write.at, requestId, requestId, write.at),
			db
				.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'revoked','client-stopped',? FROM audio_projects WHERE request_id=? AND revoked_at=? AND ${stopped}`)
				.bind(write.at, requestId, write.at, requestId, write.at),
		]);

		return saved?.results[0] ?? null;
	}).pipe(
		Effect.flatMap((found) =>
			found === null
				? Effect.succeed(null)
				: rowsOf(MessageRow, [found]).pipe(
						Effect.map((rows) => rows[0] ?? null),
					),
		),
	);

/** M7, write guarded by key: the owner reads a client's message that was not read yet. */
export const markClientMessageRead = (
	requestId: string,
	messageId: number,
	at: string,
) =>
	asked((db) =>
		db
			.prepare(
				`UPDATE audio_project_messages SET read_at=? WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL`,
			)
			.bind(at, messageId, requestId, "client")
			.run(),
	).pipe(Effect.asVoid);

/**
 * M8, compare-and-set: the client reads an owner's message that was not read yet, while the session is open and not
 * expired, the project is open and the request is not withdrawn.
 */
export const markOwnerMessageRead = (
	requestId: string,
	messageId: number,
	tokenHash: string,
	at: string,
) =>
	asked((db) =>
		db
			.prepare(`UPDATE audio_project_messages SET read_at=?
    WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL AND EXISTS(
      SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      JOIN audio_client_sessions s ON s.email=r.email
      WHERE p.request_id=audio_project_messages.request_id AND p.revoked_at IS NULL
        AND r.status<>'withdrawn' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?)`)
			.bind(at, messageId, requestId, "owner", tokenHash, at)
			.run(),
	).pipe(Effect.asVoid);
