// What queueing, claiming and delivering a notice to the client decides, for the invitation and for an update's notice, from
// the facts the flow read (docs/plans/2026-11-audio-projects-conversion.md, sections 2 and 4). The two kinds share the machine
// and the three statements but not their conditions, so each rule takes the kind and states that kind's own: the invitation's
// queue needs an open project and a request that is a service, not withdrawn, with an email; an update's queue needs
// an open project and a request not withdrawn with an email. Their claims are compare-and-set writes with no rule ahead of
// them (the invitation's needs a pending notice, an open project and a request that is a service, not withdrawn, with an email; an
// update's needs only a pending notice, so a closed project's update notice is claimed, finds no recipient and ends failed). The invitation's outcome write needs an open
// project, the update notice's does not. Each decision is re-checked at write time by the write's own conditions in
// src/server/audio-project-store.ts (I1, I3 to I5, N1, N3 to N5), so a request that lost a race is refused by the write and is
// not retried. The access also closes in the owner status area through the trigger audio_project_close_declined_request
// (migration 0015). The 60 second window after which a notice stuck in `sending` may be queued again is named once, here.
import * as Data from "effect/Data";
import { type NoticeStatus, NOTICE_MOVES } from "../machines/project-notice";
import { alwaysWrites, rule, term, unless } from "../terms";

/** How long after an attempt a notice stuck in `sending` may be queued again, once the owner confirmed it did not go out. */
export const NOTICE_STALE_MS = 60_000;

/** The kind of notice: the project's invitation or an update's email. */
export type NoticeKind = "invitation" | "update";

/** The notice cannot be queued again here. 409, with the sentence of its kind. */
export class NoticeNotQueueable extends Data.TaggedError("NoticeNotQueueable")<{
	readonly kind: NoticeKind;
}> {
	get say() {
		return this.kind === "invitation"
			? "This invitation cannot be sent again here."
			: "This email cannot be retried here.";
	}
}

/** The request a notice is about, as stored. */
export type StoredNoticeRequest = {
	readonly kind: string;
	readonly status: string;
	readonly email: string;
};

/** The request and the project's access, as a delivery reads them to find the recipient. */
export type StoredRecipient = StoredNoticeRequest & {
	readonly revoked_at: string | null;
};

type NoticeFacts = {
	readonly notice: {
		readonly status: NoticeStatus;
		readonly attempted_at: string | null;
	} | null;
	readonly project: { readonly revoked_at: string | null } | null;
	readonly request: StoredNoticeRequest | null;
};

const reachable = (request: StoredNoticeRequest | null, kind: NoticeKind) =>
	request !== null &&
	request.status !== "withdrawn" &&
	request.email !== "" &&
	(kind === "invitation" ? request.kind === "service" : true);

type QueueGiven = NoticeFacts & {
	readonly kind: NoticeKind;
	readonly confirmed: boolean;
	readonly staleBefore: string;
};

/**
 * The notice is queued again: pending or failed, or sending after the owner confirmed it did not go out and the last attempt is
 * at least the cutoff old; the project is open and the request is one a notice of this kind goes to.
 */
export const queueNotice = alwaysWrites({
	name: "queue a notice again",
	given: (
		request: {
			readonly kind: NoticeKind;
			readonly confirmed: boolean;
			readonly now: Date;
		},
		facts: NoticeFacts,
	): QueueGiven => ({
		...facts,
		kind: request.kind,
		confirmed: request.confirmed,
		staleBefore: new Date(
			request.now.getTime() - NOTICE_STALE_MS,
		).toISOString(),
	}),
	refusals: [
		unless(
			term(
				"the notice is pending or failed, or sending after the owner confirmed it did not go out and the attempt is past the cutoff",
				(given: QueueGiven) =>
					given.notice !== null &&
					(NOTICE_MOVES.QUEUE.includes(given.notice.status) ||
						(NOTICE_MOVES.QUEUE_RETRYABLE.includes(given.notice.status) &&
							given.confirmed &&
							given.notice.attempted_at !== null &&
							given.notice.attempted_at <= given.staleBefore)),
			),
			(given: QueueGiven) => new NoticeNotQueueable({ kind: given.kind }),
		),
		unless(
			term(
				"the project's access is open",
				(given: QueueGiven) =>
					given.project !== null && given.project.revoked_at === null,
			),
			(given: QueueGiven) => new NoticeNotQueueable({ kind: given.kind }),
		),
		unless(
			term(
				"the request is not withdrawn, has an email and, for the invitation, is a service",
				(given: QueueGiven) => reachable(given.request, given.kind),
			),
			(given: QueueGiven) => new NoticeNotQueueable({ kind: given.kind }),
		),
	],
	writes: (given) => ({
		confirmed: given.confirmed,
		staleBefore: given.staleBefore,
	}),
	writesText: "the owner's confirmation and the cutoff the write compares",
});

/**
 * Whom the notice goes to: the request's email when the project's access is open and the request is one a notice of this
 * kind goes to; no one otherwise, which is a failed delivery and not a refusal.
 */
export const recipientOf = alwaysWrites({
	name: "find the recipient of a notice",
	given: (
		request: { readonly kind: NoticeKind },
		facts: StoredRecipient | null,
	) => ({ kind: request.kind, recipient: facts }),
	refusals: [],
	writes: (given): string | null =>
		given.recipient !== null &&
		given.recipient.revoked_at === null &&
		reachable(given.recipient, given.kind)
			? given.recipient.email
			: null,
	writesText: "the recipient's email, or no one",
});

/** What the mail provider did, with `null` for a delivery that had no one to send to or no way to send. */
export type MailOutcome =
	| "sent"
	| "refused"
	| "uncertain"
	| "unconfigured"
	| null;

/**
 * What the delivery writes once the provider answered: sent, or failed when the provider refused, was not asked or there was no
 * recipient. An uncertain answer writes nothing: the notice stays `sending` for the owner to judge, and a retry then needs the
 * owner's confirmation.
 */
export const deliveryOutcome = rule({
	name: "settle a notice's delivery",
	given: (request: { readonly mail: MailOutcome }, _facts: null) =>
		request.mail,
	nothingToDoIf: term(
		"the provider's answer is uncertain",
		(mail: MailOutcome) => mail === "uncertain",
	),
	refusals: [],
	writes: (mail): "sent" | "failed" => (mail === "sent" ? "sent" : "failed"),
	writesText: "the status the notice ends in",
});
