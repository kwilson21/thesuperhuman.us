// Saving the signing form's draft (POST /api/offer/[token]/draft; today the route's checks, then `saveAgreementDraft` in
// src/lib/agreement-draft.ts). Staged in the route's order, each stage deciding on what was read so far
// (docs/plans/2026-11-signing-conversion.md, sections 2 and 3):
//   1. `draftFront`, from the sent offer the token names (`linkedOffer`; read first), the visitor's signing session
//      (`visitorSession`: open, and its offer still sent to it; read only for an offer) and the signing setting (read only
//      with a session): SessionMissing unless all three hold and the session is the offer's; then the body's nonce:
//      CsrfMismatch; then the values (`readDraft`): DraftRefused, with the errors by field.
//   2. `saveSigningDraft`, with the offer's agreements and a project of the offer, read just before the batch because
//      only its guards checked them before: the same three, then SigningStarted (the project A1 checks) and AlreadySigned
//      (A3), in the batch's order. It writes the upsert of the draft.
// Re-checked at write time by the batch's A1 (`liveSigningGuard`: the offer still open for signing), A2 (`sessionGuard`:
// the session unexpired and unrevoked; at read time `openSession` of src/server/rules/agreement-session.ts decides it,
// through `visitorSession`) and A3 (no agreement of the offer client-signed or executed), in that order. A raised guard is
// GuardRefused, not retried, and answers what SigningStarted and AlreadySigned answer.
//
// The route's answers: SessionMissing 401, CsrfMismatch 403, DraftRefused 400 with `errors`, SigningStarted and
// AlreadySigned 409 "Your details could not be saved. Check the fields and try again." (SigningStarted's own `say` is the
// signing link's sentence, so the draft route words it from AlreadySigned's).
import * as Data from "effect/Data";
import {
	type AgreementDraft,
	parseDraft,
	readDraft,
} from "../../lib/agreement-draft-fields";
import type { RawValue } from "../../lib/fields";
import { AGREEMENT_SIGNED } from "../machines/agreement-document";
import { alwaysWrites, term, unless } from "../terms";
import type { StoredAgreementSession } from "./agreement-session";
import { SigningStarted } from "./signing-offer";

/**
 * No sent offer is linked by the token, the visitor holds no open signing session for it, or signing is off: 401. The
 * review's POST and the sign route answer the same sentence for the same three.
 */
export class SessionMissing extends Data.TaggedError("SessionMissing") {
	readonly say =
		"Open a fresh email link to keep going. Your saved details will be here.";
}

/** The body's nonce is not the session's: 403. The review and the sign routes answer the same sentence. */
export class CsrfMismatch extends Data.TaggedError("CsrfMismatch") {
	readonly say = "Reload and try again.";
}

/** The values do not read as a draft: 400 with `errors`, by field. */
export class DraftRefused extends Data.TaggedError("DraftRefused")<{
	readonly errors: Readonly<Record<string, string>>;
}> {
	readonly say = "Check the highlighted details.";
}

/**
 * An agreement of the offer is client-signed or executed (A3): 409 on the draft. The review answers it with its own 409
 * sentence, "The agreement could not be reviewed." (plan section 2).
 */
export class AlreadySigned extends Data.TaggedError("AlreadySigned") {
	readonly say =
		"Your details could not be saved. Check the fields and try again.";
}

/** What the route has read before the nonce: the offer, the visitor's session and the signing setting. */
export type SigningSessionFacts = {
	/** The sent offer the token names (`linkedOffer`), or null when there is none. */
	readonly offer: { readonly id: string } | null;
	/** The visitor's open signing session (`visitorSession`), or null: none, or not read because there is no offer. */
	readonly session: StoredAgreementSession | null;
	/** The signing setting as stored; null when its row is missing, or when it was not read because there is no session. */
	readonly software_signing_enabled: number | null;
};

/** The two fields the draft body carries, as they arrived (a body that is not an object carries neither). */
export type DraftBody = {
	readonly nonce: RawValue;
	readonly values: RawValue;
};

type FrontGiven = {
	readonly offerId: string | null;
	readonly session: StoredAgreementSession | null;
	readonly signingOn: boolean;
	readonly nonce: RawValue;
	readonly read: ReturnType<typeof readDraft>;
};

const frontGiven = (
	request: DraftBody,
	facts: SigningSessionFacts,
): FrontGiven => ({
	offerId: facts.offer?.id ?? null,
	session: facts.session,
	signingOn: Boolean(facts.software_signing_enabled),
	nonce: request.nonce,
	read: readDraft(request.values),
});

/** The visitor holds an open signing session for the sent offer the token names, and signing is on. */
export const sessionHeld = unless(
	term(
		"a sent offer is linked by the token, the visitor holds an open signing session for it, and signing is on",
		(given: {
			readonly offerId: string | null;
			readonly session: StoredAgreementSession | null;
			readonly signingOn: boolean;
		}) =>
			given.offerId !== null &&
			given.session !== null &&
			given.session.offer_id === given.offerId &&
			given.signingOn,
	),
	() => new SessionMissing(),
);

/** The body's nonce is the session's (compared as it arrived: anything but the same text is refused). */
export const nonceMatches = unless(
	term(
		"the body's nonce is the session's",
		(given: {
			readonly session: StoredAgreementSession | null;
			readonly nonce: RawValue;
		}) => given.session !== null && given.nonce === given.session.csrf_nonce,
	),
	() => new CsrfMismatch(),
);

const draftReads = unless(
	term("the values read as a draft", (given: FrontGiven) => given.read.ok),
	(given: FrontGiven) =>
		new DraftRefused({ errors: given.read.ok ? {} : given.read.errors }),
);

/** The visitor's session and the draft it read, once the front checks passed. */
export type DraftFront = {
	readonly session: StoredAgreementSession;
	readonly draft: AgreementDraft;
};

/** The session and the draft, for both stages' `writes`, which run only once every refusal passed. */
const frontOf = (given: FrontGiven): DraftFront => {
	// SAFETY: `sessionHeld` passed, which ruled out a missing session.
	const session = given.session as StoredAgreementSession;

	// SAFETY: `draftReads` passed, which ruled out values that did not read.
	const read = given.read as { readonly value: AgreementDraft };

	return { session, draft: read.value };
};

/** Stage 1: the session, the nonce and the values, before anything else is read. */
export const draftFront = alwaysWrites({
	name: "a draft: the visitor's session, its nonce and the values",
	given: frontGiven,
	refusals: [sessionHeld, nonceMatches, draftReads],
	writes: frontOf,
	writesText: "nothing yet: the offer's agreements and a project are read next",
});

/** An agreement of the offer as stored: the columns A3 reads. */
export type StoredAgreementStatus = {
	readonly offer_id: string | null;
	readonly status: string;
};

/** What only the batch's guards checked before, read just before it: the offer's agreements and a project of the offer. */
export type DraftSaveFacts = SigningSessionFacts & {
	readonly agreements: readonly StoredAgreementStatus[];
	readonly project: { readonly offer_id: string } | null;
};

export type DraftSaveRequest = DraftBody & {
	/** The draft's `updated_at`, read as the batch is built (after A2's own time). */
	readonly at: Date;
	/**
	 * Which route saves the draft. The draft route hands `saveAgreementDraft` the values its own read answered, so they are
	 * read a second time as they are stored; the review hands it the body's values, so they are read once
	 * (`src/pages/api/offer/[token]/draft.ts` and `review.ts`).
	 */
	readonly route: "draft" | "review";
};

type SaveGiven = FrontGiven & {
	readonly started: boolean;
	readonly signed: boolean;
	readonly at: string;
	readonly route: DraftSaveRequest["route"];
};

/** The draft batch: A1, A2 and A3 with these binds, then the upsert. */
export type DraftWrite = {
	readonly offerId: string;
	/** The session's address: the draft's key with the offer, and A1's recipient. */
	readonly recipient: string;
	/** A1's link: the session's. */
	readonly linkHash: string | null;
	/** A2's session. */
	readonly sessionHash: string;
	/** The draft as stored today: read again for the draft route, as read for the review. */
	readonly values_json: string;
	readonly updated_at: string;
};

/**
 * Stage 2: the draft is saved. The front checks again, then no project of the offer (the part of A1 that only the guard
 * checked before) and no agreement of the offer client-signed or executed (A3). For the draft route the values are read a
 * second time as they are stored, as `saveAgreementDraft` reads the value the route already read: a value whose NFC form
 * outgrows its field's limit reads once but not twice, and that second read throws `FieldsRefused`, a defect (today the
 * route's logged 500). The review passes the body's values, which `saveAgreementDraft` reads once, so its draft is
 * stored as the front's read answered it.
 */
export const saveSigningDraft = alwaysWrites({
	name: "save the signing form's draft",
	given: (request: DraftSaveRequest, facts: DraftSaveFacts): SaveGiven => {
		const front = frontGiven(request, facts);

		return {
			...front,
			started:
				facts.project !== null && facts.project.offer_id === front.offerId,
			signed: facts.agreements.some(
				(agreement) =>
					agreement.offer_id === front.offerId &&
					AGREEMENT_SIGNED.some((status) => status === agreement.status),
			),
			at: request.at.toISOString(),
			route: request.route,
		};
	},
	refusals: [
		sessionHeld,
		nonceMatches,
		draftReads,
		unless(
			term(
				"no project exists for the offer",
				(given: SaveGiven) => !given.started,
			),
			() => new SigningStarted(),
		),
		unless(
			term(
				"no agreement of the offer is client-signed or executed",
				(given: SaveGiven) => !given.signed,
			),
			() => new AlreadySigned(),
		),
	],
	writes: (given): DraftWrite => {
		const { session, draft } = frontOf(given);

		return {
			// SAFETY: `sessionHeld` passed, which ruled out a missing offer.
			offerId: given.offerId as string,
			recipient: session.recipient_email,
			linkHash: session.link_hash,
			sessionHash: session.token_hash,
			values_json: JSON.stringify(
				given.route === "draft" ? parseDraft(draft) : draft,
			),
			updated_at: given.at,
		};
	},
	writesText:
		"the draft of the offer and the session's address, upserted with its time, re-checked by A1, A2 and A3",
});
