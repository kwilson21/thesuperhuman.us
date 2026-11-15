// What the public intake routes read from and write to MUSIC_DB. A write stores one owner request and its creation audit in
// one batch, one function per statement, and answers the row as it stored it (nothing is read back: a read that failed
// after the insert would make a stored request look unsaved, and a retry would store it twice). A read asks for what is
// stored and decides nothing. A failure carries what the database raised in a field named `failure`, which the route logs
// as it always has; a unique violation on the submission id is a `SubmissionIdClash`, so the flow asks the rule again on fresh
// facts.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { OwnerRequest } from "../lib/owner-model";
import {
	getOwnerRequestBySubmission,
	type NewOwnerRequest,
} from "../lib/owner-requests";
import { ChangedSinceRead, isUniqueViolation } from "./guarded-save";
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

/** The most a request's details may hold once written as JSON. */
const DETAILS_LIMIT = 16_000;

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
 * refused before anything is sent. A violation of the unique index on the submission id is a `SubmissionIdClash` (a `ChangedSinceRead`, as the music store maps its own
 * constraints); any other refusal is an `IntakeStoreFailed` carrying what the database raised.
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
			// The unique index on the submission id refusing the batch means another request stored the same id first.
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
			try: (): Promise<OwnerRequest | null> =>
				getOwnerRequestBySubmission(db, submissionId),
			catch: (failure) => new IntakeReadFailed({ failure }),
		});
	});
