// The attachment a signing session downloads: a file the owner attached to the offer being signed. The session must be a
// signing session; the offer's pinned attachment is read by the id the visitor sent, and the id decides nothing a visitor
// can probe: an unknown id, another request's attachment, and one the offer does not pin are the same refusal.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { hashBytes } from "../../lib/agreement-artifacts";
import { pinnedAttachment, sessionOf } from "../agreement-store";
import { decideAttachment } from "../rules/agreement-attachment";
import { AudioBucket, MusicDb } from "../services";

/** No signing session: the answer asks the visitor to verify. */
export class VerifyFirst extends Data.TaggedError("VerifyFirst") {
	readonly say = "Verify email first.";
}

/** The attachment is not one this session may download, or its object is not in the bucket. */
export class AttachmentNotFound extends Data.TaggedError(
	"AttachmentNotFound",
) {}

/** The bucket read failed (it threw). */
export class AttachmentReadFailed extends Data.TaggedError(
	"AttachmentReadFailed",
)<{
	readonly failure: unknown;
}> {}

/** The bytes are not the digest the row names. */
export class AttachmentIntegrity extends Data.TaggedError(
	"AttachmentIntegrity",
) {
	readonly say =
		"This file couldn’t be verified, so I’ve held it back. Please let me know before you sign.";
}

export const downloadAttachment = (input: {
	readonly id: string;
	readonly request: Request;
}) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;
		const bucket = yield* AudioBucket;

		const session = yield* sessionOf(db, input.request, "agreement");

		if (!session) return yield* Effect.fail(new VerifyFirst());

		const row = yield* pinnedAttachment(db, input.id, session.offer_id);
		const decision = decideAttachment(row);

		if (decision.kind === "refused")
			return yield* Effect.fail(new AttachmentNotFound());

		const object = yield* Effect.tryPromise({
			try: () => bucket.get(decision.row.object_key),
			catch: (cause) => new AttachmentReadFailed({ failure: cause }),
		});

		if (!object) return yield* Effect.fail(new AttachmentNotFound());

		const bytes = yield* Effect.tryPromise({
			try: () => object.arrayBuffer(),
			catch: (cause) => new AttachmentReadFailed({ failure: cause }),
		});

		const digest = yield* Effect.promise(() => hashBytes(bytes));

		if (digest !== decision.row.sha256)
			return yield* Effect.fail(new AttachmentIntegrity());

		return { bytes };
	});
