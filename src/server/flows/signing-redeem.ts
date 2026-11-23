// Redeeming an emailed link (docs/plans/2026-11-signing-conversion.md, section 3): the verify pages open the link with a
// GET (the Continue form) and consume it with a POST, which makes the visitor's two-hour session. The signing page
// (src/pages/offer/[token]/verify.astro) redeems a signing link of its offer token, the archive page
// (src/pages/agreements/verify.astro) an archive link. In the order the pages have always kept: the key's shape, the
// instant, the link read by the key's hash, and `redeemLink` (src/server/rules/signing-redeem.ts); for a GET of a signing
// link, the offer's signing state read and `stillOpenForSigning`; for a POST, the session token, its hash and the nonce
// drawn in that order, then the batch (A1 for a signing link, A5, the link used, the `verified` event, the session),
// whose raised guard is GuardRefused and is not retried. The pages answer every refusal with the expired page.
import * as Effect from "effect/Effect";
import { hashOfferToken } from "../../lib/software-offers";
import { hashing } from "../agreement-services";
import {
	readLinkByKey,
	readSigningFacts,
	redeemLinkBatch,
} from "../agreement-store";
import {
	LinkExpired,
	type RedeemPage,
	redeemLink,
	stillOpenForSigning,
} from "../rules/signing-redeem";

/** An emailed key's shape: 43 URL-safe characters. A key of another shape names no link and is never read. */
const LINK_KEY = /^[A-Za-z0-9_-]{43}$/;

export type RedeemLinkRequest = {
	/** The key the page was given: the query's on a GET, the form's on a POST. */
	readonly key: string;
	/** The signing page's offer token; none (or empty) on the archive page. */
	readonly token: string | undefined;
	readonly method: string;
	/** The time, read once, after the key's shape. */
	readonly now: () => Date;
	/** A new random token: the session's, then the nonce. */
	readonly newToken: () => string;
};

/** A GET found the link usable; a POST used it and made the session, whose token the cookie carries. */
export type RedeemLinkAnswer =
	| { readonly method: "GET" }
	| {
			readonly method: "POST";
			readonly purpose: "agreement" | "archive";
			/** Where the 303 goes: the offer's signing page, or the archive. */
			readonly location: string;
			readonly sessionToken: string;
	  };

/** The page's purpose, from whether it has an offer token, with that token's hash for a signing page. */
const pageOf = (token: string | undefined) =>
	Effect.gen(function* () {
		if (!token) return { purpose: "archive" } satisfies RedeemPage;

		const tokenHash = yield* hashing(() => hashOfferToken(token));

		return { purpose: "agreement", token, tokenHash } satisfies RedeemPage;
	});

export const redeemAgreementLink = (request: RedeemLinkRequest) =>
	Effect.gen(function* () {
		if (!LINK_KEY.test(request.key))
			return yield* Effect.fail(new LinkExpired());

		const keyHash = yield* hashing(() => hashOfferToken(request.key));
		const at = request.now();
		const link = yield* readLinkByKey(keyHash);
		const page = yield* pageOf(request.token);

		const decided = yield* redeemLink.decide(
			{ at, method: request.method, page },
			{ link },
		);

		if (decided.method === "GET") {
			// A signing link is shown only while its offer is open for signing to the link's recipient (A1, as a read).
			if (decided.live !== null) {
				const signing = yield* readSigningFacts({
					offerId: decided.live.offerId,
					linkHash: decided.live.linkHash,
				});

				yield* stillOpenForSigning.decide(decided.live, signing);
			}

			return { method: "GET" } satisfies RedeemLinkAnswer;
		}

		// Drawn in the order the page has always drawn them: the session's token, then the nonce; the store draws the
		// event's id as it builds the batch.
		const sessionToken = request.newToken();
		const sessionHash = yield* hashing(() => hashOfferToken(sessionToken));
		const csrfNonce = request.newToken();

		yield* redeemLinkBatch({
			session: decided.session,
			sessionHash,
			csrfNonce,
		});

		return {
			method: "POST",
			purpose: decided.session.purpose,
			location: decided.session.location,
			sessionToken,
		} satisfies RedeemLinkAnswer;
	});
