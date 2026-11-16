// An audio request: the attempt limit is counted first, then the captcha is checked, then the request limit is counted, and
// only then is the request stored. Each refusal is the rule's named refusal and goes to the route. A storage failure gives the
// request's allowance back, is logged and sends the owner an urgent alert, and then goes on as `RequestNotStored`, which the
// route tells the visitor. A stored request answers at once; the owner notice and
// the studio invitation (when the client portal is on) are handed to the background (ctx.waitUntil, with no context they are waited for) at the point the route always did,
// and never change the answer.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
	type IntakeInput,
	ownerRequestForIntake,
} from "../../lib/audio-intake";
import { logUnexpected } from "../failure";
import {
	BriefTooLarge,
	IntakeStoreFailed,
	insertRequest,
} from "../intake-store";
import {
	admitForPassedCheck,
	attemptWithinLimit,
	requestWithinLimit,
} from "../rules/intake-limits";
import {
	Background,
	OwnerAlert,
	OwnerNotice,
	ProjectInvitation,
	TurnstileCheck,
} from "../services";
import { countRequest, giveBack } from "./rate-limit";

const ROUTE = "/api/audio-intake";

/** The attempts an address may make in the window, counted before the captcha is checked. */
const ATTEMPTS = 10;

const ATTEMPT_PREFIX = "rl:audio-attempt:";
const REQUEST_PREFIX = "rl:audio:";

/** The request was not stored (it was too large to store, or the database refused it), and the owner has been told. */
export class RequestNotStored extends Data.TaggedError("RequestNotStored") {}

export type IntakeSubmission = {
	readonly input: IntakeInput;
	readonly ip: string;
	/** Whether the client portal is on, so the visitor is invited. */
	readonly portal: boolean;
	readonly now: () => Date;
	readonly newId: () => string;
};

export const submitIntake = (submission: IntakeSubmission) =>
	Effect.gen(function* () {
		const attempts = yield* countRequest(
			submission.ip,
			ATTEMPT_PREFIX,
			ATTEMPTS,
		);

		yield* attemptWithinLimit.decide({ attemptsAllowed: attempts }, {});

		const check = yield* TurnstileCheck;

		const outcome = yield* check.check(
			submission.input.turnstileToken,
			submission.ip,
		);

		yield* admitForPassedCheck.decide({ outcome }, {});

		const requested = yield* countRequest(submission.ip, REQUEST_PREFIX);

		yield* requestWithinLimit.decide({ requestAllowed: requested }, {});

		const stored = yield* insertRequest(
			ownerRequestForIntake(submission.input),
		).pipe(
			Effect.tapError((failure) =>
				Effect.gen(function* () {
					// Giving the allowance back is best effort: the owner must hear of a lost request even when the counter cannot be cleared.
					yield* giveBack(submission.ip, REQUEST_PREFIX).pipe(
						Effect.catchTag("RateLimitStoreFailed", (released) =>
							Effect.sync(() => logUnexpected(ROUTE, released.failure)),
						),
					);

					yield* Effect.sync(() =>
						logUnexpected(
							ROUTE,
							failure instanceof BriefTooLarge
								? new Error("Request details are too large.")
								: failure instanceof IntakeStoreFailed
									? failure.failure
									: failure.clash,
						),
					);

					const alert = yield* OwnerAlert;

					yield* alert
						.send({
							category: "request-storage",
							route: "/api/audio-intake",
							requestId: submission.newId(),
							code: "d1-write-failed",
							occurredAt: submission.now().toISOString(),
						})
						.pipe(Effect.ignore);
				}),
			),
			Effect.mapError(() => new RequestNotStored()),
		);

		const owner = yield* OwnerNotice;
		const background = yield* Background;

		// Each notice is best effort and says so itself: a failure is logged in the words the route has always used.
		const work = [
			owner
				.send({ input: submission.input, requestId: stored.id })
				.pipe(
					Effect.catchTag("OwnerNoticeFailed", () =>
						Effect.sync(() =>
							console.error("Owner notification email state is uncertain."),
						),
					),
				),
		];

		if (submission.portal) {
			const invitation = yield* ProjectInvitation;

			work.push(
				invitation
					.deliver(stored.id)
					.pipe(
						Effect.catchTag("ProjectInvitationFailed", () =>
							Effect.sync(() =>
								console.error("Studio invitation email state is uncertain."),
							),
						),
					),
			);
		}

		yield* background.defer(work);
	});
