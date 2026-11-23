// The offer board's rule (docs/plans/2026-11-offer-board.md, section 5): whether the AI may suggest an offer for this
// request now. It decides from the request as read (a software brief on the website, web app or workflow path that can
// still take an offer: not resolved or withdrawn, no project started) and the owner's count for the day, and answers the
// reservation to save, or refuses. The guard that re-checks the count at write time is the batch in
// `reserveOfferBudget` (src/server/offer-board-store.ts): it raises unless the count is still under the limit, so the
// flow reads and decides again. Time is an input; the rule reads no clock.
import * as Data from "effect/Data";
import type { PricingKind } from "../../lib/pricing-reference";
import { alwaysWrites, term, unless } from "../terms";

/** Suggestions the owner may ask for in a day: about $0.15 at most (plan, section 6). */
export const OFFER_OWNER_LIMIT = 40;

/** The scope the owner's count is kept under, in the table the brief's suggestions also count in. */
export const OFFER_OWNER_SCOPE = "offer:owner";

/** There is no software request with this id. */
export class OfferRequestMissing extends Data.TaggedError(
	"OfferRequestMissing",
) {
	readonly say = "There is no software request with this id.";
}

export class OfferNotOfferable extends Data.TaggedError("OfferNotOfferable") {
	readonly say =
		"This request can no longer take an offer, so the board has nothing to suggest.";
}

export class OfferDailyLimit extends Data.TaggedError("OfferDailyLimit") {
	readonly say =
		"The offer board reached today’s limit of 40 requests to the AI. It resets at midnight UTC.";
}

/** What the rule reads about the request; `found` is false when there is no software request with this id. */
export type OfferFacts = {
	readonly found: boolean;
	readonly kind: PricingKind | null;
	readonly status: string;
	readonly started: boolean;
	/** Today's count of suggestions for the owner. */
	readonly count: number;
};

export type OfferReservation = {
	readonly day: string;
	readonly scope: string;
	readonly limit: number;
};

type Given = { readonly day: string } & OfferFacts;

const found = term<Given>(
	"there is a software request with this id",
	(g) => g.found,
);

const offerable = term<Given>(
	"the request is a website, web app or workflow brief that can still take an offer",
	(g) =>
		g.kind !== null &&
		g.status !== "resolved" &&
		g.status !== "withdrawn" &&
		!g.started,
);

const under = term<Given>(
	"the owner has asked for fewer suggestions today than the limit",
	(g) => g.count < OFFER_OWNER_LIMIT,
);

export const reserveOfferSuggestion = alwaysWrites({
	name: "Reserve one offer suggestion",
	given: (request: { readonly day: string }, facts: OfferFacts): Given => ({
		...request,
		...facts,
	}),
	refusals: [
		unless(found, () => new OfferRequestMissing()),
		unless(offerable, () => new OfferNotOfferable()),
		unless(under, () => new OfferDailyLimit()),
	],
	writes: (g): OfferReservation => ({
		day: g.day,
		scope: OFFER_OWNER_SCOPE,
		limit: OFFER_OWNER_LIMIT,
	}),
	writesText: "one more offer suggestion for the owner today",
});
