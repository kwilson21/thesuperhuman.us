// What claiming and recovering an agreement's signed copy (its PDF packet) decides, from the packet row as read
// (docs/plans/2026-11-signing-conversion.md, sections 1 and 2; today's `prepareAgreementArtifact` and
// `recoverAgreementRendering` in src/lib/agreement-artifacts.ts, and the retry-artifact action of
// src/pages/api/owner/requests/[id]/agreement.ts). Whether a status may move is the machine's answer (`PACKET_MOVES`,
// src/server/machines/agreement-packet.ts).
// - `packetClaimable`: an attempt claims the packet from pending or failed (CLAIM) while its agreement's archive is open;
//   otherwise there is nothing to do, as today's claim that changes no row returns without rendering. Re-checked at
//   write time by the claim's own compare-and-set (A15).
// - The outcome has no rule ahead of it: ready, or failed with the step the attempt reached (render, storage or
//   readback), is written only by the attempt that claimed the packet while it is still rendering (READY and FAIL, A16),
//   so a packet the owner recovered meanwhile, or another attempt claimed, is left as it is.
// - `packetRecoverable`: the owner's recovery of a stale attempt. Nothing to do when the owner named no attempt;
//   otherwise refused unless the owner confirmed it and the packet is rendering under that attempt, started at least a
//   minute before `now` (RECOVER). Re-checked at write time by the recovery's compare-and-set (A17); a recovery whose
//   write changes no row is answered with the same refusal, as today.
// Pure: the time and the attempt id are inputs.
import * as Data from "effect/Data";
import { PACKET_MOVES, type PacketStatus } from "../machines/agreement-packet";
import { rule, term, unless } from "../terms";

/** How old an attempt must be before the owner may recover it as stale. */
export const PACKET_STALE_MS = 60_000;

/** A packet row as the claim reads it, with its agreement's `archive_closed_at` (read through the agreement). */
export type StoredPacket = {
	readonly status: PacketStatus;
	readonly attempt_id: string | null;
	readonly attempted_at: string | null;
	readonly archive_closed_at: string | null;
};

/** A packet row as the recovery reads it. */
export type StoredPacketAttempt = Pick<
	StoredPacket,
	"status" | "attempt_id" | "attempted_at"
>;

/** What the claim writes: the packet rendering under this attempt, from `attempted_at`, with no error. */
export type PacketClaim = {
	readonly status: "rendering";
	readonly attempt_id: string;
	readonly attempted_at: string;
	readonly error_code: null;
};

/** What the recovery writes, and the attempt and cutoff its compare-and-set re-checks. */
export type PacketRecovery = {
	readonly status: "failed";
	readonly error_code: "render";
	readonly attempt_id: string;
	readonly staleBefore: string;
};

/** The owner did not confirm the stale attempt, or the packet is no longer rendering under it, or it is under a minute old. */
export class StaleAttemptUnconfirmed extends Data.TaggedError(
	"StaleAttemptUnconfirmed",
) {
	readonly say = "Check the stale preparation attempt before recovery.";
}

type ClaimGiven = {
	readonly claimable: boolean;
	readonly attempt: string;
	readonly at: string;
};

/** The packet is claimed for rendering by this attempt, or nothing happens when it cannot be. */
export const packetClaimable = rule({
	name: "claim an agreement's packet for rendering",
	given: (
		request: { readonly attempt: string; readonly at: Date },
		facts: StoredPacket | null,
	): ClaimGiven => ({
		claimable:
			facts !== null &&
			PACKET_MOVES.CLAIM.includes(facts.status) &&
			facts.archive_closed_at === null,
		attempt: request.attempt,
		at: request.at.toISOString(),
	}),
	nothingToDoIf: term(
		"there is no packet, it is not pending or failed, or its agreement's archive is closed",
		(given: ClaimGiven) => !given.claimable,
	),
	refusals: [],
	writes: (given): PacketClaim => ({
		status: "rendering",
		attempt_id: given.attempt,
		attempted_at: given.at,
		error_code: null,
	}),
	writesText:
		"the packet rendering under this attempt, from now, with no error",
});

type RecoverGiven = {
	readonly named: string | null;
	readonly confirmed: boolean;
	readonly staleBefore: string;
	readonly packet: StoredPacketAttempt | null;
};

/** The owner's recovery of a stale attempt: nothing when no attempt is named, else the attempt the owner saw, failed at render. */
export const packetRecoverable = rule({
	name: "recover a stale packet attempt the owner confirmed",
	given: (
		request: {
			readonly expectedAttempt: string | undefined;
			readonly confirmedStale: boolean;
			readonly now: Date;
		},
		facts: StoredPacketAttempt | null,
	): RecoverGiven => ({
		named: request.expectedAttempt ? request.expectedAttempt : null,
		confirmed: request.confirmedStale,
		staleBefore: new Date(
			request.now.getTime() - PACKET_STALE_MS,
		).toISOString(),
		packet: facts,
	}),
	nothingToDoIf: term(
		"the owner named no attempt to recover",
		(given: RecoverGiven) => given.named === null,
	),
	refusals: [
		unless(
			term(
				"the owner confirmed the attempt is stale",
				(given: RecoverGiven) => given.confirmed,
			),
			() => new StaleAttemptUnconfirmed(),
		),
		unless(
			term(
				"the packet is rendering under the attempt the owner saw, started at least a minute ago",
				(given: RecoverGiven) =>
					given.packet !== null &&
					PACKET_MOVES.RECOVER.includes(given.packet.status) &&
					given.packet.attempt_id === given.named &&
					given.packet.attempted_at !== null &&
					given.packet.attempted_at <= given.staleBefore,
			),
			() => new StaleAttemptUnconfirmed(),
		),
	],
	writes: (given): PacketRecovery => ({
		status: "failed",
		error_code: "render",
		// SAFETY: `writes` runs only after `nothingToDoIf` did not hold, which ruled out a missing attempt.
		attempt_id: given.named as string,
		staleBefore: given.staleBefore,
	}),
	writesText:
		"the packet failed at render, for the attempt the owner saw and the cutoff its write compares",
});
