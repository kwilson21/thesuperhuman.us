// Redeeming an emailed link: a verify page opens the link with a GET (the Continue form) and consumes it with a POST,
// which makes the visitor's two-hour session (src/pages/offer/[token]/verify.astro for a signing link,
// src/pages/agreements/verify.astro for an archive link; the flow src/server/flows/signing-redeem.ts).
// One function serves both purposes today, the purpose following from whether the page has an offer token, so
// `redeemLink` decides both. Decided from `at` (read once, after the key's shape), the link read by the key's hash, the
// page's purpose and offer token, and the method, in today's order:
//   1. `redeemLink`: LinkExpired unless the link has the page's purpose, is unused and has not expired at `at` (today the
//      read's own `purpose=? AND used_at IS NULL AND expires_at>?`); unless, for a signing link, it names the page's
//      offer token; and unless the method is GET or POST. A GET answers whether the page needs the live check; a POST
//      writes the link used at `at`, the `verified` event and the session, which lasts two hours (the cookie's Max-Age).
//   2. `stillOpenForSigning`, for the GET of a signing link only: LinkExpired unless the offer is still open for signing
//      to the link's recipient (openForSigning's terms, src/server/rules/signing-offer.ts; today A1 run as a read).
// Re-checked at write time by the POST's batch: A1 for a signing link (`liveSigningGuard`) and A5 (the link still unused
// and unexpired at `at`). A raised guard is GuardRefused and is not retried: it answers LinkExpired, as today. Every
// refusal answers the expired page with 401.
import * as Data from "effect/Data";
import { alwaysWrites, term, unless } from "../terms";
import { openForSigning, type SigningStateRow } from "./signing-offer";

/** The link is unknown, used, expired, of another purpose or offer, or no longer open for signing: the expired page, 401. */
export class LinkExpired extends Data.TaggedError("LinkExpired") {
	readonly say = "This link has expired.";
}

/** How long a session lasts once a link is redeemed: the session row's `expires_at` and the cookie's Max-Age. */
export const SESSION_LIFETIME_MS = 7_200_000;

/** A signing or archive link as stored (`software_agreement_links`), read by the hash of the page's key. */
export type StoredAgreementLink = {
	readonly id: string;
	readonly purpose: string;
	readonly offer_id: string | null;
	readonly link_hash: string | null;
	readonly recipient_email: string;
	readonly token_hash: string;
	readonly issued_at: string;
	readonly expires_at: string;
	readonly used_at: string | null;
};

/** The page the link is redeemed on: the archive page, or a signing page with its offer token and that token's hash. */
export type RedeemPage =
	| { readonly purpose: "archive" }
	| {
			readonly purpose: "agreement";
			readonly token: string;
			readonly tokenHash: string;
	  };

export type RedeemRequest = {
	/** Read once, after the key's shape and before the link is read. */
	readonly at: Date;
	readonly method: string;
	readonly page: RedeemPage;
};

/** What A1 binds for a signing link: the offer, its link's token hash and the recipient. */
export type SigningCheck = {
	readonly offerId: string | null;
	readonly linkHash: string | null;
	readonly recipient: string;
};

/** The session a POST makes, with the link it uses and the event. The flow draws the session token, its hash and the nonce. */
export type RedeemSession = {
	readonly purpose: "agreement" | "archive";
	/** The link's `used_at`, the event's time and the session's `verified_at`. */
	readonly at: string;
	/** The key's hash: A5's bind and the used link's. */
	readonly keyHash: string;
	readonly linkId: string;
	readonly offerId: string | null;
	readonly linkHash: string | null;
	readonly recipient: string;
	/** Two hours after `at`. */
	readonly expiresAt: string;
	/** Where the 303 goes: the signing page of the offer token, or the archive. */
	readonly location: string;
	/** A1 in the batch, for a signing link; null for an archive link. */
	readonly live: SigningCheck | null;
};

export type RedeemWrite =
	| {
			readonly method: "GET";
			/** The live check a signing link's GET reads and decides (`stillOpenForSigning`); null for an archive link. */
			readonly live: SigningCheck | null;
	  }
	| { readonly method: "POST"; readonly session: RedeemSession };

type RedeemGiven = {
	readonly at: string;
	readonly method: string;
	readonly page: RedeemPage;
	readonly link: StoredAgreementLink | null;
};

const signingCheck = (link: StoredAgreementLink): SigningCheck => ({
	offerId: link.offer_id,
	linkHash: link.link_hash,
	recipient: link.recipient_email,
});

/** Stage 1: the link, the page's offer token and the method. */
export const redeemLink = alwaysWrites({
	name: "redeem an emailed link",
	given: (
		request: RedeemRequest,
		facts: { readonly link: StoredAgreementLink | null },
	): RedeemGiven => ({
		at: request.at.toISOString(),
		method: request.method,
		page: request.page,
		link: facts.link,
	}),
	refusals: [
		unless(
			term(
				"the key names a link of the page's purpose that is unused and has not expired",
				(given: RedeemGiven) =>
					given.link !== null &&
					given.link.purpose === given.page.purpose &&
					given.link.used_at === null &&
					given.link.expires_at > given.at,
			),
			() => new LinkExpired(),
		),
		unless(
			term(
				"an archive link, or a signing link that names the page's offer token",
				(given: RedeemGiven) =>
					given.page.purpose === "archive" ||
					given.link?.link_hash === given.page.tokenHash,
			),
			() => new LinkExpired(),
		),
		unless(
			term(
				"the page was asked with GET or POST",
				(given: RedeemGiven) =>
					given.method === "GET" || given.method === "POST",
			),
			() => new LinkExpired(),
		),
	],
	writes: (given): RedeemWrite => {
		// SAFETY: `writes` runs only once the first refusal passed, which ruled out a missing link.
		const link = given.link as StoredAgreementLink;

		const live = given.page.purpose === "agreement" ? signingCheck(link) : null;

		if (given.method === "GET") return { method: "GET", live };

		return {
			method: "POST",
			session: {
				purpose: given.page.purpose,
				at: given.at,
				keyHash: link.token_hash,
				linkId: link.id,
				offerId: link.offer_id,
				linkHash: link.link_hash,
				recipient: link.recipient_email,
				expiresAt: new Date(
					Date.parse(given.at) + SESSION_LIFETIME_MS,
				).toISOString(),
				location:
					given.page.purpose === "agreement"
						? `/offer/${given.page.token}/sign`
						: "/agreements",
				live,
			},
		};
	},
	writesText:
		"a GET: nothing (a signing link's live check is read next); a POST: the link used, the verified event and a two-hour session, re-checked by A1 for a signing link and A5",
});

/** Stage 2, the GET of a signing link: the offer is still open for signing to the link's recipient. */
export const stillOpenForSigning = alwaysWrites({
	name: "show a signing link only while its offer is open for signing",
	given: (request: SigningCheck, facts: SigningStateRow | null) =>
		openForSigning.given({ recipient: request.recipient }, facts),
	refusals: [
		unless(
			term(
				"the offer is still open for signing to the link's recipient (A1)",
				(given: ReturnType<typeof openForSigning.given>) =>
					openForSigning.refusals.every((refusal) =>
						refusal.unless.holds(given),
					),
			),
			() => new LinkExpired(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the page shows its Continue form",
});
