// What the signing form's routes read before anything else (the draft, the review's GET and POST, the sign;
// docs/plans/2026-11-signing-conversion.md, section 3): the sent offer the page's token names, and the visitor's signing
// session for it. Plain reads; the rules decide (`linkedOffer`, src/server/rules/signing-offer.ts; `openSession` and
// `signingIsLive`, src/server/rules/agreement-session.ts, through `visitorSession`). Each route reads the signing setting
// itself, at the point it always has.
import * as Effect from "effect/Effect";
import { hashOfferToken } from "../../lib/software-offers";
import { hashing } from "../agreement-services";
import { readLinkedOffer } from "../agreement-store";
import type { StoredAgreementSession } from "../rules/agreement-session";
import { type LinkedOfferRow, linkedOffer } from "../rules/signing-offer";
import { visitorSession } from "./agreement-session";

/** An offer token's shape: 43 URL-safe characters. A token of another shape names no offer and is never read. */
const OFFER_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The sent offer the token names, or null: no token, a token of another shape (not read), or no sent offer linked by it. */
export const offerOfToken = (token: string | undefined) =>
	Effect.gen(function* () {
		if (!token || !OFFER_TOKEN.test(token)) return null;

		const tokenHash = yield* hashing(() => hashOfferToken(token));
		const rows = yield* readLinkedOffer(tokenHash);

		return yield* linkedOffer
			.decide(null, rows)
			.pipe(
				Effect.catchTag("OfferUnavailable", () =>
					Effect.succeed<LinkedOfferRow | null>(null),
				),
			);
	});

/**
 * The visitor's open signing session for this offer, or null: none, not open, its offer no longer sent to it, or a
 * session of another offer.
 */
export const offerSession = (
	request: Request,
	offer: LinkedOfferRow,
	now: () => Date,
) =>
	visitorSession(request, "agreement", now).pipe(
		Effect.map((session): StoredAgreementSession | null =>
			session !== null && session.offer_id === offer.id ? session : null,
		),
	);
