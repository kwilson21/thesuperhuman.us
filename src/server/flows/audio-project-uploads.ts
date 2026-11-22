// What the owner's browser does to send a project file: start an upload (R2 opens a multipart upload and the project records
// it), put its parts, complete it (R2 joins the parts, the project records the file) or recover a completion that R2 already
// finished, and abort it (docs/plans/2026-11-audio-projects-conversion.md, sections 3 and 6). Each reads in the order the
// routes always did. A write whose own conditions no longer hold is refused by name and not retried. How R2's error codes
// map: 10043 is `ObjectStoreUnavailable` (the route answers 503 and logs nothing); at a completion 10024 (the upload is gone)
// and 10058 (too many writes to one key) look for the object, 10024 answering 409 when there is none and 10058 trying up to
// two more times after waits of 100 and 200 milliseconds and then answering 503; 10025 (an invalid part) answers 409; a part
// put into an upload R2 no longer has answers 409; every other R2 failure is `ObjectStoreFailed`. The routes build every
// answer.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import {
	abortMultipart,
	abortOpened,
	completeMultipart,
	createMultipart,
	deleteDiscardedUpload,
	deleteObject,
	deleteUploadRow,
	headObject,
	insertFileFromUpload,
	insertUpload,
	markUploadDiscarding,
	MultipartGone,
	ObjectStoreFailed,
	ObjectStoreUnavailable,
	readFileId,
	readProjectWithPayment,
	readUpload,
	uploadPart,
} from "../audio-project-store";
import {
	readBodyWithin,
	uploadPartSize,
} from "../../lib/audio-project-uploads";
import { AudioBucket } from "../services";
import {
	bodyOfPart,
	completionParts,
	existingUpload,
	fileOfUpload,
	newUploadKey,
	objectOfUpload,
	partOfUpload,
	pendingToFinish,
	pendingToPut,
	PartNotUploadable,
	projectTakesFinishedUpload,
	projectTakesUpload,
	type StoredUpload,
	UploadNotFinishable,
	UploadNotReady,
} from "../rules/audio-project-uploads";

/** The waits before the second and the third try of a completion that R2 refused for writing one key too often. */
const completionRetryDelaysMs = [100, 200];

/** The project's upload with this id, or `UploadGone`. */
const uploadOf = (requestId: string, uploadId: string) =>
	readUpload(requestId, uploadId).pipe(
		Effect.flatMap((upload) => existingUpload.decide(null, { upload })),
	);

/** The owner starts an upload: a multipart upload in R2 and its row. The row's id and the size of a part. */
export const startUpload = (input: {
	readonly requestId: string;
	readonly version: "review" | "final";
	readonly displayName: string;
	readonly mediaType: "audio/mpeg" | "audio/wav";
	readonly byteSize: number;
	readonly now: () => Date;
	readonly newId: () => string;
}) =>
	Effect.gen(function* () {
		const at = input.now();

		const facts = yield* readProjectWithPayment(input.requestId);
		yield* projectTakesUpload.decide({ version: input.version }, facts);

		const id = input.newId();

		const key = yield* newUploadKey.decide(
			{ requestId: input.requestId, id, mediaType: input.mediaType },
			null,
		);

		const opened = yield* createMultipart(key, input.mediaType);

		// The multipart upload is dropped again when the row cannot be written; a failed drop is ignored.
		const dropped = abortOpened(opened).pipe(Effect.ignore);

		const row = yield* insertUpload({
			id,
			requestId: input.requestId,
			uploadId: opened.uploadId,
			key,
			version: input.version,
			displayName: input.displayName,
			mediaType: input.mediaType,
			byteSize: input.byteSize,
			at: at.toISOString(),
		}).pipe(Effect.tapError(() => dropped));

		if (row === null) {
			yield* dropped;

			return yield* Effect.fail(new UploadNotReady());
		}

		return { id: row.id, partSize: uploadPartSize };
	});

/** The owner puts one part of a file. R2's answer for the part. */
export const putUploadPart = (input: {
	readonly requestId: string;
	readonly uploadId: string;
	readonly part: number;
	readonly contentLength: string | null;
	readonly body: ReadableStream<Uint8Array>;
}) =>
	Effect.gen(function* () {
		const upload = yield* uploadOf(input.requestId, input.uploadId);
		const facts = yield* readProjectWithPayment(input.requestId);
		yield* projectTakesUpload.decide({ version: upload.version }, facts);

		const length = yield* partOfUpload.decide(
			{ part: input.part, contentLength: input.contentLength },
			upload,
		);

		// A read of the request's own body fails only when the client went away: a defect, which the route logs once and
		// answers with its fixed sentence, as the catch around it always did. Reading stops once the body passes `length`.
		const read = yield* Effect.promise(() =>
			readBodyWithin(input.body, length),
		);

		const body = yield* bodyOfPart.decide({ body: read }, { length });

		yield* pendingToPut.decide(null, upload);

		return yield* uploadPart(upload, input.part, body).pipe(
			Effect.catchTag("MultipartGone", () =>
				Effect.fail(new PartNotUploadable()),
			),
		);
	});

/**
 * Completes the multipart upload with the owner's parts. A part R2 does not list answers 409; R2 having lost the upload, or
 * refusing the write for one key too often, looks for the object another completion may have made.
 */
const completeFromParts = (
	upload: StoredUpload,
	parts:
		| readonly { readonly partNumber: number; readonly etag: string }[]
		| null,
) =>
	Effect.gen(function* () {
		const joined = yield* completionParts.decide(
			{ parts, byteSize: upload.byte_size },
			null,
		);

		const found = (
			attempt: number,
		): Effect.Effect<
			R2Object,
			UploadNotFinishable | ObjectStoreUnavailable | ObjectStoreFailed,
			AudioBucket
		> =>
			completeMultipart(upload, joined).pipe(
				Effect.catchTags({
					MultipartPartInvalid: () => Effect.fail(new UploadNotFinishable()),
					MultipartGone: () =>
						headObject(upload.object_key).pipe(
							Effect.flatMap((object) =>
								object === null
									? Effect.fail(new UploadNotFinishable())
									: Effect.succeed(object),
							),
						),
					ConcurrentWrite: () =>
						headObject(upload.object_key).pipe(
							Effect.flatMap((object) => {
								if (object !== null) return Effect.succeed(object);

								const wait = completionRetryDelaysMs[attempt];

								// Still busy after the last try: a known temporary unavailability, which the owner may try again.
								return wait === undefined
									? Effect.fail(new ObjectStoreUnavailable())
									: Effect.sleep(Duration.millis(wait)).pipe(
											Effect.flatMap(() => found(attempt + 1)),
										);
							}),
						),
				}),
			);

		return yield* found(0);
	});

/** The owner completes an upload (with the parts R2 joins) or recovers one R2 already finished (no parts). The file's id. */
export const finishUpload = (input: {
	readonly requestId: string;
	readonly uploadId: string;
	readonly parts:
		| readonly { readonly partNumber: number; readonly etag: string }[]
		| null;
	readonly peaks: readonly number[] | null;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const at = input.now();
		const upload = yield* uploadOf(input.requestId, input.uploadId);
		yield* pendingToFinish.decide(null, upload);

		const facts = yield* readProjectWithPayment(input.requestId);
		yield* projectTakesFinishedUpload.decide(
			{ version: upload.version },
			facts,
		);

		const existing = yield* headObject(upload.object_key);
		const object = existing ?? (yield* completeFromParts(upload, input.parts));
		yield* objectOfUpload.decide({ size: object.size }, upload);

		const written = yield* insertFileFromUpload(
			upload,
			input.peaks,
			at.toISOString(),
		);

		const fileId = written ?? (yield* readFileId(input.requestId, upload.id));

		yield* fileOfUpload.decide(null, { fileId });
		yield* deleteUploadRow(input.requestId, upload.id);

		return upload.id;
	});

/** The owner discards an upload: its R2 object or multipart upload goes, and then its row. */
export const abortUpload = (input: {
	readonly requestId: string;
	readonly uploadId: string;
}) =>
	Effect.gen(function* () {
		const upload = yield* uploadOf(input.requestId, input.uploadId);

		const discarding = yield* markUploadDiscarding(input.requestId, upload.id);

		// A file row exists for the upload (or the row is gone): the object is the file's now, so only the row is dropped.
		if (discarding === null) {
			const file = yield* readFileId(input.requestId, upload.id);

			if (file !== null) yield* deleteUploadRow(input.requestId, upload.id);

			return;
		}

		const object = yield* headObject(upload.object_key);

		if (object !== null) yield* deleteObject(upload.object_key);
		else {
			// R2 failing to abort leaves the object to look for once more. R2 having dropped the upload already (an earlier
			// abort or its incomplete-upload lifecycle) leaves nothing to clean; any other failure stays retryable.
			const afterFailedAbort = (
				failure: MultipartGone | ObjectStoreFailed | ObjectStoreUnavailable,
			) =>
				headObject(upload.object_key).pipe(
					Effect.flatMap((found) =>
						found !== null
							? deleteObject(upload.object_key)
							: Predicate.isTagged(failure, "MultipartGone")
								? Effect.void
								: Effect.fail(failure),
					),
				);

			yield* abortMultipart(upload).pipe(
				Effect.catchTags({
					MultipartGone: afterFailedAbort,
					ObjectStoreFailed: afterFailedAbort,
					ObjectStoreUnavailable: afterFailedAbort,
				}),
			);
		}

		yield* deleteDiscardedUpload(input.requestId, upload.id);
	});
