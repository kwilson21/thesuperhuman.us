import { z } from "astro/zod";

// The pieces of the agreement flow that run in the browser: the client's own validator and the consent text. Pure,
// with no server imports, so a browser entry can import them without the invoicing, e-mail or session code.

export const cleanText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((v) => v.normalize("NFC"))
		.refine(
			(v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(v),
			"Remove control characters.",
		);

export const required = (max: number) =>
	cleanText(max).refine(Boolean, "This answer is required.");

export const email = z
	.string()
	.trim()
	.email()
	.max(320)
	.transform((v) => v.toLowerCase());

export const clientAgreementSchema = z
	.object({
		legal_name: required(200),
		entity_type: required(200),
		jurisdiction: required(100),
		business_address: required(1000),
		notice_email: email,
		reviewer_name: required(200),
		reviewer_email: email,
		approver_name: required(200),
		approver_email: email,
		signer_name: required(200),
		signer_title: required(200),
		portfolio: z.enum(["allow", "deny"]),
		naming: z.boolean().default(false),
	})
	.strict()
	.refine(
		(v) => v.portfolio === "allow" || !v.naming,
		"Naming requires portfolio permission.",
	);

export type ClientAgreement = z.infer<typeof clientAgreementSchema>;

export const consentText = (party: string, owner = false) =>
	owner
		? "I agree to sign and receive these documents electronically, and I’m authorized to sign for The Superhuman Group LLC."
		: `I agree to sign and receive these documents electronically, and I’m authorized to sign for ${party}, a business. I can download and keep a complete copy.`;

export const intentText = (owner = false, sowOnly = false) =>
	owner
		? `Countersigning applies your name above as your electronic signature on the ${sowOnly ? "statement of work" : "agreement and statement of work"} you reviewed.`
		: `Signing applies your name above as your electronic signature on the ${sowOnly ? "statement of work" : "agreement and statement of work"} linked above.`;
