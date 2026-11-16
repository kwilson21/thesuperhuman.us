// Which sessions a visitor of the agreement routes holds. A session is a row the store reads by the hash of the cookie's
// token; whether it still counts (not expired, not revoked, and for a signing session the offer is still being signed) is
// decided here, from the plain columns the store read, so the store's statements decide nothing. Pure.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";

/** A signing or archive session as stored. */
export type StoredAgreementSession = {
	readonly token_hash: string;
	readonly purpose: "agreement" | "archive";
	readonly offer_id: string | null;
	readonly link_hash: string | null;
	readonly recipient_email: string;
	readonly verified_at: string;
	readonly expires_at: string;
	readonly revoked_at: string | null;
	readonly csrf_nonce: string;
};

/** The session does not count: it expired, was revoked, or its offer is no longer open for signing. */
export class SessionNotOpen extends Data.TaggedError("SessionNotOpen") {
	readonly say = "No open session.";
}

type OpenGiven = {
	readonly session: StoredAgreementSession;
	readonly now: string;
};

/** A session stays open until it expires or is revoked. The expiry is compared as the stored ISO text is. */
export const openSession = alwaysWrites({
	name: "keep a session that is open",
	given: (
		request: { readonly now: Date },
		facts: StoredAgreementSession,
	): OpenGiven => ({ session: facts, now: request.now.toISOString() }),
	refusals: [
		unless(
			term(
				"the session has not expired",
				(given: OpenGiven) => given.session.expires_at > given.now,
			),
			() => new SessionNotOpen(),
		),
		unless(
			term(
				"the session was not revoked",
				(given: OpenGiven) => given.session.revoked_at === null,
			),
			() => new SessionNotOpen(),
		),
	],
	writes: (given) => given.session,
	writesText: "the session, as the visitor holds it",
});

/** The offer a signing session names, with the link it came through and the brief it belongs to, as stored. */
export type SigningOfferRow = {
	readonly offer_status: string;
	readonly link_revoked_at: string | null;
	readonly request_status: string;
	readonly recipient_email_snapshot: string | null;
};

type SigningGiven = {
	readonly session: StoredAgreementSession;
	readonly rows: readonly SigningOfferRow[];
};

/**
 * A signing session counts only while its offer is still sent to the session's address, through a link that is not
 * revoked, for a brief that is neither withdrawn nor resolved. An archive session has no offer: it is open once it is unexpired and unrevoked.
 */
export const signingIsLive = alwaysWrites({
	name: "keep a signing session whose offer is still open",
	given: (
		request: { readonly session: StoredAgreementSession },
		facts: readonly SigningOfferRow[],
	): SigningGiven => ({ session: request.session, rows: facts }),
	refusals: [
		unless(
			term(
				"the session is an archive session, or its offer is still sent to the session's address",
				(given: SigningGiven) =>
					given.session.purpose === "archive" ||
					given.rows.some(
						(row) =>
							row.offer_status === "sent" &&
							row.link_revoked_at === null &&
							row.request_status !== "withdrawn" &&
							row.request_status !== "resolved" &&
							row.recipient_email_snapshot === given.session.recipient_email,
					),
			),
			() => new SessionNotOpen(),
		),
	],
	writes: (given) => given.session,
	writesText: "the signing session, as the visitor holds it",
});

/** The studio session as stored. */
export type StoredStudioSession = {
	readonly email: string;
	readonly expires_at: string;
	readonly revoked_at: string | null;
};

/** The studio session does not count. */
export class StudioSessionNotOpen extends Data.TaggedError(
	"StudioSessionNotOpen",
) {
	readonly say = "No open studio session.";
}

type StudioGiven = {
	readonly session: StoredStudioSession;
	readonly now: string;
};

/** A studio session counts until it expires or is revoked. Its identity is the row, even when the email is empty. */
export const openStudioSession = alwaysWrites({
	name: "keep a studio session that is open",
	given: (
		request: { readonly now: Date },
		facts: StoredStudioSession,
	): StudioGiven => ({ session: facts, now: request.now.toISOString() }),
	refusals: [
		unless(
			term(
				"the studio session has not expired",
				(given: StudioGiven) => given.session.expires_at > given.now,
			),
			() => new StudioSessionNotOpen(),
		),
		unless(
			term(
				"the studio session was not revoked",
				(given: StudioGiven) => given.session.revoked_at === null,
			),
			() => new StudioSessionNotOpen(),
		),
	],
	writes: (given) => ({ email: given.session.email }),
	writesText: "the studio session's email",
});
