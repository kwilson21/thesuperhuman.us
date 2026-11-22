// What the public intake routes read from and write to MUSIC_DB. A write stores one owner request and its creation audit in
// one batch, one function per statement, and answers the row as it stored it (nothing is read back: a read that failed
// after the insert would make a stored request look unsaved, and a retry would store it twice). A read asks for what is
// stored and decides nothing. A failure carries what the database raised in a field named `failure`, which the route logs
// as it always has; a unique violation on the submission id is a `SubmissionIdClash`, so the flow asks the rule again on fresh
// facts.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
	type OwnerRequest,
	type OwnerRequestRow,
	ownerRequestFromRow,
} from "../lib/owner-model";
import { type NewOwnerRequest, requestColumns } from "../lib/owner-requests";
import { ChangedSinceRead, isUniqueViolation } from "./guarded-save";
import type { ClaimWrite, DetailsFailureWrite } from "./rules/brief-copy";
import { MusicDb } from "./services";

/** The database refused the write. */
export class IntakeStoreFailed extends Data.TaggedError("IntakeStoreFailed")<{
	readonly failure: unknown;
}> {}

/** The database could not be read. */
export class IntakeReadFailed extends Data.TaggedError("IntakeReadFailed")<{
	readonly failure: unknown;
}> {}

/** The brief's details are larger than a request may store. Nothing was written. */
export class BriefTooLarge extends Data.TaggedError("BriefTooLarge") {}

/** The unique index refused the brief: another request stored the same submission id. It keeps what the database said, for the log. */
export class SubmissionIdClash extends ChangedSinceRead {
	constructor(readonly clash: Error) {
		super();
	}
}

/**
 * The most a request's details may hold once written as JSON. The largest brief the form allows is about 14,300 characters;
 * with the fullest outline the board can send (every card carrying its longest passage, every question answered, every
 * field made of characters that double in JSON) it is about 25,700 (tests/api/software-inquiry.test.ts), so the limit
 * leaves room for both.
 */
const DETAILS_LIMIT = 32_000;

/** The insert of the request row. */
const requestStatement = (
	db: D1Database,
	row: OwnerRequest,
	detailsJson: string,
	submissionId: string | undefined,
) =>
	db
		.prepare(`INSERT INTO owner_requests
      (id,kind,release_id,service_id,campaign_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at${submissionId ? ",submission_id" : ""})
      VALUES (?,?,?,?,?,?,?,?,?,?,'new','',?,?${submissionId ? ",?" : ""})`)
		.bind(
			row.id,
			row.kind,
			row.releaseId,
			row.serviceId,
			row.campaignId,
			row.name,
			row.email,
			row.cityRegion,
			row.summary,
			detailsJson,
			row.createdAt,
			row.updatedAt,
			...(submissionId ? [submissionId] : []),
		);

/** The insert of the request's creation audit row. */
const creationAuditStatement = (db: D1Database, row: OwnerRequest) =>
	db
		.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
      VALUES (?,'created','system','',?)`)
		.bind(row.id, row.createdAt);

/**
 * Stores one owner request and its creation audit in one batch, and answers the row as stored. A brief too large is
 * refused before anything is sent. Any duplicate-key refusal is a `SubmissionIdClash` (a `ChangedSinceRead`, as the music
 * store maps its own constraints); any other refusal is an `IntakeStoreFailed` carrying what the database raised. The
 * duplicate key can only be the unique index on the submission id in practice: the request id is a fresh random UUID, and for
 * an audio request the trigger's `audio_projects.request_id` is that same fresh id, so neither realistically collides.
 * (Audio requests carry no submission id, so for them nothing can clash.)
 */
export const insertRequest = (request: NewOwnerRequest) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;
		const detailsJson = JSON.stringify(request.details ?? {});

		if (detailsJson.length > DETAILS_LIMIT)
			return yield* Effect.fail(new BriefTooLarge());

		// The id is made before the time, as the batch always was.
		const id = crypto.randomUUID();
		const at = new Date().toISOString();

		// SAFETY: detailsJson is the JSON.stringify of a plain object (request.details ?? {}), so JSON.parse gives back the same record the database returns on a read.
		const details: OwnerRequest["details"] = JSON.parse(detailsJson);

		const row: OwnerRequest = {
			id,
			kind: request.kind,
			releaseId: request.releaseId ?? null,
			serviceId: request.serviceId ?? null,
			campaignId: request.campaignId ?? null,
			name: request.name?.trim() ?? "",
			email: request.email.trim().toLowerCase(),
			cityRegion: request.cityRegion?.trim() ?? "",
			summary: request.summary.trim(),
			details,
			status: "new",
			privateNote: "",
			createdAt: at,
			updatedAt: at,
			resolvedAt: null,
			contactDeleteAfter: null,
		};

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					requestStatement(db, row, detailsJson, request.submissionId),
					creationAuditStatement(db, row),
				]),
			// A duplicate key means another request stored the same submission id first (see above for why no other key collides).
			catch: (failure) =>
				isUniqueViolation(failure) && failure instanceof Error
					? new SubmissionIdClash(failure)
					: new IntakeStoreFailed({ failure }),
		});

		return row;
	});

/** The brief stored under a submission id, or null. */
export const findStoredBrief = (submissionId: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: async (): Promise<OwnerRequest | null> => {
				const row = await db
					.prepare(
						`SELECT ${requestColumns} FROM owner_requests WHERE submission_id=?`,
					)
					.bind(submissionId)
					.first<OwnerRequestRow>();

				return row ? ownerRequestFromRow(row) : null;
			},
			catch: (failure) => new IntakeReadFailed({ failure }),
		});
	});

// The client's copy of a brief (src/server/flows/brief-copy.ts). The read says what is stored and decides nothing: the rule
// (src/server/rules/brief-copy.ts) judges it. Each write compares only that the row is still as it was read, or still carries
// this attempt's instant, and says nothing when it is not (`claimCopy` says so with a `ChangedSinceRead`, so the flow reads and
// judges again; the writes that record what happened leave a row another attempt claimed as it is).

/** The request a copy is for, with its details text exactly as stored, or null when nothing is stored under the id. */
export const readCopyFacts = (id: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		const row = yield* Effect.tryPromise({
			try: () =>
				db
					.prepare(`SELECT ${requestColumns} FROM owner_requests WHERE id=?`)
					.bind(id)
					.first<OwnerRequestRow>(),
			catch: (failure) => new IntakeReadFailed({ failure }),
		});

		if (!row) return null;

		const request = yield* Effect.try({
			try: () => ownerRequestFromRow(row),
			catch: (failure) => new IntakeReadFailed({ failure }),
		});

		return { request, detailsJson: row.details_json };
	});

/**
 * Claims the copy for this attempt: status "uncertain" and the attempt's instant, only while the request still has the
 * status, address and details text the rule judged. A row that changed since is a `ChangedSinceRead`.
 */
export const claimCopy = (write: ClaimWrite) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		const claimed = yield* Effect.tryPromise({
			try: () =>
				db
					.prepare(`UPDATE owner_requests SET details_json=json_set(details_json,
      '$.clientCopyStatus','uncertain','$.clientCopyAttemptedAt',?)
      WHERE id=? AND status=? AND email=? AND details_json=? RETURNING id`)
					.bind(
						write.at,
						write.request.id,
						write.request.status,
						write.request.email,
						write.detailsJson,
					)
					.first<{ id: string }>(),
			catch: (failure) => new IntakeStoreFailed({ failure }),
		});

		if (!claimed) return yield* Effect.fail(new ChangedSinceRead());
	});

/** Records what the provider answered, only while the request still carries this attempt's instant. */
export const recordCopyStatus = (id: string, at: string, status: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					db
						.prepare(`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus',?)
      WHERE id=? AND json_extract(details_json,'$.clientCopyAttemptedAt')=?`)
						.bind(status, id, at),
				]),
			catch: (failure) => new IntakeStoreFailed({ failure }),
		});
	});

/** Records a failure for an attempt that never asked the provider, only while the request still carries this attempt's instant. */
export const recordOwnFailure = (id: string, at: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					db
						.prepare(`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus','failed')
          WHERE id=? AND json_extract(details_json,'$.clientCopyAttemptedAt')=?`)
						.bind(id, at),
				]),
			catch: (failure) => new IntakeStoreFailed({ failure }),
		});
	});

/** Records a failure for a claim that could not be written, only while the details are the text that was read. */
export const recordUnclaimedFailure = (write: DetailsFailureWrite) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					db
						.prepare(`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus','failed')
          WHERE id=? AND details_json=?`)
						.bind(write.id, write.expected),
				]),
			catch: (failure) => new IntakeStoreFailed({ failure }),
		});
	});

/** Records a failure for a request that could not be read, only while no copy status is recorded on it. */
export const recordUnreadFailure = (id: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					db
						.prepare(`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus','failed')
          WHERE id=? AND json_extract(details_json,'$.clientCopyStatus') IS NULL`)
						.bind(id),
				]),
			catch: (failure) => new IntakeStoreFailed({ failure }),
		});
	});
