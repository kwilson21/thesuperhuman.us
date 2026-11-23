// The offer a signing token names, and whether it is open for signing (docs/plans/2026-11-signing-conversion.md,
// section 2). `linkedOffer` decides from every offer of the brief whose offer link has the token's hash, each with the
// link's revocation and the brief's kind, status and email, as the store reads them: the one a client may see is sent,
// through a link that is not revoked, for a software brief that is neither withdrawn nor resolved and has an email (today's
// `getLinkedOffer`, src/lib/software-offers.ts). `openForSigning` decides from the offer's signing state, read by its id
// with the link the session or link names, the brief, the signing setting and a project of the offer: what the live
// signing guard (A1) checks. Every signing batch (the link, the redeem, the draft, the review and the sign) re-checks A1 at
// write time; a flow reads these facts first where today only the guard looks (a project), and again after a guard
// raised (the link, Q1), so the order of answers does not move.
import * as Data from "effect/Data";
import type { SoftwareOffer } from "../../lib/software-offers";
import { alwaysWrites, term, unless } from "../terms";

export const SIGNING_OFF = "Website signing is off.";
export const OFFER_UNAVAILABLE = "This offer is unavailable for signing.";

/** The website signing setting is off (or its row is missing). */
export class SigningOff extends Data.TaggedError("SigningOff") {
	readonly say = SIGNING_OFF;
}

/** No sent offer is linked by the token, or the offer is no longer open for signing through the link to the recipient. */
export class OfferUnavailable extends Data.TaggedError("OfferUnavailable") {
	readonly say = OFFER_UNAVAILABLE;
}

/**
 * A project exists for the offer, so signing has ended. Today only A1 checks it; the link answers it as an offer that is
 * unavailable (Q1), and the draft, the review and the sign answer it with their own 409.
 */
export class SigningStarted extends Data.TaggedError("SigningStarted") {
	readonly say = OFFER_UNAVAILABLE;
}

/** An offer of the brief whose offer link has the token's hash, with that link and the brief, as stored. */
export type LinkedOfferRow = SoftwareOffer & {
	readonly link_revoked_at: string | null;
	readonly request_kind: string;
	readonly request_status: string;
	readonly request_email: string;
};

type LinkedGiven = { readonly offer: LinkedOfferRow | null };

const visible = (row: LinkedOfferRow) =>
	row.status === "sent" &&
	row.link_revoked_at === null &&
	row.request_kind === "software" &&
	row.request_status !== "withdrawn" &&
	row.request_status !== "resolved" &&
	row.request_email !== "";

/** The offer a client may see through the token: today's `getLinkedOffer`. */
export const linkedOffer = alwaysWrites({
	name: "find the sent offer a signing token names",
	given: (_request: null, facts: readonly LinkedOfferRow[]): LinkedGiven => ({
		offer: facts.find(visible) ?? null,
	}),
	refusals: [
		unless(
			term(
				"a sent offer is linked by the token, through a link that is not revoked, for an open software brief with an email",
				(given: LinkedGiven) => given.offer !== null,
			),
			() => new OfferUnavailable(),
		),
	],
	// SAFETY: `writes` runs only once the refusal above passed, which ruled out a missing offer.
	writes: (given) => given.offer as LinkedOfferRow,
	writesText: "nothing: the offer goes on to the request's own checks",
});

/**
 * What A1 re-checks, as plain rows: the offer read by its id, the link the session or link names (by its token hash,
 * absent when that link is not the brief's), the brief, the signing setting (absent when its row is missing) and a project
 * of the offer. Null when the offer is gone.
 */
export type SigningStateRow = {
	readonly status: string;
	readonly recipient_email_snapshot: string | null;
	readonly request_status: string;
	readonly link_hash: string | null;
	readonly link_revoked_at: string | null;
	readonly software_signing_enabled: number | null;
	readonly project_offer_id: string | null;
};

type OpenGiven = {
	readonly recipient: string;
	readonly row: SigningStateRow | null;
};

/**
 * The offer is open for signing to the recipient: what A1 checks, in the order Q1 answers it (signing off first, then an
 * offer that is unavailable, then a project). A missing offer is unavailable, whatever the setting.
 */
export const openForSigning = alwaysWrites({
	name: "keep the offer open for signing to the recipient",
	given: (
		request: { readonly recipient: string },
		facts: SigningStateRow | null,
	): OpenGiven => ({ recipient: request.recipient, row: facts }),
	refusals: [
		unless(
			term(
				"website signing is on",
				(given: OpenGiven) =>
					given.row === null || Boolean(given.row.software_signing_enabled),
			),
			() => new SigningOff(),
		),
		unless(
			term(
				"the offer is sent, through its brief's link that is not revoked, to the recipient, for a brief that is neither withdrawn nor resolved",
				(given: OpenGiven) =>
					given.row !== null &&
					given.row.status === "sent" &&
					given.row.link_hash !== null &&
					given.row.link_revoked_at === null &&
					given.row.recipient_email_snapshot === given.recipient &&
					given.row.request_status !== "withdrawn" &&
					given.row.request_status !== "resolved",
			),
			() => new OfferUnavailable(),
		),
		unless(
			term(
				"no project exists for the offer",
				(given: OpenGiven) => given.row?.project_offer_id === null,
			),
			() => new SigningStarted(),
		),
	],
	writes: () => ({}),
	writesText:
		"nothing: the request goes on; its batch re-checks the same with A1",
});
