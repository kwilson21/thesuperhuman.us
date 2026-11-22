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
import {
	concurrentWriteToKey,
	multipartPartInvalid,
	multipartUploadGone,
	objectStoreUnavailable,
} from "../lib/object-store-errors";
import { ChangedSinceRead, raisedByJsonGuard } from "./guarded-save";
import {
	PROJECT_MOVES,
	PROJECT_STAGES,
	type ProjectStage,
} from "./machines/audio-project";
import {
	FILE_MOVES,
	FILE_STATUSES,
	type FileStatus,
} from "./machines/project-file";
import type {
	PublishedFile,
	StoredDraftFile,
	StoredPayment,
	StoredRevokeFile,
} from "./rules/audio-project-files";
import type { StoredUpload } from "./rules/audio-project-uploads";
import type { StoredClientFile } from "./rules/studio-project-file";
import {
	endClientSessions,
	deleteClientSigninCodes,
} from "./studio-signin-store";
import { KEEPING_STAGES } from "./machines/audio-project";
import {
	NOTICE_MOVES,
	type NoticeStatus,
	NOTICE_STATUSES,
} from "./machines/project-notice";
import type {
	StoredNoticeRequest,
	StoredRecipient,
} from "./rules/audio-project-notices";
import type { StoredOwnerState } from "./rules/audio-project-updates";
import type {
	StoredDecision,
	StoredFile,
	StoredMessage,
	StoredUpdate,
} from "./rules/audio-project-messages";
import { AudioBucket, MusicDb } from "./services";

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

const projectStatement = (db: D1Database, requestId: string) =>
	db
		.prepare(
			"SELECT request_id,stage,revoked_at FROM audio_projects WHERE request_id=?",
		)
		.bind(requestId);

const requestStatement = (db: D1Database, requestId: string) =>
	db
		.prepare("SELECT status,email FROM owner_requests WHERE id=?")
		.bind(requestId);

const paymentStatement = (db: D1Database, requestId: string) =>
	db
		.prepare(
			"SELECT booking_status,balance_status FROM audio_payments WHERE request_id=?",
		)
		.bind(requestId);

/**
 * Plain reads in ONE batch (one snapshot): the project, and the request it belongs to. Neither is filtered, so a project the
 * client may not see reads like one it may.
 */
export const readProjectFacts = (requestId: string) =>
	batched((db) => [
		projectStatement(db, requestId),
		requestStatement(db, requestId),
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

// ---- the files, the uploads and the objects (docs/plans/2026-11-audio-projects-conversion.md, sections 3 and 4) ----

const PaymentRow = Schema.Struct({
	booking_status: text,
	balance_status: text,
});

const Version = Schema.Literals(["review", "final"]);

const MediaType = Schema.Literals(["audio/mpeg", "audio/wav"]);

const DraftFileRow = Schema.Struct({
	id: text,
	request_id: text,
	version: Version,
	object_key: text,
	media_type: MediaType,
	byte_size: Schema.Number,
	status: text,
});

const RevokeFileRow = Schema.Struct({ version: Version, status: text });

const PublishedFileRow = Schema.Struct({ id: text, version: Version });

const IdRow = Schema.Struct({ id: Schema.Number });

const TextIdRow = Schema.Struct({ id: text });

const UploadRow = Schema.Struct({
	id: text,
	request_id: text,
	upload_id: text,
	object_key: text,
	version: Version,
	display_name: text,
	media_type: MediaType,
	byte_size: Schema.Number,
	state: Schema.Literals(["pending", "discarding"]),
	created_at: text,
});

const ClientFileRow = Schema.Struct({
	id: text,
	request_id: text,
	version: Version,
	object_key: text,
	display_name: text,
	media_type: MediaType,
	byte_size: Schema.Number,
	downloadable: Schema.Number,
	status: text,
	published_at: maybeText,
	expires_at: maybeText,
	revoked_at: maybeText,
});

/** A stage the machine names, written into SQL as a literal; anything else is a bug, never a value from a request. */
function stageLiteral(stage: ProjectStage): string {
	if (!PROJECT_STAGES.includes(stage))
		throw new Error(`Not a stage the machine names: ${stage}`);

	return `'${stage}'`;
}

/** A status the machine names, written into SQL as a literal. */
function statusLiteral(status: FileStatus): string {
	if (!FILE_STATUSES.includes(status))
		throw new Error(`Not a status the machine names: ${status}`);

	return `'${status}'`;
}

/** `p.stage IN ('a','b')`, the stages a move is allowed from, as the machine lists them. */
const stageIn = (stages: readonly ProjectStage[]) =>
	`p.stage IN (${stages.map(stageLiteral).join(",")})`;

/** `status IN ('a','b')` for the statuses a move is allowed from. */
const statusIn = (statuses: readonly FileStatus[]) =>
	`status IN (${statuses.map(statusLiteral).join(",")})`;

/** Runs one batch whose guards raise ("malformed JSON") when what a rule read has changed: a raised guard is `ChangedSinceRead`. */
const guardedBatch = (statements: (db: D1Database) => D1PreparedStatement[]) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => db.batch(statements(db)),
			catch: (cause) =>
				cause instanceof Error && raisedByJsonGuard(cause)
					? new ChangedSinceRead()
					: new AudioProjectStoreFailed({ failure: cause }),
		});
	});

/**
 * SQL that holds when the rows `from` (a FROM clause with its WHERE, binding `values`) are exactly the files `ids`: as many rows
 * as ids, and every id among them. No order of the rows is relied on. Returns the SQL and the values it binds.
 */
type GuardSql = {
	readonly sql: string;
	readonly bind: readonly (string | number)[];
};

function exactlyTheFiles(
	from: string,
	values: readonly (string | number)[],
	ids: readonly string[],
): GuardSql {
	const count = `(SELECT count(*) ${from})=?`;

	if (ids.length === 0) return { sql: count, bind: [...values, 0] };

	// The ids are one bound value, a JSON array, because D1 allows at most 100 bound parameters in a statement and nothing caps
	// the files of a version.
	const members = `(SELECT count(*) ${from} AND id IN (SELECT value FROM json_each(?)))=?`;

	return {
		sql: `${count} AND ${members}`,
		bind: [...values, ids.length, ...values, JSON.stringify(ids), ids.length],
	};
}

/** The batch guard: the batch rolls back, and `decideAndSave` decides again, unless `condition` holds. */
const batchGuard = (db: D1Database, condition: string) =>
	db.prepare(
		`SELECT CASE WHEN ${condition} THEN 1 ELSE json_extract('Project files changed','$') END`,
	);

/** What the facts of a project's readiness for a file hold, read in ONE batch (one snapshot). */
export type ProjectPaymentFacts = {
	readonly project: typeof ProjectRow.Type | null;
	readonly request: typeof RequestRow.Type | null;
	readonly payment: StoredPayment | null;
};

/** Plain reads in ONE batch: the project, its request and its payment. */
export const readProjectWithPayment = (requestId: string) =>
	batched((db) => [
		projectStatement(db, requestId),
		requestStatement(db, requestId),
		paymentStatement(db, requestId),
	]).pipe(
		Effect.flatMap(([projects, requests, payments]) =>
			Effect.all({
				project: rowsOf(ProjectRow, projects ?? []),
				request: rowsOf(RequestRow, requests ?? []),
				payment: rowsOf(PaymentRow, payments ?? []),
			}),
		),
		Effect.map(
			(rows): ProjectPaymentFacts => ({
				project: rows.project[0] ?? null,
				request: rows.request[0] ?? null,
				payment: rows.payment[0] ?? null,
			}),
		),
	);

/** What a publish reads: the file, the project, the request, the payment and the project's live review files. */
export type PublishFacts = ProjectPaymentFacts & {
	readonly file: StoredDraftFile | null;
	readonly live: readonly PublishedFile[];
};

/** P1: plain reads in ONE batch (one snapshot): the file, the project, the request, the payment and the published files. */
export const readPublishFacts = (requestId: string, fileId: string) =>
	batched((db) => [
		db
			.prepare(`SELECT id,request_id,version,object_key,media_type,byte_size,status
    FROM audio_project_files WHERE id=? AND request_id=?`)
			.bind(fileId, requestId),
		projectStatement(db, requestId),
		requestStatement(db, requestId),
		paymentStatement(db, requestId),
		db
			.prepare(
				"SELECT id,version FROM audio_project_files WHERE request_id=? AND status='published'",
			)
			.bind(requestId),
	]).pipe(
		Effect.flatMap(([files, projects, requests, payments, published]) =>
			Effect.all({
				file: rowsOf(DraftFileRow, files ?? []),
				project: rowsOf(ProjectRow, projects ?? []),
				request: rowsOf(RequestRow, requests ?? []),
				payment: rowsOf(PaymentRow, payments ?? []),
				live: rowsOf(PublishedFileRow, published ?? []),
			}),
		),
		Effect.map(
			(rows): PublishFacts => ({
				file: rows.file[0] ?? null,
				project: rows.project[0] ?? null,
				request: rows.request[0] ?? null,
				payment: rows.payment[0] ?? null,
				live: rows.live,
			}),
		),
	);

/** What a publish writes. */
export type PublishWrite = {
	readonly fileId: string;
	readonly requestId: string;
	readonly version: "review" | "final";
	readonly downloadable: boolean;
	readonly at: string;
	readonly expiresAt: string | null;
	readonly publicationId: string;
	readonly note: string;
	readonly actor: string;
	readonly targetStage: ProjectStage;
	readonly supersedes: readonly string[];
};

/**
 * P2 to P5 in ONE batch. The guard comes first and raises when the live review files are no longer the ones the rule read, so
 * the batch rolls back and the rule decides again. P2 is the compare-and-set: the file is still uploaded, the project is open,
 * the request is not withdrawn, the booking is paid (a final also the balance) and the stage allows the version; P3 revokes the
 * live review files this decision named, P4 sets the stage and P5 writes the client's update, each linked to P2 by the
 * publication id. The id of the update, or null when P2 changed nothing (the answer is 409 at once).
 */
export const publishFileBatch = (write: PublishWrite) =>
	guardedBatch((db) => {
		const stages = stageIn(
			write.version === "review"
				? PROJECT_MOVES.PUBLISH_REVIEW.from
				: PROJECT_MOVES.PUBLISH_FINAL.from,
		);

		const settled =
			write.version === "final" ? " AND pay.balance_status='paid'" : "";

		const liveReviews = exactlyTheFiles(
			"FROM audio_project_files WHERE request_id=? AND version='review' AND status='published' AND id<>?",
			[write.requestId, write.fileId],
			write.supersedes,
		);

		return [
			batchGuard(db, liveReviews.sql).bind(...liveReviews.bind),
			db
				.prepare(`UPDATE audio_project_files SET status='published',downloadable=?,published_at=?,expires_at=?,publication_id=?
      WHERE id=? AND request_id=? AND ${statusIn(FILE_MOVES.PUBLISH)}
        AND EXISTS(SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
          JOIN audio_payments pay ON pay.request_id=p.request_id
          WHERE p.request_id=audio_project_files.request_id AND p.revoked_at IS NULL AND r.status<>'withdrawn'
            AND pay.booking_status='paid' AND ${stages}${settled})
      RETURNING id`)
				.bind(
					write.downloadable ? 1 : 0,
					write.at,
					write.expiresAt,
					write.publicationId,
					write.fileId,
					write.requestId,
				),
			...(write.supersedes.length === 0
				? []
				: [
						db
							.prepare(`UPDATE audio_project_files SET status='revoked',revoked_at=?
      WHERE request_id=? AND version='review' AND ${statusIn(FILE_MOVES.SUPERSEDE)} AND id<>? AND id IN (SELECT value FROM json_each(?))
        AND EXISTS(SELECT 1 FROM audio_project_files WHERE id=? AND publication_id=?)`)
							.bind(
								write.at,
								write.requestId,
								write.fileId,
								JSON.stringify(write.supersedes),
								write.fileId,
								write.publicationId,
							),
					]),
			db
				.prepare(`UPDATE audio_projects SET stage=?,updated_at=? WHERE request_id=?
      AND EXISTS(SELECT 1 FROM audio_project_files WHERE id=? AND publication_id=?)`)
				.bind(
					write.targetStage,
					write.at,
					write.requestId,
					write.fileId,
					write.publicationId,
				),
			db
				.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,file_id)
      SELECT request_id,'progress',?,?,?,id FROM audio_project_files
      WHERE id=? AND publication_id=? AND status='published' RETURNING id`)
				.bind(
					write.note,
					write.actor,
					write.at,
					write.fileId,
					write.publicationId,
				),
		];
	}).pipe(
		Effect.flatMap((results) => {
			const changed = results[1]?.results ?? [];
			const update = results[results.length - 1]?.results ?? [];

			return changed.length === 0
				? Effect.succeed(null)
				: rowsOf(IdRow, update).pipe(Effect.map((rows) => rows[0]?.id ?? null));
		}),
	);

/** What a revoke reads: the file, the project and the project's published files. */
export type RevokeFacts = {
	readonly file: StoredRevokeFile | null;
	readonly project: typeof ProjectRow.Type | null;
	readonly published: readonly PublishedFile[];
};

/** FR1: plain reads in ONE batch (one snapshot): the file, the project and the project's published files. */
export const readRevokeFacts = (requestId: string, fileId: string) =>
	batched((db) => [
		db
			.prepare(
				`SELECT version,status FROM audio_project_files WHERE request_id=? AND id=?`,
			)
			.bind(requestId, fileId),
		projectStatement(db, requestId),
		db
			.prepare(
				"SELECT id,version FROM audio_project_files WHERE request_id=? AND status='published'",
			)
			.bind(requestId),
	]).pipe(
		Effect.flatMap(([files, projects, published]) =>
			Effect.all({
				file: rowsOf(RevokeFileRow, files ?? []),
				project: rowsOf(ProjectRow, projects ?? []),
				published: rowsOf(PublishedFileRow, published ?? []),
			}),
		),
		Effect.map(
			(rows): RevokeFacts => ({
				file: rows.file[0] ?? null,
				project: rows.project[0] ?? null,
				published: rows.published,
			}),
		),
	);

/** What a revoke writes. */
export type RevokeWrite = {
	readonly requestId: string;
	readonly fileId: string;
	readonly actor: string;
	readonly note: string;
	readonly at: string;
	readonly revocationId: string;
	/** The status the file was read in, which the write compares. */
	readonly status: string;
	readonly version: "review" | "final";
	/** The stage the rule read, and the version's other published files it read: the batch guard compares both. */
	readonly stage: string;
	readonly others: readonly string[];
	readonly reset: boolean;
};

/**
 * FR2 to FR5 in ONE batch. The guard comes first and raises when the stage or the version's other published files are no
 * longer the ones the rule decided the reset from, so the batch rolls back and the rule decides again. FR2 is the
 * compare-and-set (the file still has the status read, the project is open); FR3 resets the stage only when the rule decided
 * it and FR2 landed (the revocation id links them); FR4 writes its audit row only when FR3 changed the stage (`changes()`
 * right after FR3); FR5 writes the client's note for a published file. Null when FR2 changed nothing (the answer is 409 at
 * once), otherwise the update's id, or null inside when no note was written.
 */
export const revokeFileBatch = (write: RevokeWrite) =>
	guardedBatch((db) => {
		const back =
			PROJECT_MOVES[
				write.version === "review" ? "REVOKE_REVIEW" : "REVOKE_FINAL"
			].to;

		const published = write.status === "published";

		// The stage is compared only when the rule decided a reset from it: a revoke that decided none does not depend on it.
		const stageHeld = write.reset
			? {
					sql: "(SELECT stage FROM audio_projects WHERE request_id=?)=? AND ",
					bind: [write.requestId, write.stage],
				}
			: { sql: "", bind: [] };

		const others = exactlyTheFiles(
			"FROM audio_project_files WHERE request_id=? AND version=? AND status='published' AND id<>?",
			[write.requestId, write.version, write.fileId],
			write.others,
		);

		return [
			batchGuard(db, `${stageHeld.sql}${others.sql}`).bind(
				...stageHeld.bind,
				...others.bind,
			),
			db
				.prepare(`UPDATE audio_project_files SET status='revoked',revoked_at=?,revoked_by=?,revocation_id=?
      WHERE request_id=? AND id=? AND status=?
        AND EXISTS(SELECT 1 FROM audio_projects WHERE request_id=? AND revoked_at IS NULL)
      RETURNING id`)
				.bind(
					write.at,
					write.actor,
					write.revocationId,
					write.requestId,
					write.fileId,
					write.status,
					write.requestId,
				),
			...(write.reset
				? [
						db
							.prepare(`UPDATE audio_projects SET stage=?,completed_at=NULL,updated_at=? WHERE request_id=?
      AND stage=? AND EXISTS(SELECT 1 FROM audio_project_files WHERE id=? AND revocation_id=?)`)
							.bind(
								back,
								write.at,
								write.requestId,
								write.stage,
								write.fileId,
								write.revocationId,
							),
						db
							.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'stage-changed',?,? FROM audio_projects
      WHERE request_id=? AND stage=? AND updated_at=? AND changes()=1`)
							.bind(write.actor, write.at, write.requestId, back, write.at),
					]
				: []),
			...(published
				? [
						db
							.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
    SELECT request_id,'progress',?,?,? FROM audio_project_files WHERE id=? AND revocation_id=?
    RETURNING id`)
							.bind(
								write.note,
								write.actor,
								write.at,
								write.fileId,
								write.revocationId,
							),
					]
				: []),
		];
	}).pipe(
		Effect.flatMap(
			(
				results,
			): Effect.Effect<
				{ readonly updateId: number | null } | null,
				AudioProjectStoreFailed
			> => {
				const changed = results[1]?.results ?? [];

				if (changed.length === 0) return Effect.succeed(null);

				return write.status === "published"
					? rowsOf(IdRow, results[results.length - 1]?.results ?? []).pipe(
							Effect.map((rows) => ({ updateId: rows[0]?.id ?? null })),
						)
					: Effect.succeed({ updateId: null });
			},
		),
	);

/** S3: plain read: the upload of the project with this id, or null. */
export const readUpload = (requestId: string, id: string) =>
	readAll(UploadRow, (db) =>
		db
			.prepare(`SELECT id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,state,created_at
    FROM audio_project_uploads WHERE request_id=? AND id=?`)
			.bind(requestId, id),
	).pipe(Effect.map((rows): StoredUpload | null => rows[0] ?? null));

/** The project takes a file of `version` (SQL guard of S2 and S4): open, request not withdrawn, booking paid, stage the machine lists. */
const takesFile = (
	version: "review" | "final",
) => `EXISTS(SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
  LEFT JOIN audio_payments pay ON pay.request_id=p.request_id
  WHERE p.request_id=? AND p.revoked_at IS NULL AND r.status<>'withdrawn'
    AND ${stageIn(version === "review" ? PROJECT_MOVES.PUBLISH_REVIEW.from : PROJECT_MOVES.PUBLISH_FINAL.from)}
    AND pay.booking_status='paid')`;

/** What a new upload writes. */
export type UploadWrite = {
	readonly id: string;
	readonly requestId: string;
	readonly uploadId: string;
	readonly key: string;
	readonly version: "review" | "final";
	readonly displayName: string;
	readonly mediaType: "audio/mpeg" | "audio/wav";
	readonly byteSize: number;
	readonly at: string;
};

/** S2, compare-and-set: the upload row, written while the project takes a file of its version. Null when it no longer does. */
export const insertUpload = (write: UploadWrite) =>
	returned(UploadRow, (db) =>
		db
			.prepare(`INSERT INTO audio_project_uploads(id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${takesFile(write.version)}
      RETURNING id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,state,created_at`)
			.bind(
				write.id,
				write.requestId,
				write.uploadId,
				write.key,
				write.version,
				write.displayName,
				write.mediaType,
				write.byteSize,
				write.at,
				write.requestId,
			),
	);

/**
 * S4, compare-and-set: the file row of a finished upload, written while the upload is still pending and the project takes a
 * file of its version; a file row that already exists is left as it is. The file's id, or null when nothing was written.
 */
export const insertFileFromUpload = (
	upload: StoredUpload,
	peaks: readonly number[] | null,
	at: string,
) =>
	returned(TextIdRow, (db) =>
		db
			.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,uploaded_at,peaks)
    SELECT id,request_id,version,object_key,display_name,media_type,byte_size,?,?
    FROM audio_project_uploads WHERE id=? AND request_id=? AND state='pending' AND ${takesFile(upload.version)}
    ON CONFLICT(id) DO NOTHING RETURNING id`)
			.bind(
				at,
				peaks ? JSON.stringify(peaks) : null,
				upload.id,
				upload.request_id,
				upload.request_id,
			),
	).pipe(Effect.map((row) => row?.id ?? null));

/** S5: plain read: the id of the project's file with this id, or null. */
export const readFileId = (requestId: string, id: string) =>
	readAll(TextIdRow, (db) =>
		db
			.prepare("SELECT id FROM audio_project_files WHERE id=? AND request_id=?")
			.bind(id, requestId),
	).pipe(Effect.map((rows) => rows[0]?.id ?? null));

/** S6 and S8, write guarded by key: the upload row is deleted. */
export const deleteUploadRow = (requestId: string, id: string) =>
	asked((db) =>
		db
			.prepare("DELETE FROM audio_project_uploads WHERE id=? AND request_id=?")
			.bind(id, requestId)
			.run(),
	).pipe(Effect.asVoid);

/** S7, compare-and-set: the upload is marked discarding while no file row exists for it. The upload's id, or null. */
export const markUploadDiscarding = (requestId: string, id: string) =>
	returned(TextIdRow, (db) =>
		db
			.prepare(`UPDATE audio_project_uploads SET state='discarding'
    WHERE id=? AND request_id=? AND NOT EXISTS(SELECT 1 FROM audio_project_files WHERE id=?) RETURNING id`)
			.bind(id, requestId, id),
	).pipe(Effect.map((row) => row?.id ?? null));

/** S9, compare-and-set: the discarding upload row is deleted while no file row exists for it. */
export const deleteDiscardedUpload = (requestId: string, id: string) =>
	asked((db) =>
		db
			.prepare(`DELETE FROM audio_project_uploads WHERE id=? AND request_id=? AND state='discarding'
    AND NOT EXISTS(SELECT 1 FROM audio_project_files WHERE id=?)`)
			.bind(id, requestId, id)
			.run(),
	).pipe(Effect.asVoid);

/** What the client's read of a file reads: the file, the project, the request and the payment, in ONE batch (one snapshot). */
export type ClientFileFacts = ProjectPaymentFacts & {
	readonly file: StoredClientFile | null;
};

/** C1 and C2: plain reads in ONE batch: the file (whatever its status), the project, the request and the payment. */
export const readClientFileFacts = (requestId: string, fileId: string) =>
	batched((db) => [
		db
			.prepare(`SELECT f.id,f.request_id,f.version,f.object_key,f.display_name,f.media_type,f.byte_size,f.downloadable,f.status,f.published_at,f.expires_at,f.revoked_at
    FROM audio_project_files f WHERE f.request_id=? AND f.id=?`)
			.bind(requestId, fileId),
		projectStatement(db, requestId),
		requestStatement(db, requestId),
		paymentStatement(db, requestId),
	]).pipe(
		Effect.flatMap(([files, projects, requests, payments]) =>
			Effect.all({
				file: rowsOf(ClientFileRow, files ?? []),
				project: rowsOf(ProjectRow, projects ?? []),
				request: rowsOf(RequestRow, requests ?? []),
				payment: rowsOf(PaymentRow, payments ?? []),
			}),
		),
		Effect.map(
			(rows): ClientFileFacts => ({
				file: rows.file[0] ?? null,
				project: rows.project[0] ?? null,
				request: rows.request[0] ?? null,
				payment: rows.payment[0] ?? null,
			}),
		),
	);

/** FA1, write guarded by key: the first and the last time this session streamed or downloaded the file. */
export const recordFileAccess = (
	fileId: string,
	tokenHash: string,
	download: boolean,
	at: string,
) =>
	asked((db) =>
		db
			.prepare(`INSERT INTO audio_project_file_access(file_id,session_token_hash,access_kind,first_at,last_at)
    VALUES (?,?,?,?,?) ON CONFLICT(file_id,session_token_hash,access_kind) DO UPDATE SET last_at=excluded.last_at`)
			.bind(fileId, tokenHash, download ? "download" : "stream", at, at)
			.run(),
	).pipe(Effect.asVoid);

// ---- the objects in R2 ----

/** R2 is unavailable (error 10043). A known outage: the route answers 503 with its sentence and logs nothing. */
export class ObjectStoreUnavailable extends Data.TaggedError(
	"ObjectStoreUnavailable",
) {}

/** An R2 call failed for another reason. The cause is for the route's log. */
export class ObjectStoreFailed extends Data.TaggedError("ObjectStoreFailed")<{
	readonly failure: unknown;
}> {}

/** R2 no longer has the multipart upload (error 10024): an abort or the incomplete-upload lifecycle got there first. */
export class MultipartGone extends Data.TaggedError("MultipartGone")<{
	readonly failure: unknown;
}> {}

/** R2 refused a completion for a part it lists as missing or with another entity tag (error 10025). */
export class MultipartPartInvalid extends Data.TaggedError(
	"MultipartPartInvalid",
) {}

/** R2 refused a completion for writing one key too often (error 10058): temporary, and another completion may have won. */
export class ConcurrentWrite extends Data.TaggedError("ConcurrentWrite") {}

/** The failure of an R2 call that has no code of its own to read. */
const objectFailure = (cause: unknown) =>
	objectStoreUnavailable(cause)
		? new ObjectStoreUnavailable()
		: new ObjectStoreFailed({ failure: cause });

const withBucket = <A, E>(
	run: (bucket: R2Bucket) => Promise<A>,
	failure: (cause: unknown) => E,
) =>
	Effect.gen(function* () {
		const bucket = yield* AudioBucket;

		return yield* Effect.tryPromise({
			try: () => run(bucket),
			catch: failure,
		});
	});

/** Plain read: the object's metadata, or null when there is none. */
export const headObject = (key: string) =>
	withBucket((bucket) => bucket.head(key), objectFailure);

/** Plain read: the object, or the part of it a range names, or null when there is none. */
export const getObject = (
	key: string,
	range: { readonly offset: number; readonly length: number } | null,
) =>
	withBucket(
		(bucket) => bucket.get(key, range ? { range } : undefined),
		objectFailure,
	);

/** The object is removed. */
export const deleteObject = (key: string) =>
	withBucket((bucket) => bucket.delete(key), objectFailure);

/** A multipart upload is opened for the key. */
export const createMultipart = (
	key: string,
	mediaType: "audio/mpeg" | "audio/wav",
) =>
	withBucket(
		(bucket) =>
			bucket.createMultipartUpload(key, {
				httpMetadata: { contentType: mediaType },
			}),
		objectFailure,
	);

/** A multipart upload this request opened is dropped; the caller ignores a failure, as the cleanup is best effort. */
export const abortOpened = (opened: R2MultipartUpload) =>
	Effect.tryPromise({
		try: () => opened.abort(),
		catch: objectFailure,
	});

/** One part of a multipart upload. R2 no longer having the upload is `MultipartGone`. */
export const uploadPart = (
	upload: StoredUpload,
	partNumber: number,
	body: ArrayBuffer,
) =>
	withBucket(
		(bucket) =>
			bucket
				.resumeMultipartUpload(upload.object_key, upload.upload_id)
				.uploadPart(partNumber, body),
		(cause) =>
			multipartUploadGone(cause)
				? new MultipartGone({ failure: cause })
				: objectFailure(cause),
	);

/** The multipart upload is completed with these parts. The refusals R2 gives for a lost or contested upload have names. */
export const completeMultipart = (
	upload: StoredUpload,
	parts: readonly R2UploadedPart[],
) =>
	withBucket(
		(bucket) =>
			bucket
				.resumeMultipartUpload(upload.object_key, upload.upload_id)
				.complete([...parts]),
		(cause) => {
			if (multipartPartInvalid(cause)) return new MultipartPartInvalid();

			if (multipartUploadGone(cause))
				return new MultipartGone({ failure: cause });

			return concurrentWriteToKey(cause)
				? new ConcurrentWrite()
				: objectFailure(cause);
		},
	);

/** The multipart upload is aborted. R2 no longer having it is `MultipartGone`. */
export const abortMultipart = (upload: StoredUpload) =>
	withBucket(
		(bucket) =>
			bucket.resumeMultipartUpload(upload.object_key, upload.upload_id).abort(),
		(cause) =>
			multipartUploadGone(cause)
				? new MultipartGone({ failure: cause })
				: objectFailure(cause),
	);

// ---- access, notices and updates (docs/plans/2026-11-audio-projects-conversion.md, section 4) ----

/** `column IN ('a','b')`, the stages a move is allowed from, as the machine lists them. */
const stagesIn = (column: string, stages: readonly ProjectStage[]) =>
	`${column} IN (${stages.map(stageLiteral).join(",")})`;

/** `column IN ('a','b')` for notice statuses a move is allowed from. */
const noticeIn = (column: string, statuses: readonly NoticeStatus[]) =>
	`${column} IN (${statuses
		.map((status) => {
			if (!NOTICE_STATUSES.includes(status))
				throw new Error(`Not a status the machine names: ${status}`);

			return `'${status}'`;
		})
		.join(",")})`;

/**
 * AR1 to AR4 in ONE batch (one transaction): the project's access closes while it is open, the client's sessions end and the
 * sign-in codes of the client the request names are deleted (the studio sign-in store's statements, linked to this
 * revocation by its id), and the audit row is written. True when AR1 changed the project, false when another request closed it
 * first.
 */
export const revokeAccessBatch = (write: {
	readonly requestId: string;
	readonly actor: string;
	readonly at: string;
	readonly revocationId: string;
}) =>
	asked(async (db) => {
		const [changed] = await db.batch([
			db
				.prepare(`UPDATE audio_projects SET revoked_at=?,updated_at=?,access_revocation_id=?
      WHERE request_id=? AND revoked_at IS NULL RETURNING request_id`)
				.bind(write.at, write.at, write.revocationId, write.requestId),
			endClientSessions(db, write.requestId, write.revocationId, write.at),
			deleteClientSigninCodes(db, write.requestId, write.revocationId),
			db
				.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'revoked',?,? FROM audio_projects WHERE request_id=? AND access_revocation_id=?`)
				.bind(write.actor, write.at, write.requestId, write.revocationId),
		]);

		return (changed?.results.length ?? 0) > 0;
	});

/** What the queue and the claim of a notice read of the request. */
const NoticeRequestRow = Schema.Struct({
	kind: text,
	status: text,
	email: text,
});

const NoticeStateRow = Schema.Struct({
	status: Schema.Literals(NOTICE_STATUSES),
	attempted_at: maybeText,
	request_id: text,
});

const OpenRow = Schema.Struct({ revoked_at: maybeText });

const RecipientRow = Schema.Struct({
	email: text,
	kind: text,
	status: text,
	revoked_at: maybeText,
});

const RequestIdRow = Schema.Struct({ request_id: text });

/** What a notice's queue and claim read: the notice's status, the project's access and the request. */
export type NoticeFacts = {
	readonly notice: {
		readonly status: NoticeStatus;
		readonly attempted_at: string | null;
	} | null;
	readonly project: { readonly revoked_at: string | null } | null;
	readonly request: StoredNoticeRequest | null;
};

/** I-read: plain reads in ONE batch (one snapshot): the invitation's status, the project's access and the request. */
export const readInvitationFacts = (requestId: string) =>
	batched((db) => [
		db
			.prepare(
				"SELECT invitation_status AS status,invitation_attempted_at AS attempted_at,request_id FROM audio_projects WHERE request_id=?",
			)
			.bind(requestId),
		db
			.prepare("SELECT revoked_at FROM audio_projects WHERE request_id=?")
			.bind(requestId),
		db
			.prepare("SELECT kind,status,email FROM owner_requests WHERE id=?")
			.bind(requestId),
	]).pipe(
		Effect.flatMap(([notices, projects, requests]) =>
			Effect.all({
				notice: rowsOf(NoticeStateRow, notices ?? []),
				project: rowsOf(OpenRow, projects ?? []),
				request: rowsOf(NoticeRequestRow, requests ?? []),
			}),
		),
		Effect.map(
			(rows): NoticeFacts => ({
				notice: rows.notice[0] ?? null,
				project: rows.project[0] ?? null,
				request: rows.request[0] ?? null,
			}),
		),
	);

/** N-read: plain reads in ONE batch: an update's notice status, the project's access and the request. */
export const readUpdateNoticeFacts = (requestId: string, updateId: number) =>
	batched((db) => [
		db
			.prepare(
				"SELECT notification_status AS status,notification_attempted_at AS attempted_at,request_id FROM audio_project_updates WHERE id=? AND request_id=?",
			)
			.bind(updateId, requestId),
		db
			.prepare("SELECT revoked_at FROM audio_projects WHERE request_id=?")
			.bind(requestId),
		db
			.prepare("SELECT kind,status,email FROM owner_requests WHERE id=?")
			.bind(requestId),
	]).pipe(
		Effect.flatMap(([notices, projects, requests]) =>
			Effect.all({
				notice: rowsOf(NoticeStateRow, notices ?? []),
				project: rowsOf(OpenRow, projects ?? []),
				request: rowsOf(NoticeRequestRow, requests ?? []),
			}),
		),
		Effect.map(
			(rows): NoticeFacts => ({
				notice: rows.notice[0] ?? null,
				project: rows.project[0] ?? null,
				request: rows.request[0] ?? null,
			}),
		),
	);

/** What a notice's queue writes. */
export type QueueWrite = {
	readonly confirmed: boolean;
	readonly staleBefore: string;
};

/**
 * I5, compare-and-set: the invitation is queued again while it is pending or failed, or sending after the owner confirmed it
 * did not go out and the last attempt is past the cutoff, the project is open and the request is a service with an email that
 * is not withdrawn. True when a row changed.
 */
export const queueInvitation = (requestId: string, write: QueueWrite) =>
	returned(RequestIdRow, (db) =>
		db
			.prepare(`UPDATE audio_projects SET invitation_status='pending',invitation_attempted_at=NULL
    WHERE request_id=? AND (${noticeIn("invitation_status", NOTICE_MOVES.QUEUE)} OR
      (${noticeIn("invitation_status", NOTICE_MOVES.QUEUE_RETRYABLE)} AND ?=1 AND invitation_attempted_at<=?)) AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND kind='service' AND status<>'withdrawn' AND email<>'')
    RETURNING request_id`)
			.bind(requestId, write.confirmed ? 1 : 0, write.staleBefore, requestId),
	).pipe(Effect.map((row) => row !== null));

/**
 * N5, compare-and-set: an update's notice is queued again under the same conditions as the invitation's, with no kind check on
 * the request. True when a row changed.
 */
export const queueUpdateNotice = (
	requestId: string,
	updateId: number,
	write: QueueWrite,
) =>
	returned(IdRow, (db) =>
		db
			.prepare(`UPDATE audio_project_updates SET notification_status='pending',notification_attempted_at=NULL
    WHERE id=? AND request_id=? AND (${noticeIn("notification_status", NOTICE_MOVES.QUEUE)} OR
      (${noticeIn("notification_status", NOTICE_MOVES.QUEUE_RETRYABLE)} AND ?=1 AND notification_attempted_at<=?))
      AND EXISTS(SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
        WHERE p.request_id=? AND p.revoked_at IS NULL AND r.status<>'withdrawn' AND r.email<>'')
    RETURNING id`)
			.bind(
				updateId,
				requestId,
				write.confirmed ? 1 : 0,
				write.staleBefore,
				requestId,
			),
	).pipe(Effect.map((row) => row !== null));

/**
 * I1, compare-and-set: the invitation is claimed while it is pending, the project is open and the request is a service with
 * an email that is not withdrawn. The request's id, or null when nothing was claimed.
 */
export const claimInvitation = (requestId: string, at: string) =>
	returned(RequestIdRow, (db) =>
		db
			.prepare(`UPDATE audio_projects SET invitation_status='sending',invitation_attempted_at=?
    WHERE request_id=? AND ${noticeIn("invitation_status", NOTICE_MOVES.CLAIM)} AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND kind='service' AND status<>'withdrawn' AND email<>'')
    RETURNING request_id`)
			.bind(at, requestId, requestId),
	).pipe(Effect.map((row) => row?.request_id ?? null));

/**
 * N1, compare-and-set: an update's notice is claimed while it is pending. It has no access condition: a closed project's
 * notice is claimed, finds no recipient and ends failed. The notice's request id, or null.
 */
export const claimUpdateNotice = (updateId: number, at: string) =>
	returned(RequestIdRow, (db) =>
		db
			.prepare(`UPDATE audio_project_updates SET notification_status='sending',notification_attempted_at=?
    WHERE id=? AND ${noticeIn("notification_status", NOTICE_MOVES.CLAIM)} RETURNING request_id`)
			.bind(at, updateId),
	).pipe(Effect.map((row) => row?.request_id ?? null));

/** I2 and N2: plain read: the request and its project's access, whom a notice goes to. Null with no project. */
export const readRecipient = (requestId: string) =>
	readAll(RecipientRow, (db) =>
		db
			.prepare(`SELECT r.email,r.kind,r.status,p.revoked_at FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE r.id=?`)
			.bind(requestId),
	).pipe(Effect.map((rows): StoredRecipient | null => rows[0] ?? null));

/** I3, compare-and-set: the invitation is marked failed while it is sending and the project is open (the recipient read failed). */
export const failInvitation = (requestId: string) =>
	asked((db) =>
		db
			.prepare(`UPDATE audio_projects SET invitation_status='failed'
      WHERE request_id=? AND ${noticeIn("invitation_status", NOTICE_MOVES.FAIL)} AND revoked_at IS NULL`)
			.bind(requestId)
			.run(),
	).pipe(Effect.asVoid);

/** N3, compare-and-set: an update's notice is marked failed while it is sending, whatever the project's access. */
export const failUpdateNotice = (updateId: number) =>
	asked((db) =>
		db
			.prepare(`UPDATE audio_project_updates SET notification_status='failed'
      WHERE id=? AND ${noticeIn("notification_status", NOTICE_MOVES.FAIL)}`)
			.bind(updateId)
			.run(),
	).pipe(Effect.asVoid);

/** I4, compare-and-set: the invitation's outcome, while it is sending and the project is open. A sent email just after a revoke leaves it sending. */
export const settleInvitation = (
	requestId: string,
	outcome: {
		readonly status: "sent" | "failed";
		readonly sentAt: string | null;
	},
) =>
	asked((db) =>
		db
			.prepare(`UPDATE audio_projects SET invitation_status=?,invitation_sent_at=?
    WHERE request_id=? AND ${noticeIn("invitation_status", NOTICE_MOVES.SEND)} AND revoked_at IS NULL`)
			.bind(outcome.status, outcome.sentAt, requestId)
			.run(),
	).pipe(Effect.asVoid);

/** N4, compare-and-set: an update's notice outcome, while it is sending, whatever the project's access. */
export const settleUpdateNotice = (
	updateId: number,
	outcome: {
		readonly status: "sent" | "failed";
		readonly sentAt: string | null;
	},
) =>
	asked((db) =>
		db
			.prepare(`UPDATE audio_project_updates SET notification_status=?,notification_sent_at=?
    WHERE id=? AND ${noticeIn("notification_status", NOTICE_MOVES.SEND)}`)
			.bind(outcome.status, outcome.sentAt, updateId)
			.run(),
	).pipe(Effect.asVoid);

/** An update as the route answers it: the columns of `audio_project_updates` in the order the answer's JSON writes them. */
const UPDATE_COLUMNS =
	"id,request_id,kind,body,reason,previous_due_at,new_due_at,actor,created_at,notification_status,notification_attempted_at,file_id,milestone";

const SavedUpdateRow = Schema.Struct({
	id: Schema.Number,
	request_id: text,
	kind: Schema.Literals([
		"accepted",
		"progress",
		"work_started",
		"date_changed",
	]),
	body: text,
	reason: Schema.NullOr(
		Schema.Literals([
			"protect_song",
			"client_clarification",
			"schedule_conflict",
		]),
	),
	previous_due_at: maybeText,
	new_due_at: maybeText,
	actor: text,
	created_at: text,
	notification_status: Schema.Literals(NOTICE_STATUSES),
	notification_attempted_at: maybeText,
	file_id: maybeText,
	milestone: Schema.NullOr(Schema.Literals(["revision_started", "completed"])),
});

export type SavedUpdate = typeof SavedUpdateRow.Type;

const OwnerStateRow = Schema.Struct({
	stage: text,
	current_due_at: maybeText,
	original_due_at: maybeText,
	updated_at: text,
	revoked_at: maybeText,
	request_status: text,
	email: text,
	booking_status: maybeText,
	balance_status: maybeText,
});

const VersionRow = Schema.Struct({ version: Version });

/** What an owner's update reads: the project's state, the request and the payments, and the versions of the published files. */
export type OwnerUpdateFacts = {
	readonly state: StoredOwnerState | null;
	readonly published: readonly { readonly version: "review" | "final" }[];
};

/** U17: plain reads in ONE batch (one snapshot): the project with its request and payments, and the published files. */
export const readOwnerUpdateFacts = (requestId: string) =>
	batched((db) => [
		db
			.prepare(`SELECT p.stage,p.current_due_at,p.original_due_at,p.updated_at,p.revoked_at,
    r.status AS request_status,r.email,pay.booking_status,pay.balance_status
    FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
    LEFT JOIN audio_payments pay ON pay.request_id=p.request_id WHERE p.request_id=?`)
			.bind(requestId),
		db
			.prepare(
				"SELECT version FROM audio_project_files WHERE request_id=? AND status='published'",
			)
			.bind(requestId),
	]).pipe(
		Effect.flatMap(([states, published]) =>
			Effect.all({
				states: rowsOf(OwnerStateRow, states ?? []),
				published: rowsOf(VersionRow, published ?? []),
			}),
		),
		Effect.map(
			(rows): OwnerUpdateFacts => ({
				state: rows.states[0] ?? null,
				published: rows.published,
			}),
		),
	);

/** What an owner's update writes, whichever action it is. */
export type UpdateWrite = {
	readonly actor: string;
	readonly body: string;
	readonly at: string;
	/** The project's `updated_at` as read, which the write compares. */
	readonly updatedAt: string;
};

/** U1, compare-and-set: a progress note, written while the stage takes one, the project is open and the request is not withdrawn. */
export const addProgressNote = (requestId: string, write: UpdateWrite) =>
	returned(SavedUpdateRow, (db) =>
		db
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
      SELECT p.request_id,'progress',?,?,? FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
      WHERE p.request_id=? AND ${stagesIn("p.stage", KEEPING_STAGES.PROGRESS)}
        AND p.revoked_at IS NULL AND r.status<>'withdrawn' RETURNING ${UPDATE_COLUMNS}`)
			.bind(write.body, write.actor, write.at, requestId),
	);

/** The batch every stage-moving update runs: the guarded UPDATE, the client's update row and the audit row. The update row, or null when the guard changed nothing. */
const savedBatch = (statements: (db: D1Database) => D1PreparedStatement[]) =>
	asked(async (db) => {
		const [changed, update] = await db.batch(statements(db));

		return changed?.results.length ? (update?.results[0] ?? null) : null;
	}).pipe(
		Effect.flatMap((found) =>
			found === null
				? Effect.succeed(null)
				: rowsOf(SavedUpdateRow, [found]).pipe(
						Effect.map((rows) => rows[0] ?? null),
					),
		),
	);

/**
 * U2 to U4 in ONE batch: the project is accepted (compare-and-set on the stage, the `updated_at` read, an open project and a
 * reviewed request), then the client's update and the audit row, each written only while that UPDATE changed the row
 * (`changes()=1`).
 */
export const acceptProject = (
	requestId: string,
	write: UpdateWrite & { readonly dueDate: string },
) => {
	const to = stageLiteral(PROJECT_MOVES.ACCEPT.to);

	return savedBatch((db) => [
		db
			.prepare(`UPDATE audio_projects SET stage=${to},original_due_at=?,current_due_at=?,updated_at=?
        WHERE request_id=? AND ${stagesIn("stage", PROJECT_MOVES.ACCEPT.from)} AND updated_at=? AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status='reviewed') RETURNING request_id`)
			.bind(
				write.dueDate,
				write.dueDate,
				write.at,
				requestId,
				write.updatedAt,
				requestId,
			),
		db
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,new_due_at,actor,created_at)
        SELECT request_id,'accepted',?,?,?,? FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND original_due_at=? AND changes()=1 RETURNING ${UPDATE_COLUMNS}`)
			.bind(
				write.body,
				write.dueDate,
				write.actor,
				write.at,
				requestId,
				write.at,
				write.dueDate,
			),
		db
			.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
        SELECT request_id,'accepted',?,? FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND original_due_at=? AND changes()=1`)
			.bind(write.actor, write.at, requestId, write.at, write.dueDate),
	]);
};

/** U5 to U7 in ONE batch: work starts while the project is accepted, open, not withdrawn and the booking is paid. */
export const startWork = (requestId: string, write: UpdateWrite) => {
	const to = stageLiteral(PROJECT_MOVES.START_WORK.to);

	return savedBatch((db) => [
		db
			.prepare(`UPDATE audio_projects SET stage=${to},updated_at=?
        WHERE request_id=? AND ${stagesIn("stage", PROJECT_MOVES.START_WORK.from)} AND updated_at=? AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status<>'withdrawn')
        AND EXISTS(SELECT 1 FROM audio_payments WHERE request_id=? AND booking_status='paid') RETURNING request_id`)
			.bind(write.at, requestId, write.updatedAt, requestId, requestId),
		db
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
        SELECT request_id,'work_started',?,?,? FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND changes()=1 RETURNING ${UPDATE_COLUMNS}`)
			.bind(write.body, write.actor, write.at, requestId, write.at),
		db
			.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
        SELECT request_id,'stage-changed',?,? FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND changes()=1`)
			.bind(write.actor, write.at, requestId, write.at),
	]);
};

/** U8 to U10 in ONE batch: a revision begins while the review is ready and a review is still published (the guard keeps it). */
export const beginRevision = (requestId: string, write: UpdateWrite) => {
	const to = stageLiteral(PROJECT_MOVES.BEGIN_REVISION.to);

	return savedBatch((db) => [
		db
			.prepare(`UPDATE audio_projects SET stage=${to},updated_at=?
        WHERE request_id=? AND ${stagesIn("stage", PROJECT_MOVES.BEGIN_REVISION.from)} AND updated_at=? AND revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status<>'withdrawn')
          AND EXISTS(SELECT 1 FROM audio_project_files WHERE request_id=? AND version='review' AND status='published')
        RETURNING request_id`)
			.bind(write.at, requestId, write.updatedAt, requestId, requestId),
		db
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone)
        SELECT request_id,'progress',?,?,?,'revision_started' FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND changes()=1 RETURNING ${UPDATE_COLUMNS}`)
			.bind(write.body, write.actor, write.at, requestId, write.at),
		db
			.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
        SELECT request_id,'stage-changed',?,? FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND changes()=1`)
			.bind(write.actor, write.at, requestId, write.at),
	]);
};

/** U11 to U13 in ONE batch: the project completes while the final is ready, both payments are paid and a final is still published (the guard keeps it). */
export const completeProject = (requestId: string, write: UpdateWrite) => {
	const to = stageLiteral(PROJECT_MOVES.COMPLETE.to);

	return savedBatch((db) => [
		db
			.prepare(`UPDATE audio_projects SET stage=${to},completed_at=?,updated_at=?
        WHERE request_id=? AND ${stagesIn("stage", PROJECT_MOVES.COMPLETE.from)} AND updated_at=? AND revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status IN ('reviewed','resolved'))
          AND EXISTS(SELECT 1 FROM audio_payments WHERE request_id=? AND booking_status='paid' AND balance_status='paid')
          AND EXISTS(SELECT 1 FROM audio_project_files WHERE request_id=? AND version='final' AND status='published')
        RETURNING request_id`)
			.bind(
				write.at,
				write.at,
				requestId,
				write.updatedAt,
				requestId,
				requestId,
				requestId,
			),
		db
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone)
        SELECT request_id,'progress',?,?,?,'completed' FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND changes()=1 RETURNING ${UPDATE_COLUMNS}`)
			.bind(write.body, write.actor, write.at, requestId, write.at),
		db
			.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
        SELECT request_id,'completed',?,? FROM audio_projects
        WHERE request_id=? AND stage=${to} AND updated_at=? AND changes()=1`)
			.bind(write.actor, write.at, requestId, write.at),
	]);
};

/** U14 to U16 in ONE batch: the due date moves while the project is not complete, is open and the request is not withdrawn. */
export const reviseDate = (
	requestId: string,
	write: UpdateWrite & {
		readonly dueDate: string;
		readonly currentDueAt: string;
		readonly reason: string;
	},
) =>
	savedBatch((db) => [
		db
			.prepare(`UPDATE audio_projects SET current_due_at=?,updated_at=?
      WHERE request_id=? AND current_due_at=? AND updated_at=? AND ${stagesIn("stage", KEEPING_STAGES.REVISE_DATE)} AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status<>'withdrawn')
      RETURNING request_id`)
			.bind(
				write.dueDate,
				write.at,
				requestId,
				write.currentDueAt,
				write.updatedAt,
				requestId,
			),
		db
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,reason,previous_due_at,new_due_at,actor,created_at)
      SELECT request_id,'date_changed',?,?,?,?,?,? FROM audio_projects
      WHERE request_id=? AND current_due_at=? AND updated_at=? AND changes()=1 RETURNING ${UPDATE_COLUMNS}`)
			.bind(
				write.body,
				write.reason,
				write.currentDueAt,
				write.dueDate,
				write.actor,
				write.at,
				requestId,
				write.dueDate,
				write.at,
			),
		db
			.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'date-changed',?,? FROM audio_projects
      WHERE request_id=? AND current_due_at=? AND updated_at=? AND changes()=1`)
			.bind(write.actor, write.at, requestId, write.dueDate, write.at),
	]);
