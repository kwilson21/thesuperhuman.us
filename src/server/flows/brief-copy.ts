// The client's copy of a software brief, for the public form (the first copy, sent when the brief is stored) and for the owner
// (who resends it). A copy is claimed before the provider is asked, so that two senders at once never both send it: the
// request is read, the rule judges it (src/server/rules/brief-copy.ts), and the claim writes only while the row is still as
// it was read; a lost claim reads and is judged again, three tries in all (src/server/guarded-save.ts). The provider is asked
// only by the sender that won the claim, and the answer is recorded over that sender's own attempt, so another sender's
// claim is never overwritten. verification/brief-copy.qnt models the claim.
//
// A claim that could not be written, or (for the public form) a request that could not be read, is recorded as a failure over a copy with no status; an answer that could not be recorded
// leaves the claim, so a copy the provider may have sent is never sent again without the owner's confirmation. Each of these
// logs the line it always has, and ends in a named failure: the owner's route answers it, and the public form answers the
// status the copy has (`sendFirstBriefCopy`). Time is an input (`now`), taken once at the start.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { briefCopyMessage } from "../../lib/client-emails";
import { alwaysDecideAndSave, decideAndSave } from "../guarded-save";
import {
	claimCopy,
	type IntakeStoreFailed,
	readCopyFacts,
	recordCopyStatus,
	recordOwnFailure,
	recordUnclaimedFailure,
	recordUnreadFailure,
} from "../intake-store";
import {
	type ClaimWrite,
	type CopyFacts,
	firstCopy,
	resendCopy,
	unclaimedFailure,
} from "../rules/brief-copy";
import { ClientCopyMail, type ClientCopyOutcome } from "../services";

/** The claim could not be written: nothing was sent, and a failure was recorded where the copy had no status. */
export class CopyClaimFailed extends Data.TaggedError("CopyClaimFailed")<{
	readonly failure: unknown;
}> {}

/**
 * The provider's answer could not be recorded. `status` is what the copy is as far as anyone knows: "uncertain" after the
 * provider was asked (the claim stays, and the copy is not sent again without the owner's confirmation), "failed" when the
 * provider was never asked.
 */
export class CopyNotRecorded extends Data.TaggedError("CopyNotRecorded")<{
	readonly failure: unknown;
	readonly status: "uncertain" | "failed";
}> {}

/** The copy could not be built from the stored brief (its answers cannot be turned into text): nothing was sent, and a failure was recorded over this attempt. */
export class CopyNotBuilt extends Data.TaggedError("CopyNotBuilt")<{
	readonly failure: unknown;
}> {}

/** What the provider did, and the status the copy now records. */
export type CopyDelivery = {
	readonly outcome: ClientCopyOutcome;
	readonly status: "sent" | "failed" | "uncertain";
};

const statusOf = (outcome: ClientCopyOutcome): CopyDelivery["status"] => {
	if (outcome === "sent") return "sent";

	return outcome === "uncertain" ? "uncertain" : "failed";
};

const say = (line: string) => Effect.sync(() => console.error(line));

const stateIs = (status: string) =>
	say(`Client brief copy state is ${status}.`);

const NOT_RECORDED = "Client brief copy failure could not be recorded.";

/**
 * The copy could not be claimed: a failure is recorded where the copy has no status (`unclaimedFailure` decides, and the
 * write compares what was read, or only that no status is there when the request could not be read), and a failure to record
 * it is logged.
 */
const recordClaimFailure = (
	id: string,
	found: CopyFacts | null,
	read: boolean,
) =>
	Effect.gen(function* () {
		const recorded = yield* unclaimedFailure.decide({ id, read }, { found });

		if (Option.isNone(recorded)) return;
		const write = recorded.value;

		yield* (
			write.expected === null
				? recordUnreadFailure(write.id)
				: recordUnclaimedFailure({ id: write.id, expected: write.expected })
		).pipe(Effect.catchTag("IntakeStoreFailed", () => say(NOT_RECORDED)));
	});

/** The claim could not be written: the failure is recorded where the copy has no status, then named. */
const claimFailed = (
	id: string,
	seen: Ref.Ref<CopyFacts | null>,
	failure: IntakeStoreFailed,
) =>
	Effect.gen(function* () {
		yield* recordClaimFailure(id, yield* Ref.get(seen), true);
		yield* stateIs("failed");

		return yield* Effect.fail(
			new CopyClaimFailed({ failure: failure.failure }),
		);
	});

/** The provider was never asked: a failure is recorded over this attempt, and the state is logged as failed. */
const failedBeforeAsking = (write: ClaimWrite) =>
	Effect.gen(function* () {
		yield* recordOwnFailure(write.request.id, write.at).pipe(
			Effect.catchTag("IntakeStoreFailed", () => say(NOT_RECORDED)),
		);
		yield* stateIs("failed");
	});

/** The answer could not be recorded: a provider that was never asked leaves a failure behind, one that was asked leaves the claim. */
const notRecorded = (
	write: ClaimWrite,
	outcome: ClientCopyOutcome,
	failure: IntakeStoreFailed,
) =>
	Effect.gen(function* () {
		if (outcome !== "unconfigured") {
			yield* stateIs("uncertain");

			return yield* Effect.fail(
				new CopyNotRecorded({
					failure: failure.failure,
					status: "uncertain",
				}),
			);
		}

		yield* failedBeforeAsking(write);

		return yield* Effect.fail(
			new CopyNotRecorded({ failure: failure.failure, status: "failed" }),
		);
	});

/** The copy is claimed: the provider is asked, once, and its answer is recorded over this attempt. */
const sendClaimed = (write: ClaimWrite) =>
	Effect.gen(function* () {
		const mail = yield* ClientCopyMail;

		const message = yield* Effect.try({
			try: () => briefCopyMessage(write.request),
			catch: (failure) => new CopyNotBuilt({ failure }),
		}).pipe(Effect.tapError(() => failedBeforeAsking(write)));

		const outcome = yield* mail.send(message);
		const status = statusOf(outcome);

		yield* recordCopyStatus(write.request.id, write.at, status).pipe(
			Effect.catchTag("IntakeStoreFailed", (failure) =>
				notRecorded(write, outcome, failure),
			),
		);

		return { outcome, status } satisfies CopyDelivery;
	});

/** The read of the request, remembering what it saw so that a claim that cannot be written is recorded over it. */
const readFacts = (id: string, seen: Ref.Ref<CopyFacts | null>) =>
	readCopyFacts(id).pipe(Effect.tap((found) => Ref.set(seen, found)));

/** The claim, which names its own failure. */
const saveClaim =
	(id: string, seen: Ref.Ref<CopyFacts | null>) => (write: ClaimWrite) =>
		claimCopy(write).pipe(
			Effect.catchTag("IntakeStoreFailed", (failure) =>
				claimFailed(id, seen, failure),
			),
		);

/** The owner resends the copy of the request `id`. Every refusal and failure is named and goes to the route. */
export const resendBriefCopy = (input: {
	readonly id: string;
	readonly confirmedNotSent: boolean;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const at = input.now().toISOString();
		const seen = yield* Ref.make<CopyFacts | null>(null);

		// The resend rule always writes or refuses, so there is always a claim to send.
		const claimed = yield* alwaysDecideAndSave({
			facts: readFacts(input.id, seen),
			decide: (found) =>
				resendCopy.decide(
					{ at, confirmedNotSent: input.confirmedNotSent },
					{ found },
				),
			save: saveClaim(input.id, seen),
		});

		return yield* sendClaimed(claimed.decided);
	});

/**
 * The public form sends the first copy of the brief it just stored, and answers the status the copy has: what the provider's
 * answer recorded, "failed" or "uncertain" when it could not be recorded, "failed" when the claim could not be written, and
 * null when another sender holds the copy.
 */
export const sendFirstBriefCopy = (input: {
	readonly id: string;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const at = input.now().toISOString();

		const seen = yield* Ref.make<CopyFacts | null>(null);

		const claimed = yield* decideAndSave({
			facts: readFacts(input.id, seen),
			decide: (found) => firstCopy.decide({ at }, { found }),
			save: saveClaim(input.id, seen),
		});

		if (Option.isNone(claimed.decided)) return null;
		const delivery = yield* sendClaimed(claimed.decided.value);

		return delivery.status;
	}).pipe(
		Effect.catchTags({
			// Another sender kept changing the request: it holds the copy.
			SaveKeptChanging: () => Effect.succeed(null),
			// The request could not be read, so nothing was claimed: a failure is recorded where the copy has no status.
			IntakeReadFailed: () =>
				Effect.gen(function* () {
					yield* recordClaimFailure(input.id, null, false);
					yield* stateIs("failed");

					return "failed" as const;
				}),
			// Its details cannot record a claim: nothing was sent.
			BriefCopyDetailsNotObject: () => Effect.as(stateIs("failed"), "failed"),
			CopyClaimFailed: () => Effect.succeed("failed"),
			CopyNotBuilt: () => Effect.succeed("failed"),
			CopyNotRecorded: (failure) => Effect.succeed(failure.status),
		}),
	);
