// FROZEN REFERENCE COPY. This is the Zod 3 validator exactly as it ran before the Effect Schema conversion of the offer
// terms, kept only so tests/server/validators-differential.test.ts can require the Effect version (src/lib/software-offers.ts)
// to answer every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
// Live imports from src: the type `RawValue` only. `offerTotal`, which the check across fields calls, is frozen below.
import { z } from "astro/zod";
import type { RawValue } from "../../../src/lib/fields";

const text = (max: number, oneLine = false) =>
	z
		.string()
		.trim()
		.max(max, `Keep this under ${max} characters.`)
		.refine(
			(value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value),
			"Remove control characters.",
		)
		.refine((value) => !oneLine || !/[\r\n]/.test(value), "Use one line.");

const required = (max: number) =>
	text(max, true).refine(
		(value) => value.length > 0,
		"This answer is required.",
	);

const cents = z
	.number()
	.int("Use whole cents.")
	.min(100, "The fee must be at least $1.")
	.max(100_000_000, "The amount must be $1,000,000 or less.");

const estimateCents = z
	.number()
	.int("Use whole cents.")
	.min(0, "Use a non-negative amount.")
	.max(Number.MAX_SAFE_INTEGER, "Use a safe whole-cent amount.");

const lines = (max: number, count: number) =>
	z
		.array(required(max))
		.min(1, "Add at least one line.")
		.max(count, `Add no more than ${count} lines.`);

export const legacyOfferTermsSchema = z
	.object({
		outcome: required(120),
		summary: required(300),
		milestones: z
			.array(
				z.object({
					name: required(80),
					deliverables: lines(200, 8),
					acceptance: lines(300, 5),
					feeCents: cents,
					checkpoint: z
						.object({
							label: required(120),
							cancellationPercent: z
								.number()
								.int("Use a whole percentage.")
								.min(51, "Use a percentage from 51 to 95.")
								.max(95, "Use a percentage from 51 to 95."),
						})
						.optional(),
				}),
			)
			.min(1, "Add at least one milestone.")
			.max(3, "Add no more than 3 milestones."),
		clientInputs: text(1000),
		exclusions: text(1000),
		timing: text(500),
		paymentMode: z.enum(["standard", "invoice"], {
			errorMap: () => ({ message: "Choose a payment mode." }),
		}),
		projectRange: z
			.object({ lowCents: estimateCents, highCents: estimateCents })
			.optional(),
	})
	.superRefine((value, ctx) => {
		if (
			value.projectRange &&
			value.projectRange.lowCents > value.projectRange.highCents
		)
			ctx.addIssue({
				code: "custom",
				path: ["projectRange", "highCents"],
				message: "The high estimate must be at least the low estimate.",
			});

		if (
			value.projectRange &&
			value.projectRange.lowCents < legacyOfferTotal(value)
		)
			ctx.addIssue({
				code: "custom",
				path: ["projectRange", "lowCents"],
				message: "The estimate must be at least the offer total.",
			});
	});

export type LegacyOfferTerms = z.infer<typeof legacyOfferTermsSchema>;

/** `input` is whatever arrived, parsed from JSON; the schema is the only code that reads it. */
export function legacyValidateOfferTerms(input: RawValue) {
	const result = legacyOfferTermsSchema.safeParse(input, {
		errorMap: (issue) => ({
			message:
				issue.path[0] === "paymentMode"
					? "Choose a payment mode."
					: "This answer is required.",
		}),
	});

	if (result.success) {
		const errors: Record<string, string> = {};
		result.data.milestones.forEach((milestone, index) => {
			const normalized = milestone.deliverables.map((line) =>
				line.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase(),
			);

			if (new Set(normalized).size !== normalized.length)
				errors[`milestones.${index}.deliverables`] =
					"Each deliverable needs to be different.";
		});

		return Object.keys(errors).length
			? { ok: false as const, errors }
			: { ok: true as const, value: result.data };
	}

	return {
		ok: false as const,
		errors: Object.fromEntries(
			result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
		),
	};
}

// Frozen from src/lib/software-offers.ts: the total the check across fields compares the low estimate with.
const legacyOfferTotal = (terms: Pick<LegacyOfferTerms, "milestones">) =>
	terms.milestones.reduce((sum, milestone) => sum + milestone.feeCents, 0);
