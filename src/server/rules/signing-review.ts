// The client's review of the offer's agreements (docs/plans/2026-11-signing-conversion.md, sections 2 and 3, "review").
//
// The GET, `reviewDocument`: the document the query names, among the offer's agreements that are not abandoned (as
// `offerAgreements`' `status<>'abandoned'` chose them), made for this review session (`review_session_hash`), answers its
// kind and text; anything else is DocumentNotFound (404). It writes nothing, so no guard re-checks it.
//
// The POST, `reviewDocuments`: today's `reviewAgreements` and `reviewOnce` (src/lib/software-agreements.ts). Its reads
// come between its decisions, so the rule is staged as the offers' send is (src/server/rules/offer-send.ts), each stage
// deciding on what was read so far, in the order the route has always answered:
//   1. the client's values and the offer's stored terms, details and contractor, read as today: StoredDataRefused (a
//      reader refused), DetailsRefused (the details' own checks against the terms, with their sentence) (reviewStored).
//      Text that is not JSON, and a contractor snapshot that is `null`, throw the same SyntaxError or TypeError as today,
//      a defect the route logs and answers with its fixed 500;
//   2. the offer's agreements: SignatureSaved (reviewExisting);
//   3. the client the natural key names and the MSA the offer reuses: MsaMismatch (reviewParty);
//   4. the two templates: TemplatesUnavailable (reviewTemplates);
//   5. the texts, rendered by `agreementValues` and `renderAgreement` as today: RenderRefused, with the template code's
//      sentence (reviewTexts);
//   6. the client's MSAs of the template: PendingMsaElsewhere (reviewPendingMsa);
//   7. the batch and the answer (reviewDocuments).
// The flow draws each new id and reads the clock where today's code does (the client's id only when no client has the
// key, the MSA's only when none is reused, then the SOW's; `at` and the New York date after the agreements are read; the
// session guard's time and the event's id as the batch is built), so the golden ids come in the same order.
//
// Re-checked at write time by A1 (the offer open for signing through the session's link, `liveSigningGuard`), A2 (the
// session unexpired and unrevoked, `sessionGuard`) and A3 (no agreement of the offer client_signed or executed: the
// review's own guard, re-checking SignatureSaved). Each raises GuardRefused, answered 409 and not retried. Two UNIQUE
// failures back facts these rules read, so the flow reads and decides again from its first read, three tries in all (B7):
// the one pending MSA per client and template (`software_agreements_pending_msa`, PendingMsaElsewhere's fact) and the
// client's natural key, recognised as today on the evidence read after a FOREIGN KEY failure (clientChangedElsewhere);
// a retry then picks the other request's client (reviewParty). A signed agreement and a project, which only A3 and A1
// checked before, are read first by the draft step the review flow runs before these stages
// (src/server/rules/signing-draft.ts), whose AlreadySigned and SigningStarted the review route answers with its own 409.
import * as Data from "effect/Data";
import {
	type ClientAgreement,
	parseClientAgreement,
} from "../../lib/agreement-client-fields";
import {
	type AgreementDetails,
	agreementValues,
	type Contractor,
	parseContractor,
	validateAgreementDetails,
} from "../../lib/agreement-fields";
import {
	type AgreementTemplate,
	renderAgreement,
	templateVersionLabel,
} from "../../lib/agreement-templates";
import { FieldsRefused, type RawValue } from "../../lib/fields";
import { ReaderMessage } from "../../lib/reader-message";
import { legalNameKey } from "../../lib/software-agreements";
import { type OfferTerms, parseOfferTerms } from "../../lib/software-offers";
import { alwaysWrites, term, unless } from "../terms";
import type { StoredAgreementSession } from "./agreement-session";
import type { LinkedOfferRow } from "./signing-offer";
import { proved } from "./software-request";

/** The review route's sentence for stored data a reader refuses, a lost race and a fault of the site. */
export const REVIEW_FAILED = "The agreement could not be reviewed.";

/** The document asked for is not one of the offer's live agreements made for this review session: 404 with no message. */
export class DocumentNotFound extends Data.TaggedError("DocumentNotFound") {
	readonly say = "Not found";
}

/**
 * A reader refused the client's values or the offer's stored terms, details or contractor (a `FieldsRefused` today): 409
 * with the route's sentence.
 */
export class StoredDataRefused extends Data.TaggedError("StoredDataRefused") {
	readonly say = REVIEW_FAILED;
}

/** The offer's stored details fail one of their own checks against the terms: 409 with that check's sentence. */
export class DetailsRefused extends Data.TaggedError("DetailsRefused")<{
	readonly sentence: string;
}> {
	get say() {
		return this.sentence;
	}
}

/** An agreement of the offer is client_signed or executed: 409. */
export class SignatureSaved extends Data.TaggedError("SignatureSaved") {
	readonly say = "A signature is already saved. These documents cannot change.";
}

/** The MSA the offer reuses is not an executed, current, ready MSA of this client: 409. */
export class MsaMismatch extends Data.TaggedError("MsaMismatch") {
	readonly say =
		"The confirmed MSA does not match this legal party. Ask Kazon for a new offer.";
}

/** A template the offer pins (or the reused MSA's) is not found: 409. */
export class TemplatesUnavailable extends Data.TaggedError(
	"TemplatesUnavailable",
) {
	readonly say = "The pinned templates are unavailable.";
}

/** The template code refused to render a document (a blank left, a character the fonts cannot print): 409 with its sentence. */
export class RenderRefused extends Data.TaggedError("RenderRefused")<{
	readonly sentence: string;
}> {
	get say() {
		return this.sentence;
	}
}

/** Another offer has an MSA in review or client_signed for this client and template: 409. */
export class PendingMsaElsewhere extends Data.TaggedError(
	"PendingMsaElsewhere",
) {
	readonly say =
		"Another offer has a pending MSA for this party. Ask Kazon to resolve it.";
}

/**
 * An agreement of the offer, as the store reads every one of them (abandoned included, ordered by kind as today); the
 * rules leave out the abandoned ones, as `offerAgreements`' `status<>'abandoned'` did.
 */
export type OfferAgreementRow = {
	readonly id: string;
	readonly kind: "msa" | "sow";
	readonly status: string;
	readonly client_id: string;
	readonly canonical_text: string;
	readonly review_session_hash: string;
};

/** The offer's agreements that are not abandoned, in the order read. */
const live = (rows: readonly OfferAgreementRow[]) =>
	rows.filter((row) => row.status !== "abandoned");

/** The offer as the review reads it: the linked offer's columns the review uses. */
export type ReviewOffer = Pick<
	LinkedOfferRow,
	| "id"
	| "request_id"
	| "version"
	| "terms_json"
	| "agreement_details_json"
	| "contractor_snapshot_json"
	| "reused_msa_id"
	| "msa_template_id"
	| "sow_template_id"
>;

/** The review session, as the route read it: what the batch guards with and writes. */
export type ReviewSession = Pick<
	StoredAgreementSession,
	"token_hash" | "link_hash" | "recipient_email"
>;

export type DocumentRequest = {
	/** The query's first `document` value, or null when it has none. */
	readonly documentId: string | null;
	/** The review session's token hash. */
	readonly sessionTokenHash: string;
};

/** The GET: the document asked for, when it is the offer's, not abandoned, and made for this review session. */
export const reviewDocument = alwaysWrites({
	name: "find the document a review session may read",
	given: (
		request: DocumentRequest,
		facts: readonly OfferAgreementRow[],
	): OfferAgreementRow | null =>
		live(facts).find(
			(row) =>
				row.id === request.documentId &&
				row.review_session_hash === request.sessionTokenHash,
		) ?? null,
	refusals: [
		unless(
			term(
				"the document is one of the offer's agreements that are not abandoned, made for this review session",
				(document: OfferAgreementRow | null) => document !== null,
			),
			() => new DocumentNotFound(),
		),
	],
	writes: (document) => {
		const found = proved(document);

		return { kind: found.kind, text: found.canonical_text };
	},
	writesText:
		"nothing is written: the route answers the document's kind and text",
});

/** The client's natural key (the table's UNIQUE key): the client row is read and written by it. */
export type ClientKey = {
	readonly recipient_email: string;
	readonly legal_name_key: string;
	readonly entity_type: string;
	readonly jurisdiction: string;
};

/** What stage 1 read: the client's details, the stored terms, details and contractor, and the client's key. */
export type ReviewStored = {
	readonly client: ClientAgreement;
	readonly terms: OfferTerms;
	readonly details: AgreementDetails;
	readonly contractor: Contractor;
	/** The contractor snapshot's `config_version`, or 1, as today's `?? 1` read it. */
	readonly configVersion: number;
	readonly key: ClientKey;
};

export type StoredRequest = {
	/** The client's details as `resolveClientDetails` resolved them from the posted values. */
	readonly client: RawValue;
	readonly session: Pick<ReviewSession, "recipient_email">;
};

export type StoredText = Pick<
	ReviewOffer,
	"terms_json" | "agreement_details_json" | "contractor_snapshot_json"
>;

type StoredRead =
	| { readonly kind: "refused" }
	| { readonly kind: "details"; readonly sentence: string }
	| { readonly kind: "read"; readonly stored: ReviewStored };

/**
 * Reads the client's details and the offer's stored text in today's order, stopping at the first that fails: a reader's
 * `FieldsRefused` is a refusal, the details' own `ReaderMessage` is its sentence, and anything else (text that is not
 * JSON, a snapshot that is `null`) is thrown as it is. `String(...)` gives JSON.parse what it was given before: a missing
 * column reads as the text "null". The snapshot's `config_version` is taken off with the same destructured parameter as
 * before, so a `null` snapshot fails with the same TypeError and message, which the route's log line prints.
 */
function readStored(request: StoredRequest, offer: StoredText): StoredRead {
	try {
		const client = parseClientAgreement(request.client),
			terms = parseOfferTerms(JSON.parse(offer.terms_json)),
			details = validateAgreementDetails(
				JSON.parse(String(offer.agreement_details_json)),
				terms,
			),
			contractor = parseContractor(
				(({ config_version, ...values }) => values)(
					JSON.parse(String(offer.contractor_snapshot_json)),
				),
			);

		return {
			kind: "read",
			stored: {
				client,
				terms,
				details,
				contractor,
				configVersion:
					JSON.parse(String(offer.contractor_snapshot_json)).config_version ??
					1,
				key: {
					recipient_email: request.session.recipient_email,
					legal_name_key: legalNameKey(client.legal_name),
					entity_type: client.entity_type,
					jurisdiction: client.jurisdiction,
				},
			},
		};
	} catch (error) {
		if (error instanceof FieldsRefused) return { kind: "refused" };

		if (error instanceof ReaderMessage)
			return { kind: "details", sentence: error.message };

		throw error;
	}
}

/** Stage 1, before any read: the client's values and the offer's stored terms, details and contractor read. */
export const reviewStored = alwaysWrites({
	name: "review: the client's details and the offer's stored terms, details and contractor read",
	given: (request: StoredRequest, facts: StoredText) =>
		readStored(request, facts),
	refusals: [
		unless(
			term(
				"every reader reads the client's details and the offer's stored terms, details and contractor",
				(read: StoredRead) => read.kind !== "refused",
			),
			() => new StoredDataRefused(),
		),
		unless(
			term(
				"the stored details pass their checks against the terms",
				(read: StoredRead) => read.kind !== "details",
			),
			(read) =>
				new DetailsRefused({
					sentence: read.kind === "details" ? read.sentence : "",
				}),
		),
	],
	writes: (read): ReviewStored =>
		proved(read.kind === "read" ? read.stored : null),
	writesText:
		"the client's details, the terms, the details, the contractor and its config version, and the client's natural key",
});

/** What stage 2 found: the clients of the documents in review, which the batch removes once nothing names them. */
export type ReviewExisting = {
	readonly replacedClientIds: readonly string[];
};

/** Stage 2, after the offer's agreements are read: none of them is signed. */
export const reviewExisting = alwaysWrites({
	name: "review: no agreement of the offer is signed",
	given: (_request: null, facts: readonly OfferAgreementRow[]) => live(facts),
	refusals: [
		unless(
			term(
				"every agreement of the offer that is not abandoned is in review",
				(rows: readonly OfferAgreementRow[]) =>
					rows.every((row) => row.status === "review"),
			),
			() => new SignatureSaved(),
		),
	],
	writes: (rows): ReviewExisting => ({
		replacedClientIds: [...new Set(rows.map((row) => row.client_id))],
	}),
	writesText:
		"the clients of the documents in review, each named once in the order read",
});

/** The MSA an offer reuses, read by its id with the status of its signed copy (null when it has none), as stored. */
export type ReusedMsaRow = {
	readonly id: string;
	readonly kind: string;
	readonly status: string;
	readonly client_id: string;
	readonly template_id: string;
	readonly terminated_at: string | null;
	readonly archive_closed_at: string | null;
	readonly effective_on: string;
	readonly canonical_text: string;
	readonly text_sha256: string;
	readonly artifact_status: string | null;
};

export type PartyRequest = {
	readonly offer: Pick<ReviewOffer, "reused_msa_id" | "msa_template_id">;
	/** A new client id, drawn only when no client has the key (as today, so the ids are drawn in today's order). */
	readonly newClientId: string | null;
};

export type PartyFacts = {
	/** The client the natural key names, read just before; null when none has it. */
	readonly client: { readonly id: string } | null;
	/** The MSA the offer reuses, read by its id when the offer names one; null otherwise, or when no row has the id. */
	readonly reusedMsa: ReusedMsaRow | null;
};

/** The client the review writes for, and the MSA it reuses. */
export type ReviewParty = {
	/** The client the key names (on a retry, the one another request wrote), or the new id. */
	readonly clientId: string;
	/** The client the key named before the batch; null for a new client. The FOREIGN KEY evidence reads by it. */
	readonly earlierClientId: string | null;
	readonly reused: ReusedMsaRow | null;
	/** The MSA template to read: the reused MSA's, or the one the offer pins. */
	readonly msaTemplateId: string | null;
};

type PartyGiven = {
	readonly reusesMsa: boolean;
	readonly clientId: string | null;
	readonly earlierClientId: string | null;
	readonly reused: ReusedMsaRow | null;
	readonly msaTemplateId: string | null;
};

/**
 * Today's read of the reused MSA, as a decision on its row: the id the offer names, an MSA, executed, not terminated, its
 * archive open, its signed copy ready, and of this client.
 */
const reusable = (row: ReusedMsaRow, id: string, clientId: string) =>
	row.id === id &&
	row.kind === "msa" &&
	row.status === "executed" &&
	row.terminated_at === null &&
	row.archive_closed_at === null &&
	row.artifact_status === "ready" &&
	row.client_id === clientId;

/** Stage 3, after the client and the reused MSA are read: the client chosen, and the MSA the offer reuses matches it. */
export const reviewParty = alwaysWrites({
	name: "review: the client chosen, and the reused MSA is this client's",
	given: (request: PartyRequest, facts: PartyFacts): PartyGiven => {
		const clientId = facts.client?.id ?? request.newClientId;
		const reusedId = request.offer.reused_msa_id;

		const reused =
			reusedId &&
			clientId !== null &&
			facts.reusedMsa !== null &&
			reusable(facts.reusedMsa, reusedId, clientId)
				? facts.reusedMsa
				: null;

		return {
			reusesMsa: Boolean(reusedId),
			clientId,
			earlierClientId: facts.client?.id ?? null,
			reused,
			msaTemplateId:
				reused?.template_id ?? request.offer.msa_template_id ?? null,
		};
	},
	refusals: [
		unless(
			term(
				"the offer reuses no MSA, or reuses an executed, current, ready MSA of this client",
				(given: PartyGiven) => !given.reusesMsa || given.reused !== null,
			),
			() => new MsaMismatch(),
		),
	],
	writes: (given): ReviewParty => ({
		clientId: proved(given.clientId),
		earlierClientId: given.earlierClientId,
		reused: given.reused,
		msaTemplateId: given.msaTemplateId,
	}),
	writesText:
		"the client's id, the client the key named before, the reused MSA and the MSA template to read",
});

/** The templates a review renders. */
export type ReviewTemplates = {
	readonly msa: AgreementTemplate;
	readonly sow: AgreementTemplate;
};

export type TemplateFacts = {
	/** The MSA template read by `ReviewParty.msaTemplateId`; null when none has it (or the id is null). */
	readonly msa: AgreementTemplate | null;
	/** The SOW template the offer pins; null when none has it (or the offer pins none). */
	readonly sow: AgreementTemplate | null;
};

/** Stage 4, after the two templates are read: both are found. */
export const reviewTemplates = alwaysWrites({
	name: "review: the pinned templates are found",
	given: (_request: null, facts: TemplateFacts) => facts,
	refusals: [
		unless(
			term(
				"the MSA template and the SOW template are found",
				(given: TemplateFacts) => given.msa !== null && given.sow !== null,
			),
			() => new TemplatesUnavailable(),
		),
	],
	writes: (given): ReviewTemplates => ({
		msa: proved(given.msa),
		sow: proved(given.sow),
	}),
	writesText: "the two templates to render",
});

export type TextsRequest = {
	readonly offer: Pick<ReviewOffer, "version">;
	readonly stored: ReviewStored;
	readonly party: ReviewParty;
	readonly templates: ReviewTemplates;
	/** The MSA's new id, drawn only when no MSA is reused; null when one is. */
	readonly msaId: string | null;
	/** The SOW's new id, drawn after the MSA's. */
	readonly sowId: string;
	/** The review's date in New York (YYYY-MM-DD), read with `at`. */
	readonly effectiveOn: string;
};

/** The values every document of the review is rendered from, as stored in `values_json`. */
export type ReviewValues = ReturnType<typeof agreementValues>;

/** A document rendered for review. */
export type ReviewText = {
	readonly id: string;
	readonly kind: "msa" | "sow";
	readonly text: string;
};

/** What stage 5 rendered. */
export type ReviewTexts = {
	/** The reused MSA's id, or the new MSA's. */
	readonly msaId: string;
	readonly sowId: string;
	readonly effectiveOn: string;
	readonly values: ReviewValues;
	/** In today's order: the MSA, unless one is reused, then the SOW. */
	readonly documents: readonly ReviewText[];
};

type TextsRead =
	| { readonly kind: "refused"; readonly sentence: string }
	| { readonly kind: "rendered"; readonly texts: ReviewTexts };

/**
 * The values and the texts, made by today's pure helpers in today's order (the values, the MSA unless one is reused, then
 * the SOW), stopping at the first `ReaderMessage`; anything else is thrown as it is.
 */
function renderTexts(request: TextsRequest): TextsRead {
	const { stored, party, templates, sowId, effectiveOn } = request;
	const { reused } = party;
	const msaId = reused?.id ?? proved(request.msaId);

	try {
		const values = agreementValues(
			stored.terms,
			stored.details,
			stored.client,
			{ ...stored.contractor, config_version: stored.configVersion },
			{
				effective_on: effectiveOn,
				msa_version: `${reused?.effective_on ?? effectiveOn} / template ${templates.msa.version}`,
				sow_number: `SOW-${sowId}`,
				offer_version: request.offer.version,
				template_version: templates.sow.version,
				msa_version_label: templateVersionLabel(templates.msa),
				msa_source_revision: templates.msa.source_revision ?? "",
				sow_version_label: templateVersionLabel(templates.sow),
				sow_source_revision: templates.sow.source_revision ?? "",
			},
		);

		const msa: ReviewText[] = reused
			? []
			: [
					{
						id: msaId,
						kind: "msa",
						text: renderAgreement("msa", templates.msa.text, values),
					},
				];

		const sow: ReviewText = {
			id: sowId,
			kind: "sow",
			text: renderAgreement("sow", templates.sow.text, values),
		};

		return {
			kind: "rendered",
			texts: {
				msaId,
				sowId,
				effectiveOn,
				values,
				documents: [...msa, sow],
			},
		};
	} catch (error) {
		if (error instanceof ReaderMessage)
			return { kind: "refused", sentence: error.message };

		throw error;
	}
}

/** Stage 5, once the ids are drawn: the documents render. */
export const reviewTexts = alwaysWrites({
	name: "review: the documents render",
	given: (request: TextsRequest, _facts: null) => renderTexts(request),
	refusals: [
		unless(
			term(
				"the template code renders every document",
				(read: TextsRead) => read.kind === "rendered",
			),
			(read) =>
				new RenderRefused({
					sentence: read.kind === "refused" ? read.sentence : "",
				}),
		),
	],
	writes: (read): ReviewTexts =>
		proved(read.kind === "rendered" ? read.texts : null),
	writesText:
		"the values and each document's text; the flow hashes each text next",
});

/** An agreement of the client and template, as stored (plain: the rule decides which are pending elsewhere). */
export type PendingMsaRow = {
	readonly id: string;
	readonly kind: string;
	readonly status: string;
	readonly offer_id: string | null;
	readonly client_id: string;
	readonly template_id: string;
};

export type PendingRequest = {
	readonly offer: Pick<ReviewOffer, "id">;
	readonly party: Pick<ReviewParty, "clientId">;
	readonly templates: ReviewTemplates;
};

type PendingGiven = {
	readonly offerId: string;
	readonly clientId: string;
	readonly templateId: string;
	readonly rows: readonly PendingMsaRow[];
};

/**
 * Today's read of a pending MSA, as a decision on the rows: an MSA of this client and template, in review or
 * client_signed, of another offer. An MSA of no offer is not another offer's, as `offer_id<>?` never matched a NULL.
 */
const pendingElsewhere = (given: PendingGiven, row: PendingMsaRow) =>
	row.client_id === given.clientId &&
	row.template_id === given.templateId &&
	row.kind === "msa" &&
	(row.status === "review" || row.status === "client_signed") &&
	row.offer_id !== null &&
	row.offer_id !== given.offerId;

/** Stage 6, after the client's MSAs of the template are read: no other offer has one pending. */
export const reviewPendingMsa = alwaysWrites({
	name: "review: no other offer has a pending MSA for this client and template",
	given: (
		request: PendingRequest,
		facts: readonly PendingMsaRow[],
	): PendingGiven => ({
		offerId: request.offer.id,
		clientId: request.party.clientId,
		templateId: request.templates.msa.id,
		rows: facts,
	}),
	refusals: [
		unless(
			term(
				"no other offer has an MSA in review or client_signed for this client and template",
				(given: PendingGiven) =>
					!given.rows.some((row) => pendingElsewhere(given, row)),
			),
			() => new PendingMsaElsewhere(),
		),
	],
	writes: () => ({}),
	writesText:
		"nothing: the batch is built next; the pending-MSA index re-checks this",
});

/** The client row, inserted unless one has its id or natural key (`INSERT OR IGNORE`), in the table's column order. */
export type ClientRow = {
	readonly id: string;
	readonly recipient_email: string;
	readonly legal_name: string;
	readonly legal_name_key: string;
	readonly entity_type: string;
	readonly jurisdiction: string;
	readonly business_address: string;
	readonly notice_email: string;
	readonly created_at: string;
};

/** A document inserted for review (its status `review`), in the insert's column order. */
export type ReviewDocumentRow = {
	readonly id: string;
	readonly kind: "msa" | "sow";
	readonly offer_id: string;
	readonly request_id: string;
	readonly client_id: string;
	readonly template_id: string;
	readonly msa_id: string | null;
	readonly sow_number: string | null;
	readonly canonical_text: string;
	readonly text_sha256: string;
	readonly values_json: string;
	readonly attachment_manifest_json: string;
	readonly created_at: string;
	readonly effective_on: string;
	readonly review_session_hash: string;
};

/** The review's event, as `agreementEvent` writes it. */
export type ReviewEventRow = {
	readonly id: string;
	readonly agreement_id: null;
	readonly offer_id: string;
	readonly action: "reviewed";
	readonly actor: string;
	readonly occurred_at: string;
	readonly reason: null;
};

/** The route's 200, in today's key order: each document's id, kind, hash and text, and the reused MSA's id, text and hash. */
export type ReviewAnswer = {
	readonly documents: readonly {
		readonly id: string;
		readonly kind: "msa" | "sow";
		readonly hash: string;
		readonly text: string;
	}[];
	readonly reused_msa: {
		readonly id: string;
		readonly text: string;
		readonly hash: string;
	} | null;
};

export type ReviewRequest = {
	readonly offer: Pick<ReviewOffer, "id" | "request_id">;
	readonly session: ReviewSession;
	readonly stored: ReviewStored;
	readonly existing: ReviewExisting;
	readonly party: ReviewParty;
	readonly templates: ReviewTemplates;
	readonly texts: ReviewTexts;
	/** Each document's SHA-256 (`hashOfferToken` of its text), in the order of `texts.documents`. */
	readonly hashes: readonly string[];
	/** The review's time (ISO), read with the New York date. */
	readonly at: string;
	/** The time A2 compares the session's expiry with (ISO), read as the batch is built. */
	readonly sessionNow: string;
	/** The event's id, drawn as the batch is built, after the documents'. */
	readonly eventId: string;
};

/**
 * The review batch: A1 (`offerId`, `linkHash`, `recipientEmail`), A2 (`sessionTokenHash` unexpired at `sessionNow`), A3
 * (`offerId`); the client inserted unless its id or key exists; the offer's documents in review deleted; the documents
 * inserted; the stale clients deleted once no agreement or notice names them (that filter stays in SQL; no statement when
 * there are none); the event. Then the route's answer.
 */
export type ReviewWrite = {
	readonly offerId: string;
	readonly linkHash: string | null;
	readonly recipientEmail: string;
	readonly sessionTokenHash: string;
	readonly sessionNow: string;
	readonly client: ClientRow;
	/** The client the key named before the batch; null for a new client (see clientChangedElsewhere). */
	readonly earlierClientId: string | null;
	readonly documents: readonly ReviewDocumentRow[];
	readonly staleClientIds: readonly string[];
	readonly event: ReviewEventRow;
	readonly answer: ReviewAnswer;
};

/** Stage 7: the review batch and the answer, from what the stages decided and the hashes, times and ids handed in. */
export const reviewDocuments = alwaysWrites({
	name: "review: the documents written for the client to sign",
	given: (request: ReviewRequest, _facts: null) => request,
	refusals: [],
	writes: (given): ReviewWrite => {
		const { offer, session, stored, party, templates, texts, at } = given;
		const valuesJson = JSON.stringify(texts.values);

		const hashed = texts.documents.map((document, index) => ({
			...document,
			hash: proved(given.hashes[index]),
		}));

		return {
			offerId: offer.id,
			linkHash: session.link_hash,
			recipientEmail: session.recipient_email,
			sessionTokenHash: session.token_hash,
			sessionNow: given.sessionNow,
			client: {
				id: party.clientId,
				recipient_email: stored.key.recipient_email,
				legal_name: stored.client.legal_name,
				legal_name_key: stored.key.legal_name_key,
				entity_type: stored.client.entity_type,
				jurisdiction: stored.client.jurisdiction,
				business_address: stored.client.business_address,
				notice_email: stored.client.notice_email,
				created_at: at,
			},
			earlierClientId: party.earlierClientId,
			documents: hashed.map((document) => ({
				id: document.id,
				kind: document.kind,
				offer_id: offer.id,
				request_id: offer.request_id,
				client_id: party.clientId,
				template_id:
					document.kind === "msa" ? templates.msa.id : templates.sow.id,
				msa_id: document.kind === "sow" ? texts.msaId : null,
				sow_number: document.kind === "sow" ? `SOW-${texts.sowId}` : null,
				canonical_text: document.text,
				text_sha256: document.hash,
				values_json: valuesJson,
				attachment_manifest_json: JSON.stringify(
					document.kind === "sow" ? stored.details.attachments : [],
				),
				created_at: at,
				effective_on: texts.effectiveOn,
				review_session_hash: session.token_hash,
			})),
			staleClientIds: given.existing.replacedClientIds,
			event: {
				id: given.eventId,
				agreement_id: null,
				offer_id: offer.id,
				action: "reviewed",
				actor: session.token_hash,
				occurred_at: at,
				reason: null,
			},
			answer: {
				documents: hashed.map((document) => ({
					id: document.id,
					kind: document.kind,
					hash: document.hash,
					text: document.text,
				})),
				reused_msa: party.reused
					? {
							id: party.reused.id,
							text: party.reused.canonical_text,
							hash: party.reused.text_sha256,
						}
					: null,
			},
		};
	},
	writesText:
		"A1, A2 and A3; the client unless it exists; the documents in review replaced by the new ones; the stale clients removed; the event; and the answer",
});

/**
 * Whether a FOREIGN KEY failure of the review batch is another request changing the client this review chose, on the
 * evidence read after it (today's `otherRequestChangedClient`): for a client the key named before the batch, the read of
 * that client by its id finds it gone; for a new client, the read by the natural key finds a row under another id (so the
 * batch's own `INSERT OR IGNORE` was skipped). `found` is what that one read found. When this holds the store answers
 * ChangedSinceRead and the review is read and decided again; otherwise, and when the evidence cannot be read, the batch's
 * own failure stands (a fault of the site, 500).
 */
export const clientChangedElsewhere = (
	write: Pick<ReviewWrite, "client" | "earlierClientId">,
	found: readonly { readonly id: string }[],
) =>
	write.earlierClientId
		? !found.some((row) => row.id === write.earlierClientId)
		: found.some((row) => row.id !== write.client.id);
