// The installment arithmetic of a software milestone: which invoices the payment mode allows, what each one charges and
// when it is due. Pure, so the agreement fields, the client project page and the invoice code share it without loading
// Stripe (src/lib/software-invoices.ts keeps the Stripe calls and the invoice storage).
import type { OfferTerms } from "./software-offers";
import { ReaderMessage } from "./reader-message";

export type SoftwareInvoiceKind = "deposit" | "balance" | "milestone";

export function softwareInvoiceTerms(
	terms: OfferTerms,
	milestone: number,
	kind: SoftwareInvoiceKind,
) {
	const item = terms.milestones[milestone];

	if (
		!["deposit", "balance", "milestone"].includes(kind) ||
		!Number.isInteger(milestone) ||
		milestone < 0 ||
		!item ||
		(terms.paymentMode === "standard"
			? kind === "milestone"
			: kind !== "milestone")
	) {
		throw new ReaderMessage(
			"Choose an invoice from the agreed milestone payment schedule.",
		);
	}

	const deposit = Math.floor(item.feeCents / 2);

	const daysUntilDue = kind === "deposit" ? 7 : kind === "balance" ? 15 : 30;

	return {
		amountCents:
			kind === "deposit"
				? deposit
				: kind === "balance"
					? item.feeCents - deposit
					: item.feeCents,
		daysUntilDue,
	};
}
