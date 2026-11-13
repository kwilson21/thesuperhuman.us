import { describe, expect, it } from "vitest";
import {
	type SoftwareInvoiceKind,
	softwareInvoiceTerms,
} from "~/lib/software-invoices";
import type { OfferTerms } from "~/lib/software-offers";
import {
	allowedMilestone,
	discountedInstallment,
	installmentOf,
	milestoneCharged,
	offerCharged,
} from "../fixtures/discount-installments";

// The discount design (docs/plans/2026-11-discount-flow.md) keeps `feeCents` as what the client pays for a milestone and
// records the discount beside it. So the installments of a discounted milestone are today's installments of its lower fee.
// These tests hold the reference rule (checked by Dafny through LemmaScript) to the live softwareInvoiceTerms, so the
// contract is about the code that runs, not about a copy of it.

const terms = (paymentMode: OfferTerms["paymentMode"], fees: number[]) =>
	({
		outcome: "A scheduling tool",
		summary: "A small tool",
		milestones: fees.map((feeCents, index) => ({
			name: `Milestone ${index + 1}`,
			deliverables: [`Deliverable ${index + 1}`],
			acceptance: ["It works"],
			feeCents,
		})),
		clientInputs: "",
		exclusions: "",
		timing: "",
		paymentMode,
	}) satisfies OfferTerms;

const plans = [
	{
		mode: "standard",
		standard: true,
		kinds: ["deposit", "balance"],
	},
	{ mode: "invoice", standard: false, kinds: ["milestone"] },
] as const satisfies readonly {
	mode: OfferTerms["paymentMode"];
	standard: boolean;
	kinds: readonly SoftwareInvoiceKind[];
}[];

// Odd and even cents, the minimum, round amounts and the maximum.
const fees = [
	100, 101, 199, 200, 999, 2_401, 240_000, 240_001, 99_999_999, 100_000_000,
];

describe("with no discount the reference rule is today's softwareInvoiceTerms", () => {
	for (const { mode, standard, kinds } of plans)
		for (const kind of kinds)
			it.each(fees)(`${mode} ${kind} of a %i cent milestone`, (fee) => {
				const live = terms(mode, [fee, 100, 101]);

				for (const milestone of [0, 1, 2]) {
					const feeCents = live.milestones[milestone].feeCents;
					const today = softwareInvoiceTerms(live, milestone, kind).amountCents;

					expect(installmentOf(feeCents, standard, kind)).toBe(today);
					expect(discountedInstallment(feeCents, 0, standard, kind)).toBe(
						today,
					);
				}
			});
});

describe("with a discount the installments are today's installments of the lower fee", () => {
	const cases = [
		[240_000, 40_000],
		[240_001, 1],
		[101, 1],
		[200, 100],
		[100_000_000, 99_999_900],
		[2_401, 2_300],
	] as const;

	for (const { mode, standard, kinds } of plans)
		for (const kind of kinds)
			it.each(cases)(`${mode} ${kind}: usual %i, discount %i`, (usual, off) => {
				const charged = terms(mode, [usual - off]);

				expect(discountedInstallment(usual, off, standard, kind)).toBe(
					softwareInvoiceTerms(charged, 0, kind).amountCents,
				);
			});
});

describe("the contract, sampled (Dafny checks it for every input)", () => {
	it("every allowed fee and discount gives whole, non-negative installments that sum to the fee less the discount", () => {
		// Plain checks collected into one list, so the 130,000 or so cases stay fast; the list must stay empty.
		const broken: string[] = [];

		for (let usual = 100; usual <= 460; usual++)
			for (let off = 0; usual - off >= 100; off++)
				for (const { standard, kinds } of plans) {
					const at = `usual ${usual}, discount ${off}, standard ${standard}`;
					let sum = 0;

					if (!allowedMilestone(usual, off)) broken.push(`${at}: refused`);

					for (const kind of kinds) {
						const amount = discountedInstallment(usual, off, standard, kind);

						if (
							!Number.isInteger(amount) ||
							amount < (standard ? 50 : 100) ||
							amount > installmentOf(usual, standard, kind)
						)
							broken.push(`${at}: ${kind} ${amount}`);
						sum += amount;
					}

					if (
						sum !== usual - off ||
						milestoneCharged(usual, off, standard) !== usual - off
					)
						broken.push(`${at}: sums to ${sum}`);
				}

		expect(broken).toEqual([]);
	});

	it("refuses a discount that leaves less than $1, or a usual fee over $1,000,000", () => {
		expect(allowedMilestone(240_000, 239_901)).toBe(false);
		expect(allowedMilestone(240_000, 240_000)).toBe(false);
		expect(allowedMilestone(240_000, -1)).toBe(false);
		expect(allowedMilestone(100_000_001, 1)).toBe(false);
		expect(allowedMilestone(0, 0)).toBe(true);
	});

	it("the whole offer is the usual total less every discount, to the cent", () => {
		const offers = [
			[240_000, 40_000, 0, 0, 0, 0],
			[120_001, 20_001, 60_000, 0, 60_001, 1],
			[100, 0, 101, 1, 199, 99],
			[100_000_000, 1, 100_000_000, 99_999_900, 100, 0],
		] as const;

		for (const [u1, d1, u2, d2, u3, d3] of offers)
			for (const { mode, standard, kinds } of plans) {
				const live = terms(
					mode,
					[u1 - d1, u2 - d2, u3 - d3].filter((_, index) =>
						index === 0 ? true : index === 1 ? u2 > 0 : u3 > 0,
					),
				);

				const invoiced = live.milestones.reduce(
					(total, _, milestone) =>
						total +
						kinds.reduce(
							(sum, kind) =>
								sum + softwareInvoiceTerms(live, milestone, kind).amountCents,
							0,
						),
					0,
				);

				expect(offerCharged(u1, d1, u2, d2, u3, d3, standard)).toBe(
					u1 + u2 + u3 - (d1 + d2 + d3),
				);
				expect(invoiced).toBe(u1 + u2 + u3 - (d1 + d2 + d3));
			}
	});
});
