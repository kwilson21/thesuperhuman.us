// The deposit decision of the software offers area: whether a first-milestone deposit stops new terms from being sent, or
// a request from being declined, and which sentence says why. Written for docs/plans/2026-11-offers-conversion.md, section
// 7, from `depositOfferBlock` (src/lib/software-offer-deposit.ts), which reads the same decision in SQL and stays for the
// owner request status until that route converts. It imports nothing, so LemmaScript and Dafny check its contracts
// (LemmaScript-files.txt, docs/verification.md); the rule in src/server/rules/offer-deposit.ts calls it and turns its
// answer into a refusal, and tests/lib/software-deposit-block.test.ts holds it to the batch guard's SQL
// (`depositOfferGuard`) and to `depositOfferBlock` for every status, kind, milestone, refund and offer status.
//
// The rule in sentences (decision 9 of docs/plans/2026-11-discount-flow.md): only a first-milestone deposit that is not
// refunded counts, on any offer version of the request. Sending new terms is stopped while one is creating, open,
// payment_failed or uncollectible (it may still be charged) or paid; declining is stopped only while one may still be
// charged. The sentence: an open one first; otherwise a paid one whose offer is the sent one; otherwise a paid one on an
// earlier offer.

/** One invoice of the request, as the decision reads it. */
export type DepositInvoice = {
	/** The milestone it bills, from 0. */
	milestoneIndex: number;
	/** deposit, balance or milestone. */
	kind: string;
	/** creating, open, paid, payment_failed, void or uncollectible. */
	status: string;
	/** Whether a refund of it is recorded. */
	refunded: boolean;
	/** The status of the offer version it bills: draft, sent, superseded or withdrawn. */
	offerStatus: string;
};

/** What stops the action: nothing ("clear"; the tool's Dafny already has a `None`), a deposit that may still be charged, one paid on the sent offer, or one paid earlier. */
export type DepositBlock = "clear" | "open" | "paidOnSent" | "paidEarlier";

/** The only invoice that counts: the first milestone's deposit, not refunded. */
export function countsAsFirstDeposit(invoice: DepositInvoice): boolean {
	//@ verify
	//@ ensures \result <==> (invoice.milestoneIndex === 0 && invoice.kind === "deposit" && !invoice.refunded)
	return (
		invoice.milestoneIndex === 0 &&
		invoice.kind === "deposit" &&
		!invoice.refunded
	);
}

/** A status Stripe may still charge: the invoice is being made, is open, failed a payment, or is uncollectible. */
export function mayStillBeCharged(status: string): boolean {
	//@ verify
	//@ ensures \result <==> (status === "creating" || status === "open" || status === "payment_failed" || status === "uncollectible")
	return (
		status === "creating" ||
		status === "open" ||
		status === "payment_failed" ||
		status === "uncollectible"
	);
}

/** Whether one of the first `n` invoices is a first deposit that may still be charged. */
export function openDepositIn(invoices: DepositInvoice[], n: number): boolean {
	//@ verify
	//@ type n nat
	//@ requires n <= invoices.length
	//@ ensures \result <==> exists(i: nat, i < n && countsAsFirstDeposit(invoices[i]) && mayStillBeCharged(invoices[i].status))
	//@ decreases n
	if (n === 0) return false;
	// SAFETY: n is at most invoices.length and at least 1 here, so index n - 1 is in the array.
	const invoice = invoices[n - 1] as DepositInvoice;

	return (
		(countsAsFirstDeposit(invoice) && mayStillBeCharged(invoice.status)) ||
		openDepositIn(invoices, n - 1)
	);
}

/** Whether one of the first `n` invoices is a paid first deposit, and with `onSent`, one whose offer is the sent one. */
export function paidDepositIn(
	invoices: DepositInvoice[],
	n: number,
	onSent: boolean,
): boolean {
	//@ verify
	//@ type n nat
	//@ requires n <= invoices.length
	//@ ensures \result <==> exists(i: nat, i < n && countsAsFirstDeposit(invoices[i]) && invoices[i].status === "paid" && (!onSent || invoices[i].offerStatus === "sent"))
	//@ ensures (onSent && \result) ==> paidDepositIn(invoices, n, false)
	//@ decreases n
	if (n === 0) return false;
	// SAFETY: n is at most invoices.length and at least 1 here, so index n - 1 is in the array.
	const invoice = invoices[n - 1] as DepositInvoice;

	return (
		(countsAsFirstDeposit(invoice) &&
			invoice.status === "paid" &&
			(!onSent || invoice.offerStatus === "sent")) ||
		paidDepositIn(invoices, n - 1, onSent)
	);
}

/**
 * What stops new terms (`decline` false) or a decline (`decline` true), given every invoice of the request. Checked by
 * Dafny for every input, with the two searches above (whose own contracts say what they find, over every invoice): a
 * decline is stopped exactly when a first deposit may still be charged; new terms exactly when one may still be charged
 * or one is paid, on any version; and the answer is "open" whenever one may still be charged, otherwise "paidOnSent" when
 * a paid one's offer is the sent one, otherwise "paidEarlier".
 */
export function depositBlock(
	invoices: DepositInvoice[],
	decline: boolean,
): DepositBlock {
	//@ verify
	//@ ensures (\result === "open") <==> openDepositIn(invoices, invoices.length)
	//@ ensures decline ==> (\result === "clear" || \result === "open")
	//@ ensures !decline ==> ((\result !== "clear") <==> (openDepositIn(invoices, invoices.length) || paidDepositIn(invoices, invoices.length, true) || paidDepositIn(invoices, invoices.length, false)))
	//@ ensures (\result === "paidOnSent") <==> (!decline && !openDepositIn(invoices, invoices.length) && paidDepositIn(invoices, invoices.length, true))
	//@ ensures (\result === "paidEarlier") <==> (!decline && !openDepositIn(invoices, invoices.length) && !paidDepositIn(invoices, invoices.length, true) && paidDepositIn(invoices, invoices.length, false))
	if (openDepositIn(invoices, invoices.length)) return "open";

	if (decline) return "clear";

	if (paidDepositIn(invoices, invoices.length, true)) return "paidOnSent";

	if (paidDepositIn(invoices, invoices.length, false)) return "paidEarlier";

	return "clear";
}
