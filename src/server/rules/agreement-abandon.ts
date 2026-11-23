// The owner abandons a signing the client has signed (docs/plans/2026-11-signing-conversion.md, section 2,
// `abandonSigning`): the client-signed documents are abandoned and the offer is retired, so it can be sent again. Decided
// from the request's sent offer, every agreement of the offer as read (ordered by kind), the documents the owner named,
// and every invoice of the offer, with the reason, the owner's email and the time the route read before anything else
// (src/pages/api/owner/requests/[id]/agreement.ts, the `abandon` action). Its reads come between its decisions, so the
// rule is staged, each stage repeating the refusals before it, in the order the route has always answered:
//   1. the request has a sent offer: NoSentOffer (abandonFront);
//   2. the client-signed documents are exactly those named: PendingActionDiffers (abandonPending);
//   3. no first deposit of the offer counts (`abandonBlocked`, src/lib/software-deposit-block.ts): DepositCounts
//      (abandonSigning).
// Writes, in one batch at the time read: per document named, in the order named, its move to abandoned with the reason
// (`AGREEMENT_MOVES.ABANDON`), the `abandoned` event with the offer and `owner-abandoned`, and its signing notices still
// sending failed as obsolete (`obsolete-signing-notice:abandoned`); then the offer superseded (`OFFER_MOVES.SUPERSEDE`),
// the request's offer link revoked, the offer's signing sessions revoked and its signing links used, and its drafts
// deleted. The store draws the event and obsolete-event ids as it builds those statements, as today. Re-checked at write
// time by A12 (no first deposit of the offer counts) and A11 (each document named still client_signed with its hash, of
// this request and offer). After a refused batch the route reads the deposits again and answers DepositCounts when one
// counts now (`afterRefusedAbandon`), otherwise its generic 409, as today's catch does.
import * as Data from "effect/Data";
import { abandonBlocked } from "../../lib/software-deposit-block";
import { AGREEMENT_MOVES } from "../machines/agreement-document";
import { alwaysWrites, term, unless } from "../terms";
import {
	type NamedDocument,
	type OfferAgreementRow,
	pendingAsNamed,
	type SentOfferRow,
} from "./agreement-countersign";

/** 409 `{ok:false}`, with no sentence: the request has no sent offer. */
export class NoSentOffer extends Data.TaggedError("NoSentOffer") {
	readonly say = "";
}

/** 409: no document of the offer is client-signed, or the client-signed documents are not exactly those named. */
export class PendingActionDiffers extends Data.TaggedError(
	"PendingActionDiffers",
) {
	readonly say = "Review the complete pending signing action.";
}

/** 409: a first deposit of the offer may still be charged, or is paid and not refunded (A12). */
export class DepositCounts extends Data.TaggedError("DepositCounts") {
	readonly say =
		"Void the deposit invoice first, or refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded.";
}

/** One invoice of the offer, as stored. */
export type OfferInvoiceRow = {
	readonly milestone_index: number;
	readonly kind: string;
	readonly status: string;
	readonly refunded_at: string | null;
};

/** Whether a first deposit among the offer's invoices stops the abandon: A12, through `abandonBlocked` and its contract. */
const depositCounts = (invoices: readonly OfferInvoiceRow[]) =>
	abandonBlocked(
		invoices.map((invoice) => ({
			milestoneIndex: invoice.milestone_index,
			kind: invoice.kind,
			status: invoice.status,
			refunded: invoice.refunded_at !== null,
		})),
	);

/** What the owner sent, and the time the route read first. */
export type AbandonRequest = {
	/** The request's id, as the route was asked (the sent offer was read by it). */
	readonly requestId: string;
	readonly documents: readonly NamedDocument[];
	readonly reason: string;
	/** The owner's email, as signed in. */
	readonly actor: string;
	readonly at: string;
};

/** The facts abandon reads, in the order it reads them. */
export type AbandonFacts = {
	readonly offer: SentOfferRow | null;
	/** Every agreement of the offer, ordered by kind (none read when there is no sent offer). */
	readonly agreements: readonly OfferAgreementRow[];
	/** Every invoice of the offer (none read before the documents are checked). */
	readonly invoices: readonly OfferInvoiceRow[];
};

type FrontGiven = { readonly offer: SentOfferRow | null };

type PendingGiven = FrontGiven & { readonly pendingAsNamed: boolean };

type DepositGiven = { readonly depositCounts: boolean };

type AbandonGiven = PendingGiven &
	DepositGiven & {
		readonly request: AbandonRequest;
	};

const pendingGiven = (
	request: Pick<AbandonRequest, "documents">,
	facts: Pick<AbandonFacts, "offer" | "agreements">,
): PendingGiven => ({
	offer: facts.offer,
	pendingAsNamed:
		pendingAsNamed(
			facts.agreements,
			request.documents,
			AGREEMENT_MOVES.ABANDON,
		) !== null,
});

const sentOffer = unless(
	term(
		"the request has a sent offer",
		(given: FrontGiven) => given.offer !== null,
	),
	() => new NoSentOffer(),
);

const pendingAreNamed = unless(
	term(
		"some documents of the offer are client-signed, and they are exactly the documents named",
		(given: PendingGiven) => given.pendingAsNamed,
	),
	() => new PendingActionDiffers(),
);

const noDepositCounts = unless(
	term(
		"no first-milestone deposit of the offer may still be charged, or is paid and not refunded",
		(given: DepositGiven) => !given.depositCounts,
	),
	() => new DepositCounts(),
);

/** Stage 1, before the agreements are read: the request has a sent offer. */
export const abandonFront = alwaysWrites({
	name: "abandon: the request has a sent offer",
	given: (_request: null, facts: Pick<AbandonFacts, "offer">): FrontGiven =>
		facts,
	refusals: [sentOffer],
	writes: () => ({}),
	writesText: "nothing: the offer's agreements are read next",
});

/** Stage 2, before the invoices are read: the client-signed documents are the ones named. */
export const abandonPending = alwaysWrites({
	name: "abandon: the documents named are the pending ones",
	given: (
		request: Pick<AbandonRequest, "documents">,
		facts: Pick<AbandonFacts, "offer" | "agreements">,
	) => pendingGiven(request, facts),
	refusals: [sentOffer, pendingAreNamed],
	writes: () => ({}),
	writesText: "nothing: the offer's invoices are read next",
});

/** The abandon batch, in the order its statements run. */
export type AbandonWrite = {
	readonly offerId: string;
	readonly requestId: string;
	readonly at: string;
	readonly actor: string;
	readonly reason: string;
	/**
	 * The documents named, in the order named: A11 over each (its id, hash, request and offer), its move to abandoned,
	 * its `abandoned` event and its obsolete notices. A12 over the offer's deposits runs first.
	 */
	readonly documents: readonly NamedDocument[];
};

/** Stage 3: the whole abandon. */
export const abandonSigning = alwaysWrites({
	name: "abandon the signing the client signed",
	given: (request: AbandonRequest, facts: AbandonFacts): AbandonGiven => ({
		...pendingGiven(request, facts),
		request,
		depositCounts: depositCounts(facts.invoices),
	}),
	refusals: [sentOffer, pendingAreNamed, noDepositCounts],
	writes: (given): AbandonWrite => {
		// SAFETY: `writes` runs only once NoSentOffer passed, which ruled out a missing offer.
		const offer = given.offer as SentOfferRow;
		const { requestId, at, actor, reason, documents } = given.request;

		return {
			offerId: offer.id,
			requestId,
			at,
			actor,
			reason,
			documents: documents.map((document) => ({
				id: document.id,
				hash: document.hash,
			})),
		};
	},
	writesText:
		"per document named its move to abandoned, its abandoned event and its obsolete notices; the offer superseded, its link and sessions revoked, its signing links used and its drafts deleted; in one batch",
});

/**
 * After a refused abandon batch: the offer's invoices read again. A first deposit that counts now answers DepositCounts;
 * otherwise nothing here, and the route answers its generic 409, as today's catch does.
 */
export const afterRefusedAbandon = alwaysWrites({
	name: "explain a refused abandon by a deposit that counts now",
	given: (
		_request: null,
		facts: Pick<AbandonFacts, "invoices">,
	): DepositGiven => ({
		depositCounts: depositCounts(facts.invoices),
	}),
	refusals: [noDepositCounts],
	writes: () => ({}),
	writesText: "nothing: the refused batch's own answer stands",
});
