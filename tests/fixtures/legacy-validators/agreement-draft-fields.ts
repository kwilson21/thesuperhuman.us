// FROZEN REFERENCE COPY. This is the Zod 3 validator exactly as it ran before the Effect Schema conversion (PR 7 of the
// Effect stack), kept only so tests/server/validators-differential.test.ts can require the Effect version to answer
// every input as this one does. It is not product code: nothing under src/ may import it
// (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
// Live imports from src: `businessTypes`, `states` and `fieldMessages` (lists and sentences, data) and the type `RawValue`.
// A later edit to those moves both sides of the differential together. The validators themselves are frozen here.
import { z } from "astro/zod";
import type { RawValue } from "../../../src/lib/fields";
import {
	businessTypes,
	fieldMessages,
	states,
} from "../../../src/lib/agreement-draft-fields";
import {
	legacyCleanText,
	legacyClientAgreementSchema,
} from "./agreement-client-fields";

export const legacyDraftSchema = z
	.object({
		legal_name: legacyCleanText(200).default(""),
		entity_type: legacyCleanText(200).default(""),
		state: legacyCleanText(100).default(""),
		country: legacyCleanText(100).default(""),
		business_address: legacyCleanText(1000).default(""),
		signer_name: legacyCleanText(200).default(""),
		signer_title: legacyCleanText(200).default(""),
		portfolio_choice: z.enum(["private", "anonymous", "named", ""]).default(""),
		reviewer_name: legacyCleanText(200).default(""),
		reviewer_email: legacyCleanText(320).default(""),
		approver_name: legacyCleanText(200).default(""),
		approver_email: legacyCleanText(320).default(""),
		notice_email: legacyCleanText(320).default(""),
	})
	.strict();

export type LegacyAgreementDraft = z.infer<typeof legacyDraftSchema>;

export function legacyDraftFieldErrors(issues: z.ZodIssue[]) {
	const errors: Record<string, string> = {};

	for (const issue of issues) {
		const field = String(issue.path[0] ?? "legal_name");
		errors[field] =
			issue.message === "Remove control characters."
				? "Remove unusual characters from this field."
				: "Check this field.";
	}

	return errors;
}

export function legacyResolveClientDetails(input: RawValue, email: string) {
	const parsed = legacyDraftSchema.safeParse(input);

	if (!parsed.success)
		return {
			ok: false as const,
			errors: legacyDraftFieldErrors(parsed.error.issues),
		};
	const draft = parsed.data;

	const client = legacyClientAgreementSchema.safeParse({
		legal_name: draft.legal_name,
		entity_type: draft.entity_type,
		jurisdiction:
			draft.state === "Outside the US" ? draft.country : draft.state,
		business_address: draft.business_address,
		signer_name: draft.signer_name,
		signer_title: draft.signer_title,
		notice_email: draft.notice_email || email,
		reviewer_name: draft.reviewer_name || draft.signer_name,
		reviewer_email: draft.reviewer_email || email,
		approver_name: draft.approver_name || draft.signer_name,
		approver_email: draft.approver_email || email,
		portfolio: draft.portfolio_choice === "private" ? "deny" : "allow",
		naming: draft.portfolio_choice === "named",
	});

	const errors: Record<string, string> = {};

	if (!client.success)
		for (const issue of client.error.issues) {
			const field =
				String(issue.path[0]) === "jurisdiction"
					? draft.state === "Outside the US"
						? "country"
						: "state"
					: String(issue.path[0]);

			errors[field] =
				issue.message === "Remove control characters."
					? "Remove unusual characters from this field."
					: issue.message === "This answer is required." ||
							issue.code === "invalid_string"
						? (fieldMessages[field] ?? "Check this field.")
						: "Check this field.";
		}

	if (!businessTypes.includes(draft.entity_type))
		errors.entity_type = fieldMessages.entity_type;

	if (!states.includes(draft.state)) errors.state = fieldMessages.state;

	if (!draft.portfolio_choice)
		errors.portfolio_choice = fieldMessages.portfolio_choice;

	return client.success && !Object.keys(errors).length
		? { ok: true as const, client: client.data }
		: { ok: false as const, errors };
}
