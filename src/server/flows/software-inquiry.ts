// A software brief: the attempt limit is counted first, then the captcha is checked, then the submission id is looked up, and
// only a brief not stored yet is counted against the request limit and stored. A brief already stored under the id (a retry
// of the same form) is answered with the stored one and is not counted. The store is guarded by the unique index on the id:
// when another request stores the same id between the look-up and the insert, the look-up is made again (three tries, src/server/guarded-save.ts),
// finds the other request's brief and answers with it, as a retry would have been answered. This request keeps the allowance it
// spent, whatever its address (a retry from the same form, one open form sent from two addresses, or another visitor reusing the id),
// and the address-wide count is left alone; that fails closed (an address waits the usual few minutes) and it takes a race on one
// submission id to get here. A failed insert gives the
// allowance back, is logged, sends the owner an urgent alert and goes on as `BriefNotStored`, unless a look-up then finds the
// brief stored. Every refusal and failure is named and goes to the route, which says what the visitor is told. A stored brief is
// answered after the client's copy is sent; the owner notice is handed to the background (ctx.waitUntil, with no context it is
// waited for) at the point the route always did, and never changes the answer.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type { OwnerRequest } from "../../lib/owner-model";
import {
	type SoftwareInput,
	softwareBrief,
	softwareRequest,
} from "../../lib/software-inquiry";
import { logUnexpected } from "../failure";
import { decideAndSave } from "../guarded-save";
import {
	BriefTooLarge,
	findStoredBrief,
	IntakeReadFailed,
	IntakeStoreFailed,
	insertRequest,
	SubmissionIdClash,
} from "../intake-store";
import {
	admitForPassedCheck,
	attemptWithinLimit,
} from "../rules/intake-limits";
import { answerStoredBrief, storeBrief } from "../rules/software-inquiry";
import {
	Background,
	BriefCopy,
	OwnerAlert,
	SoftwareNotice,
	TurnstileCheck,
} from "../services";
import { countRequest, giveBack } from "./rate-limit";

const ROUTE = "/api/software-inquiry";

/** The index refused the insert, and the look-up that followed found no other brief: the brief is lost, and is not inserted again. */
class LostWithoutRival extends Data.TaggedError("LostWithoutRival") {}

/** The attempts an address may make in the window, counted before the captcha is checked. */
const ATTEMPTS = 10;

const ATTEMPT_PREFIX = "rl:software-attempt:";
const REQUEST_PREFIX = "rl:software:";

/** The look-up of the submission id failed before anything was counted or stored; the owner has been told. */
export class BriefReadFailed extends Data.TaggedError("BriefReadFailed") {}

/** The brief was not stored and no other request stored it; its allowance was given back and the owner has been told. */
export class BriefNotStored extends Data.TaggedError("BriefNotStored") {}

/** What the software inquiry answers when it goes through: a brief stored by an earlier request of this visitor, or the one just stored. */
export type InquiryAnswer =
	| { readonly kind: "alreadyStored"; readonly request: OwnerRequest }
	| {
			readonly kind: "sent";
			readonly request: OwnerRequest;
			readonly clientCopyStatus: string | null;
	  };

export type InquirySubmission = {
	readonly input: SoftwareInput;
	readonly ip: string;
	readonly now: () => Date;
	readonly newId: () => string;
};

export const submitInquiry = (submission: InquirySubmission) =>
	Effect.gen(function* () {
		const { input, ip } = submission;

		const attempts = yield* countRequest(ip, ATTEMPT_PREFIX, ATTEMPTS);

		yield* attemptWithinLimit.decide({ attemptsAllowed: attempts }, {});

		const check = yield* TurnstileCheck;

		const outcome = yield* check.check(input.turnstileToken, ip);

		yield* admitForPassedCheck.decide({ outcome }, {});

		// The request limit is counted once, on the first pass that finds nothing stored, and the count is kept for the
		// passes that follow a lost race; `counted` says whether it was made (and so whether to give it back).
		const counted = yield* Ref.make<boolean | null>(null);

		const requestAllowed = Effect.gen(function* () {
			const known = yield* Ref.get(counted);

			if (known !== null) return known;
			const allowed = yield* countRequest(ip, REQUEST_PREFIX);

			yield* Ref.set(counted, allowed);

			return allowed;
		});

		// What the database said when the unique index refused the brief, kept for the log if the brief is then found lost.
		const clash = yield* Ref.make<{ readonly failure: unknown } | null>(null);

		/** Giving the allowance back is best effort: the visitor is answered whether or not the counter can be cleared. */
		const release = giveBack(ip, REQUEST_PREFIX).pipe(
			Effect.catchTag("RateLimitStoreFailed", (failure) =>
				Effect.sync(() => logUnexpected(ROUTE, failure.failure)),
			),
		);

		const alertLost = (code: "d1-read-failed" | "d1-write-failed") =>
			Effect.gen(function* () {
				const alert = yield* OwnerAlert;

				// The alert is best effort: when it cannot be sent the visitor is still told the brief was not stored.
				yield* alert
					.send({
						category: "request-storage",
						route: ROUTE,
						requestId: submission.newId(),
						code,
						occurredAt: submission.now().toISOString(),
					})
					.pipe(Effect.ignore);
			});

		/** What a brief stored under the id means for this visitor: the stored brief for the same address, `SubmissionIdTaken` for another. */
		const answerStored = (found: OwnerRequest) =>
			Effect.map(
				answerStoredBrief.decide({ email: input.email }, { stored: found }),
				(request) => ({ kind: "alreadyStored", request }) as const,
			);

		/** The insert did not store the brief: a look-up says whether another request did, and if not the brief is lost. */
		const afterFailedSave = (failure: BriefTooLarge | IntakeStoreFailed) =>
			Effect.gen(function* () {
				const rival = yield* findStoredBrief(input.submissionId).pipe(
					Effect.catchTag("IntakeReadFailed", (lookup) =>
						Effect.as(
							Effect.sync(() => logUnexpected(ROUTE, lookup.failure)),
							null,
						),
					),
				);

				// Another request stored this submission id first: the allowance stays spent, whatever the address (it fails closed).
				if (rival) return rival;

				if (failure instanceof BriefTooLarge) {
					yield* release;

					return yield* Effect.fail(failure);
				}

				yield* Effect.sync(() => logUnexpected(ROUTE, failure.failure));
				yield* release;
				yield* alertLost("d1-write-failed");

				return yield* Effect.fail(new BriefNotStored());
			});

		/** The brief was refused by the index and no other brief is stored: log what the database said, give the allowance back, alert the owner. */
		const lostBrief = Effect.gen(function* () {
			const clashed = yield* Ref.get(clash);

			if (clashed)
				yield* Effect.sync(() => logUnexpected(ROUTE, clashed.failure));

			yield* release;
			yield* alertLost("d1-write-failed");

			return yield* Effect.fail(new BriefNotStored());
		});

		const stored = yield* decideAndSave({
			facts: Effect.gen(function* () {
				const found = yield* findStoredBrief(input.submissionId);

				// After the index refused the insert, a look-up that finds nothing ends the try: the insert is not made again.
				if (!found && (yield* Ref.get(clash)) !== null)
					return yield* Effect.fail(new LostWithoutRival());

				// A brief already stored is neither counted nor stored again.
				return {
					stored: found,
					requestAllowed: found ? true : yield* requestAllowed,
				};
			}),
			decide: (facts) =>
				storeBrief.decide(
					{ requestAllowed: facts.requestAllowed },
					{ stored: facts.stored },
				),
			save: () =>
				insertRequest(softwareRequest(input)).pipe(
					Effect.tapError((failure) =>
						failure instanceof SubmissionIdClash
							? Ref.set(clash, { failure: failure.clash })
							: Effect.void,
					),
				),
		}).pipe(
			Effect.map((done) => ({ kind: "done", done }) as const),
			Effect.catchTags({
				IntakeReadFailed: (failure: IntakeReadFailed) =>
					Effect.gen(function* () {
						yield* Effect.sync(() => logUnexpected(ROUTE, failure.failure));

						// Before anything was counted nothing is lost; after a lost race the look-up that failed was the rival check.
						if ((yield* Ref.get(counted)) === null) {
							yield* alertLost("d1-read-failed");

							return yield* Effect.fail(new BriefReadFailed());
						}

						// The refused insert is logged after the look-up, in the order the route has always logged them.
						const clashed = yield* Ref.get(clash);

						if (clashed)
							yield* Effect.sync(() => logUnexpected(ROUTE, clashed.failure));

						yield* release;
						yield* alertLost("d1-write-failed");

						return yield* Effect.fail(new BriefNotStored());
					}),
				BriefTooLarge: (failure: BriefTooLarge) =>
					Effect.map(
						afterFailedSave(failure),
						(rival) => ({ kind: "found", stored: rival }) as const,
					),
				IntakeStoreFailed: (failure: IntakeStoreFailed) =>
					Effect.map(
						afterFailedSave(failure),
						(rival) => ({ kind: "found", stored: rival }) as const,
					),
				LostWithoutRival: () => lostBrief,
				SaveKeptChanging: () => lostBrief,
			}),
		);

		if (stored.kind === "found") return yield* answerStored(stored.stored);

		const { facts, saved } = stored.done;

		// Nothing was stored because the id was already taken: a retry, or the loser of a race, which keeps its allowance.
		if (facts.stored) return yield* answerStored(facts.stored);

		// SAFETY: the rule stores whenever nothing is stored, so `saved` is the stored brief here.
		const request = saved as OwnerRequest;
		const copy = yield* BriefCopy;
		const clientCopyStatus = yield* copy.deliver(request);
		const notice = yield* SoftwareNotice;
		const background = yield* Background;

		yield* background.defer([
			notice
				.send({
					requestId: request.id,
					path: input.path,
					name: input.name,
					email: input.email,
					brief: softwareBrief(request),
				})
				.pipe(
					Effect.catchTag("SoftwareNoticeFailed", () =>
						Effect.sync(() =>
							console.error("Owner notification email state is uncertain."),
						),
					),
				),
		]);

		return { kind: "sent", request, clientCopyStatus } as const;
	});
