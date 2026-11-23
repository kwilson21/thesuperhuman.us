// What the signing area's emails decide: claiming a copy of the signed agreement or a signing notice for sending, what a
// send writes once the provider answered, and which of them the owner's retry resets
// (docs/plans/2026-11-signing-conversion.md, sections 1 and 2; today's `deliverAgreementCopies` and
// `deliverAgreementNotifications` in src/lib/agreement-artifacts.ts, and the two reset statements of the retry-copy
// action in src/pages/api/owner/requests/[id]/agreement.ts). Whether a status may move is the machine's answer (`MESSAGE_MOVES`,
// src/server/machines/agreement-message.ts). Nothing is refused: a row that cannot move is skipped, as today.
// - `copySigned`, then `copyClaimable`: a party with no signature is skipped before an attempt is drawn, as today; then
//   the copy is claimed only when it is pending (CLAIM) and its agreement is executed with its archive open. Re-checked
//   at write time by the claim's compare-and-set (A18), which re-checks the copy and its agreement, not the signature
//   (retention deletes a signature only with its agreement, after closing its archive, which the claim refuses).
// - `noticeAgreementFound`, then `noticeClaimable`: nothing is drawn when the agreement is gone, as today; then, per kind,
//   a signing notice is claimed only when it is pending and current: its agreement is client_signed, its archive open,
//   and its request has no project (today's `currentSigningNotification`). Re-checked at write time by the claim's
//   compare-and-set (A19).
// - `messageOutcome`: an accepted send is sent, a refused one failed, and an uncertain one writes nothing, so the row stays
//   sending for the owner to judge. The write is made only by the attempt that claimed the row while it is still sending
//   (SEND and FAIL, A18 and A19), a compare-and-set with no read ahead of it.
// - `messagesToReset`: the owner's retry moves a copy or a current notice back to pending from failed (RESET), or from
//   sending once the owner confirmed it did not go out and its attempt is at least a minute old (RESET once retryable);
//   never from pending. Each table is decided with its own `now`, as today's two statements each read the clock.
//   Re-checked at write time by the reset statements themselves, which keep the same condition (A20).
// A notice still sending when its agreement is countersigned or abandoned is failed in that batch by a write-time filter
// with no rule (OBSOLETE, A21). Pure: the time and the attempt id are inputs.
import type { MailOutcome } from "../agreement-services";
import {
	MESSAGE_MOVES,
	type MessageStatus,
} from "../machines/agreement-message";
import { alwaysWrites, rule, term } from "../terms";

/** How old an attempt stuck in `sending` must be before the owner may reset it, once they confirmed it did not go out. */
export const MESSAGE_STALE_MS = 60_000;

/** A copy of the signed agreement to one party, as stored (software_agreement_deliveries). */
export type StoredCopy = {
	readonly recipient_role: string;
	readonly status: MessageStatus;
	readonly attempted_at: string | null;
};

/** A signing notice, as stored (software_agreement_notifications). */
export type StoredNotice = {
	readonly kind: string;
	readonly status: MessageStatus;
	readonly attempted_at: string | null;
};

/** The agreement a copy or a notice is about, as read with it: its status, its archive, and a project of its request. */
export type MessageAgreement = {
	readonly status: string;
	readonly archive_closed_at: string | null;
	/** The `request_id` of the software project of the agreement's request, or null when it has none. */
	readonly project_request_id: string | null;
};

/** A copy goes out only for an executed agreement whose archive is open. */
const copyCurrent = (agreement: MessageAgreement | null) =>
	agreement !== null &&
	agreement.status === "executed" &&
	agreement.archive_closed_at === null;

/** A signing notice is current while its agreement awaits the countersignature, its archive is open and no project started. */
const noticeCurrent = (agreement: MessageAgreement | null) =>
	agreement !== null &&
	agreement.status === "client_signed" &&
	agreement.archive_closed_at === null &&
	agreement.project_request_id === null;

/** What a claim writes: the row sending under this attempt, from `attempted_at`. */
export type MessageClaim = {
	readonly status: "sending";
	readonly attempt_id: string;
	readonly attempted_at: string;
};

type ClaimRequest = { readonly attempt: string; readonly at: Date };

type ClaimGiven = {
	readonly claimable: boolean;
	readonly attempt: string;
	readonly at: string;
};

const claimed = (given: ClaimGiven): MessageClaim => ({
	status: "sending",
	attempt_id: given.attempt,
	attempted_at: given.at,
});

const notClaimable = (text: string) =>
	term(text, (given: ClaimGiven) => !given.claimable);

/** What one party's copy is decided on: the party's signature, the copy, and its agreement. */
export type CopyClaimFacts = {
	/** The party's signature on the agreement, or null when the party has none. */
	readonly signature: { readonly receipt_id: string } | null;
	readonly copy: StoredCopy | null;
	readonly agreement: MessageAgreement | null;
};

/** The party's signature, as today's copy delivery reads it before it draws an attempt. */
export type CopySignatureFacts = {
	readonly signature: { readonly receipt_id: string } | null;
};

/**
 * Stage 1 of a party's copy: today's delivery skips a party with no signature before it draws the attempt
 * (`deliverAgreementCopies`, the `continue` before `crypto.randomUUID()`), so a flow decides this first and draws the
 * attempt and the time only for a party that signed; `copyClaimable` then decides the claim with them. Deciding both at
 * once would draw an attempt for a party with no signature and move every id drawn after it (golden retry-copy "the
 * client signature row is missing").
 */
export const copySigned = rule({
	name: "consider a party's copy only once the party signed",
	given: (_request: null, facts: CopySignatureFacts) => facts,
	nothingToDoIf: term(
		"the party has not signed",
		(given: CopySignatureFacts) => given.signature === null,
	),
	refusals: [],
	// A gate: what it answers is handed to the flow, which saves nothing for it.
	// SAFETY: `writes` runs only when `nothingToDoIf` did not hold, which ruled out a missing signature.
	writes: (given) => given.signature as { readonly receipt_id: string },
	writesText:
		"nothing: the flow draws the attempt and the time, then decides the claim",
});

/** Stage 2 of a party's copy: claimed for sending by the attempt drawn after `copySigned`, or skipped. */
export const copyClaimable = rule({
	name: "claim a party's copy of the signed agreement for sending",
	given: (request: ClaimRequest, facts: CopyClaimFacts): ClaimGiven => ({
		claimable:
			facts.signature !== null &&
			facts.copy !== null &&
			MESSAGE_MOVES.CLAIM.includes(facts.copy.status) &&
			copyCurrent(facts.agreement),
		attempt: request.attempt,
		at: request.at.toISOString(),
	}),
	nothingToDoIf: notClaimable(
		"the party has not signed, the copy is not pending, or its agreement is not executed or its archive is closed",
	),
	refusals: [],
	writes: claimed,
	writesText: "the copy sending under this attempt, from now",
});

/** What one signing notice is decided on: the notice and its agreement. */
export type NoticeClaimFacts = {
	readonly notice: StoredNotice | null;
	readonly agreement: MessageAgreement | null;
};

/** The agreement as today's notice delivery reads it first: its request and the client's receipt, or null. */
export type NoticeAgreementRow = {
	readonly request_id: string;
	readonly receipt_id: string | null;
};

/**
 * Stage 1 of the signing notices: today's delivery returns when the agreement is gone, before it draws any attempt
 * (`deliverAgreementNotifications`, `if (!agreement) return`), so a flow decides this first and then, for each kind in
 * order, draws the attempt and the time and asks `noticeClaimable`.
 */
export const noticeAgreementFound = rule({
	name: "consider the signing notices only while their agreement exists",
	given: (_request: null, facts: NoticeAgreementRow | null) => ({
		agreement: facts,
	}),
	nothingToDoIf: term(
		"the agreement is gone",
		(given: { readonly agreement: NoticeAgreementRow | null }) =>
			given.agreement === null,
	),
	refusals: [],
	// A gate: what it answers is handed to the flow, which saves nothing for it.
	// SAFETY: `writes` runs only when `nothingToDoIf` did not hold, which ruled out a missing agreement.
	writes: (given) => given.agreement as NoticeAgreementRow,
	writesText:
		"nothing: for each kind, the flow draws the attempt and the time, then decides the claim",
});

/** Stage 2 of a signing notice: claimed for sending by the attempt drawn for its kind, or skipped. */
export const noticeClaimable = rule({
	name: "claim a signing notice for sending",
	given: (request: ClaimRequest, facts: NoticeClaimFacts): ClaimGiven => ({
		claimable:
			facts.notice !== null &&
			MESSAGE_MOVES.CLAIM.includes(facts.notice.status) &&
			noticeCurrent(facts.agreement),
		attempt: request.attempt,
		at: request.at.toISOString(),
	}),
	nothingToDoIf: notClaimable(
		"the notice is not pending, or its agreement is not client_signed, its archive is closed or a project started",
	),
	refusals: [],
	writes: claimed,
	writesText: "the notice sending under this attempt, from now",
});

/** What a send writes once the provider answered: the status, when it was sent, and the copy's event. */
export type MessageSettled = {
	readonly status: "sent" | "failed";
	readonly sent_at: string | null;
	/** The event a copy's outcome records (a notice records none). */
	readonly action: "copy-delivered" | "delivery-failed";
};

type OutcomeGiven = { readonly mail: MailOutcome; readonly at: string };

/** Sent when the provider accepted, failed when it refused, and nothing written when its answer is uncertain. */
export const messageOutcome = rule({
	name: "settle a copy's or a notice's send",
	given: (
		request: { readonly mail: MailOutcome; readonly at: Date },
		_facts: null,
	): OutcomeGiven => ({ mail: request.mail, at: request.at.toISOString() }),
	nothingToDoIf: term(
		"the provider's answer is uncertain",
		(given: OutcomeGiven) => given.mail === "uncertain",
	),
	refusals: [],
	writes: (given): MessageSettled =>
		given.mail === "sent"
			? { status: "sent", sent_at: given.at, action: "copy-delivered" }
			: { status: "failed", sent_at: null, action: "delivery-failed" },
	writesText:
		"sent with the time, or failed with none, and the copy's event to match",
});

/** The rows one reset statement is decided on: an agreement's copies, or its notices with the agreement. */
export type ResetFacts =
	| { readonly copies: readonly StoredCopy[] }
	| {
			readonly notices: readonly StoredNotice[];
			readonly agreement: MessageAgreement | null;
	  };

/** What a reset writes, and the confirmation and cutoff its statement compares. */
export type MessageReset = {
	readonly status: "pending";
	/** The roles (copies) or kinds (notices) the reset moves back to pending; none when nothing can move. */
	readonly keys: readonly string[];
	readonly confirmed: boolean;
	readonly staleBefore: string;
};

/** The rows the owner's retry moves back to pending, and what its statement binds. Every row that cannot move is skipped. */
export const messagesToReset = alwaysWrites({
	name: "reset the copies or the current notices the owner retries",
	given: (
		request: { readonly confirmedNotSent: boolean; readonly now: Date },
		facts: ResetFacts,
	): MessageReset => {
		const staleBefore = new Date(
			request.now.getTime() - MESSAGE_STALE_MS,
		).toISOString();

		const rows =
			"copies" in facts
				? facts.copies.map((copy) => ({ ...copy, key: copy.recipient_role }))
				: noticeCurrent(facts.agreement)
					? facts.notices.map((notice) => ({ ...notice, key: notice.kind }))
					: [];

		return {
			status: "pending",
			keys: rows
				.filter(
					(row) =>
						MESSAGE_MOVES.RESET.includes(row.status) ||
						(MESSAGE_MOVES.RESET_RETRYABLE.includes(row.status) &&
							request.confirmedNotSent &&
							row.attempted_at !== null &&
							row.attempted_at <= staleBefore),
				)
				.map((row) => row.key),
			confirmed: request.confirmedNotSent,
			staleBefore,
		};
	},
	refusals: [],
	writes: (given) => given,
	writesText:
		"each failed row, and each row sending past the cutoff once the owner confirmed it, back to pending",
});

/** The two signing notices, in the order today's delivery takes them. */
export const NOTICE_KINDS = [
	"signature-receipt",
	"countersign-notice",
] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * A signing notice's words, as today's delivery writes them (`deliverAgreementNotifications`): the client's receipt, or
 * the owner's link to the request to countersign (`origin` is the site's).
 */
export function noticeMessage(
	kind: NoticeKind,
	agreement: NoticeAgreementRow,
	origin: string,
) {
	return kind === "signature-receipt"
		? {
				subject: "Your signature is saved",
				text: `Your signature is saved. Waiting for Kazon to countersign. The project has not started. Receipt: ${agreement.receipt_id}`,
			}
		: {
				subject: "Agreement ready for countersignature",
				text: `A client signature is saved. Review the exact agreement before countersigning: ${new URL(`/owner/requests/${agreement.request_id}`, origin).href}`,
			};
}
