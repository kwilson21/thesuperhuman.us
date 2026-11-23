import { agreementEvent } from "./agreement-events";
import type { SoftwareOffer } from "./software-offers";
import { softwareGuard } from "./software-guard";
import { parseContractor } from "./agreement-fields";
import {
	parseClientAgreement,
	consentText,
	intentText,
} from "./agreement-client-fields";
import { validateAgreementCharacters } from "./agreement-templates";
import { liveSigningGuard, type AgreementSession } from "./agreement-access";
import casefold from "./agreement-casefold.json";
import {
	LostRace,
	ReaderMessage,
	StoreRejected,
	stored,
} from "./reader-message";

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

export function sessionGuard(db: D1Database, s: AgreementSession) {
	return softwareGuard(
		db,
		"SELECT 1 FROM software_agreement_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL",
		[s.token_hash, new Date().toISOString()],
	);
}

export const signatureIds = (documents: { id: string; hash: string }[]) =>
	JSON.stringify(
		documents
			.map((d) => ({ id: d.id, hash: d.hash }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	);

/**
 * The client's signatures on the reviewed documents, in one batch; answers the receipt id. A read or the batch that the
 * database rejects throws a StoreRejected carrying the rejection (the route answers a guard or a unique index as a
 * changed agreement, anything else as a fault of the site), except a foreign key failure of the batch, a LostRace (see
 * signingBatchRejected); every refusal the code makes throws as itself.
 */
export async function signAgreements(
	db: D1Database,
	offer: SoftwareOffer,
	session: AgreementSession,
	documents: { id: string; hash: string }[],
	request: Request,
) {
	const agreements = await stored(offerAgreements(db, offer.id)),
		toSign = agreements.filter((a) => a.status !== "executed");

	if (
		!toSign.length ||
		signatureIds(toSign.map((a) => ({ id: a.id, hash: a.text_sha256 }))) !==
			signatureIds(documents)
	)
		throw new ReaderMessage(
			"The reviewed documents changed. Review them again.",
		);

	if (toSign.every((a) => a.status === "client_signed")) {
		const saved = await stored(
			db
				.prepare(
					"SELECT receipt_id,session_token_hash FROM software_agreement_signatures WHERE agreement_id=? AND party='client'",
				)
				.bind(toSign[0].id)
				.first<{ receipt_id: string; session_token_hash: string }>(),
		);

		if (saved?.session_token_hash !== session.token_hash)
			throw new ReaderMessage("A different signing action is already saved.");

		return saved.receipt_id;
	}

	const values = JSON.parse(toSign[0].values_json),
		client = parseClientAgreement(values.client),
		at = new Date().toISOString(),
		receipt = crypto.randomUUID();

	const draft = await stored(
		db
			.prepare(
				"SELECT values_json FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=?",
			)
			.bind(offer.id, session.recipient_email)
			.first<{ values_json: string }>(),
	);

	if (draft) {
		const { resolveClientDetails } = await import("./agreement-draft-fields");

		const resolved = resolveClientDetails(
			JSON.parse(draft.values_json),
			session.recipient_email,
		);

		if (
			!resolved.ok ||
			JSON.stringify(resolved.client) !== JSON.stringify(client)
		)
			throw new ReaderMessage(
				"Your details changed. Review the agreement again.",
			);
	}

	// The statements are built first, so a refusal while building one (the evidence, the signer's characters) throws as
	// itself; only the batch's own rejection is sorted by signingBatchRejected.
	const statements = [
		liveSigningGuard(db, offer.id, session.link_hash!, session.recipient_email),
		sessionGuard(db, session),
		...(draft
			? [
					softwareGuard(
						db,
						"SELECT 1 FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=? AND values_json=?",
						[offer.id, session.recipient_email, draft.values_json],
					),
				]
			: []),
		...reusedMsaGuard(db, offer),
		db
			.prepare(
				`INSERT INTO software_agreement_notices(id,agreement_id,client_id,business_address,notice_email,recorded_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_clients WHERE id=? AND (business_address<>? OR notice_email<>?))`,
			)
			.bind(
				crypto.randomUUID(),
				toSign.find((a) => a.kind === "sow")!.id,
				toSign[0].client_id,
				client.business_address,
				client.notice_email,
				at,
				toSign[0].client_id,
				client.business_address,
				client.notice_email,
			),
		...toSign.flatMap((a) => [
			softwareGuard(
				db,
				"SELECT 1 FROM software_agreements WHERE id=? AND status='review' AND text_sha256=? AND review_session_hash=?",
				[a.id, a.text_sha256, session.token_hash],
			),
			signatureInsert(
				db,
				a,
				"client",
				client.signer_name,
				client.signer_title,
				client.legal_name,
				session.recipient_email,
				session.verified_at,
				session.token_hash,
				null,
				receipt,
				at,
				documents,
				request,
			),
			agreementEvent(
				db,
				"client-signed",
				session.token_hash,
				at,
				a.id,
				offer.id,
			),
			db
				.prepare(
					"UPDATE software_agreements SET status='client_signed',client_signed_at=? WHERE id=?",
				)
				.bind(at, a.id),
		]),
		db
			.prepare(
				"DELETE FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=?",
			)
			.bind(offer.id, session.recipient_email),
		db
			.prepare(
				"INSERT INTO software_agreement_notifications(agreement_id,kind,email) VALUES(?,'signature-receipt',?)",
			)
			.bind(toSign.find((a) => a.kind === "sow")!.id, session.recipient_email),
		db
			.prepare(
				"INSERT INTO software_agreement_notifications(agreement_id,kind,email) VALUES(?,'countersign-notice',?)",
			)
			.bind(
				toSign.find((a) => a.kind === "sow")!.id,
				values.contractor.notice_email,
			),
	];

	await db.batch(statements).catch(signingBatchRejected);

	return receipt;
}

/**
 * Sorts a rejected signing batch. Every row the batch refers to (the documents and their client) was read just before
 * it, so a foreign key fails only when another request deleted one since (another tab's review replaces the documents
 * this one reviewed): a lost race. Any other rejection is marked as the store's, for the route to sort.
 */
function signingBatchRejected<Failure>(failure: Failure): never {
	if (failure instanceof Error && /FOREIGN KEY/.test(failure.message))
		throw new LostRace("The reviewed documents were deleted since the read.");

	throw new StoreRejected(failure);
}

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
