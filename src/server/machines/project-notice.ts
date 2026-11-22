import { setup } from "xstate";
import { next, sourcesOf } from "./next";

// The delivery of one notice to the client, as docs/plans/2026-11-audio-projects-conversion.md, section 1 ("A notice") draws
// it. `audio_projects.invitation_status` (the invitation) and `audio_project_updates.notification_status` (an update's notice)
// share the four values and the three statements (queue, claim, outcome), so one machine covers both. A notice starts at
// pending when the project or the update is saved. QUEUE is the owner sending it again: from pending or failed at once, and
// from sending only when the owner confirmed it did not go out and the last attempt is older than the cutoff (the guard reads
// the row's own `retryable` fact, which the store writes into SQL as `?=1 AND attempted_at<=?`). CLAIM is a delivery taking
// it, SEND and FAIL its outcomes; an outcome that is uncertain writes nothing, so the notice stays at sending for the owner to
// judge. Sent has no moves.

/** The stored statuses, in the order of the columns' CHECK. */
export const NOTICE_STATUSES = [
	"pending",
	"sending",
	"sent",
	"failed",
] as const;

export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** The stored moves of a notice. */
export const NOTICE_EVENTS = ["QUEUE", "CLAIM", "SEND", "FAIL"] as const;

export type NoticeEvent = (typeof NOTICE_EVENTS)[number];

export const projectNotice = setup({}).createMachine({
	id: "projectNotice",
	initial: "pending",
	context: { retryable: false },
	states: {
		pending: {
			on: {
				QUEUE: { target: "pending" },
				CLAIM: { target: "sending" },
			},
		},
		sending: {
			on: {
				QUEUE: ({ context }) =>
					context.retryable ? { target: "pending" } : undefined,
				SEND: { target: "sent" },
				FAIL: { target: "failed" },
			},
		},
		sent: { type: "final" },
		failed: { on: { QUEUE: { target: "pending" } } },
	},
});

/** Whether a notice in this status may take the move; `retryable` is the owner's confirmation with an attempt past the cutoff. */
export const noticeAllows = (
	status: NoticeStatus,
	event: NoticeEvent,
	retryable = false,
) => next(projectNotice, status, event, { retryable }) !== null;

const statusesOf = (event: NoticeEvent, retryable: boolean) =>
	sourcesOf(projectNotice, event, { retryable }).flatMap((source) =>
		NOTICE_STATUSES.filter((status) => status === source),
	);

/**
 * The statuses each event is allowed from, read from the machine once. QUEUE has two lists: the statuses it takes whatever
 * was confirmed, and the one it also takes once the owner confirmed and the attempt is past the cutoff.
 */
export const NOTICE_MOVES = {
	QUEUE: statusesOf("QUEUE", false),
	QUEUE_RETRYABLE: statusesOf("QUEUE", true).filter(
		(status) => !statusesOf("QUEUE", false).includes(status),
	),
	CLAIM: statusesOf("CLAIM", false),
	SEND: statusesOf("SEND", false),
	FAIL: statusesOf("FAIL", false),
};
