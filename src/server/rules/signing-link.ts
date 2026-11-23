// The signing link: a visitor on an offer's page asks for the link that opens its agreement, mailed to the offer's
// recipient (POST /api/offer/[token]/link; the flow src/server/flows/signing-link.ts). The route's order
// is kept, and each stage decides on what was read so far (docs/plans/2026-11-signing-conversion.md, sections 2 and 3):
//   1. the signing setting (`signingOn`): SigningOff;
//   2. the sent offer the token names (`linkedOffer`, src/server/rules/signing-offer.ts): OfferUnavailable; then, with
//      no recipient or no MSA template, OfferUnavailable, and a recipient that is not an address, InvalidEmail
//      (`linkRecipient`, which answers the recipient normalised);
//   3. the address allowance, the captcha and the recipient's allowance (`withinAllowance`, SecurityCheckFailed and
//      TooManyLinks of src/server/rules/agreement-link.ts, reused; a code key under 32 characters stays the flow's 503);
//   4. the link (`issueSigningLink`), from `at`, the offer's signing state (openForSigning's facts, refused in Q1's order:
//      SigningOff, OfferUnavailable, SigningStarted) and the recipient's signing links of the offer (CooldownRunning, a
//      link issued in the 30 seconds before `at`); it writes the link's times and the receipt's address, in full when
//      the visitor holds an open signing session for this offer and masked otherwise;
//   5. after the mail: a refused mail takes back the link, its sessions and one use of each allowance it counted
//      (`refundAllowances`) and answers MailRefused; a sent or uncertain mail consumes the recipient's older unused links
//      of the offer (`consumeOlderLinks` of src/server/rules/agreement-link.ts, reused).
// Re-checked at write time by the link batch's A4 (no signing link of the recipient and offer issued after `since`) and
// A1 (`liveSigningGuard`: the offer still open for signing); a raised guard is read and decided again, three tries in
// all, each keeping the first `at` (`decideAndSave`, whose SaveKeptChanging answers CooldownRunning). A6, the consume's
// own `used_at IS NULL`, re-checks the older links. The answers: SigningOff, OfferUnavailable and SigningStarted 404
// with their sentence, InvalidEmail 400, TooManyLinks and CooldownRunning 429, SecurityCheckFailed 403, MailRefused 502.
import * as Data from "effect/Data";
import { maskedAgreementEmail } from "../../lib/agreement-access";
import { normalizeClientEmail } from "../../lib/client-portal";
import { escapeHtml } from "../../lib/email-template";
import { alwaysWrites, rule, term, unless } from "../terms";
import {
	COOLDOWN_MS,
	CooldownRunning,
	InvalidEmail,
	LINK_LIFETIME_MS,
} from "./agreement-link";
import type { StoredAgreementSession } from "./agreement-session";
import {
	type LinkedOfferRow,
	OfferUnavailable,
	openForSigning,
	SigningOff,
	type SigningStateRow,
} from "./signing-offer";

/** The allowance scopes and limits the signing link counts under, in the order it counts them. */
export const SIGNING_ADDRESS_ALLOWANCE = {
	scope: "agreement-link-ip",
	limit: 20,
} as const;

export const SIGNING_EMAIL_ALLOWANCE = {
	scope: "agreement-link-email",
	limit: 3,
} as const;

/** The mail with the link was refused (a 4xx): the link, its sessions and the uses it counted were taken back. 502. */
export class MailRefused extends Data.TaggedError("MailRefused") {
	readonly say = "That email didn’t go through. Please try again.";
}

/** The signing setting's row as stored, or null when the row is missing. */
export type SigningSettingRow = {
	readonly software_signing_enabled: number;
};

/** Stage 1: website signing is on (a missing row is off). */
export const signingOn = alwaysWrites({
	name: "a signing link: website signing is on",
	given: (_request: null, facts: SigningSettingRow | null) => ({
		on: Boolean(facts?.software_signing_enabled),
	}),
	refusals: [
		unless(
			term("website signing is on", (given: { on: boolean }) => given.on),
			() => new SigningOff(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the offer is read next",
});

type RecipientGiven = {
	readonly signable: boolean;
	readonly email: string | null;
};

/**
 * Stage 2, after `linkedOffer`: the offer names a recipient and an MSA template (an empty value counts as none), and the
 * recipient is an email address. Answers the recipient normalised, as every later check and write uses it.
 */
export const linkRecipient = alwaysWrites({
	name: "mail the signing link to the offer's recipient",
	given: (
		_request: null,
		facts: Pick<LinkedOfferRow, "recipient_email_snapshot" | "msa_template_id">,
	): RecipientGiven => ({
		signable:
			Boolean(facts.recipient_email_snapshot) && Boolean(facts.msa_template_id),
		email: facts.recipient_email_snapshot
			? normalizeClientEmail(facts.recipient_email_snapshot)
			: null,
	}),
	refusals: [
		unless(
			term(
				"the offer names a recipient and an MSA template",
				(given: RecipientGiven) => given.signable,
			),
			() => new OfferUnavailable(),
		),
		unless(
			term(
				"the recipient is an email address",
				(given: RecipientGiven) => given.email !== null,
			),
			() => new InvalidEmail(),
		),
	],
	// SAFETY: `writes` runs only once the refusals above passed, which ruled out a recipient that is not an address.
	writes: (given) => given.email as string,
	writesText: "the recipient, normalised",
});

/** A signing link of the recipient and the offer as stored (`purpose='agreement'`, every one, used or not). */
export type StoredSigningLink = {
	readonly id: string;
	readonly issued_at: string;
	readonly used_at: string | null;
};

export type SigningLinkRequest = {
	/** The link's instant: read once, after the visitor's session, and kept by every retry. */
	readonly at: Date;
	readonly offerId: string;
	/** The recipient, as `linkRecipient` answered it. */
	readonly recipient: string;
	/**
	 * The visitor's open signing session (`visitorSession`: open, and its offer still sent to it), or null. Read once,
	 * before `at`, for the receipt only.
	 */
	readonly session: Pick<StoredAgreementSession, "offer_id"> | null;
};

/** What the link batch's guards re-check, read just before it (and again after a guard raised). */
export type SigningLinkFacts = {
	/** The offer's signing state, read by its id with the token's hash (openForSigning's facts), or null when it is gone. */
	readonly signing: SigningStateRow | null;
	/**
	 * The recipient's signing links of the offer: at least every one issued after the window's start (`since`), which are
	 * all the rule counts (the flow reads only those).
	 */
	readonly links: readonly StoredSigningLink[];
};

/** The link's times and the receipt's address. The flow draws the link's id and key for each try. */
export type SigningLinkWrite = {
	readonly at: string;
	/** The start of the 30-second window A4 re-checks: `at` less 30 seconds. */
	readonly since: string;
	/** An hour after `at`. */
	readonly expiresAt: string;
	/** The recipient in full when the visitor holds an open signing session for this offer, otherwise masked. */
	readonly receiptAddress: string;
};

type LinkGiven = ReturnType<typeof openForSigning.given> & {
	readonly recentlyIssued: boolean;
	readonly at: string;
	readonly since: string;
	readonly expiresAt: string;
	readonly receiptAddress: string;
};

/**
 * Stage 4: whether the link is issued. The offer must still be open for signing to the recipient (openForSigning's
 * refusals, in Q1's order), then no signing link of the recipient and the offer may have been issued after `since` (used
 * or not, as A4 counts them).
 */
export const issueSigningLink = alwaysWrites({
	name: "issue a signing link",
	given: (request: SigningLinkRequest, facts: SigningLinkFacts): LinkGiven => {
		const since = new Date(request.at.getTime() - COOLDOWN_MS).toISOString();

		return {
			...openForSigning.given({ recipient: request.recipient }, facts.signing),
			recentlyIssued: facts.links.some((link) => link.issued_at > since),
			at: request.at.toISOString(),
			since,
			expiresAt: new Date(
				request.at.getTime() + LINK_LIFETIME_MS,
			).toISOString(),
			receiptAddress:
				request.session !== null && request.session.offer_id === request.offerId
					? request.recipient
					: maskedAgreementEmail(request.recipient),
		};
	},
	refusals: [
		...openForSigning.refusals,
		unless(
			term(
				"no signing link was issued to the recipient for the offer in the last 30 seconds",
				(given: LinkGiven) => !given.recentlyIssued,
			),
			() => new CooldownRunning(),
		),
	],
	writes: (given): SigningLinkWrite => ({
		at: given.at,
		since: given.since,
		expiresAt: given.expiresAt,
		receiptAddress: given.receiptAddress,
	}),
	writesText:
		"one link row that lasts an hour and its issue event, re-checked by A4 and A1; the receipt's address",
});

/** One use an allowance counted: its keyed hash and the window start its count answered (`RETURNING window_start`). */
export type CountedUse = {
	readonly key: string;
	readonly window_start: string;
};

export type RefundFacts = {
	/** What the mail service answered. */
	readonly outcome: "sent" | "refused" | "uncertain";
	/** Every use the request counted, in the order it counted them: the address's, then the recipient's. */
	readonly uses: readonly CountedUse[];
};

/** The refused link to take back, with the uses to give back. */
export type RefundWrite = {
	readonly linkId: string;
	readonly uses: readonly CountedUse[];
};

type RefundGiven = RefundFacts & { readonly linkId: string };

/**
 * Stage 5: what a refused mail takes back. Nothing to do when the mail was sent or its outcome is uncertain (the older
 * links are consumed then). A refused mail takes back the link and its sessions, and gives back one use of every
 * allowance the request counted: each by its key and the window start its count answered. Whether that use was the
 * window's only one (the row deleted) or not (one use taken off) is the refund statements' own filter, as today.
 */
export const refundAllowances = rule({
	name: "take back a signing link whose mail was refused, with the uses it counted",
	given: (
		request: { readonly linkId: string },
		facts: RefundFacts,
	): RefundGiven => ({ ...facts, linkId: request.linkId }),
	nothingToDoIf: term(
		"the mail was not refused: it was sent, or its outcome is uncertain",
		(given: RefundGiven) => given.outcome !== "refused",
	),
	refusals: [],
	writes: (given): RefundWrite => ({
		linkId: given.linkId,
		uses: given.uses,
	}),
	writesText:
		"the link, its sessions and one use of each counted allowance taken back, in one batch",
});

/** The mail's words for a signing link: the greeting takes the first word of the brief's name, or "there". */
export function signingMail(input: {
	readonly name: string | null | undefined;
	/** The offer terms' `outcome`, as `JSON.parse(terms_json).outcome` gives it. */
	readonly outcome: unknown;
	readonly url: string;
}) {
	const greeting = `Hi ${input.name?.trim().split(/\s+/)[0] || "there"},`;
	const intro = `Tap below to review and sign the agreement for ${String(input.outcome)}.`;
	const action = "Review and sign";

	const expiry =
		"This link works once and expires in an hour. If you didn’t ask for it, you can ignore this email.";

	return {
		subject: "Open your agreement",
		text: `${greeting}\n\n${intro}\n\n${action}: ${input.url}\n\n${expiry}\n\nKazon`,
		html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(input.url)}">${action}</a></p><p>${escapeHtml(expiry)}</p><p>Kazon</p>`,
	};
}
