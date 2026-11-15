// The signed copy a verified visitor downloads. The reads run in the same order for every id: the visitor's sessions, then
// ONE batch with the agreement named by the id (whatever its status), the offer a signing session reuses, and a studio
// visitor's projects; so an unknown agreement, one not executed or closed, and another client's all read the same
// statements. The rules in src/server/rules/agreement-download.ts are the only place they part. Then the signed copy is
// read from the bucket and checked against its digest. A failed bucket read is a named failure; so is a failed database
// call, which the route logs and answers with its fixed 500.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { hashBytes } from "../../lib/agreement-artifacts";
import { hashing } from "../agreement-services";
import { readDownloadFacts, readSignedCopy } from "../agreement-store";
import {
	decideDownload,
	intactSignedCopy,
	readySignedCopy,
	verifiedVisitor,
} from "../rules/agreement-download";
import { AudioBucket } from "../services";
import { studioIdentity, visitorSession } from "./agreement-session";

/** The copy's object is not in the bucket. */
export class CopyMissing extends Data.TaggedError("CopyMissing") {}

/** The bucket read failed (it threw). The route answers its fixed 500 with no log line, as it always has. */
export class CopyReadFailed extends Data.TaggedError("CopyReadFailed")<{
	readonly failure: unknown;
}> {}

/** Reading the object's bytes failed (it threw). The route logs it and answers its fixed 500. */
export class CopyBytesFailed extends Data.TaggedError("CopyBytesFailed")<{
	readonly failure: unknown;
}> {}

export type SignedCopyDownload = { readonly bytes: ArrayBuffer };

export const downloadSignedCopy = (input: {
	readonly id: string;
	readonly request: Request;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const bucket = yield* AudioBucket;
		const { id, request, now } = input;

		const archive = yield* visitorSession(request, "archive", now);
		const signing = yield* visitorSession(request, "agreement", now);
		const studio = yield* studioIdentity(request, now);

		const sessions = {
			archive: archive ? { recipient_email: archive.recipient_email } : null,
			signing: signing
				? {
						recipient_email: signing.recipient_email,
						offer_id: signing.offer_id,
					}
				: null,
			studio,
		};

		yield* verifiedVisitor.decide(null, sessions);

		const read = yield* readDownloadFacts({
			id,
			signingOfferId: signing?.offer_id ?? null,
			studioEmail: studio?.email ?? null,
		});

		yield* decideDownload.decide({ id }, { ...sessions, ...read });

		const copy = yield* readSignedCopy(id).pipe(
			Effect.flatMap((stored) => readySignedCopy.decide(null, stored)),
			Effect.flatMap((ready) =>
				Effect.fromNullishOr(ready).pipe(
					Effect.mapError(() => new CopyMissing()),
				),
			),
		);

		const object = yield* Effect.tryPromise({
			try: () => bucket.get(copy.pdf_key),
			catch: (failure) => new CopyReadFailed({ failure }),
		}).pipe(
			Effect.flatMap((found) =>
				Effect.fromNullishOr(found).pipe(
					Effect.mapError(() => new CopyMissing()),
				),
			),
		);

		const bytes = yield* Effect.tryPromise({
			try: () => object.arrayBuffer(),
			catch: (failure) => new CopyBytesFailed({ failure }),
		});

		const digest = yield* hashing(() => hashBytes(bytes));

		yield* intactSignedCopy.decide({ bytesSha256: digest }, copy);

		return { bytes } satisfies SignedCopyDownload;
	});
