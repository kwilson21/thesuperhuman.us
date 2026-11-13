// FROZEN REFERENCE COPY. This is the Zod 3 validator exactly as it ran before the Effect Schema conversion (PR 7 of the
// Effect stack), kept only so tests/server/validators-differential.test.ts can require the Effect version to answer
// every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
// No live imports from src: this copy is self-contained.
import { z } from "astro/zod";

export const legacyCleanText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((v) => v.normalize("NFC"))
		.refine(
			(v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(v),
			"Remove control characters.",
		);

export const legacyRequired = (max: number) =>
	legacyCleanText(max).refine(Boolean, "This answer is required.");

export const legacyEmail = z
	.string()
	.trim()
	.email()
	.max(320)
	.transform((v) => v.toLowerCase());

export const legacyClientAgreementSchema = z
	.object({
		legal_name: legacyRequired(200),
		entity_type: legacyRequired(200),
		jurisdiction: legacyRequired(100),
		business_address: legacyRequired(1000),
		notice_email: legacyEmail,
		reviewer_name: legacyRequired(200),
		reviewer_email: legacyEmail,
		approver_name: legacyRequired(200),
		approver_email: legacyEmail,
		signer_name: legacyRequired(200),
		signer_title: legacyRequired(200),
		portfolio: z.enum(["allow", "deny"]),
		naming: z.boolean().default(false),
	})
	.strict()
	.refine(
		(v) => v.portfolio === "allow" || !v.naming,
		"Naming requires portfolio permission.",
	);

export type LegacyClientAgreement = z.infer<typeof legacyClientAgreementSchema>;
