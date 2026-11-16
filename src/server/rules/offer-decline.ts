// Declining a software request: the owner withdraws its offers, closes its link and emails the client, and the request is
// resolved once the email went out. Its reads come between its decisions, so the rule is staged, each stage deciding on
// what was read so far, in the order the route has always answered (docs/plans/2026-11-offers-conversion.md, section 2):
//   1. the request and whether a project started: ProjectStarted, RequestClosed (declineFront);
//   2. every invoice of the request: DepositOpenOnDecline, then AlreadyResolved, the machine's refusal of DECLINE from
//      resolved (declineDeposits);
//   3. whether a live link was made in the last 20 seconds: OfferStillSending (declineNotSending);
//      then the flow checks the mail settings (F8, a 503 with nothing written);
//   4. a signed agreement and an audio project, read just before the first batch, where only its guards checked them
//      before: AgreementSigned, AudioProjectExists (declineRequest), which writes the first batch;
//   5. after the client email, whether an offer of the request is still draft or sent (F10, #331): OfferLeftAfterEmail
//      (resolveDeclined), which writes the second batch.
// The machine moves DECLINE through `declining`, which invokes the email and lands on resolved once the client email was
// accepted; that landing is what the second batch saves. Re-checked at write time: the first batch by G3 (no signed
// agreement), G1 (the request as read), G5 (no live link made in the last 20 seconds), G4 (no first deposit that may still
// be charged), G6 (no audio project) and G2 (no project); the second by G1 with the updated_at the first batch wrote, G2,
// G5, G6 and no draft or sent offer. A refused batch, and the refusals of stages 4 and 5, are answered by the reads in
// src/server/rules/offer-refused-batch.ts. The resolve fires none of the five writing triggers of issue #242:
// `audio_project_close_declined_request` fires only for kind `service`.
import * as Data from "effect/Data";
import { OFFER_MOVES, type OfferMove } from "../machines/offer-version";
import type { RequestStatus } from "../machines/software-request";
import { alwaysWrites, term, unless } from "../terms";
import { type DepositsRead, noOpenDepositOnDecline } from "./offer-deposit";
import {
	type EmailWords,
	noProjectStarted,
	noSignedAgreement,
	notSending,
	type ProjectRead,
	type Requested,
	type RequestRead,
	requestOpen,
	requestRead,
	retireSigning,
	type SendingRead,
	type SigningRetired,
	signedText,
	statusAllows,
	writeTime,
} from "./software-request";

export class AlreadyResolved extends Data.TaggedError("AlreadyResolved") {
	readonly say = "This request is already resolved.";
}

/** An audio project exists for the request (G6). Answered as a refused batch is: the request changed. */
export class AudioProjectExists extends Data.TaggedError("AudioProjectExists") {
	readonly say =
		"The request changed or could not be saved. Reload and try again.";
}

/**
 * After the client email, an offer of the request is still draft or sent: saved, or saved and sent, while the email was
 * in flight (F10). The request is not resolved; answered as a refused second batch is.
 */
export class OfferLeftAfterEmail extends Data.TaggedError(
	"OfferLeftAfterEmail",
) {
	readonly say =
		"The client email was sent, but the request changed before it could be recorded. Reload before taking another action.";
}

/** Stage 1: no project has started and the request is open. */
export const declineFront = alwaysWrites({
	name: "decline: no project has started and the request is open",
	given: (_request: null, facts: Requested & ProjectRead) => facts,
	refusals: [noProjectStarted, requestOpen("DECLINE")],
	writes: () => ({}),
	writesText: "nothing: the request's invoices are read next",
});

/** Stage 2: no first deposit may still be charged, and the request's status allows DECLINE. */
export const declineDeposits = alwaysWrites({
	name: "decline: no deposit may still be charged, and the request is not resolved",
	given: (_request: null, facts: Requested & DepositsRead) => facts,
	refusals: [
		noOpenDepositOnDecline,
		statusAllows("DECLINE", () => new AlreadyResolved()),
	],
	writes: () => ({}),
	writesText: "nothing: the sending window is read next",
});

/** Stage 3: no offer is still being sent. */
export const declineNotSending = alwaysWrites({
	name: "decline: no offer is still being sent",
	given: (_request: null, facts: SendingRead) => facts,
	refusals: [notSending],
	writes: () => ({}),
	writesText: "nothing: the mail settings are checked next",
});

export type DeclineRequest = {
	/** The decline's text, trimmed by the command reader. */
	readonly text: string;
	readonly now: string;
	readonly actor: string;
};

type DeclineGiven = Requested & {
	readonly command: DeclineRequest;
	readonly signedAgreement: boolean;
	readonly audioProject: boolean;
};

/**
 * The first batch and the email. The batch: G3, G1 over `request`, G5, G4 (decline mode), G6, G2; the draft and sent
 * offers withdrawn (`withdraw`, from the machine); signing retired; the live links revoked, the request's updated_at, all
 * at `at`; and the audit.
 */
export type DeclineWrite = {
	readonly request: RequestRead;
	readonly at: string;
	readonly actor: string;
	readonly withdraw: OfferMove;
	readonly signing: SigningRetired;
	readonly audit: {
		readonly action: "offer-link-revoked";
		readonly note: "Offer withdrawn and link closed to decline the request";
	};
	/** The client's address: the request's email, as stored. */
	readonly to: string;
	readonly email: EmailWords;
};

/** Stage 4: no signed agreement and no audio project, read just before the first batch. */
export const declineRequest = alwaysWrites({
	name: "decline the request: withdraw its offers, close its link and email the client",
	given: (
		command: DeclineRequest,
		facts: Requested & {
			readonly signedAgreement: boolean;
			readonly audioProject: boolean;
		},
	): DeclineGiven => ({ command, ...facts }),
	refusals: [
		noSignedAgreement,
		unless(
			term(
				"the request has no audio project",
				(given: DeclineGiven) => !given.audioProject,
			),
			() => new AudioProjectExists(),
		),
	],
	writes: (given): DeclineWrite => {
		const at = writeTime(given.command.now, given.request.updatedAt);

		return {
			request: requestRead(given.request),
			at,
			actor: given.command.actor,
			withdraw: OFFER_MOVES.WITHDRAW,
			signing: retireSigning(at),
			audit: {
				action: "offer-link-revoked",
				note: "Offer withdrawn and link closed to decline the request",
			},
			to: given.request.email,
			email: {
				subject: "About your project brief",
				text: signedText(given.command.text),
			},
		};
	},
	writesText:
		"the offers withdrawn, signing retired, the live links revoked, the request's updated_at and the audit offer-link-revoked, in one batch; then the client email and its copy",
});

type ResolveGiven = {
	readonly write: DeclineWrite;
	readonly landed: RequestStatus;
	readonly offerLeft: boolean;
};

/** The second batch: G1 with the updated_at the first wrote, G2, G5, G6 and no offer in `noOfferIn`; then the resolve. */
export type ResolveWrite = {
	readonly request: RequestRead;
	readonly at: string;
	readonly actor: string;
	/** The status the machine landed on: resolved. */
	readonly status: RequestStatus;
	/** The offer statuses a decline withdraws, of which none may be left (F10): the read and the guard. */
	readonly noOfferIn: OfferMove["from"];
	readonly audit: "declined";
};

/** Stage 5, after the client email was accepted: no offer of the request is draft or sent. */
export const resolveDeclined = alwaysWrites({
	name: "resolve the declined request once the client email went out",
	given: (
		command: { readonly write: DeclineWrite; readonly landed: RequestStatus },
		facts: { readonly offerLeft: boolean },
	): ResolveGiven => ({ ...command, ...facts }),
	refusals: [
		unless(
			term(
				"no offer of the request is draft or sent",
				(given: ResolveGiven) => !given.offerLeft,
			),
			() => new OfferLeftAfterEmail(),
		),
	],
	writes: (given): ResolveWrite => ({
		request: { ...given.write.request, updatedAt: given.write.at },
		at: given.write.at,
		actor: given.write.actor,
		status: given.landed,
		noOfferIn: given.write.withdraw.from,
		audit: "declined",
	}),
	writesText:
		"the request resolved at the first batch's time, and the audit declined, in one batch",
});
