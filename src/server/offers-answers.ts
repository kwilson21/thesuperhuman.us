// The answers of the owner's software request actions (POST /api/owner/requests/[id]/software), exactly as the route
// gives them today (docs/plans/2026-11-offers-conversion.md, section 5): each refusal's Response, each action's success,
// the client email's 502s, and the fixed answers to a failure, which are logged once first. Every answer the route builds
// carries `cache-control: private, no-store`. The bodies are written key by key, because the golden corpus records each
// body as text and the order of its keys is part of it; tests/server/offers-answers.test.ts holds each one to the bytes a
// fixture recorded.
//
// A refusal is answered by its tag, never by its `say` alone: the 404 has no message, the terms' 400s carry only their
// errors, and DraftChanged carries the updated_at to reload. The refusals that name a condition only a batch guard checked
// before (AgreementSigned, AudioProjectExists, LinkNotRevoked, AttachmentNotUsable), stored data a batch could not be
// built from (AttachmentsUnreadable, MsaNotFound, StoredTermsUnreadable), a decline that finds an offer left after its
// email (OfferLeftAfterEmail), a refused batch (GuardRefused) and a draft whose version kept being taken
// (SaveKeptChanging) are NOT answered here: today each is answered by the reads after a refused batch, so the flow turns
// each into those reads (src/server/rules/offer-refused-batch.ts, `REFUSED_BATCH_ANSWERS` below) and the refusal they end
// in is answered here. `OfferRefusal` leaves them out, so passing one is a type error.
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import {
	offersCheckFailedAfterEmail,
	offersCheckFailedAfterFailedEmail,
	offersFailed,
	offersFailedAfterDraft,
	offersFailedAfterEmail,
	offersMailNotConfigured,
	offersStorageNotConfigured,
} from "../lib/software-offers";
import { loggedAnswer } from "./answers";
import type { MailFailure } from "./machines/software-request";
import type { AlreadyResolved } from "./rules/offer-decline";
import type {
	DepositOpen,
	DepositOpenOnDecline,
	DepositPaidEarlier,
	DepositPaidOnSentOffer,
} from "./rules/offer-deposit";
import type { DraftChanged, TermsInvalid } from "./rules/offer-draft";
import type {
	DetailsIncomplete,
	MsaUnavailable,
	TemplatesMissing,
} from "./rules/offer-pin";
import type { EmailSentButChanged } from "./rules/offer-refused-batch";
import type { LinkChanged } from "./rules/offer-revoke";
import type {
	LinkClosedAfterFailedEmail,
	LinkClosedWhileSending,
	LinkNotBuilt,
	NoOfferToSend,
	SendAnswer,
	StoredTermsInvalid,
} from "./rules/offer-send";
import type {
	OfferStillSending,
	ProjectStarted,
	RequestChanged,
	RequestClosed,
	RequestNotFound,
	RequestResolved,
} from "./rules/software-request";
import type { DefectAnswer } from "./run";

/** The route, as its failures are logged. */
export const OFFERS_ROUTE = "/api/owner/requests/[id]/software";

/** A JSON answer with the route's private header. */
const answer = <Body>(body: Body, status = 200) =>
	Response.json(body, {
		status,
		headers: { "cache-control": "private, no-store" },
	});

// ---- before the program ----

/** Not the owner: 403. */
export const notOwner = () => answer({ ok: false }, 403);

/** No MUSIC_DB binding: 503, with no message. */
export const offersDatabaseMissing = () => answer({ ok: false }, 503);

/** The owner's command does not read (src/server/software-offer-input.ts): one sentence, whatever was wrong. */
export const commandRefused = () =>
	answer(
		{ ok: false, message: "Check the required fields and their limits." },
		400,
	);

// ---- refusals ----

/** Every refusal the route answers by its tag. */
export type OfferRefusal =
	| RequestNotFound
	| ProjectStarted
	| RequestClosed
	| RequestResolved
	| AlreadyResolved
	| RequestChanged
	| OfferStillSending
	| DepositOpenOnDecline
	| DepositOpen
	| DepositPaidOnSentOffer
	| DepositPaidEarlier
	| EmailSentButChanged
	| LinkChanged
	| TermsInvalid
	| DraftChanged
	| NoOfferToSend
	| StoredTermsInvalid
	| DetailsIncomplete
	| TemplatesMissing
	| MsaUnavailable
	| LinkNotBuilt
	| LinkClosedWhileSending
	| LinkClosedAfterFailedEmail;

/** A refusal answered with its sentence: `{ok:false,message}`. */
const said = (status: number) => (refusal: { readonly say: string }) =>
	answer({ ok: false, message: refusal.say }, status);

/** A refusal's Response: its status, and its body as the route has always written it. */
export const refusedAnswer = (refusal: OfferRefusal): Response =>
	Match.value(refusal).pipe(
		Match.tagsExhaustive({
			RequestNotFound: () => answer({ ok: false }, 404),
			TermsInvalid: (refused) =>
				answer({ ok: false, errors: refused.errors }, 400),
			StoredTermsInvalid: (refused) =>
				answer({ ok: false, errors: refused.errors }, 400),
			DraftChanged: (refused) =>
				answer(
					{ ok: false, updatedAt: refused.updatedAt, message: refused.say },
					409,
				),
			DetailsIncomplete: (refused) =>
				answer(
					refused.errors === undefined
						? { ok: false, message: refused.say }
						: { ok: false, message: refused.say, errors: refused.errors },
					400,
				),
			TemplatesMissing: said(400),
			LinkNotBuilt: said(500),
			ProjectStarted: said(409),
			RequestClosed: said(409),
			RequestResolved: said(409),
			AlreadyResolved: said(409),
			RequestChanged: said(409),
			OfferStillSending: said(409),
			DepositOpenOnDecline: said(409),
			DepositOpen: said(409),
			DepositPaidOnSentOffer: said(409),
			DepositPaidEarlier: said(409),
			EmailSentButChanged: said(409),
			LinkChanged: said(409),
			NoOfferToSend: said(409),
			MsaUnavailable: said(409),
			LinkClosedWhileSending: said(409),
			LinkClosedAfterFailedEmail: said(409),
		}),
	);

/** A refusal's Response, as a `catchTags` handler. */
export const refused = (refusal: OfferRefusal) =>
	Effect.succeed(refusedAnswer(refusal));

/**
 * The refusals that today end in the reads after a refused batch, with the rule of src/server/rules/offer-refused-batch.ts
 * that answers each, per action: the flow reads what that rule asks for, and answers the refusal it ends in through
 * `refusedAnswer`. GuardRefused is a refused batch itself; SaveKeptChanging, a draft whose version kept being taken.
 */
export const REFUSED_BATCH_ANSWERS = {
	GuardRefused: {
		fit: "afterRefusedFit",
		question: "afterRefusedQuestion",
		questionRecord: "afterRefusedQuestionRecord",
		decline: "afterRefusedSendOrDecline",
		declineResolve: "afterRefusedResolve",
		revoke: "afterRefusedRevoke",
		draft: "afterRefusedDraft",
		send: "afterRefusedSendOrDecline",
	},
	SaveKeptChanging: { draft: "afterRefusedDraft" },
	AgreementSigned: {
		decline: "afterRefusedSendOrDecline",
		send: "afterRefusedSendOrDecline",
	},
	AudioProjectExists: { decline: "afterRefusedSendOrDecline" },
	LinkNotRevoked: { send: "afterRefusedSendOrDecline" },
	AttachmentNotUsable: {
		draft: "afterRefusedDraft",
		send: "afterRefusedSendOrDecline",
	},
	AttachmentsUnreadable: { draft: "afterRefusedDraft" },
	MsaNotFound: { draft: "afterRefusedDraft" },
	StoredTermsUnreadable: { send: "afterRefusedSendOrDecline" },
	OfferLeftAfterEmail: { declineResolve: "afterRefusedResolve" },
} as const;

// ---- successes ----

/** fit: the time it was saved at. */
export const fitReviewed = (updatedAt: string) =>
	answer({ ok: true, updatedAt });

/** question or decline: the client email went out, and whether the owner's copy did. */
export const clientEmailed = (copySent: boolean) =>
	answer({ ok: true, copySent });

/** revoke. */
export const linkRevoked = () => answer({ ok: true });

/** draft: the version saved, its time, and whether a removed attachment's object is still to be deleted. */
export const draftSaved = (saved: {
	readonly version: number;
	readonly updatedAt: string;
	readonly attachmentCleanupPending: boolean;
}) =>
	answer({
		ok: true,
		version: saved.version,
		updatedAt: saved.updatedAt,
		attachmentCleanupPending: saved.attachmentCleanupPending,
	});

/** send: the link and its times, and what became of the email (`uncertain` is left out when it is undefined). */
export const offerSent = (sent: SendAnswer) =>
	answer({
		ok: true,
		version: sent.version,
		link: sent.link,
		linkCreatedAt: sent.linkCreatedAt,
		sentAt: sent.sentAt,
		updatedAt: sent.updatedAt,
		emailSent: sent.emailSent,
		uncertain: sent.uncertain,
		copySent: sent.copySent,
	});

// ---- the client email of a question or a decline ----

const EMAIL_FAILED = {
	question: {
		MailUncertain:
			"The email service didn’t confirm. Check Resend before retrying. The question was reserved, but delivery was not recorded.",
		MailRefused:
			"The email didn’t send. The question was reserved. Reload before retrying.",
	},
	decline: {
		MailUncertain:
			"The email service didn’t confirm. The offer is withdrawn and its link is closed. Check Resend before retrying.",
		MailRefused:
			"The email didn’t send. The offer is withdrawn and its link is closed; nothing else changed. Try again.",
	},
} as const;

/** The client email of a question or a decline did not go out (refused) or may not have (uncertain): 502. */
export const clientEmailFailed = (
	action: "question" | "decline",
	failure: MailFailure,
) =>
	answer(
		{
			ok: false,
			uncertain: failure === "MailUncertain",
			message: EMAIL_FAILED[action][failure],
		},
		502,
	);

// ---- failures ----

/** No mail settings for a question or a decline (F8): 503, before anything is written. Not logged. */
export const mailNotConfigured = () =>
	Effect.succeed(offersMailNotConfigured());

/** R2 is needed and there is no AUDIO binding (F4): 503, before anything is written. Not logged. */
export const storageMissing = () =>
	Effect.succeed(offersStorageNotConfigured());

/** A store or R2 failure before any outside effect: logged once, then 500 with the fixed sentence. */
export const storeFailed = loggedAnswer(OFFERS_ROUTE, offersFailed);

/** A store failure after the client email went out (a question's record, a decline's resolve, the reads after them). */
export const storeFailedAfterEmail = loggedAnswer(
	OFFERS_ROUTE,
	offersFailedAfterEmail,
);

/** A store failure after the draft was saved, putting back a removed attachment's metadata row. */
export const storeFailedAfterDraft = loggedAnswer(
	OFFERS_ROUTE,
	offersFailedAfterDraft,
);

/** A send's live-link check failed after the email was tried: it says whether the client email was accepted. */
export const liveCheckFailed = (emailAccepted: boolean) =>
	loggedAnswer(
		OFFERS_ROUTE,
		emailAccepted
			? offersCheckFailedAfterEmail
			: offersCheckFailedAfterFailedEmail,
	);

/** A defect: logged once by `runRoute`, then 500 with the fixed sentence. */
export const offersDefect: DefectAnswer = {
	route: OFFERS_ROUTE,
	answer: offersFailed,
};
