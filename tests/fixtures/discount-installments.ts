// REFERENCE COPY of the money rule for an offer discount, written before the code (docs/plans/2026-11-discount-flow.md).
// It is not product code: nothing under src/ imports it. LemmaScript and Dafny check the contracts below
// (LemmaScript-files.txt, docs/verification.md), and tests/verification/discount-installments.test.ts holds the rule
// to today's softwareInvoiceTerms, so the contract is anchored to live behaviour and not to a copy of it.
//
// The rule in one sentence: a milestone's discount is a whole number of dollars taken off its usual fee (decision 6 of the
// plan: whole dollars, at least $1 off), the client pays the rest (at least $1, today's minimum fee), and that lower fee
// is split into installments exactly as today (the deposit is half, rounded down to the cent, and the balance is the
// rest; on invoice terms the milestone is one invoice). Arguments are plain numbers in cents, so a discount is a
// multiple of 100 (0 means none). The usual fee may have cents, as feeCents may today. Up to three milestones, as an
// offer allows; an absent milestone is 0 and 0.

/** The installment kinds of the two payment modes: standard is deposit then balance, invoice terms is one invoice. */
export type InstallmentKind = "deposit" | "balance" | "milestone";

/** Today's minimum milestone fee, in cents (offerTermsSchema: "The fee must be at least $1."). */
export const MINIMUM_FEE_CENTS = 100;

/** Today's maximum milestone fee, in cents (offerTermsSchema: "The amount must be $1,000,000 or less."). */
export const MAXIMUM_FEE_CENTS = 100_000_000;

/** One installment of a milestone whose fee (what the client pays for it) is `fee`, as softwareInvoiceTerms has it. */
export function installmentOf(
	fee: number,
	standard: boolean,
	kind: InstallmentKind,
): number {
	//@ verify
	//@ requires fee >= 0
	//@ requires standard ? (kind === "deposit" || kind === "balance") : kind === "milestone"
	//@ ensures \result >= 0 && \result <= fee
	if (!standard) return fee;

	const deposit = Math.floor(fee / 2);

	return kind === "deposit" ? deposit : fee - deposit;
}

/**
 * One installment after the discount. For every allowed fee and discount: it is a whole, non-negative number of cents;
 * it is never more than the same installment without the discount; and with no discount it is today's amount.
 */
export function discountedInstallment(
	usualFee: number,
	discount: number,
	standard: boolean,
	kind: InstallmentKind,
): number {
	//@ verify
	//@ requires discount >= 0 && discount % 100 === 0 && usualFee - discount >= 100 && usualFee <= 100000000
	//@ requires standard ? (kind === "deposit" || kind === "balance") : kind === "milestone"
	//@ ensures \result >= 0
	//@ ensures \result <= installmentOf(usualFee, standard, kind)
	//@ ensures discount === 0 ==> \result === installmentOf(usualFee, standard, kind)
	//@ ensures (standard && kind === "deposit") ==> \result >= 50
	return installmentOf(usualFee - discount, standard, kind);
}

/** What the client pays for one milestone: the sum of its installments in the payment mode. */
export function milestoneCharged(
	usualFee: number,
	discount: number,
	standard: boolean,
): number {
	//@ verify
	//@ requires discount >= 0 && discount % 100 === 0 && usualFee - discount >= 100 && usualFee <= 100000000
	//@ ensures \result === usualFee - discount
	return standard
		? discountedInstallment(usualFee, discount, true, "deposit") +
				discountedInstallment(usualFee, discount, true, "balance")
		: discountedInstallment(usualFee, discount, false, "milestone");
}

/**
 * An allowed milestone: absent (0 and 0), or a usual fee and a whole-dollar discount (none, or at least $1) that leave
 * the client at least $1 to pay.
 */
export function allowedMilestone(usualFee: number, discount: number): boolean {
	//@ verify
	//@ ensures \result <==> ((usualFee === 0 && discount === 0) || (discount >= 0 && discount % 100 === 0 && usualFee - discount >= 100 && usualFee <= 100000000))
	return (
		(usualFee === 0 && discount === 0) ||
		(discount >= 0 &&
			discount % 100 === 0 &&
			usualFee - discount >= MINIMUM_FEE_CENTS &&
			usualFee <= MAXIMUM_FEE_CENTS)
	);
}

/** What the client pays for one milestone, or 0 for an absent one. */
function chargedOrNone(
	usualFee: number,
	discount: number,
	standard: boolean,
): number {
	//@ verify
	//@ requires (usualFee === 0 && discount === 0) || (discount >= 0 && discount % 100 === 0 && usualFee - discount >= 100 && usualFee <= 100000000)
	//@ ensures \result === usualFee - discount
	return usualFee === 0 ? 0 : milestoneCharged(usualFee, discount, standard);
}

/**
 * The whole offer: every installment of every milestone, added up, is exactly the usual total less the discount, to the
 * cent. Milestone 1 is always present; milestones 2 and 3 may be absent.
 */
export function offerCharged(
	usual1: number,
	discount1: number,
	usual2: number,
	discount2: number,
	usual3: number,
	discount3: number,
	standard: boolean,
): number {
	//@ verify
	//@ requires discount1 >= 0 && discount1 % 100 === 0 && usual1 - discount1 >= 100 && usual1 <= 100000000
	//@ requires (usual2 === 0 && discount2 === 0) || (discount2 >= 0 && discount2 % 100 === 0 && usual2 - discount2 >= 100 && usual2 <= 100000000)
	//@ requires (usual3 === 0 && discount3 === 0) || (discount3 >= 0 && discount3 % 100 === 0 && usual3 - discount3 >= 100 && usual3 <= 100000000)
	//@ ensures \result === (usual1 + usual2 + usual3) - (discount1 + discount2 + discount3)
	//@ ensures \result >= 100
	return (
		milestoneCharged(usual1, discount1, standard) +
		chargedOrNone(usual2, discount2, standard) +
		chargedOrNone(usual3, discount3, standard)
	);
}
