import { liveSigningGuard, type AgreementSession } from "./agreement-access";
import { parseDraft, states } from "./agreement-draft-fields";
import { sessionGuard } from "./software-agreements";
import type { SoftwareOffer } from "./software-offers";
import type { OwnerRequest } from "./owner-model";

export function prefillAgreementDraft(
	request: OwnerRequest,
	previous?: Record<string, unknown>,
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

export async function saveAgreementDraft(
	db: D1Database,
	offer: SoftwareOffer,
	session: AgreementSession,
	input: unknown,
) {
	const draft = parseDraft(input);
	await db.batch([
		liveSigningGuard(db, offer.id, session.link_hash!, session.recipient_email),
		sessionGuard(db, session),
		db
			.prepare(
				`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND status IN ('client_signed','executed')) THEN 1 ELSE json_extract('Already signed','$') END`,
			)
			.bind(offer.id),
		db
			.prepare(
				"INSERT INTO software_agreement_drafts(offer_id,recipient_email,values_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(offer_id,recipient_email) DO UPDATE SET values_json=excluded.values_json,updated_at=excluded.updated_at",
			)
			.bind(
				offer.id,
				session.recipient_email,
				JSON.stringify(draft),
				new Date().toISOString(),
			),
	]);

	return draft;
}
