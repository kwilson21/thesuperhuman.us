import { setup } from "xstate";
import { next, sourcesOf } from "./next";

// One email of the signing area, a copy of the signed agreement or a signing notice, as
// docs/plans/2026-11-signing-conversion.md, section 1 ("A copy or a signing notice") draws it.
// `software_agreement_deliveries.status` and `software_agreement_notifications.status` share the four values. Sign
// inserts the two notices at pending and countersign the two copies. A delivery claims one (CLAIM, A18 or A19) and ends it
// sent or failed by its attempt (SEND, FAIL); an uncertain answer writes nothing, so it stays at sending for the owner to
// judge. A signing notice still sending when its agreement is countersigned or abandoned is failed (OBSOLETE, A21). The
// owner resets one to pending (RESET, A20): from failed at once, and from sending only when the owner confirmed it did not
// go out and the attempt is at least a minute old (the guard reads the row's own `retryable` fact). Unlike the audio
// notices' QUEUE, RESET never matches a pending row (agreement.ts's two reset statements), so this area has its own
// machine. Sent has no moves.

/** The stored statuses, in the order of the columns' CHECK (migrations/music/0023_software_signing.sql). */
export const MESSAGE_STATUSES = [
	"pending",
	"sending",
	"sent",
	"failed",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** The stored moves of a copy or a notice. */
export const MESSAGE_EVENTS = [
	"CLAIM",
	"SEND",
	"FAIL",
	"OBSOLETE",
	"RESET",
] as const;

export type MessageEvent = (typeof MESSAGE_EVENTS)[number];

export const agreementMessage = setup({}).createMachine({
	id: "agreementMessage",
	initial: "pending",
	context: { retryable: false },
	states: {
		pending: { on: { CLAIM: { target: "sending" } } },
		sending: {
			on: {
				SEND: { target: "sent" },
				FAIL: { target: "failed" },
				OBSOLETE: { target: "failed" },
				RESET: ({ context }) =>
					context.retryable ? { target: "pending" } : undefined,
			},
		},
		sent: { type: "final" },
		failed: { on: { RESET: { target: "pending" } } },
	},
});

/** Whether a message in this status may take the move; `retryable` is the owner's confirmation with an attempt past the cutoff. */
export const messageAllows = (
	status: MessageStatus,
	event: MessageEvent,
	retryable = false,
) => next(agreementMessage, status, event, { retryable }) !== null;

const statusesOf = (event: MessageEvent, retryable: boolean) =>
	sourcesOf(agreementMessage, event, { retryable }).flatMap((source) =>
		MESSAGE_STATUSES.filter((status) => status === source),
	);

/**
 * The statuses each event is allowed from, read from the machine once. RESET has two lists: the statuses it takes
 * whatever was confirmed, and the one it also takes once the owner confirmed and the attempt is past the cutoff.
 */
export const MESSAGE_MOVES = {
	CLAIM: statusesOf("CLAIM", false),
	SEND: statusesOf("SEND", false),
	FAIL: statusesOf("FAIL", false),
	OBSOLETE: statusesOf("OBSOLETE", false),
	RESET: statusesOf("RESET", false),
	RESET_RETRYABLE: statusesOf("RESET", true).filter(
		(status) => !statusesOf("RESET", false).includes(status),
	),
};
