// Declining a software request (POST /api/owner/requests/[id]/software, action decline). The staged rule
// (src/server/rules/offer-decline.ts) decides between the reads, in the order the route has always read and answered:
// the request and whether a project started (project started, closed); every invoice of the request (a deposit that may
// still be charged, already resolved); a live link made in the last 20 seconds (still sending); then, without the mail
// settings, nothing is written (F8, MailNotConfigured); then a signed agreement and an audio project, read just before the
// first batch. The first batch withdraws the offers, retires signing, closes the link and moves the request's updated_at.
// The client email and the owner's copy go through the request machine's bridge (`declining`), which lands on resolved
// once the client email was accepted; then the offers are read again (F10, #331) and the second batch saves the landing.
// A refused batch, and the refusals that name what only a batch checked before, are answered by the reads after it
// (src/server/rules/offer-refused-batch.ts). After the email, a failed store or read is OffersStoreFailedAfterEmail. A
// client email that was refused or may not have gone out is MailRefused or MailUncertain, with the offers already
// withdrawn and nothing more saved. It builds no response text.
import * as Effect from "effect/Effect";
import {
	readAudioProject,
	readDepositInvoices,
	readFreshLiveLink,
	readOfferLeft,
	readProjectStarted,
	readSignedAgreement,
	resolveDeclined as saveResolve,
	withdrawForDecline,
} from "../offers-store";
import {
	declineDeposits,
	declineFront,
	declineNotSending,
	declineRequest,
	resolveDeclined,
} from "../rules/offer-decline";
import {
	afterRefusedResolve,
	afterRefusedSendOrDecline,
} from "../rules/offer-refused-batch";
import { offerEmails } from "../rules/software-request";
import type { MessageCommand } from "../software-offer-input";
import {
	afterEmail,
	answerRefusedBatch,
	emailThroughMachine,
	findRequest,
	mailSettings,
	type OfferAction,
	type OfferMail,
} from "./offer-request";

/** The decline the owner sends the client, and the mail settings to send it with. */
export type DeclineAction = OfferAction & {
	readonly command: MessageCommand;
	readonly mail: OfferMail;
};

/** Declines the request: its offers withdrawn and its link closed, the client emailed, then the request resolved. */
export const declineSoftwareRequest = (action: DeclineAction) =>
	Effect.gen(function* () {
		const { requestId } = action;
		const request = yield* findRequest(requestId);
		const projectStarted = yield* readProjectStarted(requestId);

		yield* declineFront.decide(null, { request, projectStarted });

		const now = action.now();
		const invoices = yield* readDepositInvoices(requestId);

		yield* declineDeposits.decide(null, { request, invoices });

		const sending = yield* readFreshLiveLink(requestId, action.sendingSince());

		yield* declineNotSending.decide(null, { sending });

		const settings = yield* mailSettings(action.mail);
		const signedAgreement = yield* readSignedAgreement(requestId);
		const audioProject = yield* readAudioProject(requestId);

		const write = yield* declineRequest
			.decide(
				{ text: action.command.text, now, actor: action.actor },
				{ request, signedAgreement, audioProject },
			)
			.pipe(
				Effect.catchTags({
					AgreementSigned: () =>
						answerRefusedBatch(afterRefusedSendOrDecline, action),
					AudioProjectExists: () =>
						answerRefusedBatch(afterRefusedSendOrDecline, action),
				}),
			);

		yield* withdrawForDecline(write, action.sendingSince()).pipe(
			Effect.catchTag("GuardRefused", () =>
				answerRefusedBatch(afterRefusedSendOrDecline, action),
			),
		);

		const landed = yield* emailThroughMachine(
			request.status,
			"DECLINE",
			offerEmails(settings, write.to, write.email),
		);

		yield* Effect.gen(function* () {
			// The list the resolve's guard re-checks (`ResolveWrite.noOfferIn`): the statuses the decline withdrew.
			const offerLeft = yield* readOfferLeft(requestId, write.withdraw.from);

			const resolve = yield* resolveDeclined.decide(
				{ write, landed: landed.status },
				{ offerLeft },
			);

			yield* saveResolve(resolve, action.sendingSince()).pipe(
				Effect.catchTag("GuardRefused", () =>
					answerRefusedBatch(afterRefusedResolve, action),
				),
			);
		}).pipe(
			Effect.catchTag("OfferLeftAfterEmail", () =>
				answerRefusedBatch(afterRefusedResolve, action),
			),
			Effect.catchTag("OffersStoreFailed", afterEmail),
		);

		return landed.copySent;
	});
