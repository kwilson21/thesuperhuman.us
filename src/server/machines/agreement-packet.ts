import { setup } from "xstate";
import { next, sourcesOf } from "./next";

// The signed copy of one agreement (the PDF packet), as docs/plans/2026-11-signing-conversion.md, section 1 ("The signed
// copy") draws it. `software_agreement_artifacts.status` holds the four states. Countersign inserts the row at pending.
// An attempt claims it from pending or failed while its archive is open (CLAIM, A15) and then ends it ready or failed
// (READY and FAIL, written only by the attempt that claimed it, A16). The owner recovers a rendering packet whose attempt
// is at least a minute old and the one the owner saw (RECOVER, A17); the guard reads the row's own `recoverable` fact.
// The waiting state is saved before pdf-lib and R2 run, so no bridge is needed: two compare-and-set writes around the
// outside work. Ready has no moves.

/** The stored statuses, in the order of the column's CHECK (migrations/music/0023_software_signing.sql). */
export const PACKET_STATUSES = [
	"pending",
	"rendering",
	"ready",
	"failed",
] as const;

export type PacketStatus = (typeof PACKET_STATUSES)[number];

/** The stored moves of a packet. */
export const PACKET_EVENTS = ["CLAIM", "READY", "FAIL", "RECOVER"] as const;

export type PacketEvent = (typeof PACKET_EVENTS)[number];

export const agreementPacket = setup({}).createMachine({
	id: "agreementPacket",
	initial: "pending",
	context: { recoverable: false },
	states: {
		pending: { on: { CLAIM: { target: "rendering" } } },
		rendering: {
			on: {
				READY: { target: "ready" },
				FAIL: { target: "failed" },
				RECOVER: ({ context }) =>
					context.recoverable ? { target: "failed" } : undefined,
			},
		},
		ready: { type: "final" },
		failed: { on: { CLAIM: { target: "rendering" } } },
	},
});

/** Whether a packet in this status may take the move; `recoverable` is the owner's confirmation of a stale attempt. */
export const packetAllows = (
	status: PacketStatus,
	event: PacketEvent,
	recoverable = false,
) => next(agreementPacket, status, event, { recoverable }) !== null;

const statusesOf = (event: PacketEvent, recoverable: boolean) =>
	sourcesOf(agreementPacket, event, { recoverable }).flatMap((source) =>
		PACKET_STATUSES.filter((status) => status === source),
	);

/** The statuses each event is allowed from, read from the machine once. RECOVER is listed for a confirmed, stale attempt. */
export const PACKET_MOVES = {
	CLAIM: statusesOf("CLAIM", false),
	READY: statusesOf("READY", false),
	FAIL: statusesOf("FAIL", false),
	RECOVER: statusesOf("RECOVER", true),
};
