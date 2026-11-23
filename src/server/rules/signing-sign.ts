// The client's signature on the documents they reviewed (docs/plans/2026-11-signing-conversion.md, section 2, the
// `signing-sign.ts` row, and section 3, "signSigningDocuments"): today's `signAgreements`, `signatureInsert` and
// `reusedMsaGuard` (src/lib/software-agreements.ts), called by POST /api/offer/[token]/sign once the session, the signing
// setting, the body and the nonce have passed. Its reads come between its decisions, so the rule is staged, each stage
// deciding on what was read so far, in the order today's code answers:
//   1. the offer's agreements (the abandoned left out, in kind order) and the documents named: DocumentsChanged; when
//      every document still to sign is client_signed the saved receipt is read next, otherwise the first document's
//      stored values are read: StoredDataRefused (documentsToSign);
//   2. a repeat: the saved client signature of the first document: SignedElsewhere, else its receipt is the answer
//      (savedReceipt);
//   3. the client's saved draft, then each statement of the batch as today's code builds it: DetailsChanged,
//      DocumentsChanged (no SOW among the documents to sign), NameNotPrintable, EvidenceTooLong, StoredDataRefused (the
//      contractor's notice email) (signDocuments), which writes the batch;
//   4. read just before the batch, what only its guards checked before (plan, section 2, "read first, same answer"):
//      the offer's signing state (A1, through `openForSigning`: SigningOff, OfferUnavailable, SigningStarted), the
//      session at `at` (A2, through `openSession`: SessionNotOpen), the MSA the offer reuses (A8) and each document still
//      in review by this session (A9): DocumentsChanged (stillSignable).
// Every refusal answers the sign route's one 409, "The reviewed agreement changed. Reload and review it again." (today's
// catch, sign.ts); the sentences today's code throws inside `signAgreements` never reach a client, so each refusal here
// says the route's sentence. Re-checked at write time, in the batch, by A1 (the live signing guard), A2 (the session
// guard), A7 (the draft as read), A8 (the reused MSA) and A9 (each document in review with the hash and review session
// read); a refused guard is not retried. The signature and notice UNIQUE constraints back no fact read here and are
// not decided again. The notice is inserted only where the client row it names has another address or notice email:
// that EXISTS is a write-time filter that refuses nothing, kept in SQL as today. The time and every new id are inputs.
import * as Data from "effect/Data";
import {
	type ClientAgreement,
	consentText,
	intentText,
	parseClientAgreement,
} from "../../lib/agreement-client-fields";
import { resolveClientDetails } from "../../lib/agreement-draft-fields";
import { agreementCharacterSupported } from "../../lib/agreement-templates";
import { signatureIds } from "../../lib/software-agreements";
import type { SoftwareOffer } from "../../lib/software-offers";
import { isText } from "../../lib/type-guards";
import {
	AGREEMENT_MOVES,
	type AgreementStatus,
	agreementAllows,
} from "../machines/agreement-document";
import { alwaysWrites, term, unless } from "../terms";
import { openSession, type StoredAgreementSession } from "./agreement-session";
import { openForSigning, type SigningStateRow } from "./signing-offer";
import { proved } from "./software-request";

/** The sign route's one answer to every refusal (src/pages/api/offer/[token]/sign.ts). */
export const SIGNING_CHANGED =
	"The reviewed agreement changed. Reload and review it again.";

/**
 * The documents named are not the offer's documents still to sign with the hashes read (none left, one missing or extra,
 * a hash changed), no SOW is among them, the MSA the offer reuses ended (A8), or a document is no longer in review by
 * this session (A9).
 */
export class DocumentsChanged extends Data.TaggedError("DocumentsChanged") {
	readonly say = SIGNING_CHANGED;
}

/** Every document is client_signed, and the saved client signature is another session's, or there is none. */
export class SignedElsewhere extends Data.TaggedError("SignedElsewhere") {
	readonly say = SIGNING_CHANGED;
}

/** The client's saved draft no longer resolves to the client the documents were reviewed with. */
export class DetailsChanged extends Data.TaggedError("DetailsChanged") {
	readonly say = SIGNING_CHANGED;
}

/** The signer's name and title hold a character the agreement fonts cannot print. */
export class NameNotPrintable extends Data.TaggedError("NameNotPrintable") {
	readonly say = SIGNING_CHANGED;
}

/** The browser's address is over 100 characters, its user agent over 2,000, or either holds a control character. */
export class EvidenceTooLong extends Data.TaggedError("EvidenceTooLong") {
	readonly say = SIGNING_CHANGED;
}

/**
 * The stored values do not read: not JSON, `null`, a client the client reader refuses, or no contractor notice email
 * that is text.
 */
export class StoredDataRefused extends Data.TaggedError("StoredDataRefused") {
	readonly say = SIGNING_CHANGED;
}

/** An agreement document of the offer, as stored: the columns the signature reads. */
export type SigningDocumentRow = {
	readonly id: string;
	readonly kind: "msa" | "sow";
	readonly client_id: string;
	readonly status: AgreementStatus;
	readonly text_sha256: string;
	readonly values_json: string;
	readonly review_session_hash: string;
};

/** A document as the client names it: its id and the hash of the text they reviewed. */
export type NamedDocument = { readonly id: string; readonly hash: string };

/**
 * The stored values as today's code reads them: JSON, `values.client` through the client reader, and
 * `values.contractor.notice_email`, which is read last, when the batch's last statement is built.
 */
type StoredValues =
	| { readonly kind: "refused" }
	| {
			readonly kind: "read";
			readonly client: ClientAgreement;
			/** Null when the values have no contractor, or its notice email is not text. */
			readonly contractorNotice: string | null;
	  };

function storedValues(text: string): StoredValues {
	try {
		// Today's reads (signAgreements): text that is not JSON throws, and so does `values.client` of `null`.
		const values = JSON.parse(text);
		const client = parseClientAgreement(values.client);
		const contractor = values.contractor;

		return {
			kind: "read",
			client,
			contractorNotice:
				contractor === null ||
				contractor === undefined ||
				!isText(contractor.notice_email)
					? null
					: contractor.notice_email,
		};
	} catch {
		return { kind: "refused" };
	}
}

/** The documents a signature signs, with what their stored values say. */
export type DocumentsToSign =
	| {
			/** Every document still to sign is client_signed: the saved client signature of this one is read next. */
			readonly kind: "repeat";
			readonly agreementId: string;
	  }
	| {
			readonly kind: "sign";
			/** The documents to sign, in kind order (the MSA first). */
			readonly documents: readonly SigningDocumentRow[];
			/** The client, read from the first document's stored values. */
			readonly client: ClientAgreement;
			/** The contractor's notice email from the same values; null when it does not read (refused when the batch is built). */
			readonly contractorNotice: string | null;
	  };

type ChooseGiven = {
	readonly toSign: readonly SigningDocumentRow[];
	readonly named: readonly NamedDocument[];
	readonly repeat: boolean;
	readonly stored: StoredValues | null;
};

/** `ORDER BY kind`, as SQLite compares text (code unit by code unit); the sort is stable, so equal kinds keep the read order. */
const byKind = (a: SigningDocumentRow, b: SigningDocumentRow) =>
	Number(a.kind > b.kind) - Number(a.kind < b.kind);

const documentList = (documents: readonly NamedDocument[]) =>
	signatureIds(documents.map((d) => ({ id: d.id, hash: d.hash })));

/**
 * Stage 1: the documents still to sign are the offer's agreements that are neither abandoned (today's `offerAgreements`
 * filter, decided here) nor executed, in kind order, and must be exactly the documents named, with the hashes read.
 */
export const documentsToSign = alwaysWrites({
	name: "sign: the documents named are the offer's documents still to sign",
	given: (
		request: { readonly named: readonly NamedDocument[] },
		facts: readonly SigningDocumentRow[],
	): ChooseGiven => {
		const toSign = facts
			.filter((a) => a.status !== "abandoned")
			.sort(byKind)
			.filter((a) => a.status !== "executed");

		const repeat = toSign.every((a) => a.status === "client_signed");

		return {
			toSign,
			named: request.named,
			repeat,
			stored:
				toSign.length > 0 && !repeat
					? storedValues(toSign[0].values_json)
					: null,
		};
	},
	refusals: [
		unless(
			term(
				"a document is left to sign, and the documents named are exactly those, with the hashes read",
				(given: ChooseGiven) =>
					given.toSign.length > 0 &&
					documentList(
						given.toSign.map((a) => ({ id: a.id, hash: a.text_sha256 })),
					) === documentList(given.named),
			),
			() => new DocumentsChanged(),
		),
		unless(
			term(
				"every document is client_signed, or the first document's stored values read",
				(given: ChooseGiven) => given.repeat || given.stored?.kind === "read",
			),
			() => new StoredDataRefused(),
		),
	],
	writes: (given): DocumentsToSign => {
		if (given.repeat)
			return { kind: "repeat", agreementId: given.toSign[0].id };

		const stored = proved(given.stored?.kind === "read" ? given.stored : null);

		return {
			kind: "sign",
			documents: given.toSign,
			client: stored.client,
			contractorNotice: stored.contractorNotice,
		};
	},
	writesText:
		"the documents to sign with the client and the contractor's notice email, or the document whose saved receipt a repeat reads",
});

/** The client signature saved on a document, as stored: the receipt and the session that saved it. */
export type SavedSignatureRow = {
	readonly receipt_id: string;
	readonly session_token_hash: string | null;
};

type SavedGiven = {
	readonly token: string;
	readonly saved: SavedSignatureRow | null;
};

/** Stage 2, a repeat: the receipt saved with the first document's client signature, when this session saved it. */
export const savedReceipt = alwaysWrites({
	name: "sign again: the saved receipt, when this session saved the signature",
	given: (
		request: { readonly session: StoredAgreementSession },
		facts: SavedSignatureRow | null,
	): SavedGiven => ({ token: request.session.token_hash, saved: facts }),
	refusals: [
		unless(
			term(
				"the first document's client signature was saved by this session",
				(given: SavedGiven) =>
					given.saved !== null &&
					given.saved.session_token_hash === given.token,
			),
			() => new SignedElsewhere(),
		),
	],
	writes: (given) => proved(given.saved).receipt_id,
	writesText: "nothing: the saved receipt is the answer",
});

/** The new ids, drawn in today's order: the receipt, the notice, then each document's signature and event. */
export type SignIds = {
	readonly receipt: string;
	readonly notice: string;
	/** One pair per document to sign, in their order. */
	readonly documents: readonly {
		readonly signature: string;
		readonly event: string;
	}[];
};

export type SignRequest = {
	/** The signing time: the consent, the signature, the status, the event and the notice. */
	readonly at: string;
	readonly ids: SignIds;
	readonly session: StoredAgreementSession;
	readonly offer: Pick<SoftwareOffer, "id" | "reused_msa_id">;
	/** The documents the client named, as the body read them. */
	readonly named: readonly NamedDocument[];
	/** The browser evidence: the `cf-connecting-ip` and `user-agent` headers, null when absent. */
	readonly address: string | null;
	readonly userAgent: string | null;
};

/** The client's saved draft for the offer and the session's address, as stored. */
export type DraftRow = { readonly values_json: string };

export type SignFacts = {
	/** What `documentsToSign` answered for a signature. */
	readonly chosen: Extract<DocumentsToSign, { readonly kind: "sign" }>;
	/** The saved draft, or null when there is none. */
	readonly draft: DraftRow | null;
};

/** A client signature as the batch inserts it (`consent_version` is the statement's constant, 'website-signing-v3'). */
export type ClientSignature = {
	readonly id: string;
	readonly agreement_id: string;
	readonly party: "client";
	readonly typed_name: string;
	readonly title: string;
	readonly consent_text: string;
	readonly consent_at: string;
	readonly signed_at: string;
	readonly document_sha256: string;
	readonly session_token_hash: string;
	readonly owner_subject: null;
	readonly verified_email: string;
	readonly verified_at: string;
	readonly verification_method: string;
	readonly intent_text: string;
	readonly document_list_json: string;
	readonly receipt_id: string;
	readonly ip_address: string;
	readonly user_agent: string;
};

/** The event a signature records, as `agreementEvent` writes it. */
export type SignedEvent = {
	readonly id: string;
	readonly agreement_id: string;
	readonly offer_id: string;
	readonly action: "client-signed";
	readonly actor: string;
	readonly occurred_at: string;
	readonly reason: null;
};

/** One document signed: its signature, its event and its move to client_signed. */
export type SignedDocument = {
	readonly id: string;
	/** The hash read, which A9 re-checks with the review session. */
	readonly text_sha256: string;
	readonly signature: ClientSignature;
	readonly event: SignedEvent;
	/** Where SIGN leads (src/server/machines/agreement-document.ts). */
	readonly status: AgreementStatus;
	readonly client_signed_at: string;
};

/** The client's address and notice email, recorded on the SOW when the client row it names differs (the statement's filter). */
export type ClientNotice = {
	readonly id: string;
	readonly agreement_id: string;
	readonly client_id: string;
	readonly business_address: string;
	readonly notice_email: string;
	readonly recorded_at: string;
};

/** A signing notification queued on the SOW (`software_agreement_notifications`, pending by default). */
export type SigningNotification = {
	readonly agreement_id: string;
	readonly kind: "signature-receipt" | "countersign-notice";
	readonly email: string;
};

/** What the batch's guards are bound with, in the batch's order. */
export type SignGuards = {
	/** A1: the offer, the link the session came through, and its recipient. */
	readonly offerId: string;
	readonly linkHash: string | null;
	readonly recipient: string;
	/** A2: the session, unexpired and unrevoked as the batch is built. */
	readonly sessionTokenHash: string;
	/** A7: the draft's values as read; null when there was none, and then there is no guard, as today. */
	readonly draftValues: string | null;
	/** A8: the MSA the offer reuses; null when it names none (an empty id included, as today), and then there is no guard. */
	readonly reusedMsaId: string | null;
	/** A9: the statuses a document is signed from (the machine's SIGN list); each document carries its id and hash. */
	readonly signFrom: readonly AgreementStatus[];
};

/** The signing batch, in today's statement order. */
export type SignWrite = {
	readonly receiptId: string;
	readonly guards: SignGuards;
	readonly notice: ClientNotice;
	readonly documents: readonly SignedDocument[];
	/** The draft deleted: the offer and the session's address. */
	readonly draft: {
		readonly offer_id: string;
		readonly recipient_email: string;
	};
	readonly notifications: readonly [SigningNotification, SigningNotification];
};

type SignGiven = {
	readonly request: SignRequest;
	readonly documents: readonly SigningDocumentRow[];
	readonly client: ClientAgreement;
	readonly contractorNotice: string | null;
	readonly draft: DraftRow | null;
	readonly draftMatches: boolean;
	readonly sow: SigningDocumentRow | null;
	readonly address: string;
	readonly userAgent: string;
};

/**
 * Today's check of a saved draft: it reads, and resolves (the session's address filling the blanks) to exactly the
 * client the documents were reviewed with, compared as JSON text.
 */
function draftMatches(draft: DraftRow, email: string, client: ClientAgreement) {
	try {
		const resolved = resolveClientDetails(JSON.parse(draft.values_json), email);

		return (
			resolved.ok && JSON.stringify(resolved.client) === JSON.stringify(client)
		);
	} catch {
		return false;
	}
}

/** Where SIGN leads; a test holds it to the machine. */
const SIGNED: AgreementStatus = "client_signed";

const CONTROL = /[\x00-\x1f\x7f]/;

/**
 * Stage 3: the draft, then each statement of the batch, in the order today's code builds them: the notice (which names
 * the SOW), then for each document its signature (the signer's characters, then the browser evidence), and last the
 * countersign notice (the contractor's notice email).
 */
export const signDocuments = alwaysWrites({
	name: "sign: the client signs the documents they reviewed",
	given: (request: SignRequest, facts: SignFacts): SignGiven => ({
		request,
		documents: facts.chosen.documents,
		client: facts.chosen.client,
		contractorNotice: facts.chosen.contractorNotice,
		draft: facts.draft,
		draftMatches:
			facts.draft === null ||
			draftMatches(
				facts.draft,
				request.session.recipient_email,
				facts.chosen.client,
			),
		sow: facts.chosen.documents.find((a) => a.kind === "sow") ?? null,
		address: request.address ?? "",
		userAgent: request.userAgent ?? "",
	}),
	refusals: [
		unless(
			term(
				"there is no saved draft, or it resolves to the client the documents were reviewed with",
				(given: SignGiven) => given.draftMatches,
			),
			() => new DetailsChanged(),
		),
		unless(
			term(
				"a SOW is among the documents to sign",
				(given: SignGiven) => given.sow !== null,
			),
			() => new DocumentsChanged(),
		),
		unless(
			term(
				"the agreement fonts print every character of the signer's name and title",
				(given: SignGiven) =>
					[...(given.client.signer_name + given.client.signer_title)].every(
						agreementCharacterSupported,
					),
			),
			() => new NameNotPrintable(),
		),
		unless(
			term(
				"the browser's address is at most 100 characters and its user agent at most 2,000, neither with a control character",
				(given: SignGiven) =>
					given.address.length <= 100 &&
					given.userAgent.length <= 2000 &&
					!CONTROL.test(given.address + given.userAgent),
			),
			() => new EvidenceTooLong(),
		),
		unless(
			term(
				"the stored values name the contractor's notice email",
				(given: SignGiven) => given.contractorNotice !== null,
			),
			() => new StoredDataRefused(),
		),
	],
	writes: (given): SignWrite => {
		const { request, client } = given;
		const { at, ids, session, offer } = request;
		const sow = proved(given.sow);
		const named = documentList(request.named);

		return {
			receiptId: ids.receipt,
			guards: {
				offerId: offer.id,
				linkHash: session.link_hash,
				recipient: session.recipient_email,
				sessionTokenHash: session.token_hash,
				draftValues: given.draft === null ? null : given.draft.values_json,
				reusedMsaId: offer.reused_msa_id ? offer.reused_msa_id : null,
				signFrom: AGREEMENT_MOVES.SIGN,
			},
			notice: {
				id: ids.notice,
				agreement_id: sow.id,
				client_id: given.documents[0].client_id,
				business_address: client.business_address,
				notice_email: client.notice_email,
				recorded_at: at,
			},
			documents: given.documents.map((a, index) => {
				const drawn = proved(ids.documents[index]);

				return {
					id: a.id,
					text_sha256: a.text_sha256,
					signature: {
						id: drawn.signature,
						agreement_id: a.id,
						party: "client",
						typed_name: client.signer_name,
						title: client.signer_title,
						consent_text: consentText(client.legal_name, false),
						consent_at: at,
						signed_at: at,
						document_sha256: a.text_sha256,
						session_token_hash: session.token_hash,
						owner_subject: null,
						verified_email: session.recipient_email,
						verified_at: session.verified_at,
						verification_method: "verified by one-time email link",
						intent_text: intentText(
							false,
							request.named.length === 1 && a.kind === "sow",
						),
						document_list_json: named,
						receipt_id: ids.receipt,
						ip_address: given.address,
						user_agent: given.userAgent,
					},
					event: {
						id: drawn.event,
						agreement_id: a.id,
						offer_id: offer.id,
						action: "client-signed",
						actor: session.token_hash,
						occurred_at: at,
						reason: null,
					},
					status: SIGNED,
					client_signed_at: at,
				};
			}),
			draft: { offer_id: offer.id, recipient_email: session.recipient_email },
			notifications: [
				{
					agreement_id: sow.id,
					kind: "signature-receipt",
					email: session.recipient_email,
				},
				{
					agreement_id: sow.id,
					kind: "countersign-notice",
					email: proved(given.contractorNotice),
				},
			],
		};
	},
	writesText:
		"the notice, each document's signature, event and move to client_signed, the draft removed and the two signing notifications",
});

/** The MSA an offer reuses, read by its id, as stored. */
export type ReusedMsaRow = {
	readonly id: string;
	readonly kind: "msa" | "sow";
	readonly status: AgreementStatus;
	readonly terminated_at: string | null;
};

export type StillSignableRequest = {
	/** The signing time; the session must still be open at it. */
	readonly at: string;
	readonly session: StoredAgreementSession;
	readonly offer: Pick<SoftwareOffer, "reused_msa_id">;
	/** The documents to sign, as read in stage 1. */
	readonly documents: readonly SigningDocumentRow[];
};

export type StillSignableFacts = {
	/** The offer's signing state, read just before the batch (`openForSigning`'s facts). */
	readonly signing: SigningStateRow | null;
	/** The MSA the offer reuses, read just before the batch; null when it names none or the row is gone. */
	readonly reusedMsa: ReusedMsaRow | null;
};

type StillGiven = {
	readonly open: ReturnType<typeof openForSigning.given>;
	readonly session: ReturnType<typeof openSession.given>;
	readonly reusedMsaId: string | null | undefined;
	readonly reusedMsa: ReusedMsaRow | null;
	readonly token: string;
	readonly documents: readonly SigningDocumentRow[];
};

/**
 * Stage 4, read just before the batch: what only the batch's guards checked before, in their order. A1 and A2 are the
 * shared rules' own terms (`openForSigning`, `openSession`), so they cannot drift from them.
 */
export const stillSignable = alwaysWrites({
	name: "sign: the offer, the session, the reused MSA and the documents are still as signed",
	given: (
		request: StillSignableRequest,
		facts: StillSignableFacts,
	): StillGiven => ({
		open: openForSigning.given(
			{ recipient: request.session.recipient_email },
			facts.signing,
		),
		session: openSession.given({ now: new Date(request.at) }, request.session),
		reusedMsaId: request.offer.reused_msa_id,
		reusedMsa: facts.reusedMsa,
		token: request.session.token_hash,
		documents: request.documents,
	}),
	refusals: [
		...openForSigning.refusals.map((refusal) =>
			unless(
				term(refusal.unless.text, (given: StillGiven) =>
					refusal.unless.holds(given.open),
				),
				(given: StillGiven) => refusal.refuse(given.open),
			),
		),
		...openSession.refusals.map((refusal) =>
			unless(
				term(refusal.unless.text, (given: StillGiven) =>
					refusal.unless.holds(given.session),
				),
				(given: StillGiven) => refusal.refuse(given.session),
			),
		),
		unless(
			term(
				"the offer reuses no MSA, or the MSA it reuses is executed and not terminated",
				(given: StillGiven) =>
					!given.reusedMsaId ||
					(given.reusedMsa !== null &&
						given.reusedMsa.id === given.reusedMsaId &&
						given.reusedMsa.kind === "msa" &&
						given.reusedMsa.status === "executed" &&
						given.reusedMsa.terminated_at === null),
			),
			() => new DocumentsChanged(),
		),
		unless(
			term(
				"each document is still in review, reviewed by this session",
				(given: StillGiven) =>
					given.documents.every(
						(a) =>
							agreementAllows(a.status, "SIGN") &&
							a.review_session_hash === given.token,
					),
			),
			() => new DocumentsChanged(),
		),
	],
	writes: () => ({}),
	writesText:
		"nothing: the batch goes, and its guards re-check the same at write time",
});
