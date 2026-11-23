// The deposit decision of the software offers area: whether a first-milestone deposit stops new terms from being sent,
// or a request from being declined, and which sentence says why. Written for docs/plans/2026-11-offers-conversion.md,
// section 7, from `depositOfferBlock` (src/lib/software-offer-deposit.ts), which reads the same decision in SQL and
// stays for the owner request status until that route converts. It imports nothing, so LemmaScript and Dafny check its
// contracts (LemmaScript-files.txt, docs/verification.md); the rule in src/server/rules/offer-deposit.ts calls it and
// turns its answer into a refusal. tests/lib/software-deposit-block.test.ts holds it to the batch guard's SQL
// (`depositOfferGuard`) for every status, kind, milestone, refund and offer status; tests/rules/offer-deposit.test.ts
// holds its sentence to `depositOfferBlock` for first-milestone deposits of every status, refund and offer status,
// singly and in pairs.
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

// The abandon decision of the signing area (docs/plans/2026-11-signing-conversion.md, section 7, "LemmaScript"): whether
// a first deposit stops the owner from abandoning a signing the client has signed. It is the guard A12 as the owner
// request route writes it today (`depositUse` in src/pages/api/owner/requests/[id]/agreement.ts), which looks at
// `refunded_at` only for a paid invoice: a first-milestone deposit of the offer that may still be charged blocks whether
// or not a refund is recorded, and a paid one blocks until its refund is recorded. It differs from `countsAsFirstDeposit`
// above, which leaves out every refunded invoice, for an unpaid invoice with a refund recorded; the conversion keeps A12's
// meaning, and aligning the two would be a behaviour change of its own. src/server/rules/agreement-abandon.ts calls it;
// tests/lib/software-deposit-block.test.ts holds it to A12's SQL on sqlite for every status, kind, milestone and refund.

/** One invoice of the offer, as the abandon decision reads it. */
export type OfferInvoice = {
	/** The milestone it bills, from 0. */
	milestoneIndex: number;
	/** deposit, balance or milestone. */
	kind: string;
	/** creating, open, paid, payment_failed, void or uncollectible. */
	status: string;
	/** Whether a refund of it is recorded. */
	refunded: boolean;
};

/** Whether one of the first `n` invoices is the first milestone's deposit and may still be charged, or is paid and not refunded. */
export function abandonDepositIn(invoices: OfferInvoice[], n: number): boolean {
	//@ verify
	//@ type n nat
	//@ requires n <= invoices.length
	//@ ensures \result <==> exists(i: nat, i < n && invoices[i].milestoneIndex === 0 && invoices[i].kind === "deposit" && (mayStillBeCharged(invoices[i].status) || (invoices[i].status === "paid" && !invoices[i].refunded)))
	//@ decreases n
	if (n === 0) return false;
	// SAFETY: n is at most invoices.length and at least 1 here, so index n - 1 is in the array.
	const invoice = invoices[n - 1] as OfferInvoice;

	return (
		(invoice.milestoneIndex === 0 &&
			invoice.kind === "deposit" &&
			(mayStillBeCharged(invoice.status) ||
				(invoice.status === "paid" && !invoice.refunded))) ||
		abandonDepositIn(invoices, n - 1)
	);
}

/**
 * Whether a first deposit stops the abandon, given every invoice of the offer. Checked by Dafny for every input, with the
 * search above (whose own contract says what it finds, over every invoice): it blocks exactly when some invoice is the
 * first milestone's deposit (milestone 0, kind `deposit`) and either may still be charged (creating, open,
 * payment_failed or uncollectible), refunded or not, or is paid and not refunded.
 */
export function abandonBlocked(invoices: OfferInvoice[]): boolean {
	//@ verify
	//@ ensures \result <==> abandonDepositIn(invoices, invoices.length)
	return abandonDepositIn(invoices, invoices.length);
}
