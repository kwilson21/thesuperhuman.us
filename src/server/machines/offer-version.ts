import { setup } from "xstate";
import { next, sourcesOf } from "./next";

// One offer version's stored moves (`software_offers.status`), as docs/plans/2026-11-offers-conversion.md, section 1 ("The
// offer version") draws them. The picture of the offer's whole life, with InReview, ClientSigned and Started, is in that
// section and in docs/plans/2026-11-discount-flow.md, section 3; those three are not values of the status column
// (they are `software_agreements` rows, review, client_signed and executed, and a `software_projects` row), so they are
// facts the rules read, not states here. The writes are SQL compare-and-set guards (G7 the open draft, G8 the offer as
// read, G9 a reissue's revoked link); the store builds each statement's `status IN (...)` list from this machine
// (`OFFER_MOVES`), and tests hold each list to it.
//
// A new version is inserted at the initial state, draft (numbered newest plus one). SAVE updates the open draft. SEND
// sends it, and SUPERSEDE, in the same batch, retires the sent version it replaces. REISSUE sends the sent version again
// with a new link after a revoke. WITHDRAW, the decline's first batch, ends the draft and the sent version. Superseded and
// withdrawn have no moves: a send then answers NoOfferToSend.

/** The stored statuses, in the order of the column's CHECK (migrations/music/0020_software_offers.sql). */
export const OFFER_STATUSES = [
	"draft",
	"sent",
	"superseded",
	"withdrawn",
] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** The stored moves of an offer version. */
export const OFFER_EVENTS = [
	"SAVE",
	"SEND",
	"SUPERSEDE",
	"REISSUE",
	"WITHDRAW",
] as const;

export type OfferEvent = (typeof OFFER_EVENTS)[number];

export const offerVersion = setup({}).createMachine({
	id: "offerVersion",
	initial: "draft",
	states: {
		draft: {
			on: {
				SAVE: { target: "draft" },
				SEND: { target: "sent" },
				WITHDRAW: { target: "withdrawn" },
			},
		},
		sent: {
			on: {
				SUPERSEDE: { target: "superseded" },
				REISSUE: { target: "sent" },
				WITHDRAW: { target: "withdrawn" },
			},
		},
		superseded: { type: "final" },
		withdrawn: { type: "final" },
	},
});

/** Whether a version in this status may take the move. */
export const offerAllows = (status: OfferStatus, event: OfferEvent) =>
	next(offerVersion, status, event) !== null;

/** One move as a statement writes it: the statuses it is allowed from and the status it sets. */
export type OfferMove = {
	readonly from: readonly OfferStatus[];
	readonly to: OfferStatus;
};

/** The move of an event, read from the machine: the statuses it is allowed from and the one status it sets from each. */
function moveOf(event: OfferEvent): OfferMove {
	const from = sourcesOf(offerVersion, event).flatMap((source) =>
		OFFER_STATUSES.filter((status) => status === source),
	);

	const targets = new Set(
		from.map((status) => next(offerVersion, status, event)),
	);

	const to = OFFER_STATUSES.find((status) => targets.has(status));

	if (targets.size !== 1 || to === undefined)
		throw new Error(
			`The move ${event} of machine "offerVersion" does not set one status: ${JSON.stringify([...targets])}`,
		);

	return { from, to };
}

/** The move of each event, read from the machine once: what the store's `status IN (...)` lists and its writes use. */
export const OFFER_MOVES = {
	SAVE: moveOf("SAVE"),
	SEND: moveOf("SEND"),
	SUPERSEDE: moveOf("SUPERSEDE"),
	REISSUE: moveOf("REISSUE"),
	WITHDRAW: moveOf("WITHDRAW"),
} satisfies { readonly [E in OfferEvent]: OfferMove };
