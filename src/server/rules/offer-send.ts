// Sending the owner's offer: the open draft sent, or the sent version sent again with a new link after a revoke (a
// reissue). Its reads come between its decisions, so the rule is staged, each stage deciding on what was read so far, in
// the order the route has always answered (docs/plans/2026-11-offers-conversion.md, sections 2 and 3, "send"):
//   1. the request and whether a project started: ProjectStarted, RequestClosed, RequestResolved (sendFront);
//   2. every offer version, then whether a live link was made in the last 20 seconds: OfferStillSending, NoOfferToSend
//      (the offer is the open draft, whose status allows SEND, else the sent version, whose status allows REISSUE, by the
//      machine `offerVersion`; refused when there is neither, or when its version or updated_at is not the page's),
//      StoredTermsUnreadable, StoredTermsInvalid (chooseOffer);
//   3. for the open draft, every invoice of the request: DepositOpen, DepositPaidOnSentOffer, DepositPaidEarlier
//      (`depositAllowsSend`, src/server/rules/offer-deposit.ts);
//   4. with signing on and the open draft, the agreement pinned (src/server/rules/offer-pin.ts);
//   5. the link built from SITE_ORIGIN and the new token: LinkNotBuilt (offerLink);
//   6. a signed agreement, the request's link row for a reissue and the closed archives of the pinned attachments, read
//      last because only the batch checked them before: AgreementSigned, LinkNotRevoked, AttachmentNotUsable (sendOffer),
//      which writes the batch and the email;
//   7. after the email, whether the link is still live: LinkClosedWhileSending when the client email was accepted, and
//      LinkClosedAfterFailedEmail otherwise (F9, #314) (afterSendEmail).
// Re-checked at write time by G1 (the request as read), G5 (no live link made in the last 20 seconds), G3 (no signed
// agreement), G11 per pinned attachment, G4 (send mode, for the open draft), G2 (no project), G8 (the offer still has the
// status and updated_at read) and, for a reissue, G9 (the request's link is revoked); the supersede and the mark-sent
// UPDATE filter by the SUPERSEDE and SEND lists of the machine. A refused batch, and StoredTermsUnreadable,
// AgreementSigned, LinkNotRevoked and AttachmentNotUsable, are answered by the reads in
// src/server/rules/offer-refused-batch.ts. A refused, uncertain or unconfigured client email is part of the answer, never
// a refusal.
import * as Data from "effect/Data";
import {
	type OfferTerms,
	type SoftwareOffer,
	validateOfferTerms,
} from "../../lib/software-offers";
import { siteOrigin } from "../../lib/site-origin.mjs";
import {
	OFFER_MOVES,
	type OfferMove,
	offerAllows,
} from "../machines/offer-version";
import type { SendCommand } from "../software-offer-input";
import { alwaysWrites, term, unless } from "../terms";
import type { OffersRead } from "./offer-draft";
import type { Pin } from "./offer-pin";
import type { LinkRow } from "./offer-revoke";
import {
	AttachmentNotUsable,
	type ClosedArchives,
	type EmailWords,
	noProjectStarted,
	noSignedAgreement,
	notSending,
	outsideClosedArchives,
	type ProjectRead,
	proved,
	type Requested,
	type RequestRead,
	RequestResolved,
	requestOpen,
	requestRead,
	retireSigning,
	type SendingRead,
	type SigningRetired,
	statusAllows,
	writeTime,
} from "./software-request";

/** No open draft, and no sent version, with the page's version and updated_at. */
export class NoOfferToSend extends Data.TaggedError("NoOfferToSend") {
	readonly say = "Save a valid draft before sending.";
}

/** The chosen offer's stored terms are not JSON (F5). Answered as a refused batch is: the request changed. */
export class StoredTermsUnreadable extends Data.TaggedError(
	"StoredTermsUnreadable",
) {
	readonly say =
		"The request changed or could not be saved. Reload and try again.";
}

/** The chosen offer's stored terms do not read: 400 with `errors`, by field path. */
export class StoredTermsInvalid extends Data.TaggedError("StoredTermsInvalid")<{
	readonly errors: Readonly<Record<string, string>>;
}> {
	readonly say = "Check the offer terms.";
}

export class LinkNotBuilt extends Data.TaggedError("LinkNotBuilt") {
	readonly say =
		"The offer link couldn’t be built. Check SITE_ORIGIN. Nothing was sent.";
}

/** A reissue, but the request's link is not revoked, or it has none (G9). Answered as a refused batch is. */
export class LinkNotRevoked extends Data.TaggedError("LinkNotRevoked") {
	readonly say =
		"The request changed or could not be saved. Reload and try again.";
}

/** The client email was accepted, but the link was closed while it was sending. */
export class LinkClosedWhileSending extends Data.TaggedError(
	"LinkClosedWhileSending",
) {
	readonly say =
		"The email went out, but the link was closed while it was sending. Send the offer again for a working link.";
}

/** The client email was not accepted (refused, uncertain or not configured), and the link was closed (F9). */
export class LinkClosedAfterFailedEmail extends Data.TaggedError(
	"LinkClosedAfterFailedEmail",
) {
	readonly say =
		"The link was closed while the offer was being sent. Send the offer again for a working link.";
}

/** Stage 1: no project has started, and the request is open and allows SEND. */
export const sendFront = alwaysWrites({
	name: "send: no project has started, and the request is open and not resolved",
	given: (_request: null, facts: Requested & ProjectRead) => facts,
	refusals: [
		noProjectStarted,
		requestOpen("SEND"),
		statusAllows("SEND", () => new RequestResolved()),
	],
	writes: () => ({}),
	writesText: "nothing: the offers are read next",
});

/** The chosen offer's stored terms, read as the route read them: JSON, then `validateOfferTerms`. */
type StoredTerms =
	| { readonly kind: "unreadable" }
	| {
			readonly kind: "invalid";
			readonly errors: Readonly<Record<string, string>>;
	  }
	| { readonly kind: "read"; readonly terms: OfferTerms };

function storedTerms(text: string): StoredTerms {
	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch {
		return { kind: "unreadable" };
	}

	const read = validateOfferTerms(parsed);

	return read.ok
		? { kind: "read", terms: read.value }
		: { kind: "invalid", errors: read.errors };
}

export type ChooseOfferRequest = Pick<
	SendCommand,
	"version" | "expectedUpdatedAt"
> & {
	readonly now: string;
};

type ChooseGiven = SendingRead & {
	readonly draft: SoftwareOffer | null;
	readonly chosen: SoftwareOffer | null;
	readonly terms: StoredTerms | null;
	readonly now: string;
};

/** The offer a send sends, with its terms and the write time. */
export type OfferChoice = {
	readonly offer: SoftwareOffer;
	/** SEND for the open draft (which supersedes the sent version), REISSUE for the sent version. */
	readonly move: "SEND" | "REISSUE";
	readonly terms: OfferTerms;
	/** The time read, or one millisecond after the open draft's updated_at. */
	readonly at: string;
};

/** Stage 2: not still sending, the page's offer, and its stored terms. */
export const chooseOffer = alwaysWrites({
	name: "choose the offer a send sends",
	given: (
		command: ChooseOfferRequest,
		facts: OffersRead & SendingRead,
	): ChooseGiven => {
		const draft =
			facts.offers.find((offer) => offerAllows(offer.status, "SEND")) ?? null;

		const offer =
			draft ??
			facts.offers.find((offer) => offerAllows(offer.status, "REISSUE")) ??
			null;

		const chosen =
			offer !== null &&
			offer.version === command.version &&
			offer.updated_at === command.expectedUpdatedAt
				? offer
				: null;

		return {
			sending: facts.sending,
			draft,
			chosen,
			terms: chosen === null ? null : storedTerms(chosen.terms_json),
			now: command.now,
		};
	},
	refusals: [
		notSending,
		unless(
			term(
				"the page's version and updated_at are the open draft's, or the sent version's when no draft is open",
				(given: ChooseGiven) => given.chosen !== null,
			),
			() => new NoOfferToSend(),
		),
		unless(
			term(
				"the offer's stored terms are JSON",
				(given: ChooseGiven) => given.terms?.kind !== "unreadable",
			),
			() => new StoredTermsUnreadable(),
		),
		unless(
			term(
				"the offer's stored terms read",
				(given: ChooseGiven) => given.terms?.kind !== "invalid",
			),
			(given) =>
				new StoredTermsInvalid({
					errors: given.terms?.kind === "invalid" ? given.terms.errors : {},
				}),
		),
	],
	writes: (given): OfferChoice => {
		const offer = proved(given.chosen);

		return {
			offer,
			move: offerAllows(offer.status, "SEND") ? "SEND" : "REISSUE",
			terms: proved(given.terms?.kind === "read" ? given.terms.terms : null),
			at: writeTime(given.now, given.draft?.updated_at ?? null),
		};
	},
	writesText: "the offer to send, its move, its terms and the write time",
});

/** The offer link, `/offer/<token>` on the site's origin; null when SITE_ORIGIN is not a URL. */
function linkOf(configured: string | undefined, token: string): string | null {
	try {
		return new URL(`/offer/${token}`, siteOrigin(configured)).href;
	} catch {
		return null;
	}
}

/** Stage 5: the link, from SITE_ORIGIN (the site's own origin when it is not set) and the new token. */
export const offerLink = alwaysWrites({
	name: "build the offer link",
	given: (
		command: { readonly token: string },
		facts: { readonly siteOrigin: string | undefined },
	) => ({ href: linkOf(facts.siteOrigin, command.token) }),
	refusals: [
		unless(
			term(
				"SITE_ORIGIN makes a link",
				(given: { readonly href: string | null }) => given.href !== null,
			),
			() => new LinkNotBuilt(),
		),
	],
	writes: (given) => proved(given.href),
	writesText: "the link the client is sent",
});

export type SendRequest = {
	readonly choice: OfferChoice;
	readonly pin: Pin | null;
	/** The link and the hash of its token, stored in place of the request's link. */
	readonly link: { readonly href: string; readonly tokenHash: string };
	readonly signingEnabled: boolean;
	readonly actor: string;
};

export type SendFacts = Requested & {
	readonly signedAgreement: boolean;
	/** The request's link row, read for a reissue; null otherwise, or when it has none. */
	readonly linkRow: LinkRow | null;
	/** The closed archives, as read for the pinned attachments' keys (nothing is read, and none found, with none pinned). */
	readonly closed: ClosedArchives;
};

type SendGiven = SendFacts & { readonly command: SendRequest };

/** The send's move as its batch writes it: the open draft sent (and the sent version superseded), or a reissue. */
export type SendMove =
	| {
			readonly kind: "send";
			readonly supersede: OfferMove;
			readonly markSent: OfferMove;
	  }
	| { readonly kind: "reissue"; readonly move: OfferMove };

/**
 * The send's batch and email. The batch: G1 over `request`, G5, G3, G11 per pinned attachment, G4 (send mode) for a
 * send, G2, G8 over `offer`, G9 for a reissue; for a send the sent version superseded and the draft marked sent at `at`
 * by `actor`; the link upserted (`tokenHash`, created at `at`, not revoked); the pin; signing retired; and the audit.
 */
export type SendWrite = {
	readonly request: RequestRead;
	readonly at: string;
	readonly actor: string;
	readonly offer: {
		readonly id: string;
		readonly version: number;
		readonly status: SoftwareOffer["status"];
		readonly updatedAt: string;
		readonly sentAt: string | null;
	};
	readonly move: SendMove;
	readonly link: { readonly href: string; readonly tokenHash: string };
	readonly pin: Pin | null;
	readonly signing: SigningRetired;
	readonly audit: { readonly action: "offer-sent"; readonly note: string };
	/** The client's address: the request's email, as stored. */
	readonly to: string;
	readonly email: EmailWords;
};

/** The client's words: the link, and how to sign (on the website when signing is on and the offer pins an MSA template). */
function sendWords(given: SendGiven): EmailWords {
	const { choice, pin, link, signingEnabled } = given.command;
	const first = given.request.name.trim().split(/\s+/)[0] || "there";

	const signing =
		signingEnabled && (pin !== null || Boolean(choice.offer.msa_template_id))
			? "Review and sign on the website."
			: "We will arrange for you to sign outside the website.";

	return {
		subject: `Your project offer: ${choice.terms.outcome}`,
		text: `Hi ${first},\n\nHere’s the offer for ${choice.terms.outcome}: ${link.href}\n\n${signing}\n\nThe link is private to you. You can forward it to whoever approves the budget. Reply to this email with any questions.\n\nKazon`,
	};
}

/** Stage 6: no signed agreement, a reissue's link revoked, and the pinned attachments in no closed archive. */
export const sendOffer = alwaysWrites({
	name: "send the offer to the client",
	given: (command: SendRequest, facts: SendFacts): SendGiven => ({
		command,
		...facts,
	}),
	refusals: [
		noSignedAgreement,
		unless(
			term(
				"the offer is the open draft, or the request's link is revoked for a reissue",
				(given: SendGiven) =>
					given.command.choice.move === "SEND" ||
					(given.linkRow !== null && given.linkRow.revoked_at !== null),
			),
			() => new LinkNotRevoked(),
		),
		unless(
			term(
				"no pinned attachment is in a closed archive, and every closed archive reads",
				// The pin read each attachment's row just before (attachmentRowFound); its archives are what was left to G11.
				(given: SendGiven) =>
					given.command.pin === null ||
					given.command.pin.attachments.every((attachment) =>
						outsideClosedArchives(attachment, given.closed),
					),
			),
			() => new AttachmentNotUsable(),
		),
	],
	writes: (given): SendWrite => {
		const { choice, pin, link, actor } = given.command;
		const { offer } = choice;

		return {
			request: requestRead(given.request),
			at: choice.at,
			actor,
			offer: {
				id: offer.id,
				version: offer.version,
				status: offer.status,
				updatedAt: offer.updated_at,
				sentAt: offer.sent_at,
			},
			move:
				choice.move === "SEND"
					? {
							kind: "send",
							supersede: OFFER_MOVES.SUPERSEDE,
							markSent: OFFER_MOVES.SEND,
						}
					: { kind: "reissue", move: OFFER_MOVES.REISSUE },
			link,
			pin,
			signing: retireSigning(choice.at),
			audit: { action: "offer-sent", note: `Offer v${offer.version} sent` },
			to: given.request.email,
			email: sendWords(given),
		};
	},
	writesText:
		"for the open draft the sent version superseded and the draft marked sent; the link, the pin, signing retired and the audit offer-sent, in one batch; then the client email and its copy",
});

/** What became of the client email: accepted, refused, uncertain, or not sent for want of the mail settings. */
export type MailOutcome = {
	readonly sent: "accepted" | "refused" | "uncertain" | "not-configured";
	readonly copySent: boolean;
};

type AfterGiven = {
	readonly write: SendWrite;
	readonly mail: MailOutcome;
	readonly live: boolean;
};

/** The send's answer. `uncertain` is absent when the client email was accepted or not configured, as it has always been. */
export type SendAnswer = {
	readonly version: number;
	readonly link: string;
	readonly linkCreatedAt: string;
	readonly sentAt: string | null;
	readonly updatedAt: string;
	readonly emailSent: boolean;
	readonly uncertain: boolean | undefined;
	readonly copySent: boolean;
};

/** Stage 7, after the email: the link this send made is still live, with its offer sent and the request open. */
export const afterSendEmail = alwaysWrites({
	name: "answer the send once its email was tried",
	given: (
		command: { readonly write: SendWrite; readonly mail: MailOutcome },
		facts: { readonly live: boolean },
	): AfterGiven => ({ ...command, ...facts }),
	refusals: [
		unless(
			term(
				"the link is still live, or the client email was not accepted",
				(given: AfterGiven) => given.live || given.mail.sent !== "accepted",
			),
			() => new LinkClosedWhileSending(),
		),
		unless(
			term("the link is still live", (given: AfterGiven) => given.live),
			() => new LinkClosedAfterFailedEmail(),
		),
	],
	writes: (given): SendAnswer => {
		const { write, mail } = given;
		const sent = write.move.kind === "send";

		return {
			version: write.offer.version,
			link: write.link.href,
			linkCreatedAt: write.at,
			sentAt: sent ? write.at : write.offer.sentAt,
			updatedAt: sent ? write.at : write.offer.updatedAt,
			emailSent: mail.sent === "accepted",
			uncertain:
				mail.sent === "refused" || mail.sent === "uncertain"
					? mail.sent === "uncertain"
					: undefined,
			copySent: mail.sent === "accepted" && mail.copySent,
		};
	},
	writesText:
		"the send's answer: the version, the link and its time, and what became of the email",
});
