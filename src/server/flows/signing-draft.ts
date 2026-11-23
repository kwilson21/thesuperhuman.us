// Saving the signing form's draft (POST /api/offer/[token]/draft; docs/plans/2026-11-signing-conversion.md, section 3),
// in the order the route has always kept: the sent offer the token names, the visitor's signing session for it (read
// only for an offer) and the signing setting (read only with a session); then the nonce and the values (`draftFront`,
// src/server/rules/signing-draft.ts); then the offer's agreements and a project of the offer, which only the batch's
// guards checked before, and `saveSigningDraft`; then the batch (A1, A2, A3, the upsert), whose raised guard is
// GuardRefused and is not retried. `storeDraft` is the second half, which the review runs first as well, with the
// values it read once (`route: "review"`).
import * as Effect from "effect/Effect";
import type { RawValue } from "../../lib/fields";
import {
	readDraftFacts,
	readSigningEnabled,
	saveDraftBatch,
} from "../agreement-store";
import type { StoredAgreementSession } from "../rules/agreement-session";
import {
	type DraftBody,
	draftFront,
	type DraftSaveRequest,
	type SigningSessionFacts,
	saveSigningDraft,
} from "../rules/signing-draft";
import type { LinkedOfferRow } from "../rules/signing-offer";
import { offerOfToken, offerSession } from "./signing-front";

export type DraftRequest = {
	/** The page's offer token, as it arrived. */
	readonly token: string | undefined;
	/** The visitor's request, for the signing session its cookie may name. */
	readonly request: Request;
	/** The body's nonce and values, as they arrived. */
	readonly body: DraftBody;
	/** The time, read at each point the flow needs it, as the route always has. */
	readonly now: () => Date;
};

/**
 * The draft's batch, once the front checks passed: the offer's agreements and a project of the offer read just before
 * it, `saveSigningDraft` (which reads the values a second time for the draft route, as today), and the batch. A2's own
 * time is read as the batch is built, then the draft's `updated_at`, as today's statements read them.
 */
export const storeDraft = (input: {
	readonly offer: LinkedOfferRow;
	readonly session: StoredAgreementSession;
	readonly signingSetting: number | null;
	readonly body: DraftBody;
	readonly route: DraftSaveRequest["route"];
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const read = yield* readDraftFacts(input.offer.id);
		const sessionNow = input.now().toISOString();

		const write = yield* saveSigningDraft.decide(
			{ ...input.body, at: input.now(), route: input.route },
			{
				offer: input.offer,
				session: input.session,
				software_signing_enabled: input.signingSetting,
				agreements: read.agreements,
				project: read.project,
			},
		);

		yield* saveDraftBatch(write, sessionNow);
	});

/** The offer, the visitor's session for it and the signing setting, each read only when the one before it is there. */
const signingFacts = (request: DraftRequest) =>
	Effect.gen(function* () {
		const offer = yield* offerOfToken(request.token);

		const session =
			offer === null
				? null
				: yield* offerSession(request.request, offer, request.now);

		const setting = session === null ? null : yield* readSigningEnabled();

		return {
			offer,
			session,
			software_signing_enabled: setting?.software_signing_enabled ?? null,
		} satisfies SigningSessionFacts;
	});

export const saveSigningFormDraft = (request: DraftRequest) =>
	Effect.gen(function* () {
		const facts = yield* signingFacts(request);
		const front = yield* draftFront.decide(request.body, facts);

		// SAFETY: `draftFront` refused unless a sent offer is linked by the token.
		const offer = facts.offer as LinkedOfferRow;

		yield* storeDraft({
			offer,
			session: front.session,
			signingSetting: facts.software_signing_enabled,
			body: request.body,
			route: "draft",
			now: request.now,
		});
	});

/** The two fields a draft body is read for: anything else it holds is left out, as the route has always read it. */
export const draftBody = (body: RawValue): DraftBody => {
	// SAFETY: this names the two body fields the route reads; the nonce is compared to the session's and the values go to readDraft, so neither is used unchecked. A body that is not an object (a JSON null included) carries neither, so it gets the 403 of a missing nonce.
	const fields = (body ?? {}) as { csrf_nonce?: RawValue; values?: RawValue };

	return { nonce: fields.csrf_nonce, values: fields.values };
};
