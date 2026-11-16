import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { musicRequest } from "~/lib/music-request";
import { newOfferToken, offerSendingSince } from "~/lib/software-offers";
import { declineSoftwareRequest } from "~/server/flows/offer-decline";
import { saveOfferDraft } from "~/server/flows/offer-draft";
import { reviewSoftwareFit } from "~/server/flows/offer-fit";
import { askSoftwareQuestion } from "~/server/flows/offer-question";
import type { OfferAction } from "~/server/flows/offer-request";
import { closeOfferLink } from "~/server/flows/offer-revoke";
import { sendSoftwareOffer } from "~/server/flows/offer-send";
import {
	clientEmailed,
	clientEmailFailed,
	commandRefused,
	draftSaved,
	fitReviewed,
	linkRevoked,
	liveCheckFailed,
	mailNotConfigured,
	notOwner,
	offerSent,
	offersDatabaseMissing,
	offersDefect,
	refused,
	refusedAnswer,
	storageMissing,
	storeFailed,
	storeFailedAfterDraft,
	storeFailedAfterEmail,
} from "~/server/offers-answers";
import {
	liveAgreementPreflight,
	liveOfferMail,
	offerMailSettings,
} from "~/server/offers-services";
import { RequestNotFound } from "~/server/rules/software-request";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable, Mail } from "~/server/services";
import {
	readSoftwareCommand,
	type SoftwareCommand,
} from "~/server/software-offer-input";

export const prerender = false;

/**
 * The email of a question, a decline or a send with the mail settings missing. Each flow checks the settings before it
 * would send (a question or a decline answers 503, a send records the email as not sent), so this is never asked; if it
 * is, that is a bug, and the request fails as one.
 */
const unconfiguredMail = Context.make(Mail, {
	send: () =>
		Effect.die(new Error("An offer email was sent with no mail settings.")),
});

/**
 * `settled`'s TimeoutError (no landing within 30 seconds) or ActorStoppedError (the request machine stopped without one)
 * while a question's or a decline's client email was in flight: never expected, since each email has its own 10-second
 * timeout. Logged once, as every unexpected failure of a converted route is, then the fixed 500 a defect gets.
 */
const notLanded = storeFailed;

/** The action's program, every failure answered: the route's Response. */
const program = (
	command: SoftwareCommand,
	action: OfferAction,
	mail: ReturnType<typeof offerMailSettings>,
	env: Env,
) => {
	switch (command.action) {
		case "fit":
			return reviewSoftwareFit({ ...action, command }).pipe(
				Effect.map(fitReviewed),
				Effect.catchTags({
					RequestNotFound: refused,
					RequestClosed: refused,
					RequestResolved: refused,
					RequestChanged: refused,
					OffersStoreFailed: (failed) => storeFailed(failed.failure),
				}),
			);
		case "question":
			return askSoftwareQuestion({ ...action, command, mail }).pipe(
				Effect.map(clientEmailed),
				Effect.catchTags({
					RequestNotFound: refused,
					ProjectStarted: refused,
					RequestClosed: refused,
					RequestResolved: refused,
					RequestChanged: refused,
					EmailSentButChanged: refused,
					MailNotConfigured: mailNotConfigured,
					MailRefused: () =>
						Effect.succeed(clientEmailFailed("question", "MailRefused")),
					MailUncertain: () =>
						Effect.succeed(clientEmailFailed("question", "MailUncertain")),
					OffersStoreFailed: (failed) => storeFailed(failed.failure),
					OffersStoreFailedAfterEmail: (failed) =>
						storeFailedAfterEmail(failed.failure),
					TimeoutError: notLanded,
					ActorStoppedError: notLanded,
				}),
			);
		case "decline":
			return declineSoftwareRequest({ ...action, command, mail }).pipe(
				Effect.map(clientEmailed),
				Effect.catchTags({
					RequestNotFound: refused,
					ProjectStarted: refused,
					RequestClosed: refused,
					DepositOpenOnDecline: refused,
					AlreadyResolved: refused,
					OfferStillSending: refused,
					RequestChanged: refused,
					EmailSentButChanged: refused,
					MailNotConfigured: mailNotConfigured,
					MailRefused: () =>
						Effect.succeed(clientEmailFailed("decline", "MailRefused")),
					MailUncertain: () =>
						Effect.succeed(clientEmailFailed("decline", "MailUncertain")),
					OffersStoreFailed: (failed) => storeFailed(failed.failure),
					OffersStoreFailedAfterEmail: (failed) =>
						storeFailedAfterEmail(failed.failure),
					TimeoutError: notLanded,
					ActorStoppedError: notLanded,
				}),
			);
		case "revoke":
			return closeOfferLink({ ...action, command }).pipe(
				Effect.map(linkRevoked),
				Effect.catchTags({
					RequestNotFound: refused,
					RequestClosed: refused,
					LinkChanged: refused,
					OfferStillSending: refused,
					RequestChanged: refused,
					OffersStoreFailed: (failed) => storeFailed(failed.failure),
				}),
			);
		case "draft":
			return saveOfferDraft({
				...action,
				command,
				newId: () => crypto.randomUUID(),
			}).pipe(
				Effect.map(draftSaved),
				Effect.catchTags({
					RequestNotFound: refused,
					ProjectStarted: refused,
					RequestClosed: refused,
					RequestResolved: refused,
					TermsInvalid: refused,
					DraftChanged: refused,
					OffersStoreFailed: (failed) => storeFailed(failed.failure),
					OffersStoreFailedAfterDraft: (failed) =>
						storeFailedAfterDraft(failed.failure),
				}),
			);
		case "send":
			return sendSoftwareOffer({
				...action,
				command,
				mail,
				siteOrigin: env.SITE_ORIGIN,
				newToken: newOfferToken,
			}).pipe(
				Effect.map(offerSent),
				Effect.catchTags({
					RequestNotFound: refused,
					ProjectStarted: refused,
					RequestClosed: refused,
					RequestResolved: refused,
					OfferStillSending: refused,
					NoOfferToSend: refused,
					StoredTermsInvalid: refused,
					RequestChanged: refused,
					DepositOpen: refused,
					DepositPaidOnSentOffer: refused,
					DepositPaidEarlier: refused,
					DetailsIncomplete: refused,
					TemplatesMissing: refused,
					MsaUnavailable: refused,
					LinkNotBuilt: refused,
					LinkClosedWhileSending: refused,
					LinkClosedAfterFailedEmail: refused,
					OffersStorageMissing: storageMissing,
					OffersStoreFailed: (failed) => storeFailed(failed.failure),
					AttachmentReadFailed: (failed) => storeFailed(failed.failure),
					PacketReadFailed: (failed) => storeFailed(failed.failure),
					LinkCheckFailed: (failed) =>
						liveCheckFailed(failed.emailAccepted)(failed.failure),
				}),
			);
	}
};

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.owner) return notOwner();

	const env = locals.runtime.env;
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return offersDatabaseMissing();

	const body = await musicRequest(request, 80 * 1024);

	if (body instanceof Response) return body;

	const read = readSoftwareCommand(body);

	if (!read.ok) return commandRefused();

	// A missing or empty id matches no request, as an unknown one does (F6).
	if (!params.id) return refusedAnswer(new RequestNotFound());

	const mail = offerMailSettings(env);

	return runRoute(
		Context.merge(
			Context.merge(
				bindings.services,
				mail === null ? unconfiguredMail : liveOfferMail(mail.apiKey),
			),
			liveAgreementPreflight(env),
		),
		program(
			read.value,
			{
				requestId: params.id,
				actor: locals.owner.email,
				now: () => new Date().toISOString(),
				sendingSince: offerSendingSince,
			},
			mail,
			env,
		),
		// A defect is the route's fixed sentence as a 500, logged once without what was sent.
		offersDefect,
	);
};
