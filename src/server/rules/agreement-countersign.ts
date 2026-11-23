// The owner's countersignature (docs/plans/2026-11-signing-conversion.md, section 2, `countersign`): the owner signs the
// documents the client has signed, and they become executed. Decided from the request's sent offer (its contractor
// snapshot, its client email snapshot and the MSA it reuses), the signing setting, every agreement of the offer as read
// (ordered by kind), the documents the owner named, the typed name, the owner's email and the browser evidence (the
// request's cf-connecting-ip and user-agent headers), with the time and the receipt id the flow reads after the pending
// documents are checked, where `countersignAgreements` (src/lib/software-agreements.ts) reads them today. Its reads come
// between its decisions, so the rule is staged, each stage repeating the refusals before it, in the order the route has
// always answered (src/pages/api/owner/requests/[id]/agreement.ts and `countersignAgreements`):
//   1. the request has a sent offer and signing is on: OfferChanged (countersignFront);
//   2. the client-signed documents are exactly those named: PendingChanged (countersignPending); the flow then reads the
//      time and draws the receipt id;
//   3. the contractor snapshot reads (StoredDataRefused), the typed name and the contractor's title can be printed
//      (NameNotPrintable), the browser evidence is within its limits (EvidenceTooLong), the pending documents hold the
//      statement of work (PendingChanged again: today `sow.id` throws a TypeError there), and the offer has a client
//      email snapshot for the client's copy (RecipientMissing: today the copy row's NOT NULL fails the batch) (countersign).
// Writes, in one batch: per pending document its contractor signature, the `countersigned` event, its signing notices still
// sending failed as obsolete (`MESSAGE_MOVES.OBSOLETE`, with the `delivery-failed` event), and its move to executed
// (`AGREEMENT_MOVES.COUNTERSIGN`); then a packet row per document and the SOW's two copies. The store draws the
// signature, event and obsolete-event ids as it builds those statements, in that order, as today. Re-checked at write time
// by A10 (the offer still sent, its request neither withdrawn nor resolved, signing on), A8 (the reused MSA still
// executed and not terminated) and A11 (each document still client_signed with the hash read). The request's status (A10)
// and the reused MSA (A8) are not read before the batch: only those guards check them today, and the plan's list of
// conditions read first does not name them, so a closed request or an unusable reused MSA is a refused guard, which the
// route answers with the same 409 as every refusal here but OfferChanged.
import * as Data from "effect/Data";
import { consentText, intentText } from "../../lib/agreement-client-fields";
import { type Contractor, readContractor } from "../../lib/agreement-fields";
import type { Body } from "../../lib/fields";
import { agreementCharacterSupported } from "../../lib/agreement-templates";
import { signatureIds } from "../../lib/software-agreements";
import { AGREEMENT_MOVES } from "../machines/agreement-document";
import { alwaysWrites, term, unless } from "../terms";

/** The owner request route's answer to every refusal of the owner's actions that has no sentence of its own (409). */
export const CHANGED_OR_FAILED =
	"The agreement changed or the operation failed. Reload before retrying.";

/** 409: the request has no sent offer, or website signing is off. Checked by the route before any agreement is read. */
export class OfferChanged extends Data.TaggedError("OfferChanged") {
	readonly say = "Signing is off or the offer changed.";
}

/**
 * 409 with the route's generic sentence: no document is client-signed, the client-signed documents are not exactly the
 * documents named (by id and hash), or they hold no statement of work. Today the first two throw "The pending documents
 * changed. Reload before countersigning.", which the route never shows, and the last a TypeError.
 */
export class PendingChanged extends Data.TaggedError("PendingChanged") {
	readonly say = CHANGED_OR_FAILED;
}

/**
 * 409 with the route's generic sentence: the offer's contractor snapshot is missing, is not JSON, or does not read as the
 * contractor's details (empty, an extra field, the registered agent not confirmed). Today a TypeError, a SyntaxError or a
 * FieldsRefused.
 */
export class StoredDataRefused extends Data.TaggedError("StoredDataRefused") {
	readonly say = CHANGED_OR_FAILED;
}

/**
 * 409 with the route's generic sentence: the typed name or the contractor's title has a character the agreement fonts
 * cannot print. Today "Unsupported character. Arrange outside-site signing.", which the route never shows.
 */
export class NameNotPrintable extends Data.TaggedError("NameNotPrintable") {
	readonly say = CHANGED_OR_FAILED;
}

/**
 * 409 with the route's generic sentence: the address is over 100 characters, the user agent over 2,000, or either holds a
 * control character. Today "Browser evidence exceeds its limits.", which the route never shows.
 */
export class EvidenceTooLong extends Data.TaggedError("EvidenceTooLong") {
	readonly say = CHANGED_OR_FAILED;
}

/**
 * 409 with the route's generic sentence: the offer has no client email snapshot, so the client's copy has no address.
 * Today the copy row's NOT NULL fails the batch, which the route answers as a refusal; decided here before the batch.
 */
export class RecipientMissing extends Data.TaggedError("RecipientMissing") {
	readonly say = CHANGED_OR_FAILED;
}

/** The request's sent offer, as stored: the columns countersign and abandon read. */
export type SentOfferRow = {
	readonly id: string;
	readonly request_id: string;
	readonly contractor_snapshot_json: string | null;
	readonly recipient_email_snapshot: string | null;
	readonly reused_msa_id: string | null;
};

/** One agreement of the offer, as stored. */
export type OfferAgreementRow = {
	readonly id: string;
	readonly kind: string;
	readonly status: string;
	readonly text_sha256: string;
};

/** A document the owner named, by id and the hash of the text the page showed. */
export type NamedDocument = { readonly id: string; readonly hash: string };

/**
 * The documents of the offer awaiting a move from client_signed (countersign or abandon), in the order read, when they are
 * exactly the documents named (compared as `signatureIds` compares them: by id and hash, in any order); null when none is
 * awaiting it or they differ. Every client-signed document is one `offerAgreements` keeps (it leaves out the abandoned).
 */
export function pendingAsNamed(
	agreements: readonly OfferAgreementRow[],
	documents: readonly NamedDocument[],
	awaiting: readonly string[],
): readonly OfferAgreementRow[] | null {
	const pending = agreements.filter((agreement) =>
		awaiting.includes(agreement.status),
	);

	const same =
		signatureIds(
			pending.map((agreement) => ({
				id: agreement.id,
				hash: agreement.text_sha256,
			})),
		) === signatureIds([...documents]);

	return pending.length > 0 && same ? pending : null;
}

/** What the owner sent: the documents named, the typed name, the owner's email and the browser evidence. */
export type CountersignRequest = {
	readonly documents: readonly NamedDocument[];
	readonly typedName: string;
	/** The owner's email, as signed in. */
	readonly actor: string;
	/** The request's cf-connecting-ip header, or null when it has none. */
	readonly ip: string | null;
	/** The request's user-agent header, or null when it has none. */
	readonly userAgent: string | null;
};

/** The time and the receipt id, read once the pending documents are checked. */
export type CountersignStamp = {
	readonly at: string;
	readonly receiptId: string;
};

/** The offer and the setting, read first. */
export type CountersignOfferFacts = {
	readonly offer: SentOfferRow | null;
	/** The setting's `software_signing_enabled`: null when its row is missing, or when there is no sent offer to read it for. */
	readonly signingEnabled: number | null;
};

/** Every fact countersign reads: the offer, the setting and every agreement of the offer, ordered by kind. */
export type CountersignFacts = CountersignOfferFacts & {
	readonly agreements: readonly OfferAgreementRow[];
};

/**
 * The contractor's details from the offer's snapshot, read as countersign has always read them: JSON, without its
 * `config_version` (an object rest), through the contractor's reader; null when any step fails (a missing snapshot, text
 * that is not JSON, JSON `null`, or details the reader refuses).
 */
function snapshotContractor(snapshot: string | null): Contractor | null {
	if (snapshot === null) return null;
	let parsed: Body | null;

	try {
		parsed = JSON.parse(snapshot);
	} catch {
		return null;
	}

	if (parsed === null) return null;
	// The rest copies the own properties of any value but null, as today's destructuring did (a string's characters, an
	// array's items, nothing of a number or a boolean); the reader then refuses whatever is not the contractor's details.
	const { config_version: _version, ...values } = parsed;
	const read = readContractor(values);

	return read.ok ? read.value : null;
}

/** Whether the address and the user agent are within the limits the signature record keeps. */
const evidenceWithin = (ip: string, userAgent: string) =>
	!(
		ip.length > 100 ||
		userAgent.length > 2000 ||
		/[\x00-\x1f\x7f]/.test(ip + userAgent)
	);

type FrontGiven = {
	readonly offer: SentOfferRow | null;
	readonly signingOn: boolean;
};

type PendingGiven = FrontGiven & {
	readonly pending: readonly OfferAgreementRow[] | null;
};

type CountersignGiven = PendingGiven & {
	readonly request: CountersignRequest & CountersignStamp;
	readonly contractor: Contractor | null;
	readonly ip: string;
	readonly userAgent: string;
	readonly sow: OfferAgreementRow | null;
};

const frontGiven = (facts: CountersignOfferFacts): FrontGiven => ({
	offer: facts.offer,
	signingOn: Boolean(facts.signingEnabled),
});

const pendingGiven = (
	request: Pick<CountersignRequest, "documents">,
	facts: CountersignFacts,
): PendingGiven => ({
	...frontGiven(facts),
	pending: pendingAsNamed(
		facts.agreements,
		request.documents,
		AGREEMENT_MOVES.COUNTERSIGN,
	),
});

const offerSentAndSigningOn = unless(
	term(
		"the request has a sent offer and website signing is on",
		(given: FrontGiven) => given.offer !== null && given.signingOn,
	),
	() => new OfferChanged(),
);

const pendingAreNamed = unless(
	term(
		"some documents of the offer are client-signed, and they are exactly the documents named",
		(given: PendingGiven) => given.pending !== null,
	),
	() => new PendingChanged(),
);

const snapshotReads = unless(
	term(
		"the offer's contractor snapshot reads as the contractor's details",
		(given: CountersignGiven) => given.contractor !== null,
	),
	() => new StoredDataRefused(),
);

const namePrintable = unless(
	term(
		"the agreement fonts can print the typed name and the contractor's title",
		(given: CountersignGiven) =>
			[
				...(given.request.typedName + (given.contractor?.signer_title ?? "")),
			].every((character) => agreementCharacterSupported(character)),
	),
	() => new NameNotPrintable(),
);

const evidenceFits = unless(
	term("the browser evidence is within its limits", (given: CountersignGiven) =>
		evidenceWithin(given.ip, given.userAgent),
	),
	() => new EvidenceTooLong(),
);

const sowPending = unless(
	term(
		"the pending documents hold the statement of work",
		(given: CountersignGiven) => given.sow !== null,
	),
	() => new PendingChanged(),
);

const recipientKnown = unless(
	term(
		"the offer has a client email snapshot for the client's copy",
		(given: CountersignGiven) =>
			given.offer !== null && given.offer.recipient_email_snapshot !== null,
	),
	() => new RecipientMissing(),
);

/** Stage 1, before the agreements are read: the request has a sent offer, and signing is on. */
export const countersignFront = alwaysWrites({
	name: "countersign: a sent offer, with signing on",
	given: (_request: null, facts: CountersignOfferFacts) => frontGiven(facts),
	refusals: [offerSentAndSigningOn],
	writes: () => ({}),
	writesText: "nothing: the offer's agreements are read next",
});

/** Stage 2, once the agreements are read: the client-signed documents are the ones named. */
export const countersignPending = alwaysWrites({
	name: "countersign: the documents named are the pending ones",
	given: (
		request: Pick<CountersignRequest, "documents">,
		facts: CountersignFacts,
	) => pendingGiven(request, facts),
	refusals: [offerSentAndSigningOn, pendingAreNamed],
	writes: () => ({}),
	writesText: "nothing: the time is read and the receipt id drawn next",
});

/** One contractor signature, with the values its row stores (`consent_version` is the statement's own literal). */
export type ContractorSignature = {
	readonly agreement_id: string;
	readonly party: "contractor";
	readonly typed_name: string;
	readonly title: string;
	readonly consent_text: string;
	readonly consent_at: string;
	readonly signed_at: string;
	readonly document_sha256: string;
	readonly session_token_hash: null;
	readonly owner_subject: string;
	readonly verified_email: string;
	readonly verified_at: string;
	readonly verification_method: "verified by owner authentication";
	readonly intent_text: string;
	readonly document_list_json: string;
	readonly receipt_id: string;
	readonly ip_address: string;
	readonly user_agent: string;
};

/** A copy of the signed SOW to send. */
export type CopyRow = {
	readonly agreement_id: string;
	readonly recipient_role: "client" | "contractor";
	readonly email: string;
};

/** The countersign batch, in the order its statements run. */
export type CountersignWrite = {
	readonly offerId: string;
	/** The MSA the offer reuses, which A8 re-checks; null when it reuses none. */
	readonly reusedMsaId: string | null;
	readonly at: string;
	readonly actor: string;
	/**
	 * Each pending document, in the order read: A11 over its id and hash, its signature, the `countersigned` event (with
	 * the offer), its obsolete notices (`obsolete-signing-notice:executed`), and its move to executed at `at`.
	 */
	readonly documents: readonly {
		readonly id: string;
		readonly hash: string;
		readonly signature: ContractorSignature;
	}[];
	/** The packet rows, one per pending document, in the same order. */
	readonly packets: readonly string[];
	/** The SOW's two copies: the client's, then the contractor's. */
	readonly copies: readonly CopyRow[];
	/** The SOW's id: what countersign answers, and the packets and copies after the batch are prepared from it. */
	readonly sowId: string;
};

/**
 * Stage 3: the whole countersignature. Each refusal is checked where today's code meets it, so the first that holds is
 * the one today's route answers.
 */
export const countersign = alwaysWrites({
	name: "countersign the documents the client signed",
	given: (
		request: CountersignRequest & CountersignStamp,
		facts: CountersignFacts,
	): CountersignGiven => {
		const pending = pendingGiven(request, facts);

		return {
			...pending,
			request,
			contractor: snapshotContractor(
				facts.offer?.contractor_snapshot_json ?? null,
			),
			ip: request.ip ?? "",
			userAgent: request.userAgent ?? "",
			sow:
				pending.pending?.find((agreement) => agreement.kind === "sow") ?? null,
		};
	},
	refusals: [
		offerSentAndSigningOn,
		pendingAreNamed,
		snapshotReads,
		namePrintable,
		evidenceFits,
		sowPending,
		recipientKnown,
	],
	writes: (given): CountersignWrite => {
		// SAFETY: `writes` runs only once every refusal above passed, which ruled out a missing offer, pending documents that
		// are not the ones named, a snapshot that does not read, a missing SOW and a missing client email snapshot.
		const offer = given.offer as SentOfferRow;
		// SAFETY: as above.
		const pending = given.pending as readonly OfferAgreementRow[];
		// SAFETY: as above.
		const contractor = given.contractor as Contractor;
		// SAFETY: as above.
		const sow = given.sow as OfferAgreementRow;
		const { at, actor, documents, receiptId, typedName } = given.request;

		const signature = (agreement: OfferAgreementRow): ContractorSignature => ({
			agreement_id: agreement.id,
			party: "contractor",
			typed_name: typedName,
			title: contractor.signer_title,
			consent_text: consentText(contractor.legal_name, true),
			consent_at: at,
			signed_at: at,
			document_sha256: agreement.text_sha256,
			session_token_hash: null,
			owner_subject: actor,
			verified_email: actor.trim().toLowerCase(),
			verified_at: at,
			verification_method: "verified by owner authentication",
			intent_text: intentText(
				true,
				documents.length === 1 && agreement.kind === "sow",
			),
			document_list_json: signatureIds([...documents]),
			receipt_id: receiptId,
			ip_address: given.ip,
			user_agent: given.userAgent,
		});

		return {
			offerId: offer.id,
			reusedMsaId: offer.reused_msa_id ? offer.reused_msa_id : null,
			at,
			actor,
			documents: pending.map((agreement) => ({
				id: agreement.id,
				hash: agreement.text_sha256,
				signature: signature(agreement),
			})),
			packets: pending.map((agreement) => agreement.id),
			copies: [
				{
					agreement_id: sow.id,
					recipient_role: "client",
					// SAFETY: as above: RecipientMissing ruled out a missing client email snapshot.
					email: offer.recipient_email_snapshot as string,
				},
				{
					agreement_id: sow.id,
					recipient_role: "contractor",
					email: contractor.notice_email,
				},
			],
			sowId: sow.id,
		};
	},
	writesText:
		"per pending document its contractor signature, the countersigned event, its obsolete notices and its move to executed; a packet row per document; the SOW's two copies; in one batch",
});
