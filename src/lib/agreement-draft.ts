import { parseDraft, states } from "./agreement-draft-fields";
import type { OwnerRequest } from "./owner-model";
import type { JsonValue } from "./json-value";

/** Client answers saved with an earlier agreement, read back from stored JSON; parseDraft checks each value before use. */
export type PreviousClientDetails = Partial<
	Record<
		"jurisdiction" | "legal_name" | "entity_type" | "business_address",
		JsonValue
	>
>;

export function prefillAgreementDraft(
	request: OwnerRequest,
	previous?: PreviousClientDetails,
) {
	const jurisdiction = String(previous?.jurisdiction ?? "");

	return parseDraft({
		legal_name: previous?.legal_name ?? request.details.company ?? "",
		signer_name: request.name,
		entity_type: previous?.entity_type ?? "",
		state: jurisdiction
			? states.includes(jurisdiction)
				? jurisdiction
				: "Outside the US"
			: "",
		country: jurisdiction && !states.includes(jurisdiction) ? jurisdiction : "",
		business_address: previous?.business_address ?? "",
	});
}

export async function loadAgreementDraft(
	db: D1Database,
	offerId: string,
	email: string,
) {
	const saved = await db
		.prepare(
			"SELECT values_json FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=?",
		)
		.bind(offerId, email)
		.first<{ values_json: string }>();

	return saved ? parseDraft(JSON.parse(saved.values_json)) : null;
}
