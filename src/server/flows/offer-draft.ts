// Saving the owner's draft offer (POST /api/owner/requests/[id]/software, action draft). The staged rule
// (src/server/rules/offer-draft.ts) decides between the reads, in the order the route has always read and answered: the
// request and whether a project started (project started, closed, resolved); every offer version, with the terms read
// (`validateOfferTerms`) after them (the terms, then the page's draft); a new id only for a new version; the metadata rows
// of the attachments the draft removes; the attachments the details name (`namedAttachmentsOf`); then, just before the
// batch and only when they are named, their metadata rows and closed archives, and the MSA the draft reuses. One batch
// saves the draft. All of it runs through `alwaysDecideAndSave`: the batch's unique indexes back the version's number and
// the one open draft, so another writer taking either is read and decided again from the request on, three tries in all
// (F7, #316). A refused batch, a draft whose version kept being taken, and the refusals that name what only the batch
// checked before, are answered by the reads after it (src/server/rules/offer-refused-batch.ts). After the batch, each
// removed attachment it deleted has its R2 object removed; when that fails its metadata row is put back and the cleanup
// is pending, and a failed put-back is OffersStoreFailedAfterDraft, whose answer says the draft was saved. It builds no
// response text.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { validateOfferTerms } from "../../lib/software-offers";
import { alwaysDecideAndSave } from "../guarded-save";
import { AttachmentStore } from "../offers-services";
import {
	type OffersStoreFailed,
	readAttachmentRows,
	readClosedArchives,
	readMsaExists,
	readOffers,
	readProjectStarted,
	readRemovedAttachments,
	restoreAttachment,
	saveDraftBatch,
} from "../offers-store";
import {
	attachmentsToClean,
	chooseDraft,
	draftAttachments,
	draftFront,
	namedAttachmentsOf,
	reusedMsaOf,
	saveDraft,
} from "../rules/offer-draft";
import { afterRefusedDraft } from "../rules/offer-refused-batch";
import type { DraftCommand } from "../software-offer-input";
import {
	answerRefusedBatch,
	findRequest,
	type OfferAction,
} from "./offer-request";

/** The draft the owner saves. */
export type DraftAction = OfferAction & {
	readonly command: DraftCommand;
	/** A new random id: made only for a new version, on each try. */
	readonly newId: () => string;
};

/** The draft was saved, and a removed attachment's metadata row could not be put back after its R2 delete failed. */
export class OffersStoreFailedAfterDraft extends Data.TaggedError(
	"OffersStoreFailedAfterDraft",
)<{ readonly failure: unknown }> {}

const afterDraft = (failed: OffersStoreFailed) =>
	Effect.fail(new OffersStoreFailedAfterDraft({ failure: failed.failure }));

/** What the draft answers: the version saved, its time, and whether a removed attachment's object is still to be deleted. */
export type DraftAnswer = {
	readonly version: number;
	readonly updatedAt: string;
	readonly attachmentCleanupPending: boolean;
};

/** Every read the draft decides on, in the order the route has always made them, deciding between them. */
const draftFacts = (action: DraftAction) =>
	Effect.gen(function* () {
		const { command, requestId } = action;
		const request = yield* findRequest(requestId);
		const projectStarted = yield* readProjectStarted(requestId);

		yield* draftFront.decide(null, { request, projectStarted });

		const offers = yield* readOffers(requestId);

		const chosen = yield* chooseDraft.decide(
			{
				terms: validateOfferTerms(command.terms),
				expectedUpdatedAt: command.expectedUpdatedAt,
				now: action.now(),
			},
			{ offers },
		);

		const id = chosen.open?.id ?? action.newId();

		const removed =
			command.removedAttachmentKeys.length > 0
				? yield* readRemovedAttachments(
						requestId,
						command.removedAttachmentKeys,
					)
				: [];

		const attachments = yield* draftAttachments.decide(null, {
			named: namedAttachmentsOf(command.agreementDetails),
		});

		const keys = attachments.map((attachment) => attachment.key);

		// With no attachment named, the batch has no G11 and nothing is read (the closed archives read nothing either).
		const named = {
			rows: keys.length > 0 ? yield* readAttachmentRows(requestId, keys) : [],
			closed: yield* readClosedArchives(keys),
		};

		const msaId = reusedMsaOf(command);
		const reusedMsaFound = msaId === null ? null : yield* readMsaExists(msaId);

		return {
			request,
			chosen,
			id,
			attachments,
			named,
			removed,
			reusedMsaFound,
		};
	});

/** Saves the draft; answers its version, its time and whether an attachment's cleanup is pending. */
export const saveOfferDraft = (action: DraftAction) =>
	Effect.gen(function* () {
		const { command } = action;

		const { decided: write, saved } = yield* alwaysDecideAndSave({
			facts: draftFacts(action),
			decide: (facts) =>
				saveDraft.decide(
					{
						agreementDetails: command.agreementDetails,
						reusedMsaId: command.reusedMsaId,
						confirmMsaReuse: command.confirmMsaReuse,
						id: facts.id,
						actor: action.actor,
					},
					facts,
				),
			save: saveDraftBatch,
		}).pipe(
			Effect.catchTags({
				GuardRefused: () => answerRefusedBatch(afterRefusedDraft, action),
				SaveKeptChanging: () => answerRefusedBatch(afterRefusedDraft, action),
				AttachmentsUnreadable: () =>
					answerRefusedBatch(afterRefusedDraft, action),
				AttachmentNotUsable: () =>
					answerRefusedBatch(afterRefusedDraft, action),
				MsaNotFound: () => answerRefusedBatch(afterRefusedDraft, action),
			}),
		);

		const clean = yield* attachmentsToClean.decide(null, {
			removed: write.removed,
			deletedKeys: saved.deletedKeys,
		});

		let attachmentCleanupPending = false;

		for (const row of clean) {
			const removed = yield* AttachmentStore.remove(row.object_key).pipe(
				Effect.as(true),
				Effect.catchTag("AttachmentRemoveFailed", () => Effect.succeed(false)),
			);

			if (removed) continue;

			yield* restoreAttachment(row).pipe(
				Effect.catchTag("OffersStoreFailed", afterDraft),
			);

			attachmentCleanupPending = true;
		}

		return {
			version: write.version,
			updatedAt: write.at,
			attachmentCleanupPending,
		} satisfies DraftAnswer;
	});
