// The deposit refusals: whether a first-milestone deposit stops new terms from being sent (a send of the open draft; a
// reissue of the sent version keeps its deposits) or the request from being declined, and which sentence says why.
// Decided from every invoice of the request with the status of its offer, by `depositBlock`
// (src/lib/software-deposit-block.ts), whose contract LemmaScript and Dafny prove: only a first-milestone deposit that is
// not refunded counts, on any offer version (decision 9 of docs/plans/2026-11-discount-flow.md); new terms are stopped
// while one may still be charged (DepositOpen) or is paid (DepositPaidOnSentOffer when its offer is the sent one,
// otherwise DepositPaidEarlier), a decline only while one may still be charged (DepositOpenOnDecline). Re-checked at
// write time by G4, `depositOfferGuard` (src/lib/software-offer-deposit.ts), in the send's batch and the decline's first
// batch; tests/lib/software-deposit-block.test.ts holds the two copies together.
import * as Data from "effect/Data";
import {
	type DepositInvoice,
	depositBlock,
} from "../../lib/software-deposit-block";
import { alwaysWrites, term, unless } from "../terms";

export class DepositOpen extends Data.TaggedError("DepositOpen") {
	readonly say =
		"Void the open deposit invoice in Stripe first, then send the new offer.";
}

export class DepositPaidOnSentOffer extends Data.TaggedError(
	"DepositPaidOnSentOffer",
) {
	readonly say =
		"A deposit is already paid for this offer. Start the project, or refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded. New terms can't be sent while an agreement is signed.";
}

export class DepositPaidEarlier extends Data.TaggedError("DepositPaidEarlier") {
	readonly say =
		"A deposit is paid on an earlier offer. Refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded before sending new terms.";
}

export class DepositOpenOnDecline extends Data.TaggedError(
	"DepositOpenOnDecline",
) {
	readonly say =
		"Void the open deposit invoice in Stripe before declining this request.";
}

/** Every invoice of the request, with its offer's status: the store reads them unfiltered, so the rule decides. */
export type DepositsRead = { readonly invoices: readonly DepositInvoice[] };

type SendGiven = { readonly block: ReturnType<typeof depositBlock> };

/** For a send of the open draft: no first deposit may still be charged or is paid, on any version. */
export const depositAllowsSend = alwaysWrites({
	name: "send new terms only while no first deposit is open or paid",
	given: (_request: null, facts: DepositsRead): SendGiven => ({
		block: depositBlock([...facts.invoices], false),
	}),
	refusals: [
		unless(
			term(
				"no first deposit of the request may still be charged",
				(given: SendGiven) => given.block !== "open",
			),
			() => new DepositOpen(),
		),
		unless(
			term(
				"no first deposit is paid on the sent offer",
				(given: SendGiven) => given.block !== "paidOnSent",
			),
			() => new DepositPaidOnSentOffer(),
		),
		unless(
			term(
				"no first deposit is paid on an earlier offer",
				(given: SendGiven) => given.block !== "paidEarlier",
			),
			() => new DepositPaidEarlier(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the send goes on",
});

/** DepositOpenOnDecline: no first deposit of the request may still be charged; a paid one does not stop a decline. */
export const noOpenDepositOnDecline = unless(
	term(
		"no first deposit of the request may still be charged",
		(given: DepositsRead) => depositBlock([...given.invoices], true) !== "open",
	),
	() => new DepositOpenOnDecline(),
);
