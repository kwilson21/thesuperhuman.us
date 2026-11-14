// The signed copy a verified visitor downloads. The reads run in the order the route has always run them, and they do
// not depend on the id: an unknown agreement, one not executed or closed, and another client's all read the same rows in
// the same order, and the decision in src/server/rules/agreement-download.ts is the only place they part. Then the
// signed copy is read from the bucket and checked against its digest. A failed bucket read is a named failure; a failed
// database call is a defect, which the route logs and answers with its fixed 500.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { AgreementArtifact } from "../../lib/agreement-artifacts";
import { hashBytes } from "../../lib/agreement-artifacts";
import { studioSessionFromRequest } from "../../lib/audio-client-access";
import {
	executedAgreement,
	linkedMsaId,
	offerReusesAgreement,
	projectAgreementId,
	readySignedCopy,
	sessionOf,
	studioEmail,
	studioProjects,
} from "../agreement-store";
import { AudioBucket, MusicDb } from "../services";
import {
	copyIsIntact,
	decideDownload,
	type DownloadFacts,
} from "../rules/agreement-download";

/** The visitor has no valid session: the answer asks them to verify. */
export class SignInFirst extends Data.TaggedError("SignInFirst") {
	readonly say = "Verify your agreement email first.";
}

/** Nothing a visitor can download answers here, the same as an unknown id. */
export class AgreementNotFound extends Data.TaggedError("AgreementNotFound") {}

/** The agreement is signed by both parties but its copy is not ready yet. */
export class CopyNotReady extends Data.TaggedError("CopyNotReady") {
	readonly say = "Signed by both parties. Copy preparation needs attention.";
}

/** The copy's object is not in the bucket. */
export class CopyMissing extends Data.TaggedError("CopyMissing") {}

/** The bytes in the bucket are not the copy the row names. */
export class CopyIntegrity extends Data.TaggedError("CopyIntegrity") {
	readonly say = "Signed copy failed its integrity check. Contact Kazon.";
}

/** The bucket read failed (it threw). */
export class CopyReadFailed extends Data.TaggedError("CopyReadFailed")<{
	readonly failure: unknown;
}> {}

export type SignedCopyDownload = {
	readonly bytes: ArrayBuffer;
};

export const downloadSignedCopy = (input: {
	readonly id: string;
	readonly request: Request;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;
		const bucket = yield* AudioBucket;
		const { id, request } = input;

		const archive = yield* sessionOf(db, request, "archive");
		const signing = yield* sessionOf(db, request, "agreement");
		const studio = studioSessionFromRequest(request);

		const studioIdentity = studio
			? yield* studioEmail(db, studio, input.now())
			: null;

		if (!archive && !signing && !studioIdentity)
			return yield* Effect.fail(new SignInFirst());

		const projects = studio ? yield* studioProjects(db, studio) : null;
		const agreement = yield* executedAgreement(db, id);

		// The same reads whatever the id is: the project and its linked agreement are read even when there is no agreement.
		const project =
			projects?.find(
				(candidate) => candidate.request_id === agreement?.request_id,
			) ?? null;

		const reuses = yield* offerReusesAgreement(
			db,
			signing?.offer_id ?? null,
			id,
		);

		const projectAgreement = yield* projectAgreementId(
			db,
			project?.request_id ?? null,
		);

		const linked = yield* linkedMsaId(db, projectAgreement);

		const facts: DownloadFacts = {
			agreement,
			archiveEmail: archive?.recipient_email ?? null,
			signing: signing
				? {
						recipient_email: signing.recipient_email,
						offer_id: signing.offer_id,
					}
				: null,
			signingReusesAgreement: reuses,
			studioEmail: studioIdentity,
			projectAgreementId: projectAgreement,
			linkedMsaId: linked,
		};

		const decision = decideDownload(id, facts);

		if (decision.kind === "refused")
			return yield* Effect.fail(new AgreementNotFound());

		const copy: AgreementArtifact | null = yield* readySignedCopy(db, id);

		if (!copy?.pdf_key) return yield* Effect.fail(new CopyNotReady());

		const object = yield* Effect.tryPromise({
			try: () => bucket.get(copy.pdf_key!),
			catch: (cause) => new CopyReadFailed({ failure: cause }),
		});

		if (!object) return yield* Effect.fail(new CopyMissing());

		const bytes = yield* Effect.tryPromise({
			try: () => object.arrayBuffer(),
			catch: (cause) => new CopyReadFailed({ failure: cause }),
		});

		const digest = yield* Effect.promise(() => hashBytes(bytes));

		if (
			!copyIsIntact(
				{
					status: copy.status,
					pdf_key: copy.pdf_key,
					pdf_sha256: copy.pdf_sha256,
				},
				digest,
			)
		)
			return yield* Effect.fail(new CopyIntegrity());

		return { bytes } satisfies SignedCopyDownload;
	});
