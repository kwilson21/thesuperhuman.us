// What the owner does with a project's file: publish an uploaded one and revoke a published or uploaded one. Each runs in the
// order the routes always did (docs/plans/2026-11-audio-projects-conversion.md, section 3). A publish names the owner, reads the
// file with the project's facts in ONE batch, judges the file, asks R2 for the object and judges its size, draws the
// publication id, then reads the facts again, judges the project from them and saves through `alwaysDecideAndSave`: the live review files it replaces are the
// batch guard's facts, so a review published in between makes the guard raise and the project is judged again (three tries). A
// revoke names the owner, then reads the file, the project and the published files in ONE batch, judges the file (still the
// status the first read saw: that status is carried across the tries), draws the revocation id, judges the project and the
// stage reset, and saves through `alwaysDecideAndSave` in the same way. A write whose own conditions no longer hold answers
// 409 at once and is not retried. A client's notice is started in the background once the batch has been saved. The routes
// build every answer.
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { alwaysDecideAndSave } from "../guarded-save";
import {
	headObject,
	publishFileBatch,
	readPublishFacts,
	readRevokeFacts,
	revokeFileBatch,
} from "../audio-project-store";
import {
	draftFile,
	FileNotPublishable,
	FileNotRevocable,
	objectOfFile,
	publishableProject,
	publishActor,
	revocableFile,
	revokeActor,
	revokeInProject,
} from "../rules/audio-project-files";
import {
	deliverInBackground,
	deliverUpdateNotice,
} from "./audio-project-notices";

/** A value drawn once, when it is first asked for, and the same value after (an id the retries of a save share). */
const drawnOnce = (draw: () => string) =>
	Effect.gen(function* () {
		const drawn = yield* Ref.make<string | null>(null);

		return Ref.get(drawn).pipe(
			Effect.flatMap((already) =>
				already === null
					? Effect.sync(draw).pipe(Effect.tap((id) => Ref.set(drawn, id)))
					: Effect.succeed(already),
			),
		);
	});

/** The owner publishes an uploaded file to the client. The update's id. */
export const publishProjectFile = (input: {
	readonly requestId: string;
	readonly fileId: string;
	readonly ownerEmail: string;
	readonly note: string;
	readonly downloadable: boolean;
	readonly now: () => Date;
	readonly newId: () => string;
}) =>
	Effect.gen(function* () {
		const now = input.now();
		const { requestId, fileId } = input;

		yield* publishActor.decide({ actor: input.ownerEmail }, null);
		const first = yield* readPublishFacts(requestId, fileId);
		const file = yield* draftFile.decide({ requestId }, first);
		const object = yield* headObject(file.object_key);
		yield* objectOfFile.decide({ object }, { file });

		const publicationId = input.newId();
		const expiry = new Date(now);
		expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);

		const saved = yield* alwaysDecideAndSave({
			// The project is judged from facts read now, after the object's head, as the write's own conditions were evaluated then.
			facts: readPublishFacts(requestId, fileId),
			decide: (facts) => publishableProject.decide({ file }, facts),
			save: (write) =>
				publishFileBatch({
					fileId,
					requestId,
					version: file.version,
					downloadable: file.version === "final" || input.downloadable,
					at: now.toISOString(),
					expiresAt: file.version === "final" ? expiry.toISOString() : null,
					publicationId,
					note: input.note,
					actor: input.ownerEmail,
					targetStage: write.targetStage,
					supersedes: write.supersedes,
				}),
		});

		if (saved.saved === null)
			return yield* Effect.fail(new FileNotPublishable());

		yield* deliverInBackground(
			deliverUpdateNotice({ updateId: saved.saved, now: input.now }),
			"Studio file notice state is uncertain.",
		);

		return saved.saved;
	});

/** The owner revokes a file. A published file's revoke tells the client, in the background. */
export const revokeProjectFile = (input: {
	readonly requestId: string;
	readonly fileId: string;
	readonly ownerEmail: string;
	readonly note: string;
	readonly now: () => Date;
	readonly newId: () => string;
}) =>
	Effect.gen(function* () {
		const now = input.now();
		const { requestId, fileId } = input;

		yield* revokeActor.decide({ actor: input.ownerEmail }, null);

		const firstStatus = yield* Ref.make<string | null>(null);
		const revocationId = yield* drawnOnce(input.newId);

		const saved = yield* alwaysDecideAndSave({
			facts: readRevokeFacts(requestId, fileId).pipe(
				Effect.tap((facts) =>
					Ref.update(firstStatus, (seen) => seen ?? facts.file?.status ?? null),
				),
			),
			decide: (facts) =>
				Effect.gen(function* () {
					const found = yield* revocableFile.decide(
						{ note: input.note, firstStatus: yield* Ref.get(firstStatus) },
						facts,
					);

					const id = yield* revocationId;

					const plan = yield* revokeInProject.decide(
						{ file: found.file, fileId },
						facts,
					);

					return { found, id, plan };
				}),
			save: ({ found, id, plan }) =>
				revokeFileBatch({
					requestId,
					fileId,
					actor: input.ownerEmail,
					note: found.note,
					at: now.toISOString(),
					revocationId: id,
					status: found.file.status,
					version: found.file.version,
					stage: plan.stage,
					others: plan.others,
					reset: plan.reset,
				}),
		});

		if (saved.saved === null) return yield* Effect.fail(new FileNotRevocable());

		if (saved.saved.updateId !== null)
			yield* deliverInBackground(
				deliverUpdateNotice({
					updateId: saved.saved.updateId,
					now: input.now,
				}),
				"Studio file revocation notice state is uncertain.",
			);
	});
