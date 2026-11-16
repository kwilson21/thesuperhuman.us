// Sending the owner's offer (POST /api/owner/requests/[id]/software, action send): the open draft, or the sent version
// again with a new link after a revoke (a reissue). The staged rule (src/server/rules/offer-send.ts) decides between the
// reads, in the order the route has always read and answered: the request and whether a project started; every offer
// version and a live link made in the last 20 seconds (still sending, the page's offer, its stored terms); for the open
// draft every invoice of the request (the deposit refusals); whether signing is on; with signing on and the open draft,
// the agreement pinned (`pinAgreement`, below); a new token, its hash and the link (LinkNotBuilt); then, read last because
// only the batch checked them before, a signed agreement, a reissue's link row and the pinned attachments' closed
// archives. One batch sends the offer. Then the client email and the owner's copy (never a failure: a refused, uncertain
// or unconfigured email is part of the answer), then whether the link is still live. A refused batch, and the refusals
// that name what only the batch checked before or stored terms that are not JSON, are answered by the reads after it
// (src/server/rules/offer-refused-batch.ts). A failed live-link check is LinkCheckFailed, whose answer says what became of
// the client email. It builds no response text.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { hashOfferToken } from "../../lib/software-offers";
import { AgreementPreflight, AttachmentStore } from "../offers-services";
import {
	type OffersStoreFailed,
	readAttachmentRow,
	readClosedArchives,
	readContractorConfig,
	readCurrentTemplate,
	readDepositInvoices,
	readFreshLiveLink,
	readLinkRow,
	readLinkStillLive,
	readOffers,
	readProjectStarted,
	readReusableMsa,
	readSignedAgreement,
	readSigningEnabled,
	saveSend,
} from "../offers-store";
import { depositAllowsSend } from "../rules/offer-deposit";
import {
	attachmentDigestMatches,
	attachmentObjectSized,
	attachmentRowFound,
	DetailsIncomplete,
	packetReady,
	pinContractor,
	pinDetails,
	pinOf,
	pinReusedMsa,
	pinTemplates,
} from "../rules/offer-pin";
import { afterRefusedSendOrDecline } from "../rules/offer-refused-batch";
import {
	afterSendEmail,
	chooseOffer,
	type MailOutcome,
	type OfferChoice,
	offerLink,
	sendFront,
	sendOffer,
	type SendWrite,
} from "../rules/offer-send";
import {
	offerEmails,
	proved,
	type SoftwareRequest,
} from "../rules/software-request";
import { Mail } from "../services";
import type { SendCommand } from "../software-offer-input";
import {
	answerRefusedBatch,
	findRequest,
	mailSettings,
	type OfferAction,
	type OfferMail,
} from "./offer-request";

/** The offer the owner sends, the mail settings to email it with, and what the link is made from. */
export type SendAction = OfferAction & {
	readonly command: SendCommand;
	readonly mail: OfferMail;
	/** env.SITE_ORIGIN, as configured: the link's origin (the site's own when it is not set). */
	readonly siteOrigin: string | undefined;
	/** A new link token (`newOfferToken`). */
	readonly newToken: () => string;
};

/**
 * The live-link check after the email failed. `emailAccepted` says whether the client email was accepted, which the
 * answer says; `failure` is what the database gave, for the route's log.
 */
export class LinkCheckFailed extends Data.TaggedError("LinkCheckFailed")<{
	readonly emailAccepted: boolean;
	readonly failure: unknown;
}> {}

/**
 * The agreement a send pins, with signing on and the open draft: the stored details against the terms; the MSA and SOW
 * templates and the contractor config; the contractor's details; the MSA the offer reuses, for the request's address
 * (trimmed and lower-cased); each attachment's metadata row, then its object and size, then (once, after the size) its
 * digest; and the packet's preflight. A rule decides after each read (src/server/rules/offer-pin.ts). A failed read is
 * OffersStoreFailed, a failed R2 read AttachmentReadFailed, a failed read in the preflight PacketReadFailed, and no R2
 * binding when one is needed OffersStorageMissing (F4, #313); bytes that cannot be hashed, or a packet that does not
 * render, are incomplete details, as they always have been.
 */
const pinAgreement = (request: SoftwareRequest, choice: OfferChoice) =>
	Effect.gen(function* () {
		const { offer, terms } = choice;

		const details = yield* pinDetails.decide(
			{ terms },
			{ stored: offer.agreement_details_json },
		);

		const msa = yield* readCurrentTemplate("msa");
		const sow = yield* readCurrentTemplate("sow");
		const config = yield* readContractorConfig();

		const templates = yield* pinTemplates.decide(null, { msa, sow, config });

		const contractor = yield* pinContractor.decide(null, {
			config: templates.config,
		});

		if (offer.reused_msa_id) {
			const reusable = yield* readReusableMsa(
				offer.reused_msa_id,
				request.email.trim().toLowerCase(),
			);

			yield* pinReusedMsa.decide(null, { reusable });
		}

		for (const attachment of details.attachments) {
			const found = yield* readAttachmentRow(request.id, attachment);

			yield* attachmentRowFound.decide(null, { found });

			const object = yield* AttachmentStore.read(attachment.key);

			yield* attachmentObjectSized.decide(
				{ bytes: attachment.bytes },
				{ object },
			);

			// Read once, after the size: the object's body can be read only once.
			const sha256 = yield* proved(object)
				.sha256()
				.pipe(
					Effect.catchTag("AttachmentUnhashable", () =>
						Effect.fail(new DetailsIncomplete({ errors: undefined })),
					),
				);

			yield* attachmentDigestMatches.decide(
				{ sha256: attachment.sha256 },
				{ sha256 },
			);
		}

		const preflight = yield* AgreementPreflight;

		yield* preflight
			.check({
				terms,
				details,
				contractor,
				templates: [templates.msa, templates.sow],
				reusedMsaId: offer.reused_msa_id ?? null,
			})
			.pipe(
				Effect.catchTag("PacketNotReady", () =>
					packetReady.decide(null, { ready: false }),
				),
			);

		return yield* pinOf.decide(null, {
			details,
			templates,
			contractor,
			email: request.email,
		});
	});

/** The client email and the owner's copy, sent only when the client's was accepted. Never fails: the outcome says how it went. */
const emailOffer = (mail: OfferMail, write: SendWrite) =>
	Effect.gen(function* () {
		const settings = yield* mailSettings(mail);
		const emails = offerEmails(settings, write.to, write.email);
		const sender = yield* Mail;

		const client = yield* sender.send(emails.client).pipe(
			Effect.as("accepted" as const),
			Effect.catchTags({
				MailRefused: () => Effect.succeed("refused" as const),
				MailUncertain: () => Effect.succeed("uncertain" as const),
			}),
		);

		if (client !== "accepted")
			return { sent: client, copySent: false } satisfies MailOutcome;

		const copySent = yield* sender.send(emails.copy).pipe(
			Effect.as(true),
			Effect.catchTags({
				MailRefused: () => Effect.succeed(false),
				MailUncertain: () => Effect.succeed(false),
			}),
		);

		return { sent: "accepted", copySent } satisfies MailOutcome;
	}).pipe(
		Effect.catchTag("MailNotConfigured", () =>
			Effect.succeed({
				sent: "not-configured",
				copySent: false,
			} satisfies MailOutcome),
		),
	);

/** Sends the offer; answers the version, the link and its times, and what became of the email. */
export const sendSoftwareOffer = (action: SendAction) =>
	Effect.gen(function* () {
		const { command, requestId } = action;
		const request = yield* findRequest(requestId);
		const projectStarted = yield* readProjectStarted(requestId);

		yield* sendFront.decide(null, { request, projectStarted });

		const now = action.now();
		const offers = yield* readOffers(requestId);
		const sending = yield* readFreshLiveLink(requestId, action.sendingSince());

		const choice = yield* chooseOffer.decide(
			{
				version: command.version,
				expectedUpdatedAt: command.expectedUpdatedAt,
				now,
			},
			{ offers, sending },
		);

		if (choice.move === "SEND") {
			const invoices = yield* readDepositInvoices(requestId);

			yield* depositAllowsSend.decide(null, { invoices });
		}

		const signingEnabled = yield* readSigningEnabled();

		const pin =
			signingEnabled && choice.move === "SEND"
				? yield* pinAgreement(request, choice)
				: null;

		const token = action.newToken();

		// hashOfferToken only digests text with WebCrypto, which does not fail: a rejection is a bug, so a defect is intended.
		const tokenHash = yield* Effect.promise(() => hashOfferToken(token));

		const href = yield* offerLink.decide(
			{ token },
			{ siteOrigin: action.siteOrigin },
		);

		const signedAgreement = yield* readSignedAgreement(requestId);

		const linkRow =
			choice.move === "REISSUE" ? yield* readLinkRow(requestId) : null;

		// With nothing pinned, or no attachment pinned, the batch has no G11 and the closed archives read nothing.
		const closed = yield* readClosedArchives(
			pin?.attachments.map((attachment) => attachment.key) ?? [],
		);

		const write = yield* sendOffer.decide(
			{
				choice,
				pin,
				link: { href, tokenHash },
				signingEnabled,
				actor: action.actor,
			},
			{ request, signedAgreement, linkRow, closed },
		);

		yield* saveSend(write, action.sendingSince()).pipe(
			Effect.catchTag("GuardRefused", () =>
				answerRefusedBatch(afterRefusedSendOrDecline, action),
			),
		);

		const mail = yield* emailOffer(action.mail, write);

		const live = yield* readLinkStillLive(
			requestId,
			tokenHash,
			write.offer.id,
		).pipe(
			Effect.catchTag("OffersStoreFailed", (failed: OffersStoreFailed) =>
				Effect.fail(
					new LinkCheckFailed({
						emailAccepted: mail.sent === "accepted",
						failure: failed.failure,
					}),
				),
			),
		);

		return yield* afterSendEmail.decide({ write, mail }, { live });
	}).pipe(
		Effect.catchTags({
			StoredTermsUnreadable: () =>
				answerRefusedBatch(afterRefusedSendOrDecline, action),
			AgreementSigned: () =>
				answerRefusedBatch(afterRefusedSendOrDecline, action),
			LinkNotRevoked: () =>
				answerRefusedBatch(afterRefusedSendOrDecline, action),
			AttachmentNotUsable: () =>
				answerRefusedBatch(afterRefusedSendOrDecline, action),
		}),
	);
