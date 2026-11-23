// The client's signature (POST /api/offer/[token]/sign; docs/plans/2026-11-signing-conversion.md, section 3), in the
// order the route has always kept: the sent offer the token names, the visitor's signing session for it (read only for an
// offer) and the signing setting (always read), decided with the body and its nonce (`signFront`); then the signature's
// stages (src/server/rules/signing-sign.ts): the offer's agreements and the documents named (`documentsToSign`); for a
// repeat, the saved receipt (`savedReceipt`); otherwise the time, the receipt id, the client's saved draft, the notice's,
// each signature's and each event's ids, and `signDocuments`; then what only the batch's guards checked before, read
// just before it (`stillSignable`); and the batch at A2's own time (A1, A2, A7, A8, A9), whose raised guard is
// GuardRefused, not retried. Once the signatures are saved, the SOW's signing notices go out: the offer's agreements read
// again (part of the notices step, Q3), then `deliverNotices` (src/server/flows/agreement-messages.ts); a store or mail
// failure there is ignored by name, so the client gets the receipt, and the owner's retry sends what did not go out.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	readOfferAgreements,
	readSavedDraft,
	readSavedReceipt,
	readSigningEnabled,
	readStillSignable,
	signBatch,
} from "../agreement-store";
import type { SoftwareOffer } from "../../lib/software-offers";
import type { StoredAgreementSession } from "../rules/agreement-session";
import type { LinkedOfferRow } from "../rules/signing-offer";
import {
	documentsToSign,
	type NamedDocument,
	type SignFrontRequest,
	savedReceipt,
	signDocuments,
	signedSow,
	signFront,
	stillSignable,
} from "../rules/signing-sign";
import { deliverNotices } from "./agreement-messages";
import { offerOfToken, offerSession } from "./signing-front";

export type SignRequest = {
	/** The page's offer token, as it arrived. */
	readonly token: string | undefined;
	/** The visitor's request: the signing session its cookie may name, and the browser evidence. */
	readonly request: Request;
	readonly body: SignFrontRequest["body"];
	/** The sender of the notices (env.CONTACT_FROM_EMAIL; unused when the mail is not configured). */
	readonly from: string;
	/** The site origin the owner's notice links to. */
	readonly origin: string;
	/** The time, read at each point the flow needs it, as the route always has. */
	readonly now: () => Date;
	/** A new id: the receipt's, the notice's, each document's signature and event, then each notice attempt's. */
	readonly newId: () => string;
};

/** What the signature proper reads and draws besides the store: the visitor's request (the browser evidence), the clock, ids. */
export type SignDraws = Pick<SignRequest, "request" | "now" | "newId">;

/**
 * The signature proper, once the front checks passed: the saved receipt of a repeat, or the new receipt once the batch
 * committed. The notices are not sent here.
 */
export const signAndStore = (
	request: SignDraws,
	offer: Pick<SoftwareOffer, "id" | "reused_msa_id">,
	session: StoredAgreementSession,
	named: readonly NamedDocument[],
) =>
	Effect.gen(function* () {
		const chosen = yield* readOfferAgreements(offer.id).pipe(
			Effect.flatMap((rows) => documentsToSign.decide({ named }, rows)),
		);

		if (chosen.kind === "repeat")
			return yield* readSavedReceipt(chosen.agreementId).pipe(
				Effect.flatMap((saved) => savedReceipt.decide({ session }, saved)),
			);

		const at = request.now().toISOString();
		const receipt = request.newId();
		const draft = yield* readSavedDraft(offer.id, session.recipient_email);

		// The ids the batch's statements bind, drawn in the order the route has always built them: the notice, then each
		// document's signature and event.
		const ids = {
			receipt,
			notice: request.newId(),
			documents: chosen.documents.map(() => ({
				signature: request.newId(),
				event: request.newId(),
			})),
		};

		const headers = request.request.headers;

		const write = yield* signDocuments.decide(
			{
				at,
				ids,
				session,
				offer,
				named,
				address: headers.get("cf-connecting-ip"),
				userAgent: headers.get("user-agent"),
			},
			{ chosen, draft },
		);

		yield* readStillSignable(offer, session).pipe(
			Effect.flatMap((facts) =>
				stillSignable.decide(
					{ at, session, offer, documents: chosen.documents },
					facts,
				),
			),
		);

		// A2's own time, read as the batch is built.
		yield* signBatch(write, request.now().toISOString());

		return write.receiptId;
	});

/** The SOW's signing notices, after the signatures are saved: the agreements read again, then the delivery. */
const notices = (request: SignRequest, offer: LinkedOfferRow) =>
	Effect.gen(function* () {
		const sow = yield* readOfferAgreements(offer.id).pipe(
			Effect.flatMap((rows) => signedSow.decide(null, rows)),
		);

		if (Option.isNone(sow)) return;

		yield* deliverNotices({
			agreementId: sow.value,
			from: request.from,
			origin: request.origin,
			now: request.now,
			newId: request.newId,
		});
	});

/** The POST: the receipt of the client's signature. */
export const signSigningDocuments = (request: SignRequest) =>
	Effect.gen(function* () {
		const offer = yield* offerOfToken(request.token);

		const session =
			offer === null
				? null
				: yield* offerSession(request.request, offer, request.now);

		// Read whether or not there is a session, as the route always has.
		const setting = yield* readSigningEnabled();

		const front = yield* signFront.decide(
			{ body: request.body },
			{
				offer,
				session,
				software_signing_enabled: setting?.software_signing_enabled ?? null,
			},
		);

		// SAFETY: `signFront` refused unless a sent offer is linked by the token.
		const linked = offer as LinkedOfferRow;

		const receipt = yield* signAndStore(
			request,
			linked,
			front.session,
			front.named,
		);

		// Saved signatures survive a failed read or notice: each is ignored by name (Q3).
		yield* notices(request, linked).pipe(
			Effect.catchTags({
				AgreementStoreFailed: () => Effect.void,
				AgreementMailFailed: () => Effect.void,
			}),
		);

		return receipt;
	});
