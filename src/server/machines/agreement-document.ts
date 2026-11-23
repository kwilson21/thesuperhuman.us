import { setup } from "xstate";
import { next, sourcesOf } from "./next";

// One agreement document (an MSA or an SOW), as docs/plans/2026-11-signing-conversion.md, section 1 ("The agreement
// document") draws it. `software_agreements.status` holds the four states. A review inserts the row in review; a second
// review of the same offer deletes the review rows and inserts new ones (REVIEW from review). The client signs (SIGN),
// the owner countersigns (COUNTERSIGN) or abandons a client-signed signing (ABANDON); a send, reissue, revoke or decline
// of the offer retires a document still in review (RETIRE, the offers store's `retireSigning`). The owner ends an
// executed or abandoned agreement (END), and puts any agreement on hold or records an outside copy of it (HOLD and
// RECORD_COPY, which today read no status). A closed archive is not a state: retention sets `archive_closed_at` on an
// executed or abandoned agreement and later deletes the row, and the rules read it as a fact.

/** The stored statuses, in the order of the column's CHECK (migrations/music/0023_software_signing.sql). */
export const AGREEMENT_STATUSES = [
	"review",
	"client_signed",
	"executed",
	"abandoned",
] as const;

export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** The stored moves of a document. */
export const AGREEMENT_EVENTS = [
	"REVIEW",
	"SIGN",
	"RETIRE",
	"COUNTERSIGN",
	"ABANDON",
	"END",
	"HOLD",
	"RECORD_COPY",
] as const;

export type AgreementEvent = (typeof AGREEMENT_EVENTS)[number];

export const agreementDocument = setup({}).createMachine({
	id: "agreementDocument",
	initial: "review",
	states: {
		review: {
			on: {
				REVIEW: { target: "review" },
				SIGN: { target: "client_signed" },
				RETIRE: { target: "abandoned" },
				HOLD: { target: "review" },
				RECORD_COPY: { target: "review" },
			},
		},
		client_signed: {
			on: {
				COUNTERSIGN: { target: "executed" },
				ABANDON: { target: "abandoned" },
				HOLD: { target: "client_signed" },
				RECORD_COPY: { target: "client_signed" },
			},
		},
		executed: {
			on: {
				END: { target: "executed" },
				HOLD: { target: "executed" },
				RECORD_COPY: { target: "executed" },
			},
		},
		abandoned: {
			on: {
				END: { target: "abandoned" },
				HOLD: { target: "abandoned" },
				RECORD_COPY: { target: "abandoned" },
			},
		},
	},
});

/** Whether a document in this status may take the move. */
export const agreementAllows = (
	status: AgreementStatus,
	event: AgreementEvent,
) => next(agreementDocument, status, event) !== null;

const statusesOf = (event: AgreementEvent) =>
	sourcesOf(agreementDocument, event).flatMap((source) =>
		AGREEMENT_STATUSES.filter((status) => status === source),
	);

/** The statuses each event is allowed from, read from the machine once; the store builds its `status IN (...)` lists from these. */
export const AGREEMENT_MOVES = {
	REVIEW: statusesOf("REVIEW"),
	SIGN: statusesOf("SIGN"),
	RETIRE: statusesOf("RETIRE"),
	COUNTERSIGN: statusesOf("COUNTERSIGN"),
	ABANDON: statusesOf("ABANDON"),
	END: statusesOf("END"),
	HOLD: statusesOf("HOLD"),
	RECORD_COPY: statusesOf("RECORD_COPY"),
};

/**
 * The statuses that mean the client has signed and the signing was not abandoned: where SIGN and then COUNTERSIGN lead.
 * While a document of the offer is in one of them there is no new review and no draft (A3); a test holds the list to
 * those moves.
 */
export const AGREEMENT_SIGNED: readonly AgreementStatus[] = [
	"client_signed",
	"executed",
];
