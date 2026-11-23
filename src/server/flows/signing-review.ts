// The client's review of the offer's agreements (GET and POST /api/offer/[token]/review;
// docs/plans/2026-11-signing-conversion.md, section 3), each in the order the route has always kept.
//
// The GET, `readReviewDocument`: the sent offer the token names, the visitor's signing session for it (read only for an
// offer) and the signing setting (read only with a session), decided by `documentFront`; then the offer's agreements and
// `reviewDocument`, which answers the document's kind and text. It writes nothing.
//
// The POST, `reviewSigningDocuments`: the offer, the session (read only for an offer) and the signing setting (always
// read), decided by `reviewFront` (the session, the nonce, the client's details); the draft saved first, as the draft
// route saves it but with the values as read once (`storeDraft`, route "review"); then the review's stages in today's order
// (src/server/rules/signing-review.ts): the client's details and the offer's stored text read (`reviewStored`), the
// offer's agreements (`reviewExisting`), the review's time and New York date, the client the key names (a new client id
// drawn only when none has it) and the MSA the offer reuses (`reviewParty`), the two templates (`reviewTemplates`), the
// MSA's id (unless one is reused) and the SOW's drawn and the documents rendered (`reviewTexts`) and hashed, the client's
// MSAs of the template (`reviewPendingMsa`), then A2's time and the event's id, and the batch (`reviewDocuments`). The
// stages and the batch run through `alwaysDecideAndSave`: a lost pending MSA, or the client changed by another request
// (the store's ChangedSinceRead), reads and decides again from the client's details, three tries in all, each drawing its
// ids and reading the clock where the route always has; a third is SaveKeptChanging. Any other guard of the batch is
// GuardRefused, not retried.
import * as Effect from "effect/Effect";
import { hashOfferToken } from "../../lib/software-offers";
import { hashing } from "../agreement-services";
import {
	readClientByKey,
	readOfferAgreements,
	readPendingMsa,
	readReusedMsa,
	readSigningEnabled,
	readTemplate,
	reviewBatch,
} from "../agreement-store";
import { alwaysDecideAndSave } from "../guarded-save";
import type { RawValue } from "../../lib/fields";
import { newYorkDay } from "../rules/agreement-record";
import type { SigningSessionFacts } from "../rules/signing-draft";
import type { LinkedOfferRow } from "../rules/signing-offer";
import {
	documentFront,
	type ReviewFrontRequest,
	type ReviewOffer,
	type ReviewSession,
	reviewDocument,
	reviewDocuments,
	reviewExisting,
	reviewFront,
	reviewParty,
	reviewPendingMsa,
	reviewStored,
	reviewTemplates,
	reviewTexts,
} from "../rules/signing-review";
import { storeDraft } from "./signing-draft";
import { offerOfToken, offerSession } from "./signing-front";

type ReviewClock = {
	/** The page's offer token, as it arrived. */
	readonly token: string | undefined;
	/** The visitor's request, for the signing session its cookie may name. */
	readonly request: Request;
	/** The time, read at each point the flow needs it, as the route always has. */
	readonly now: () => Date;
};

export type ReviewDocumentRequest = ReviewClock & {
	/** The query's first `document` value, or null when it has none. */
	readonly documentId: string | null;
};

/** The GET: the document's kind and text, for the visitor's review session. */
export const readReviewDocument = (request: ReviewDocumentRequest) =>
	Effect.gen(function* () {
		const offer = yield* offerOfToken(request.token);

		const session =
			offer === null
				? null
				: yield* offerSession(request.request, offer, request.now);

		const setting = session === null ? null : yield* readSigningEnabled();

		const held = yield* documentFront.decide(null, {
			offer,
			session,
			software_signing_enabled: setting?.software_signing_enabled ?? null,
		});

		// SAFETY: `documentFront` refused unless a sent offer is linked by the token.
		const { id } = offer as LinkedOfferRow;
		const agreements = yield* readOfferAgreements(id);

		return yield* reviewDocument.decide(
			{ documentId: request.documentId, sessionTokenHash: held.token_hash },
			agreements,
		);
	});

/** The clock and the ids the review's stages read and draw. */
export type ReviewDraws = {
	/** The time, read at each point the stages need it, as the route always has. */
	readonly now: () => Date;
	/** A new id: the client's (when none has the key), the MSA's (unless one is reused), the SOW's, then the event's. */
	readonly newId: () => string;
};

export type ReviewRequest = ReviewClock &
	ReviewDraws & {
		/** The body's nonce and the client's details, as they arrived (`nonce` undefined when the reader refused the body). */
		readonly body: ReviewFrontRequest;
	};

/** One try of the review's stages, from the client's details to the batch's write. */
const reviewWrite = (
	request: ReviewDraws,
	offer: ReviewOffer,
	session: ReviewSession,
	client: RawValue,
) =>
	Effect.gen(function* () {
		const stored = yield* reviewStored.decide(
			{ client, session },
			{
				terms_json: offer.terms_json,
				agreement_details_json: offer.agreement_details_json,
				contractor_snapshot_json: offer.contractor_snapshot_json,
			},
		);

		const existing = yield* readOfferAgreements(offer.id).pipe(
			Effect.flatMap((rows) => reviewExisting.decide(null, rows)),
		);

		const at = request.now().toISOString();
		const effectiveOn = newYorkDay(request.now());
		const previous = yield* readClientByKey(stored.key);
		const newClientId = previous === null ? request.newId() : null;
		const reusedMsa = yield* readReusedMsa(offer.reused_msa_id);

		const party = yield* reviewParty.decide(
			{ offer, newClientId },
			{ client: previous, reusedMsa },
		);

		const msaTemplate = yield* readTemplate(party.msaTemplateId);
		const sowTemplate = yield* readTemplate(offer.sow_template_id);

		const templates = yield* reviewTemplates.decide(null, {
			msa: msaTemplate,
			sow: sowTemplate,
		});

		const msaId = party.reused === null ? request.newId() : null;
		const sowId = request.newId();

		const texts = yield* reviewTexts.decide(
			{ offer, stored, party, templates, msaId, sowId, effectiveOn },
			null,
		);

		const hashes = yield* Effect.forEach(texts.documents, (document) =>
			hashing(() => hashOfferToken(document.text)),
		);

		yield* readPendingMsa(party.clientId, templates.msa.id).pipe(
			Effect.flatMap((rows) =>
				reviewPendingMsa.decide({ offer, party, templates }, rows),
			),
		);

		// As the batch is built: A2's own time, then the event's id.
		const sessionNow = request.now().toISOString();
		const eventId = request.newId();

		return yield* reviewDocuments.decide(
			{
				offer,
				session,
				stored,
				existing,
				party,
				templates,
				texts,
				hashes,
				at,
				sessionNow,
				eventId,
			},
			null,
		);
	});

/**
 * The review's stages and its batch, once the front checks passed and the draft is saved, for the client's details as
 * `resolveClientDetails` resolved them: through `alwaysDecideAndSave`, three tries when another request changed a fact
 * the review decided from. Answers the documents and the reused MSA.
 */
export const reviewAndStore = (
	request: ReviewDraws,
	offer: ReviewOffer,
	session: ReviewSession,
	client: RawValue,
) =>
	alwaysDecideAndSave({
		facts: reviewWrite(request, offer, session, client),
		decide: (write) => Effect.succeed(write),
		save: reviewBatch,
	}).pipe(Effect.map((reviewed) => reviewed.decided.answer));

/** The POST: the documents written for the client to sign, and the route's answer. */
export const reviewSigningDocuments = (request: ReviewRequest) =>
	Effect.gen(function* () {
		const offer = yield* offerOfToken(request.token);

		const session =
			offer === null
				? null
				: yield* offerSession(request.request, offer, request.now);

		// Read whether or not there is a session, as the route always has.
		const setting = yield* readSigningEnabled();

		const facts: SigningSessionFacts = {
			offer,
			session,
			software_signing_enabled: setting?.software_signing_enabled ?? null,
		};

		const front = yield* reviewFront.decide(request.body, facts);

		// SAFETY: `reviewFront` refused unless a sent offer is linked by the token.
		const linked = offer as LinkedOfferRow;

		yield* storeDraft({
			offer: linked,
			session: front.session,
			signingSetting: facts.software_signing_enabled,
			body: request.body,
			route: "review",
			now: request.now,
		});

		return yield* reviewAndStore(request, linked, front.session, front.client);
	});
