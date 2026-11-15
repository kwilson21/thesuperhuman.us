// The deposit facts the offers area reads before it sends new terms or declines a request: the read (depositOfferBlock)
// and the batch guard that re-checks it at write time (depositOfferGuard). Here rather than in
// src/lib/software-invoices.ts so the offers code and the owner request status do not load Stripe.
import { softwareGuard } from "./software-guard";

/**
 * Why new terms can't be sent (or, with `decline`, why the request can't be declined), or null. Every offer version of
 * the request counts, not only the sent one: a decline withdraws the sent offer without waiting for a paid deposit, so
 * after a reopen a paid deposit sits on a withdrawn offer and must still stop new terms (decision 9 of
 * docs/plans/2026-11-discount-flow.md). A decline is stopped only by an open deposit.
 */
export async function depositOfferBlock(
	db: D1Database,
	id: string,
	decline = false,
) {
	const rows = await db
		.prepare(`SELECT i.status,o.status AS offer_status FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id
    WHERE i.request_id=? AND i.milestone_index=0 AND i.kind='deposit'
    AND i.refunded_at IS NULL AND i.status IN ('creating','open','payment_failed','uncollectible','paid')`)
		.bind(id)
		.all<{ status: string; offer_status: string }>();

	if (
		rows.results.some((row) =>
			["creating", "open", "payment_failed", "uncollectible"].includes(
				row.status,
			),
		)
	)
		return "Void the open deposit invoice in Stripe first, then send the new offer.";

	if (decline) return null;

	const paid = rows.results.filter((row) => row.status === "paid");

	if (paid.some((row) => row.offer_status === "sent"))
		return "A deposit is already paid for this offer. Start the project, or refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded. New terms can't be sent while an agreement is signed.";

	if (paid.length > 0)
		return "A deposit is paid on an earlier offer. Refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded before sending new terms.";

	return null;
}

/** The batch guard for depositOfferBlock: the same invoices, on any offer version of the request. */
export const depositOfferGuard = (
	db: D1Database,
	id: string,
	decline = false,
) =>
	softwareGuard(
		db,
		`SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id
   WHERE i.request_id=? AND i.milestone_index=0 AND i.kind='deposit'
   AND i.refunded_at IS NULL AND i.status IN (${decline ? "'creating','open','payment_failed','uncollectible'" : "'creating','open','payment_failed','uncollectible','paid'"}))`,
		[id],
	);
