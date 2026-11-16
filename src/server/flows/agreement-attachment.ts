// The attachment a signing session downloads: a file the owner attached to the offer being signed. The session must be a
// signing session. The attachment and the offer the session names are read in one batch, whatever the id, and the rule in
// src/server/rules/agreement-attachment.ts decides: an unknown id, another request's attachment, and one the offer does
// not pin are the same refusal, read by the same statements. The bucket is read only after the rule allows it.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { hashBytes } from "../../lib/agreement-artifacts";
import { hashing } from "../agreement-services";
import { readAttachmentFacts } from "../agreement-store";
import {
	AttachmentNotFound,
	decideAttachment,
	intactAttachment,
} from "../rules/agreement-attachment";
import { AudioBucket } from "../services";
import { visitorSession } from "./agreement-session";

/** No signing session: the answer asks the visitor to verify. */
export class VerifyFirst extends Data.TaggedError("VerifyFirst") {
	readonly say = "Verify email first.";
}

/** The bucket read failed (it threw). The route logs it and answers its fixed 500. */
export class AttachmentReadFailed extends Data.TaggedError(
	"AttachmentReadFailed",
)<{ readonly failure: unknown }> {}

const missing = () => new AttachmentNotFound();

export const downloadAttachment = (input: {
	readonly id: string;
	readonly request: Request;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const bucket = yield* AudioBucket;

		const session = yield* visitorSession(
			input.request,
			"agreement",
			input.now,
		).pipe(
			Effect.flatMap((found) =>
				Effect.fromNullishOr(found).pipe(
					Effect.mapError(() => new VerifyFirst()),
				),
			),
		);

		const facts = yield* readAttachmentFacts(input.id, session.offer_id);
		const pinned = yield* decideAttachment.decide(null, facts);

		const row = yield* Effect.fromNullishOr(pinned).pipe(
			Effect.mapError(missing),
		);

		const object = yield* Effect.tryPromise({
			try: () => bucket.get(row.object_key),
			catch: (failure) => new AttachmentReadFailed({ failure }),
		}).pipe(
			Effect.flatMap((found) =>
				Effect.fromNullishOr(found).pipe(Effect.mapError(missing)),
			),
		);

		const bytes = yield* Effect.tryPromise({
			try: () => object.arrayBuffer(),
			catch: (failure) => new AttachmentReadFailed({ failure }),
		});

		const digest = yield* hashing(() => hashBytes(bytes));

		yield* intactAttachment.decide({ bytesSha256: digest }, row);

		return { bytes };
	});
