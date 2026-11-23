import { agreementEvent } from "./agreement-events";
import type { SoftwareOffer } from "./software-offers";
import { softwareGuard } from "./software-guard";
import { parseContractor } from "./agreement-fields";
import { consentText, intentText } from "./agreement-client-fields";
import { validateAgreementCharacters } from "./agreement-templates";
import casefold from "./agreement-casefold.json";
import { ReaderMessage, stored } from "./reader-message";

export const legalNameKey = (value: string) =>
	[...value.trim().normalize("NFC")]
		.map(
			// SAFETY: agreement-casefold.json maps single characters to folded strings; a character it does not list reads undefined, which the ?? falls back from.
			(c) => (casefold.mapping as Record<string, string>)[c] ?? c.toLowerCase(),
		)
		.join("");

export function abandonUnsignedAgreementReviews(
	db: D1Database,
	requestId: string,
	at: string,
) {
	return db
		.prepare(
			"UPDATE software_agreements SET status='abandoned',abandoned_at=?,abandoned_reason='Offer link changed',ended_at=?,retain_until=? WHERE request_id=? AND status='review'",
		)
		.bind(
			at,
			at,
			new Date(Date.parse(at) + 90 * 86400000).toISOString(),
			requestId,
		);
}

export function retireRequestSigning(
	db: D1Database,
	requestId: string,
	at: string,
) {
	return [
		abandonUnsignedAgreementReviews(db, requestId, at),
		db
			.prepare(
				"DELETE FROM software_agreement_drafts WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id=?)",
			)
			.bind(requestId),
		db
			.prepare(
				"UPDATE software_agreement_sessions SET revoked_at=? WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id=?) AND revoked_at IS NULL",
			)
			.bind(at, requestId),
		db
			.prepare(
				"UPDATE software_agreement_links SET used_at=? WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id=?) AND used_at IS NULL",
			)
			.bind(at, requestId),
	];
}

export type Agreement = {
	id: string;
	kind: "msa" | "sow";
	offer_id: string;
	request_id: string;
	client_id: string;
	template_id: string;
	msa_id: string | null;
	status: "review" | "client_signed" | "executed" | "abandoned";
	canonical_text: string;
	text_sha256: string;
	values_json: string;
	effective_on: string;
	executed_at: string | null;
	review_session_hash: string;
	attachment_manifest_json: string;
	terminated_at: string | null;
};

export async function offerAgreements(db: D1Database, id: string) {
	return (
		await db
			.prepare(
				"SELECT * FROM software_agreements WHERE offer_id=? AND status<>'abandoned' ORDER BY kind",
			)
			.bind(id)
			.all<Agreement>()
	).results;
}

export const signatureIds = (documents: { id: string; hash: string }[]) =>
	JSON.stringify(
		documents
			.map((d) => ({ id: d.id, hash: d.hash }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	);

function reusedMsaGuard(db: D1Database, offer: SoftwareOffer) {
	return offer.reused_msa_id
		? [
				softwareGuard(
					db,
					"SELECT 1 FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL",
					[offer.reused_msa_id],
				),
			]
		: [];
}

function signatureInsert(
	db: D1Database,
	a: Agreement,
	party: string,
	name: string,
	title: string,
	legalParty: string,
	email: string,
	verified: string,
	session: string | null,
	owner: string | null,
	receipt: string,
	at: string,
	documents: { id: string; hash: string }[],
	request: Request,
) {
	validateAgreementCharacters(name + title);

	const ip = request.headers.get("cf-connecting-ip") ?? "",
		ua = request.headers.get("user-agent") ?? "";

	if (ip.length > 100 || ua.length > 2000 || /[\x00-\x1f\x7f]/.test(ip + ua))
		throw new ReaderMessage("Browser evidence exceeds its limits.");

	return db
		.prepare(
			`INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,session_token_hash,owner_subject,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES(?,?,?,?,?,?,'website-signing-v3',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		)
		.bind(
			crypto.randomUUID(),
			a.id,
			party,
			name,
			title,
			consentText(legalParty, party === "contractor"),
			at,
			at,
			a.text_sha256,
			session,
			owner,
			email,
			verified,
			party === "client"
				? "verified by one-time email link"
				: "verified by owner authentication",
			intentText(
				party === "contractor",
				documents.length === 1 && a.kind === "sow",
			),
			signatureIds(documents),
			receipt,
			ip,
			ua,
		);
}

// Failed means this uncertain notice is obsolete, not confirmed undelivered.
export function closeObsoleteAgreementNotifications(
	db: D1Database,
	agreementId: string,
	state: "executed" | "abandoned",
	actor: string,
	at: string,
) {
	return [
		db
			.prepare(
				"INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at,reason) SELECT ?,?,'delivery-failed',?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_notifications WHERE agreement_id=? AND status='sending')",
			)
			.bind(
				crypto.randomUUID(),
				agreementId,
				actor,
				at,
				`obsolete-signing-notice:${state}`,
				agreementId,
			),
		db
			.prepare(
				"UPDATE software_agreement_notifications SET status='failed' WHERE agreement_id=? AND status='sending'",
			)
			.bind(agreementId),
	];
}

/**
 * The owner's countersignature on the client-signed documents, in one batch; answers the SOW's id. The read and the batch
 * that the database rejects throw a StoreRejected carrying the rejection, which the owner route sorts (a guard, a unique
 * index, a foreign key, a NOT NULL value or a trigger's raise keep its 409; anything else is a fault of the site); every
 * refusal the code makes throws as itself.
 */
export async function countersignAgreements(
	db: D1Database,
	offer: SoftwareOffer,
	documents: { id: string; hash: string }[],
	name: string,
	actor: string,
	request: Request,
) {
	const agreements = await stored(offerAgreements(db, offer.id)),
		pending = agreements.filter((a) => a.status === "client_signed");

	if (
		!pending.length ||
		signatureIds(pending.map((a) => ({ id: a.id, hash: a.text_sha256 }))) !==
			signatureIds(documents)
	)
		throw new ReaderMessage(
			"The pending documents changed. Reload before countersigning.",
		);

	const at = new Date().toISOString(),
		receipt = crypto.randomUUID(),
		config = parseContractor(
			(({ config_version, ...values }) => values)(
				JSON.parse(offer.contractor_snapshot_json!),
			),
		),
		sow = pending.find((a) => a.kind === "sow")!;

	// The statements are built first, so a refusal while building one (the evidence, the signer's characters) throws as
	// itself; only the batch's own rejection is marked as the store's.
	const statements = [
		softwareGuard(
			db,
			"SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND r.status NOT IN ('withdrawn','resolved') AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)",
			[offer.id],
		),
		...reusedMsaGuard(db, offer),
		...pending.flatMap((a) => [
			softwareGuard(
				db,
				"SELECT 1 FROM software_agreements WHERE id=? AND status='client_signed' AND text_sha256=?",
				[a.id, a.text_sha256],
			),
			signatureInsert(
				db,
				a,
				"contractor",
				name,
				config.signer_title,
				config.legal_name,
				actor.trim().toLowerCase(),
				at,
				null,
				actor,
				receipt,
				at,
				documents,
				request,
			),
			agreementEvent(db, "countersigned", actor, at, a.id, offer.id),
			...closeObsoleteAgreementNotifications(db, a.id, "executed", actor, at),
			db
				.prepare(
					"UPDATE software_agreements SET status='executed',executed_at=? WHERE id=?",
				)
				.bind(at, a.id),
		]),
		...pending.map((a) =>
			db
				.prepare(
					"INSERT INTO software_agreement_artifacts(agreement_id) VALUES(?)",
				)
				.bind(a.id),
		),
		...(["client", "contractor"] as const).map((role) =>
			db
				.prepare(
					"INSERT INTO software_agreement_deliveries(agreement_id,recipient_role,email) VALUES(?,?,?)",
				)
				.bind(
					sow.id,
					role,
					role === "client"
						? offer.recipient_email_snapshot
						: config.notice_email,
				),
		),
	];

	await stored(db.batch(statements));

	return sow.id;
}

export async function executedOfferAgreement(db: D1Database, offerId: string) {
	return db
		.prepare(
			`SELECT a.* FROM software_agreements a JOIN software_agreement_artifacts f ON f.agreement_id=a.id WHERE a.offer_id=? AND a.kind='sow' AND a.status='executed' AND a.ended_at IS NULL AND a.archive_closed_at IS NULL AND f.status='ready' AND (SELECT count(*) FROM software_agreement_deliveries d WHERE d.agreement_id=a.id AND (d.status='sent' OR d.alternate_delivered_at IS NOT NULL))=2`,
		)
		.bind(offerId)
		.first<Agreement>();
}
